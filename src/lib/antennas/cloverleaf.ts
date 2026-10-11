import type { AntennaDef, Design, Vec3, Wire } from "../types";
import { num, str } from "../types";
import { deg, wavelength } from "../rf";
import { add, dist, scale, v } from "../geom";
import { band, BANDS } from "./common";

/** Angle of each leaf's two legs either side of its radial line, in the leaf's own plane (90° between them at the hub). */
export const LEG_ANGLE = 45;

const TILTS = [30, 40, 45, 50, 60];
const DL = [0.005, 0.01, 0.02, 0.04];
/**
 * Nominal leaf length / λ (leg + arc + leg, measured from the hub centre; the real wire from pin to shield is ≈ g·sin β·sin α
 * shorter and is what the dims report) for the lowest SWR at 50 Ω, from the built-in MoM (cross-checked
 * with NEC-2, docs/ANTENNAS.md): rows = tilt (TILTS), columns = wire diameter / λ (DL). The hub's closely spaced legs
 * make the antenna low-Q, so the best match is not at X = 0. FPV build guides cut 1.025 λ (307022 / f[MHz] mm).
 */
const LEAF_K: Record<3 | 4, number[][]> = {
  3: [[1.040, 1.073, 1.091, 1.052], [1.056, 1.090, 1.116, 1.114], [1.067, 1.104, 1.138, 1.172], [1.078, 1.119, 1.163, 1.229], [1.100, 1.147, 1.205, 1.290]],
  4: [[1.006, 1.042, 1.045, 0.945], [1.041, 1.081, 1.103, 1.075], [1.064, 1.113, 1.165, 1.282], [1.090, 1.150, 1.229, 1.365], [1.135, 1.207, 1.294, 1.401]],
};

/** Index and weight of x in a sorted grid (clamped at the ends). */
function cell(grid: number[], x: number): [number, number] {
  if (x <= grid[0]) return [0, 0];
  for (let i = 0; i < grid.length - 1; i++) if (x <= grid[i + 1]) return [i, (x - grid[i]) / (grid[i + 1] - grid[i])];
  return [grid.length - 2, 1];
}

/** Bilinear in tilt (degrees) and log(d/λ). */
export function leafK(leaves: 3 | 4, tiltDeg: number, dl: number): number {
  const [i, u] = cell(TILTS, tiltDeg), [j, w] = cell(DL.map(Math.log), Math.log(dl)), t = LEAF_K[leaves];
  return (1 - u) * ((1 - w) * t[i][j] + w * t[i][j + 1]) + u * ((1 - w) * t[i + 1][j] + w * t[i + 1][j + 1]);
}

/**
 * One leaf: from the hub top (centre pin, z = +g/2) a leg out at +β, an arc bulging outward, a leg back to the hub
 * bottom (shield, z = −g/2). The leaf plane holds the radial line û and v̂ = cos α·φ̂ + sin α·ẑ: a propeller blade
 * tilted by α (the mirror image, y → −y, is the other hand). Legs are L/4 each and the arc L/2 (a wire bent λ/4 from each end, as in the build guides).
 */
export function leafPoints(L: number, phi: number, tilt: number, g: number, nArc = 16): Vec3[] {
  const b = deg(LEG_ANGLE);
  const u: Vec3 = v(Math.cos(phi), Math.sin(phi), 0);
  const w: Vec3 = v(-Math.sin(phi) * Math.cos(tilt), Math.cos(phi) * Math.cos(tilt), Math.sin(tilt));
  // arc of length L/2 through both leg tips: R·2h = L/2 and R·sin h = (L/4)·sin β  →  sin h / h = sin β
  let h = 1;
  for (let i = 0; i < 60; i++) h -= (Math.sin(h) / h - Math.sin(b)) / ((h * Math.cos(h) - Math.sin(h)) / (h * h));
  const R = L / (4 * h), uc = (L / 4) * Math.cos(b) - R * Math.cos(h);
  const at = (pu: number, pw: number, z0: number): Vec3 => add(add(scale(u, pu), scale(w, pw)), v(0, 0, z0));
  // the hub offset ±g/2 fades out along each leg so the arc itself is symmetric
  const pts: Vec3[] = [at(0, 0, g / 2)];
  for (let i = 1; i <= nArc; i++) {
    const a = h - (2 * h * i) / nArc;
    pts.push(at(uc + R * Math.cos(a), R * Math.sin(a), 0));
  }
  pts.splice(1, 0, at(uc + R * Math.cos(h), R * Math.sin(h), 0));
  pts.push(at(0, 0, -g / 2));
  return pts;
}

export const cloverleaf: AntennaDef = {
  id: "cloverleaf",
  name: "Cloverleaf (FPV)",
  category: "Circular polarisation",
  traits: { pol: "circular", pattern: "omni" },
  summary: "Three or four tilted wire loops on a coax end: omnidirectional circular polarisation for FPV video links.",
  params: [
    BANDS,
    { key: "leaves", label: "Leaves", kind: "select", options: [["3", "3 (transmitter)"], ["4", "4 (receiver)"]] },
    { key: "tilt", label: "Leaf tilt", kind: "angle", min: 30, max: 60, step: 5, hint: "45° in the build guides" },
    { key: "d", label: "Wire diameter", kind: "length", min: 0.2e-3, max: 3e-3 },
    { key: "hand", label: "Polarisation", kind: "select", options: [["rhcp", "RHCP (right hand)"], ["lhcp", "LHCP (left hand)"]] },
  ],
  defaults: { bands: "5.65e9-5.95e9", leaves: "3", tilt: 45, d: 1e-3, hand: "rhcp" },
  build(p): Design {
    const { f, sweeps } = band(p);
    const n = str(p, "leaves", "3") === "4" ? 4 : 3, tilt = deg(num(p, "tilt", 45)), d = num(p, "d", 1e-3);
    const hand = str(p, "hand", "rhcp") === "lhcp" ? -1 : 1;
    const lam = wavelength(f), r = d / 2;
    const L = leafK(n, num(p, "tilt", 45), d / lam) * lam;
    const g = Math.max(1.5 * d, 0.02 * lam);
    const wires: Wire[] = [{ a: v(0, 0, -g / 2), b: v(0, 0, g / 2), r, group: "feed" }];
    let span = 0, top = 0, wire = 0, leg = 0, legAt: [Vec3, Vec3] = [v(0, 0, 0), v(0, 0, 0)];
    for (let k = 0; k < n; k++) {
      const pts = leafPoints(L, (2 * Math.PI * k) / n, tilt, g).map((q): Vec3 => [q[0], hand * q[1], q[2]]);
      for (let i = 1; i < pts.length; i++) wires.push({ a: pts[i - 1], b: pts[i], r, group: "driven", tag: k === 0 && i === Math.round(pts.length / 2) ? "L" : undefined });
      for (const q of pts) { span = Math.max(span, Math.hypot(q[0], q[1])); top = Math.max(top, Math.abs(q[2])); }
      if (k === 0) { for (let i = 1; i < pts.length; i++) wire += dist(pts[i - 1], pts[i]); leg = dist(pts[0], pts[1]); legAt = [pts[0], pts[1]]; }
    }
    return {
      wires,
      plates: [],
      feed: { wire: 0, at: "center" },
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "L", label: "Wire per leaf (pin to shield)", value: wire },
        { label: "Bend from each end (leg)", value: leg, at: legAt },
        { label: "Feed gap (pin to shield)", value: g, at: [wires[0].a, wires[0].b] },
        { label: "Outer diameter", value: 2 * span },
        { label: "Height", value: 2 * top, at: [v(0, 0, -top), v(0, 0, top)] },
      ],
      tables: [],
      perf: [
        { label: "Polarisation", value: hand === 1 ? "RHCP (right hand)" : "LHCP (left hand)" },
        { label: "Gain (MoM)", value: "≈ 0.5–1 dBic, peak ≈ 25° above and below the horizon" },
        { label: "Cross-polar rejection", value: n === 3 ? "≈ 8 dB" : "≈ 12 dB" },
        { label: "Feed impedance", value: "≈ 50–60 Ω, direct 50 Ω coax" },
      ],
      notes: [
        "Bend each wire λ/4 from both ends, solder the upper legs to the centre pin and the lower legs to the shield, then twist every leaf the same way by the tilt angle.",
        "All leaves must tilt the same way: the tilt direction sets RHCP or LHCP. Match it to the other end of the link.",
        "Cut the leaves slightly long and trim them equally for the lowest SWR.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
