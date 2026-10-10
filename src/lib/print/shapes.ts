import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR, FLANGE_BODY, FLANGE_PITCH, M3_HOLE, M3_NUT, M3_NUT_DEPTH, SEG_H, ZIP_T, ZIP_W } from "./rules";

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

/** Helical groove for a wire of diameter d whose centre runs at radius R, starting at angle 0 at z0 and rising S per
 *  turn; hand +1 turns counter-clockwise seen from +z (y = +R sin t), −1 clockwise. The 2D section is the horizontal
 *  slice of a tube of diameter d + CLEAR round the helix: at a shallow pitch it is a long curved bean, the union of the
 *  discs cut from balls along the helix. Twist-extruding that section reproduces the tube exactly. */
export function twistGroove(M: M, R: number, d: number, z0: number, z1: number, S: number, hand: 1 | -1): Manifold {
  const rc = (d + CLEAR) / 2, steps = 16;
  const discs = Array.from({ length: 2 * steps + 1 }, (_, i) => {
    const dz = (rc * (i - steps)) / steps, phi = (hand * 2 * Math.PI * dz) / S, r = Math.sqrt(Math.max(rc * rc - dz * dz, 1e-6));
    return M.CrossSection.circle(r, 24).translate([R * Math.cos(phi), R * Math.sin(phi)]);
  });
  const bean = M.CrossSection.union(discs.slice(1).map((c, i) => M.CrossSection.hull([discs[i], c])));
  const turns = (z1 - z0) / S;
  const perTurn = Math.max(24, Math.ceil((2 * Math.PI) / Math.sqrt(0.4 / R)));   // chord sag R·θ²/8 < 0.05 mm
  // manifold twists the top counter-clockwise for positive degrees (checked by shapes.test.ts)
  return M.Manifold.extrude(bean, z1 - z0, Math.ceil(perTurn * turns), hand * 360 * turns).translate([0, 0, z0]);
}

/** D-shaped section: a circle of radius r cut flat at x = flat. Keys a spigot so stacked pieces fit one way only. */
export const dShape = (M: M, r: number, flat: number): CrossSection =>
  M.CrossSection.circle(r, 64).intersect(M.CrossSection.square([flat + r + 1, 2 * r + 2]).translate([-r - 1, -r - 1]));

/** Bottoms of the stacked pieces of a body of height H: equal pieces no taller than SEG_H. */
export const pieceBottoms = (H: number): number[] => { const k = Math.ceil(H / SEG_H); return Array.from({ length: k }, (_, i) => (i * H) / k); };

export type Joint = { below?: Manifold; aboveAdd?: Manifold; aboveCut?: Manifold };

/** Cut a body standing on z = 0 into the pieces of `pieceBottoms(H)`, each moved down so its cut is at z = 0 (a joint that adds
 *  a skirt below the cut puts the piece's lowest point below z = 0). At each cut zc,
 *  `joint(zc)` gives the spigot the piece below gains and what the piece above gains or loses (all in body coordinates). */
export function stack(body: Manifold, H: number, joint: (zc: number) => Joint): Manifold[] {
  const zs = pieceBottoms(H);
  if (zs.length === 1) return [body];
  return zs.map((z0, i) => {
    const z1 = i + 1 < zs.length ? zs[i + 1] : Infinity;
    let p = body.trimByPlane([0, 0, 1], z0);
    if (z1 !== Infinity) { p = p.trimByPlane([0, 0, -1], -z1); const j = joint(z1); if (j.below) p = p.add(j.below); }
    if (i > 0) { const j = joint(z0); if (j.aboveAdd) p = p.add(j.aboveAdd); if (j.aboveCut) p = p.subtract(j.aboveCut); }
    return p.translate([0, 0, -z0]);
  });
}

/** Move `at` to the origin and turn `dir` to +z (for printing a part along its axis). */
export function toZ(part: Manifold, at: V3, dir: V3): Manifold {
  const u = unit(dir), th = (Math.acos(Math.max(-1, Math.min(1, u[2]))) * 180) / Math.PI, ph = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  return part.translate(scale(at, -1)).rotate([0, 0, -ph]).rotate([0, -th, 0]);
}
