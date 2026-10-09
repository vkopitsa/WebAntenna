import type { Params, Wire } from "../types";
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

/** Thin-wire stand-in for a flat trace of width w: equivalent radius w/4 (strip ↔ wire). */
export const traceRadius = (w: number) => w / 4;

/** Wire centre-line of a trace rectangle (long axis), for the MoM approximation. */
export function traceWire(q: PcbRect, z: number, group: Wire["group"] = "driven"): Wire {
  const wx = q.x1 - q.x0, wy = q.y1 - q.y0;
  return wx >= wy
    ? { a: [q.x0, (q.y0 + q.y1) / 2, z], b: [q.x1, (q.y0 + q.y1) / 2, z], r: traceRadius(wy), group }
    : { a: [(q.x0 + q.x1) / 2, q.y0, z], b: [(q.x0 + q.x1) / 2, q.y1, z], r: traceRadius(wx), group };
}
