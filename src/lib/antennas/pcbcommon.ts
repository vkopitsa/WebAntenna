import type { Params, Vec3, Wire } from "../types";
import { num } from "../types";
import { r, type Pcb, type PcbRect } from "../pcb";

/** Board with a ground pour (top + bottom) for y ∈ [−gl, 0] and an antenna keep-out above y = 0. */
export function groundedBoard(p: Params, top: number, extra: PcbRect[], port: Pcb["port"]): Pcb {
  const er = num(p, "er", 4.4), h = num(p, "h", 1.6e-3), tanD = num(p, "tanD", 0.02), gl = num(p, "gl", 0.04), bw = num(p, "bw", 0.03);
  return {
    board: { x0: -bw / 2, y0: -gl, x1: bw / 2, y1: top },
    h, er, tanD, t: 35e-6,
    rects: [r("top", -bw / 2, -gl, bw / 2, 0, "Ground (top)"), r("bottom", -bw / 2, -gl, bw / 2, 0, "Ground (bottom)"), ...extra],
    port,
  };
}

/** In-plane lumped port across the gap between the ground edge (y = 0) and a trace starting at y = g. */
export const gapPort = (x: number, w: number, g: number, h: number): Pcb["port"] =>
  ({ start: [x - w / 2, 0, h], stop: [x + w / 2, g, h], dir: "y", R: 50 });

/** Dimension span between two board points (x0, y0) → (x1, y1) at height z, in model coordinates. */
export const span = (x0: number, y0: number, x1: number, y1: number, z: number): [Vec3, Vec3] => [[x0, y0, z], [x1, y1, z]];

/** Width (x) and length (y) spans along the edges of the board, on its top face z. */
export const boardSpans = (b: Pcb["board"], z: number) => ({ w: span(b.x0, b.y0, b.x1, b.y0, z), l: span(b.x0, b.y0, b.x0, b.y1, z) });

/** Thin-wire stand-in for a flat trace of width w: equivalent radius w/4 (strip ↔ wire). */
export const traceRadius = (w: number) => w / 4;

/** Wire centre-line of a trace rectangle (long axis), for the MoM approximation. */
export function traceWire(q: PcbRect, z: number, group: Wire["group"] = "driven"): Wire {
  const wx = q.x1 - q.x0, wy = q.y1 - q.y0;
  return wx >= wy
    ? { a: [q.x0, (q.y0 + q.y1) / 2, z], b: [q.x1, (q.y0 + q.y1) / 2, z], r: traceRadius(wy), group }
    : { a: [(q.x0 + q.x1) / 2, q.y0, z], b: [(q.x0 + q.x1) / 2, q.y1, z], r: traceRadius(wx), group };
}
