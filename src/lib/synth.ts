// Antenna synthesis: for the requested bands, optimise every candidate antenna type's free parameters
// (Nelder–Mead on a bounded box) against simulated performance, then rank. No DOM: runs in the worker.
import type { AntennaDef, Design, Params } from "./types";
import { ANTENNAS } from "./antennas";
import { buildMesh, gainFn, solve } from "./mom";
import { patchDesign } from "./antennas/patch";
import { loopModel, loopZin } from "./antennas/pcbloop";
import { centre, formatBands, type Band } from "./bands";
import { num } from "./types";
import { wavelength } from "./rf";

export type Goal = "balanced" | "match" | "gain" | "small";
export interface SynthOptions {
  bands: Band[];
  goal: Goal;
  family: "any" | "wire" | "printed";
  pol: "any" | "vertical" | "horizontal" | "circular";
  pattern: "any" | "omni" | "beam";
  /** Wire / element diameter to build with (m). */
  d: number;
  /** Substrate for printed candidates. */
  er: number; h: number;
}

export interface Candidate {
  id: string;
  name: string;
  params: Params;
  /** Lower is better. NaN: not simulated (formula design, needs FDTD / openEMS). */
  score: number;
  /** Worst SWR (vs the antenna's natural feed impedance) per band. Gain below is the worst band's peak gain. */
  swr: number[];
  feedZ0: number;
  gain: number;
  /** Largest dimension / λ at the lowest band. */
  size: number;
  evals: number;
  note?: string;
}

interface Knob { key: string; lo: number; hi: number; int?: boolean }

/** Free parameters per type (beyond the bands, which are fixed by the request). */
function knobs(id: string, o: SynthOptions): Knob[] {
  const trim: Knob = { key: "trim", lo: -10, hi: 10 };
  switch (id) {
    case "dipole": return [trim, { key: "droop", lo: 0, hi: 50 }];
    case "groundplane": return [trim, { key: "droop", lo: 0, hi: 60 }];
    case "jpole": return [trim, { key: "sp", lo: 0.012 * wavelength(centre(o.bands[0])), hi: 0.03 * wavelength(centre(o.bands[0])) }];
    case "moxon": return [trim];
    case "quad": return [trim, { key: "sp", lo: 0.1, hi: 0.25 }];
    case "biquad": return [trim, { key: "sp", lo: 0.08, hi: 0.2 }];
    case "yagi": return [trim];
    case "helix": return [trim, { key: "pitch", lo: 11, hi: 15 }];
    case "cloverleaf": return [trim, { key: "tilt", lo: 35, hi: 55 }];
    case "discone": return [trim, { key: "half", lo: 25, hi: 40 }];
    case "fandipole": return [{ key: "fan", lo: 10, hi: 45 }];
    case "patch": return [{ key: "h", lo: 0.4e-3, hi: Math.min(3.2e-3, 0.06 * wavelength(centre(o.bands[0])) / Math.sqrt(o.er)) }];
    case "pcbloop": return [{ key: "a", lo: 0.01, hi: Math.min(0.08, 0.1 * wavelength(centre(o.bands[0]))) }, { key: "b", lo: 0.01, hi: Math.min(0.08, 0.1 * wavelength(centre(o.bands[0]))) }];
    default: return [];
  }
}

/** Discrete variants explored as separate starts (e.g. Yagi element count, helix turns). */
function variants(id: string, o: SynthOptions): Params[] {
  if (id === "yagi") return (o.goal === "small" ? [3, 4] : o.goal === "gain" ? [5, 9, 15] : [3, 5, 9]).map((n) => ({ n, driven: "folded" }));
  if (id === "helix") return (o.goal === "small" ? [4] : o.goal === "gain" ? [8, 14] : [6, 10]).map((turns) => ({ turns }));
  return [{}];
}

/** Single-band types physically cannot be at their best on several separate bands; they are still scored on all. */
function candidates(o: SynthOptions): AntennaDef[] {
  return ANTENNAS.filter((a) => {
    if (a.id === "collinear") return false; // no impedance model
    const printed = a.category === "Printed";
    if (o.family === "wire" && printed) return false;
    if (o.family === "printed" && !printed) return false;
    const t = a.traits!;
    if (o.pol !== "any" && !(t.pol === o.pol || t.pol === "linear")) return false;
    if (o.pattern === "omni" && t.pattern === "beam") return false;
    if (o.pattern === "beam" && t.pattern !== "beam") return false;
    // Size sanity: printed antennas above ~6 GHz or below ~100 MHz, patches/helices below 300 MHz are impractical.
    const f = centre(o.bands[0]);
    if (printed && (f < 100e6 || f > 10e9) && a.id !== "patch") return false;
    if ((a.id === "patch" || a.id === "helix" || a.id === "biquad") && f < 300e6) return false;
    return true;
  });
}

function sizeOf(d: Design, lam: number): number {
  const pts = [...d.wires.filter((w) => !w.necOnly).flatMap((w) => [w.a, w.b]), ...d.plates.flatMap((p) => p.pts)];
  if (!pts.length) return 0;
  let m = 0;
  for (let i = 0; i < 3; i++) m = Math.max(m, Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i])));
  return m / lam;
}

const swrOf = (r: number, x: number, z0: number) => {
  const g = Math.hypot(r - z0, x) / Math.hypot(r + z0, x);
  return g >= 1 ? 99 : (1 + g) / (1 - g);
};

/** Evaluate one parameter set: worst SWR per band (3 points per band: edges + centre) and peak gain at band 1. */
function evaluate(def: AntennaDef, p: Params, o: SynthOptions, withGain: boolean): { swr: number[]; gain: number; size: number; z0: number } | null {
  let d: Design;
  try { d = def.build(p); } catch { return null; }
  const z0 = d.feedZ0 ?? 50;
  const lamLow = wavelength(Math.min(...o.bands.map((b) => b[0])));
  const pts = (b: Band) => (b[1] > b[0] ? [b[0], centre(b), b[1]] : [b[0]]);
  if (def.id === "patch") {
    const q = patchDesign(d.f, num(p, "er", 4.4), num(p, "h", 1.6e-3), num(p, "z0", 50));
    const R0 = q.Rin * Math.cos((Math.PI * q.y0) / q.L) ** 2, Q = 1 / (Math.SQRT2 * q.bw);
    const swr = o.bands.map((b) => Math.max(...pts(b).map((f) => { const u = Q * (f / d.f - d.f / f), den = 1 + u * u; return swrOf(R0 / den, (-R0 * u) / den, 50); })));
    return { swr, gain: 6.5, size: sizeOf(d, lamLow), z0: 50 };
  }
  if (def.id === "pcbloop") {
    const m = loopModel(d.f, num(p, "a", 0.03), num(p, "b", 0.02), num(p, "w", 2e-3), num(p, "t", 35e-6), 5.8e7, num(p, "qc", 300));
    const swr = o.bands.map((b) => Math.max(...pts(b).map((f) => { const [r, x] = loopZin(f, m, d.f); return swrOf(r, x, 50); })));
    return { swr, gain: 1.76 + 10 * Math.log10(Math.max(m.eff, 1e-6)), size: sizeOf(d, lamLow), z0: 50 };
  }
  if (!d.necSupported) return null;
  const swr: number[] = [];
  for (const b of o.bands) {
    let worst = 1;
    for (const f of pts(b)) {
      const m = buildMesh(d, wavelength(f), 24, 220);
      const s = m && solve(m, f);
      if (!s) return null;
      worst = Math.max(worst, swrOf(s.z[0], s.z[1], z0));
    }
    swr.push(worst);
  }
  // Gain = the WORST band's peak gain: an antenna that is great on band 1 but sprays lobes on band 2 must not win.
  let gain = NaN;
  if (withGain) {
    gain = Infinity;
    for (const b of o.bands) {
      const f = centre(b);
      const m = buildMesh(d, wavelength(f), 24, 220);
      const s = m && solve(m, f);
      if (!s) continue;
      const g = gainFn(s);
      let peak = -Infinity;
      for (let th = 10; th <= 170; th += 20) for (let ph = 0; ph < 360; ph += 20) peak = Math.max(peak, g((th * Math.PI) / 180, (ph * Math.PI) / 180));
      gain = Math.min(gain, peak);
    }
    if (!Number.isFinite(gain)) gain = NaN;
  }
  return { swr, gain, size: sizeOf(d, lamLow), z0 };
}

/** Mismatch loss in dB for an SWR. */
const mlDb = (s: number) => { const g = (s - 1) / (s + 1); return -10 * Math.log10(Math.max(1 - g * g, 1e-6)); };

function cost(e: { swr: number[]; gain: number; size: number }, goal: Goal): number {
  const ml = Math.max(...e.swr.map(mlDb)); // worst band dominates
  const g = Number.isFinite(e.gain) ? e.gain : 0;
  const big = Math.max(0, e.size - 0.5);
  switch (goal) {
    case "match": return 10 * ml + 0.2 * big;
    case "gain": return 4 * ml - g + 0.1 * big;
    case "small": return 4 * ml + 3 * e.size;
    default: return 6 * ml - 0.4 * g + 0.8 * big;
  }
}

/** Bounded Nelder–Mead in [0,1]^n. */
function nelderMead(f: (x: number[]) => number, x0: number[], iters: number): { x: number[]; v: number } {
  const n = x0.length;
  if (n === 0) return { x: [], v: f([]) };
  const clamp = (x: number[]) => x.map((v) => Math.min(1, Math.max(0, v)));
  let simplex = [x0, ...x0.map((_, i) => clamp(x0.map((v, j) => (j === i ? v + (v < 0.5 ? 0.25 : -0.25) : v))))].map((x) => ({ x, v: f(x) }));
  for (let k = 0; k < iters; k++) {
    simplex.sort((a, b) => a.v - b.v);
    const best = simplex[0], worst = simplex[n], second = simplex[n - 1];
    const c = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((s, p) => s + p.x[j], 0) / n);
    const at = (t: number) => clamp(c.map((v, j) => v + t * (worst.x[j] - v)));
    const r = at(-1), vr = f(r);
    if (vr < best.v) {
      const e = at(-2), ve = f(e);
      simplex[n] = ve < vr ? { x: e, v: ve } : { x: r, v: vr };
    } else if (vr < second.v) simplex[n] = { x: r, v: vr };
    else {
      const ct = at(0.5), vc = f(ct);
      if (vc < worst.v) simplex[n] = { x: ct, v: vc };
      else simplex = simplex.map((p, i) => (i === 0 ? p : (() => { const x = clamp(p.x.map((v, j) => best.x[j] + 0.5 * (v - best.x[j]))); return { x, v: f(x) }; })()));
    }
    if (Math.abs(simplex[n].v - simplex[0].v) < 1e-3) break;
  }
  simplex.sort((a, b) => a.v - b.v);
  return simplex[0];
}

export function synthesize(o: SynthOptions, onProgress?: (done: number, total: number, current: string) => void): Candidate[] {
  const bandsStr = formatBands(o.bands);
  const defs = candidates(o);
  const jobs = defs.flatMap((def) => variants(def.id, o).map((v) => ({ def, v })));
  const out: Candidate[] = [];
  const withGain = o.goal !== "match" && o.goal !== "small";
  jobs.forEach(({ def, v }, i) => {
    onProgress?.(i, jobs.length, def.name);
    const base: Params = { ...def.defaults, bands: bandsStr, ...v };
    if ("d" in def.defaults) base.d = o.d;
    if ("er" in def.defaults) { base.er = o.er; base.h = o.h; }
    if (def.category === "Printed" && def.id !== "patch" && def.id !== "pcbloop") {
      // No in-browser solver for these yet: formula design, listed unscored.
      const d = def.build(base);
      out.push({ id: def.id, name: def.name, params: base, score: NaN, swr: [], feedZ0: d.feedZ0 ?? 50, gain: NaN, size: sizeOf(d, wavelength(Math.min(...o.bands.map((b) => b[0])))), evals: 0, note: "Formula design (openEMS-calibrated); not simulated in the browser yet" });
      return;
    }
    const ks = knobs(def.id, o);
    const toParams = (x: number[]): Params => {
      const p = { ...base };
      ks.forEach((k, j) => { const val = k.lo + x[j] * (k.hi - k.lo); p[k.key] = k.int ? Math.round(val) : +val.toPrecision(5); });
      return p;
    };
    let evals = 0;
    const cache = new Map<string, number>();
    const f = (x: number[]) => {
      const key = x.map((v) => v.toFixed(3)).join(",");
      if (cache.has(key)) return cache.get(key)!;
      evals++;
      const e = evaluate(def, toParams(x), o, withGain);
      const c = e ? cost(e, o.goal) : 1e6;
      cache.set(key, c);
      return c;
    };
    const x0 = ks.map((k) => {
      const dflt = Number(base[k.key] ?? 0);
      return Math.min(1, Math.max(0, (dflt - k.lo) / (k.hi - k.lo)));
    });
    const iters = def.id === "fandipole" ? 6 : def.id === "discone" || def.id === "helix" || def.id === "biquad" ? 10 : 22;
    const best = nelderMead(f, x0, iters);
    const params = toParams(best.x);
    const e = evaluate(def, params, o, true);
    if (!e) return;
    out.push({ id: def.id, name: def.name, params, score: cost(e, o.goal), swr: e.swr, feedZ0: e.z0, gain: e.gain, size: e.size, evals });
  });
  onProgress?.(jobs.length, jobs.length, "");
  const scored = out.filter((c) => Number.isFinite(c.score)).sort((a, b) => a.score - b.score);
  // Keep the best variant per type.
  const seen = new Set<string>();
  const uniq = scored.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)));
  return [...uniq, ...out.filter((c) => !Number.isFinite(c.score))];
}
