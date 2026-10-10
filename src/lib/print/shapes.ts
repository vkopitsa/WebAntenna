import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR, FLANGE_BODY, FLANGE_PITCH, M3_HOLE, M3_NUT, M3_NUT_DEPTH, ZIP_T, ZIP_W } from "./rules";

/** Building blocks for printed parts. Everything is in mm. */
export type V3 = [number, number, number];
type M = ManifoldToplevel;

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));

/** Cylinder of diameter d from a to b. */
export function rod(M: M, a: V3, b: V3, d: number): Manifold {
  const u = sub(b, a), L = Math.hypot(...u);
  const th = (Math.acos(u[2] / L) * 180) / Math.PI, ph = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  return M.Manifold.cylinder(L, d / 2, d / 2, undefined, false).rotate([0, th, ph]).translate(a);
}

/** Bar of width w from a to b: the hull of two cubes centred on the ends. */
export const bar = (M: M, a: V3, b: V3, w: number): Manifold =>
  M.Manifold.hull([M.Manifold.cube(w, true).translate(a), M.Manifold.cube(w, true).translate(b)]);

/** Axis-aligned box between two corners. */
export const box = (M: M, lo: V3, hi: V3): Manifold => M.Manifold.cube(sub(hi, lo), false).translate(lo);

/** Channel for a wire or tube of diameter d from a to b: d + clearance, 1 mm past both ends so it cuts cleanly. */
export function channel(M: M, a: V3, b: V3, d: number): Manifold {
  const u = unit(sub(b, a));
  return rod(M, sub(a, u), add(b, u), d + CLEAR);
}

/** Vertical M3 screw hole at (x, y) from z0 to z1, with a hexagonal nut pocket at the top (z1) or the bottom (z0). */
export function m3(M: M, x: number, y: number, z0: number, z1: number, nutTop: boolean): Manifold {
  const hole = M.Manifold.cylinder(z1 - z0 + 2, M3_HOLE / 2, M3_HOLE / 2, undefined, false).translate([x, y, z0 - 1]);
  const nut = M.Manifold.cylinder(M3_NUT_DEPTH + 1, M3_NUT / 2, M3_NUT / 2, 6, false)
    .translate([x, y, nutTop ? z1 - M3_NUT_DEPTH : z0 - 1]);
  return hole.add(nut);
}

/** Slot for a zip tie centred at c, cut through along `through` with the strap width along `wide`. */
export function zipSlot(M: M, c: V3, through: 0 | 1 | 2, wide: 0 | 1 | 2, len: number): Manifold {
  const s: V3 = [ZIP_T, ZIP_T, ZIP_T];
  s[through] = len; s[wide] = ZIP_W;
  return M.Manifold.cube(s, true).translate(c);
}

/** Cut-out for an SO-239 or N 4-hole panel jack centred on the z axis, through z0..z1: body hole and four M3 holes with nut pockets at z0. */
export function flangeCut(M: M, z0: number, z1: number): Manifold {
  const h = FLANGE_PITCH / 2;
  return M.Manifold.union([
    M.Manifold.cylinder(z1 - z0 + 2, FLANGE_BODY / 2, FLANGE_BODY / 2, undefined, false).translate([0, 0, z0 - 1]),
    ...[[h, h], [-h, h], [-h, -h], [h, -h]].map(([x, y]) => m3(M, x, y, z0, z1, false)),
  ]);
}
