// Read external results into the chart model: openEMS runs (our exported script's _results.json)
// and Touchstone .s1p (e.g. a WebVNA measurement). No DOM.
import type { Cut, Pattern, ZPoint } from "./simulate";

export interface Imported { name: string; z: ZPoint[]; pattern: Pattern | null; source: "openems" | "touchstone" }

/** Touchstone 1-port: # <unit> S <RI|MA|DB> R <z0>. Returns input impedance points. */
export function parseTouchstone(text: string, name: string): Imported {
  let unit = 1e9, fmt = "MA", z0 = 50;
  const z: ZPoint[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/!.*/, "").trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const t = line.slice(1).trim().toUpperCase().split(/\s+/);
      for (let i = 0; i < t.length; i++) {
        if (["HZ", "KHZ", "MHZ", "GHZ"].includes(t[i])) unit = { HZ: 1, KHZ: 1e3, MHZ: 1e6, GHZ: 1e9 }[t[i] as "HZ"];
        else if (["RI", "MA", "DB"].includes(t[i])) fmt = t[i];
        else if (t[i] === "R" && t[i + 1]) { const r = parseFloat(t[i + 1]); if (r > 0) z0 = r; }
      }
      continue;
    }
    const n = line.split(/\s+/).map(Number);
    if (n.length < 3 || n.some((x) => !Number.isFinite(x))) continue;
    let gr: number, gi: number;
    if (fmt === "RI") { gr = n[1]; gi = n[2]; }
    else {
      const mag = fmt === "DB" ? Math.pow(10, n[1] / 20) : n[1], ang = (n[2] * Math.PI) / 180;
      gr = mag * Math.cos(ang); gi = mag * Math.sin(ang);
    }
    // Z = z0 (1 + Γ) / (1 − Γ)
    const dr = 1 - gr, di = -gi, nr = 1 + gr, ni = gi, d = dr * dr + di * di;
    const p = { f: n[0] * unit, r: (z0 * (nr * dr + ni * di)) / d, x: (z0 * (ni * dr - nr * di)) / d };
    // |Γ| = 1 at Γ = 1 (an open) has no finite impedance; f ≤ 0 is not a frequency
    if (p.f > 0 && Number.isFinite(p.r) && Number.isFinite(p.x)) z.push(p);
  }
  z.sort((a, b) => a.f - b.f);
  if (!z.length) throw new Error("No Touchstone data found");
  return { name, z, pattern: null, source: "touchstone" };
}

interface OemsJson { f: number[]; zin_re: number[]; zin_im: number[]; theta?: number[]; cut_xz?: number[]; cut_yz?: number[]; cut_xy?: number[]; dmax_dbi?: number; efficiency?: number }

/** Results JSON written by the exported openEMS script. */
export function parseOpenEMS(obj: unknown, name: string, fPattern: number): Imported {
  const o = obj as OemsJson;
  if (!Array.isArray(o?.f) || !Array.isArray(o.zin_re)) throw new Error("Not an openEMS results file from this app");
  const z = o.f.map((f, i) => ({ f, r: o.zin_re[i], x: o.zin_im?.[i] }))
    .filter((p): p is ZPoint => p.f > 0 && Number.isFinite(p.r) && Number.isFinite(p.x));
  if (!z.length) throw new Error("Not an openEMS results file from this app");
  let pattern: Pattern | null = null;
  const ok = (a: unknown): a is number[] => Array.isArray(a) && a.length > 0;
  if (ok(o.theta) && ok(o.cut_xz) && ok(o.cut_yz) && ok(o.cut_xy)) {
    const ang = Array.from({ length: 181 }, (_, i) => i * 2);
    const th = o.theta;
    // our cuts: angle a from +z towards +x (or +y), clockwise; openEMS: θ ∈ [−180, 180] at φ = 0 / 90
    const pick = (vals: number[]) => ang.map((a) => {
      const t = a <= 180 ? a : a - 360;
      let best = 0;
      th.forEach((x, i) => { if (Math.abs(x - t) < Math.abs(th[best] - t)) best = i; });
      return vals[Math.min(best, vals.length - 1)];
    });
    const xy = o.cut_xy.length === 181 ? o.cut_xy : ang.map((_, i) => o.cut_xy![Math.min(i, o.cut_xy!.length - 1)]);
    const cuts: Cut[] = [
      { id: "xy", label: "Horizontal plane XY (θ = 90°)", deg: ang, dbi: xy },
      { id: "xz", label: "Vertical plane XZ (φ = 0°)", deg: ang, dbi: pick(o.cut_xz) },
      { id: "yz", label: "Vertical plane YZ (φ = 90°)", deg: ang, dbi: pick(o.cut_yz) },
    ];
    const all = cuts.flatMap((c) => c.dbi);
    const mx = Math.max(...all);
    pattern = { f: fPattern, cuts, grid: { dTheta: 0, dPhi: 0, dbi: [] }, max: { dbi: o.dmax_dbi ?? mx, theta: NaN, phi: NaN }, back: NaN, hpbw: NaN };
  }
  return { name, z, pattern, source: "openems" };
}
