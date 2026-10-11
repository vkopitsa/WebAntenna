// Simulation results for the charts (openEMS-style: S11, Zin, Smith, far-field cuts, 3D pattern).
// Wire antennas: MoM (mom.ts). Patch: cavity + two-slot model. Collinear: array factor. No DOM.
import type { AntennaDef, Design, Params } from "./types";
import { buildMesh, gainFn, solve } from "./mom";
import { patchDesign } from "./antennas/patch";
import { loopModel, loopZin } from "./antennas/pcbloop";
import { num } from "./types";
import { C0, wavelength } from "./rf";
import { centre, parseBands } from "./bands";

export interface ZPoint { f: number; r: number; x: number }
export interface Cut { id: "xy" | "xz" | "yz"; label: string; /** angle (deg) of each sample, 0..360 */ deg: number[]; dbi: number[] }
export interface Pattern {
  f: number;
  cuts: Cut[];
  /** Gain grid for the 3D view: theta 0..180 step dTheta (rows), phi 0..360 step dPhi (cols), dBi. */
  grid: { dTheta: number; dPhi: number; dbi: number[][] };
  max: { dbi: number; theta: number; phi: number };
  /** Gain toward the opposite direction of the maximum. */
  back: number;
  /** −3 dB beamwidth in the cut through the maximum (deg), NaN if not found. */
  hpbw: number;
}
export interface SimResult {
  method: "mom" | "analytic" | "pattern-only" | "openems" | "none";
  z: ZPoint[];
  pattern: Pattern | null;
  /** Mesh size of the pattern solve (MoM). */
  unknowns?: number;
  notes: string[];
}

const DEG = Math.PI / 180;

/** Sweep frequencies (merged over the design's sweeps), capped for speed. */
export function sweepFreqs(d: Design, perBand = 21, exact = false): number[] {
  const out: number[] = [];
  for (const s of d.sweeps) {
    const n = Math.max(2, exact ? perBand : Math.min(perBand, s.steps));
    for (let i = 0; i < n; i++) out.push(s.start + ((s.stop - s.start) * i) / (n - 1));
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

/** Sample a gain function into cuts, a 3D grid and summary numbers. θ from +z, φ from +x. */
export function samplePattern(f: number, g: (th: number, ph: number) => number): Pattern {
  const step = 2;
  const ang = Array.from({ length: 360 / step + 1 }, (_, i) => i * step);
  // xy: θ = 90°, φ = a.  xz: φ = 0 for a ≤ 180 measured from +z… expressed as elevation around the y axis.
  const xz = (a: number) => { const t = a * DEG; return g(Math.acos(Math.cos(t)), Math.sin(t) >= 0 ? 0 : Math.PI); };
  const yz = (a: number) => { const t = a * DEG; return g(Math.acos(Math.cos(t)), Math.sin(t) >= 0 ? Math.PI / 2 : -Math.PI / 2); };
  const cuts: Cut[] = [
    { id: "xy", label: "Horizontal plane XY (θ = 90°)", deg: ang, dbi: ang.map((a) => g(Math.PI / 2, a * DEG)) },
    { id: "xz", label: "Vertical plane XZ (φ = 0°)", deg: ang, dbi: ang.map(xz) },
    { id: "yz", label: "Vertical plane YZ (φ = 90°)", deg: ang, dbi: ang.map(yz) },
  ];
  const dT = 5, dP = 5;
  const grid: number[][] = [];
  let max = { dbi: -Infinity, theta: 0, phi: 0 };
  for (let t = 0; t <= 180; t += dT) {
    const row: number[] = [];
    for (let p = 0; p <= 360; p += dP) {
      const v = g(t * DEG, p * DEG);
      row.push(v);
      if (v > max.dbi) max = { dbi: v, theta: t, phi: p % 360 };
    }
    grid.push(row);
  }
  const back = g((180 - max.theta) * DEG, (max.phi + 180) * DEG);
  // Beamwidth: walk away from the maximum along φ (θ fixed) and along θ (φ fixed); report the narrower.
  const walk = (fn: (d: number) => number) => {
    let lo = NaN, hi = NaN;
    for (let d = 0.5; d <= 180; d += 0.5) if (fn(d) < max.dbi - 3) { hi = d; break; }
    for (let d = 0.5; d <= 180; d += 0.5) if (fn(-d) < max.dbi - 3) { lo = d; break; }
    return lo + hi;
  };
  const bwPhi = walk((d) => g(max.theta * DEG, (max.phi + d) * DEG));
  const bwTheta = walk((d) => {
    const t = max.theta + d;
    return t < 0 ? g(-t * DEG, (max.phi + 180) * DEG) : t > 180 ? g((360 - t) * DEG, (max.phi + 180) * DEG) : g(t * DEG, max.phi * DEG);
  });
  const hpbw = Math.min(...[bwPhi, bwTheta].filter((x) => Number.isFinite(x)), Infinity);
  return { f, cuts, grid: { dTheta: dT, dPhi: dP, dbi: grid }, max, back, hpbw: Number.isFinite(hpbw) ? hpbw : NaN };
}

/** Rectangular patch: cavity RLC input impedance + two-slot far field over an infinite ground plane (Balanis ch. 14). */
function patchSim(params: Params, d: Design, freqs: number[], fPat: number): SimResult {
  const er = num(params, "er", 4.4), h = num(params, "h", 1.6e-3), z0 = num(params, "z0", 50);
  const q = patchDesign(d.f, er, h, z0);
  const R0 = q.Rin * Math.cos((Math.PI * q.y0) / q.L) ** 2;
  const Q = 1 / (Math.SQRT2 * q.bw);
  const z = freqs.map((f) => {
    const u = Q * (f / d.f - d.f / f);
    const den = 1 + u * u;
    return { f, r: R0 / den, x: (-R0 * u) / den };
  });
  const k0 = (2 * Math.PI * fPat) / C0, Le = q.L + 2 * q.dL, W = q.W;
  // Two slots at x = ±Le/2, magnetic current along y; upper hemisphere only.
  const raw = (th: number, ph: number) => {
    if (th > Math.PI / 2) return 0;
    const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
    const af = Math.cos((k0 * Le * st * cp) / 2);
    const xw = (k0 * W * st * sp) / 2;
    const sinc = Math.abs(xw) < 1e-9 ? 1 : Math.sin(xw) / xw;
    const lth = cp, lph = -ct * sp; // |ŷ·φ̂|, |ŷ·θ̂| components of the slot current
    return (af * sinc) ** 2 * (lth * lth + lph * lph);
  };
  // Normalise to directivity by integrating over the sphere.
  let P = 0;
  for (let t = 0.5; t < 90; t += 1) for (let p = 0.5; p < 360; p += 1) P += raw(t * DEG, p * DEG) * Math.sin(t * DEG) * DEG * DEG;
  const g = (th: number, ph: number) => 10 * Math.log10(Math.max((4 * Math.PI * raw(th, ph)) / P, 1e-6));
  return {
    method: "analytic", z, pattern: samplePattern(fPat, g),
    notes: ["Patch: cavity-model impedance and two-slot pattern over an infinite ground plane (no back radiation). Use openEMS or another full-wave tool for final numbers."],
  };
}

/** Coaxial collinear: N in-phase λ/2 dipoles stacked along z (array factor × dipole pattern). */
function collinearSim(params: Params, fPat: number): SimResult {
  const n = Math.round(num(params, "n", 8));
  const k = (2 * Math.PI * fPat) / C0, dz = wavelength(fPat) / 2;
  const raw = (th: number) => {
    const ct = Math.cos(th), st = Math.sin(th);
    const el = Math.abs(st) < 1e-9 ? 0 : Math.cos((Math.PI / 2) * ct) / st;
    let ar = 0, ai = 0;
    for (let i = 0; i < n; i++) { ar += Math.cos(k * i * dz * ct); ai += Math.sin(k * i * dz * ct); }
    return el * el * (ar * ar + ai * ai);
  };
  let P = 0;
  for (let t = 0.25; t < 180; t += 0.5) P += raw(t * DEG) * Math.sin(t * DEG) * 0.5 * DEG * 2 * Math.PI;
  const g = (th: number) => 10 * Math.log10(Math.max((4 * Math.PI * raw(th)) / P, 1e-6));
  return {
    method: "pattern-only", z: [], pattern: samplePattern(fPat, (th) => g(th)),
    notes: ["Collinear: ideal array-factor pattern (equal in-phase currents). No impedance: a wire model cannot represent the coax."],
  };
}

/** Small loop: analytic matched-loop impedance; magnetic-dipole pattern (axis along z, loop in the board plane). */
function loopSim(params: Params, d: Design, freqs: number[], fPat: number): SimResult {
  const m = loopModel(d.f, num(params, "a", 0.03), num(params, "b", 0.02), num(params, "w", 2e-3), num(params, "t", 35e-6), 5.8e7, num(params, "qc", 300));
  const z = freqs.map((f) => { const [r, x] = loopZin(f, m, d.f); return { f, r, x }; });
  const gmax = 10 * Math.log10(1.5 * m.eff);
  const g = (th: number) => gmax + 20 * Math.log10(Math.max(Math.abs(Math.sin(th)), 1e-3));
  return {
    method: "analytic", z, pattern: samplePattern(fPat, (th) => g(th)),
    notes: ["Small loop: analytic model (matched with Cs + Cp at the design frequency; magnetic-dipole pattern, efficiency included)."],
  };
}

/** True when the wire MoM solver models this design (the `method: "mom"` path of simulate()). */
export function momEligible(defId: string, d: Design): boolean {
  return defId !== "patch" && defId !== "collinear" && defId !== "pcbloop" && !d.pcb && !!d.necSupported && !!d.feed;
}

/**
 * True when the Radiation view can show this design: MoM currents, a wire stand-in of the PCB copper
 * (pcbwires.ts) or an assumed current distribution (idealcurrents.ts).
 */
export function radiationEligible(defId: string, d: Design): boolean {
  return momEligible(defId, d) || !!d.pcb || defId === "collinear" || defId === "pcbloop";
}

export interface SimOptions {
  /** Pattern frequency; default the design frequency. */
  patternF?: number;
  /** Max points per band for the impedance sweep. */
  perBand?: number;
  onProgress?: (done: number, total: number) => void;
}

export function simulate(def: AntennaDef, params: Params, d: Design, opt: SimOptions = {}): SimResult {
  const freqs = def.id === "patch" ? sweepFreqs(d, 101, true) : sweepFreqs(d, opt.perBand ?? 21);
  const fPat = opt.patternF ?? d.f;
  if (def.id === "patch") return patchSim(params, d, freqs, fPat);
  if (def.id === "collinear") return collinearSim(params, fPat);
  if (def.id === "pcbloop") return loopSim(params, d, sweepFreqs(d, 101, true), fPat);
  if (d.pcb) return { method: "openems", z: [], pattern: null, notes: ["Printed antenna on a dielectric: the wire solver cannot model it. Export the openEMS script, run it, and load its results file here."] };
  if (!d.necSupported) return { method: "none", z: [], pattern: null, notes: [] };
  const z: ZPoint[] = [];
  const total = freqs.length + 1;
  freqs.forEach((f, i) => {
    const m = buildMesh(d, wavelength(f), 60, 450);
    const s = m && solve(m, f);
    if (s) z.push({ f, r: s.z[0], x: s.z[1] });
    opt.onProgress?.(i + 1, total);
  });
  const m = buildMesh(d, wavelength(fPat), 60, 450);
  const s = m && solve(m, fPat);
  opt.onProgress?.(total, total);
  return {
    method: "mom",
    z,
    pattern: s ? samplePattern(fPat, gainFn(s)) : null,
    unknowns: m?.unknowns.length,
    notes: ["Thin-wire Method of Moments (MININEC formulation), free space, perfect conductors. Checked against NEC-2 on converged models."],
  };
}

/** Frequencies offered for the pattern: band centres (once each: "+ Add band" starts with a copy of the last band). */
export const patternChoices = (params: Params, d: Design): number[] => {
  const b = parseBands(String(params.bands ?? ""));
  return b.length ? [...new Set(b.map(centre))] : [d.f];
};

/** Reflection coefficient and derived values for reference impedance z0. */
export function s11(p: ZPoint, z0: number) {
  const nr = p.r - z0, ni = p.x, dr = p.r + z0, di = p.x;
  const dd = dr * dr + di * di;
  const gr = (nr * dr + ni * di) / dd, gi = (ni * dr - nr * di) / dd;
  const mag = Math.hypot(gr, gi);
  return { gr, gi, mag, db: 20 * Math.log10(Math.max(mag, 1e-6)), swr: mag >= 1 ? Infinity : (1 + mag) / (1 - mag) };
}

/** Touchstone 1-port (S RI, reference z0). */
export function toS1P(name: string, z: ZPoint[], z0: number): string {
  const lines = [`! ${name} — simulated by Antenna Generator (thin-wire MoM / analytic model)`, `# HZ S RI R ${z0}`];
  for (const p of z) { const s = s11(p, z0); lines.push(`${p.f} ${s.gr.toPrecision(8)} ${s.gi.toPrecision(8)}`); }
  return lines.join("\n") + "\n";
}

/** Every English string this module can show (for the i18n coverage test). */
export const SIM_STRINGS = [
  "Horizontal plane XY (θ = 90°)", "Vertical plane XZ (φ = 0°)", "Vertical plane YZ (φ = 90°)",
  "Patch: cavity-model impedance and two-slot pattern over an infinite ground plane (no back radiation). Use openEMS or another full-wave tool for final numbers.",
  "Collinear: ideal array-factor pattern (equal in-phase currents). No impedance: a wire model cannot represent the coax.",
  "Thin-wire Method of Moments (MININEC formulation), free space, perfect conductors. Checked against NEC-2 on converged models.",
  "Printed antenna on a dielectric: the wire solver cannot model it. Export the openEMS script, run it, and load its results file here.",
  "Small loop: analytic model (matched with Cs + Cp at the design frequency; magnetic-dipole pattern, efficiency included).",
];

/** Impedance at frequency f, linearly interpolated between samples (null outside the sweep). */
export function interpZ(z: ZPoint[], f: number): ZPoint | null {
  if (z.length < 2) return null;
  const tol = (z[z.length - 1].f - z[0].f) * 0.002;
  if (f < z[0].f - tol || f > z[z.length - 1].f + tol) return null;
  let i = 1;
  while (i < z.length - 1 && z[i].f < f) i++;
  const a = z[i - 1], b = z[i], u = Math.max(0, Math.min(1, (f - a.f) / (b.f - a.f || 1)));
  return { f, r: a.r + (b.r - a.r) * u, x: a.x + (b.x - a.x) * u };
}
