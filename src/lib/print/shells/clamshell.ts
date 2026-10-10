import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR, M3_HOLE, M3_NUT, M3_NUT_DEPTH } from "../rules";
import { box, rod, type V3 } from "../shapes";
import { grow, type Box3 } from "./geometry";

/** Two-half box round an inner cavity: a lip on the bottom half seats in a recess of the top half (seal it with
 *  silicone outdoors), four M3 screw ears at the vertical corners, and the caller's cuts (wire, coax, connector holes). */
export type ClamOpts = { inner: Box3; wall: number; splitZ: number; cuts?: Manifold[]; drain?: boolean; adds?: { bottom?: Manifold[]; top?: Manifold[] } };

export const EAR_R = 4;
const EAR_OFF = EAR_R - 1;   // centre offset past the outer corner: ears reach EAR_R + EAR_OFF = 7 mm past the wall (geometry.ts EAR)
const LIP_H = 3;

/** Ear (screw) centres: just outside the outer corners, so the screw never enters the cavity. */
export function earCentres(inner: Box3, wall: number): V3[] {
  const o = grow(inner, wall), k = EAR_OFF;
  return [[o.lo[0] - k, o.lo[1] - k, 0], [o.hi[0] + k, o.lo[1] - k, 0], [o.lo[0] - k, o.hi[1] + k, 0], [o.hi[0] + k, o.hi[1] + k, 0]];
}

export function clamshell(M: ManifoldToplevel, o: ClamOpts): [Manifold, Manifold] {
  const out = grow(o.inner, o.wall), lipOut = grow(o.inner, o.wall / 2);
  const z0 = out.lo[2], z1 = out.hi[2];
  let body = box(M, out.lo, out.hi);
  for (const c of earCentres(o.inner, o.wall)) {
    // the ear circle does not reach the box corner (3·√2 > 4), so a bridge block joins them; it starts 1 mm inside the wall
    const sx = c[0] > 0 ? 1 : -1, sy = c[1] > 0 ? 1 : -1;
    const ex = (sx > 0 ? out.hi[0] : out.lo[0]) - sx, ey = (sy > 0 ? out.hi[1] : out.lo[1]) - sy;
    body = body.add(M.Manifold.cylinder(z1 - z0, EAR_R, EAR_R, 24).translate([c[0], c[1], z0]));
    body = body.add(box(M, [Math.min(c[0], ex), Math.min(c[1], ey), z0], [Math.max(c[0], ex), Math.max(c[1], ey), z1]));
  }
  body = body.subtract(box(M, o.inner.lo, o.inner.hi));
  const cuts: Manifold[] = [...(o.cuts ?? [])];
  for (const c of earCentres(o.inner, o.wall)) {
    cuts.push(M.Manifold.cylinder(z1 - z0 + 2, M3_HOLE / 2, M3_HOLE / 2, 16).translate([c[0], c[1], z0 - 1]));
    cuts.push(M.Manifold.cylinder(M3_NUT_DEPTH + 1, M3_NUT / 2, M3_NUT / 2, 6).translate([c[0], c[1], z0 - 1]));
  }
  if (o.drain) cuts.push(rod(M, [o.inner.lo[0] + 4, o.inner.lo[1] + 4, z0 - 1], [o.inner.lo[0] + 4, o.inner.lo[1] + 4, o.inner.lo[2] + 1], 3));
  // the lip: a band half a wall thick round the cavity, LIP_H above the split, on the bottom half
  const lip = box(M, [lipOut.lo[0], lipOut.lo[1], o.splitZ - 0.01], [lipOut.hi[0], lipOut.hi[1], o.splitZ + LIP_H]).subtract(box(M, [o.inner.lo[0], o.inner.lo[1], o.splitZ - 1], [o.inner.hi[0], o.inner.hi[1], o.splitZ + LIP_H + 1]));
  const recess = box(M, [lipOut.lo[0] - CLEAR / 2, lipOut.lo[1] - CLEAR / 2, o.splitZ - 1], [lipOut.hi[0] + CLEAR / 2, lipOut.hi[1] + CLEAR / 2, o.splitZ + LIP_H + CLEAR]);
  let bottom = body.trimByPlane([0, 0, -1], -o.splitZ).add(lip);
  let top = body.trimByPlane([0, 0, 1], o.splitZ).subtract(recess);
  for (const a of o.adds?.bottom ?? []) bottom = bottom.add(a);
  for (const a of o.adds?.top ?? []) top = top.add(a);
  for (const c of cuts) { bottom = bottom.subtract(c); top = top.subtract(c); }    // one at a time (manifold batch-union defect)
  return [bottom, top];
}
