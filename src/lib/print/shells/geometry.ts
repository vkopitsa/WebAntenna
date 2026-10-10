import type { Design, Vec3 } from "../../types";
import { copperBoxes } from "../../pcb";
import { MAX_SIZE, mm } from "../rules";
import { add, pieceBottoms, scale, sub, unit, type V3 } from "../shapes";

/** Geometry helpers for shells, in mm. */
export type Box3 = { lo: V3; hi: V3 };
export type Style = "fpv" | "outdoor";
export const STYLE: Record<Style, { wall: number; gap: number }> = { fpv: { wall: 1.2, gap: 1.5 }, outdoor: { wall: 2, gap: 3 } };
export const FPV_HZ = 2e9;
const FOOT = 170;                          // largest dome diameter
export const EAR = 7;                            // screw ears stick out this far past the wall (each side)

const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];
export const grow = (b: Box3, k: number): Box3 => ({ lo: [b.lo[0] - k, b.lo[1] - k, b.lo[2] - k], hi: [b.hi[0] + k, b.hi[1] + k, b.hi[2] + k] });
export const size = (b: Box3): V3 => [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
export const inside = (b: Box3, p: V3) => p.every((v, i) => v >= b.lo[i] - 1e-9 && v <= b.hi[i] + 1e-9);
export const styleOf = (d: Design): Style => (d.f >= FPV_HZ ? "fpv" : "outdoor");

function bounds(pts: V3[]): Box3 {
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))) as V3, hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))) as V3;
  return { lo, hi };
}

/** The antenna itself: live wires (with their radius), plates and the PCB board (z 0..h). */
export function envelope(d: Design): Box3 {
  const pts: V3[] = [];
  for (const w of d.wires) {
    if (w.drawOnly || w.necOnly) continue;
    const r = mm(w.r);
    for (const p of [mmv(w.a), mmv(w.b)]) pts.push(sub(p, [r, r, r]), add(p, [r, r, r]));
  }
  // PCB copper plates (the arm can overrun the board): the board united with every copper rectangle in x/y, z -t .. h+t
  if (d.pcb) {
    const b = d.pcb.board, t = mm(d.pcb.t), xs = [b.x0, b.x1], ys = [b.y0, b.y1];
    for (const q of copperBoxes(d.pcb)) { xs.push(q.x0, q.x1); ys.push(q.y0, q.y1); }
    pts.push([mm(Math.min(...xs)), mm(Math.min(...ys)), -t], [mm(Math.max(...xs)), mm(Math.max(...ys)), mm(d.pcb.h) + t]);
  } else for (const pl of d.plates ?? []) for (const p of pl.pts) pts.push(mmv(p));
  return bounds(pts);
}

/** Feed point from the design's feed wire; antennas without one (collinear) feed at the origin. */
export function feedPoint(d: Design): V3 {
  if (!d.feed) return [0, 0, 0];
  const w = d.wires[d.feed.wire], a = mmv(w.a), b = mmv(w.b);
  return d.feed.at === "start" ? a : d.feed.at === "end" ? b : scale(add(a, b), 0.5);
}

/** A wire (or lug) leaving a box: `d` is the diameter of the circle round it; `w`, when set, says it is a `bar()` lug
 *  of that width (a hull of axis-aligned cubes) and the hole may follow its shape; `from` is where such a lug starts (the
 *  hole never reaches back past it); `free` says the wire ends free outside (no other live wire is attached to its
 *  outer end), so a hood can be lowered over that end. */
export type Exit = { at: V3; dir: V3; d: number; w?: number; from?: V3; free?: boolean };

/** Where wires (not NEC-only; drawn parts like booms included) cross the surface of a box: the crossing point, the
 *  direction out of the box and the wire diameter. A wire through the box gives two exits. */
export function exits(d: Design, b: Box3): Exit[] {
  const out: Exit[] = [];
  const live = d.wires.filter((w) => !w.drawOnly && !w.necOnly);
  // no other live wire has an endpoint within 0.5 mm of p
  const freeEnd = (w: (typeof d.wires)[number], p: V3) => !live.some((o) => o !== w && [mmv(o.a), mmv(o.b)].some((q) => Math.hypot(...sub(q, p)) < 0.5));
  for (const w of d.wires) {
    if (w.necOnly) continue;
    const a = mmv(w.a), c = mmv(w.b), u = sub(c, a);
    let t0 = 0, t1 = 1, hit = true;
    for (let i = 0; i < 3 && hit; i++) {
      if (Math.abs(u[i]) < 1e-12) { if (a[i] < b.lo[i] || a[i] > b.hi[i]) hit = false; continue; }
      let ta = (b.lo[i] - a[i]) / u[i], tb = (b.hi[i] - a[i]) / u[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) hit = false;
    }
    if (!hit) continue;
    const dir = unit(u), dw = mm(2 * w.r), back = freeEnd(w, a), fwd = freeEnd(w, c);
    if (t0 > 1e-9) out.push({ at: add(a, scale(u, t0)), dir: scale(dir, -1), d: dw, free: back });
    // an endpoint exactly on a face, with the wire pointing through it, counts as crossing that face
    const onFace = (p: V3, sgn: number) => [0, 1, 2].some((i) => Math.abs(u[i]) > 1e-12 && Math.abs(p[i] - (u[i] * sgn > 0 ? b.hi[i] : b.lo[i])) < 1e-9);
    if (t0 <= 1e-9 && t1 > 1e-9 && onFace(a, -1)) out.push({ at: a, dir: scale(dir, -1), d: dw, free: back });
    if (t1 < 1 - 1e-9 || (t1 >= 1 - 1e-9 && onFace(c, 1))) out.push({ at: add(a, scale(u, t1)), dir, d: dw, free: fwd });
  }
  // a polyline vertex exactly on the surface gives the same exit twice: keep the first, free when the piece that
  // actually runs on outside ends free
  const same = (x: Exit, y: Exit) => Math.hypot(...sub(x.at, y.at)) < 0.5 && x.dir[0] * y.dir[0] + x.dir[1] * y.dir[1] + x.dir[2] * y.dir[2] > 0.999;
  return out.filter((x, i) => !out.slice(0, i).some((y) => same(x, y)))
    .map((x) => ({ ...x, free: out.some((y) => same(x, y) && y.free) }));
}

/** A clamshell round `inner` with this wall (and its screw ears) fits the bed. */
export const boxFits = (inner: Box3, wall: number) => Math.max(...size(grow(inner, wall + EAR))) <= MAX_SIZE;
/** A dome of inner radius r whose body is H tall (`domeHeight`, base to cone apex) fits: diameter within FOOT, at most
 *  3 stacked pieces. */
export const domeFits = (r: number, H: number, wall: number) => 2 * (r + wall) <= FOOT && pieceBottoms(H).length <= 3;
