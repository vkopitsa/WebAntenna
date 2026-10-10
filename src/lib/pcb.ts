// Printed (PCB) antennas: board + copper rectangles + lumped feed port. Board in the xy plane,
// bottom copper at z = 0, top copper at z = h. Rectangles keep the openEMS mesh exact (edge "thirds" rule);
// polygons (diagonal traces) are staircased by the FDTD mesh, like openEMS does.
import type { Plate, Vec3 } from "./types";
import { rect, v } from "./geom";

export interface PcbRect { layer: "top" | "bottom"; x0: number; y0: number; x1: number; y1: number; label: string }
/** Copper polygon (simple, either winding), for traces that are not axis-aligned. */
export interface PcbPoly { layer: "top" | "bottom"; pts: [number, number][]; label: string }
export interface PcbPort {
  /** Box of the lumped port (metres). For an in-plane gap port z0 = z1 = h; for a probe z0 = 0, z1 = h. */
  start: Vec3; stop: Vec3;
  dir: "x" | "y" | "z";
  R: number;
}
export interface Pcb {
  board: { x0: number; y0: number; x1: number; y1: number };
  h: number; er: number; tanD: number; t: number;
  rects: PcbRect[];
  polys?: PcbPoly[];
  port: PcbPort;
}

export const r = (layer: PcbRect["layer"], x0: number, y0: number, x1: number, y1: number, label: string): PcbRect =>
  ({ layer, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), label });

/** Bounding rectangle of a polygon (same layer and label). */
export const polyBox = (q: PcbPoly): PcbRect => {
  const xs = q.pts.map((p) => p[0]), ys = q.pts.map((p) => p[1]);
  return r(q.layer, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), q.label);
};

/** Every copper shape as a rectangle (polygons by their bounding box): for extents, keep-outs and layer counts. */
export const copperBoxes = (p: Pcb): PcbRect[] => [...p.rects, ...(p.polys ?? []).map(polyBox)];

/** Point in polygon (even–odd rule). */
export function inPoly(pts: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Narrowest copper feature: the short side of every rectangle and the shortest edge of every polygon. */
export function minCopperFeature(p: Pcb): number {
  let m = Infinity;
  for (const q of p.rects) m = Math.min(m, q.x1 - q.x0, q.y1 - q.y0);
  for (const q of p.polys ?? []) q.pts.forEach((a, i) => { const b = q.pts[(i + 1) % q.pts.length]; m = Math.min(m, Math.hypot(b[0] - a[0], b[1] - a[1])); });
  return m;
}

/** Drawing / CAD plates for a PCB: substrate, then copper (merged visually per label). */
export function pcbPlates(p: Pcb): Plate[] {
  const { board: b, h, t } = p;
  const plates: Plate[] = [
    { pts: rect(v((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, 0), v((b.x1 - b.x0) / 2, 0, 0), v(0, (b.y1 - b.y0) / 2, 0)), thickness: h, material: "dielectric", label: "Substrate" },
  ];
  for (const q of p.rects) {
    const z = q.layer === "top" ? h : -t;
    plates.push({ pts: rect(v((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, z), v((q.x1 - q.x0) / 2, 0, 0), v(0, (q.y1 - q.y0) / 2, 0)), thickness: t, material: "metal", label: q.label });
  }
  for (const q of p.polys ?? []) plates.push({ pts: q.pts.map(([x, y]) => v(x, y, q.layer === "top" ? h : -t)), thickness: t, material: "metal", label: q.label });
  return plates;
}

/**
 * Effective permittivity seen by a trace printed on a substrate with no ground below it (air on top,
 * thin dielectric under): εeff = 1 + q (εr − 1), q fitted per antenna type with openEMS (docs/ANTENNAS.md).
 */
export const eeffPrinted = (er: number, q: number) => 1 + q * (er - 1);

/** Common PCB parameter definitions. */
export const PCB_PARAMS = {
  er: { key: "er", label: "Substrate εr", kind: "number", min: 1, max: 15, step: 0.05, hint: "FR-4 ≈ 4.3–4.6, RO4003C 3.38" },
  h: { key: "h", label: "Substrate thickness", kind: "length", min: 0.1e-3, max: 5e-3 },
  tanD: { key: "tanD", label: "Loss tangent tan δ", kind: "number", min: 0, max: 0.1, step: 0.001, hint: "FR-4 ≈ 0.02, RO4003C 0.0027" },
  w: { key: "w", label: "Trace width", kind: "length", min: 0.1e-3, max: 10e-3 },
  gl: { key: "gl", label: "Ground plane length", kind: "length", min: 5e-3, max: 0.5, hint: "PCB area with copper pour (your circuit)" },
  bw: { key: "bw", label: "Board width", kind: "length", min: 5e-3, max: 0.5 },
} as const;

/** Resonant-length trim for printed antennas (FDTD "Tune to band" sets it). */
export const PRINTED_TRIM = { key: "trim", label: "Length trim (%)", kind: "number", min: -25, max: 25, step: 0.5, hint: "Scales the resonant length; set by FDTD tuning" } as const;

/** Probe feed: a vertical port of zero cross-section inside the board (needs a drilled hole); otherwise an edge or gap port. */
export const isProbe = (p: Pcb) => p.port.dir === "z" && p.port.start[0] === p.port.stop[0] && p.port.start[1] === p.port.stop[1];
