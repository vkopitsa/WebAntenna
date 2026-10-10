import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR } from "../rules";
import { box, m3, rod, type V3 } from "../shapes";
import { EAR, grow, type Box3 } from "./geometry";

/** Two-half box round an inner cavity: a lip on the bottom half seats in a recess of the top half (seal it with
 *  silicone outdoors), four M3 screw ears at the vertical corners, and the caller's cuts (wire, coax, connector holes). */
export type ClamOpts = { inner: Box3; wall: number; splitZ: number; cuts?: Manifold[]; drain?: boolean; adds?: { bottom?: Manifold[]; top?: Manifold[] } };

export const EAR_R = 4;
const EAR_OFF = EAR - EAR_R;   // centre offset past the outer corner: ears reach EAR (7 mm, geometry.ts) past the wall
const LIP_H = 3;

/** Ear (screw) centres: just outside the outer corners, so the screw never enters the cavity. */
export function earCentres(inner: Box3, wall: number): V3[] {
  const o = grow(inner, wall), k = EAR_OFF;
  return [[o.lo[0] - k, o.lo[1] - k, 0], [o.hi[0] + k, o.lo[1] - k, 0], [o.lo[0] - k, o.hi[1] + k, 0], [o.hi[0] + k, o.hi[1] + k, 0]];
}

/** The drain hole (outdoor): a Ø3 hole through the floor near the low corner, reaching 1 mm into the cavity. */
export const DRAIN = 3;
export function drainAt(inner: Box3): [number, number] {
  const off = Math.min(4, Math.min(inner.hi[0] - inner.lo[0], inner.hi[1] - inner.lo[1]) / 2 - 1.5);
  return [inner.lo[0] + off, inner.lo[1] + off];
}

export function clamshell(M: ManifoldToplevel, o: ClamOpts): [Manifold, Manifold] {
  if (!(o.splitZ > o.inner.lo[2] && o.splitZ < o.inner.hi[2])) throw new Error("clamshell: splitZ must lie strictly inside the cavity");
  const out = grow(o.inner, o.wall), lipOut = grow(o.inner, o.wall / 2);
  // lip height: it must not reach into the roof; too short a lip or too thin a wall beside the recess gives a flat joint
  const lipH = Math.min(LIP_H, o.inner.hi[2] - o.splitZ - CLEAR);
  const lipped = lipH >= 1 && o.wall - (o.wall / 2 + CLEAR / 2) >= 0.6;
  const z0 = out.lo[2], z1 = out.hi[2];
  let body = box(M, out.lo, out.hi);
  for (const c of earCentres(o.inner, o.wall)) {
    // the ear circle does not reach the box corner (3·√2 > 4), so a bridge block joins them; it starts 1 mm inside the wall
    const sx = c[0] > out.lo[0] ? 1 : -1, sy = c[1] > out.lo[1] ? 1 : -1;   // which corner, relative to the box (not the origin)
    const ex = (sx > 0 ? out.hi[0] : out.lo[0]) - sx, ey = (sy > 0 ? out.hi[1] : out.lo[1]) - sy;
    body = body.add(M.Manifold.cylinder(z1 - z0, EAR_R, EAR_R, 24).translate([c[0], c[1], z0]));
    body = body.add(box(M, [Math.min(c[0], ex), Math.min(c[1], ey), z0], [Math.max(c[0], ex), Math.max(c[1], ey), z1]));
  }
  body = body.subtract(box(M, o.inner.lo, o.inner.hi));
  const cuts: Manifold[] = [...(o.cuts ?? [])];
  for (const c of earCentres(o.inner, o.wall)) cuts.push(m3(M, c[0], c[1], z0, z1, false));
  if (o.drain) { const [x, y] = drainAt(o.inner); cuts.push(rod(M, [x, y, z0 - 1], [x, y, o.inner.lo[2] + 1], DRAIN)); }
  // the lip: a band half a wall thick round the cavity, LIP_H above the split, on the bottom half
  const lip = box(M, [lipOut.lo[0], lipOut.lo[1], o.splitZ - 0.01], [lipOut.hi[0], lipOut.hi[1], o.splitZ + lipH]).subtract(box(M, [o.inner.lo[0], o.inner.lo[1], o.splitZ - 1], [o.inner.hi[0], o.inner.hi[1], o.splitZ + lipH + 1]));
  const recess = box(M, [lipOut.lo[0] - CLEAR / 2, lipOut.lo[1] - CLEAR / 2, o.splitZ - 1], [lipOut.hi[0] + CLEAR / 2, lipOut.hi[1] + CLEAR / 2, o.splitZ + lipH + CLEAR]);
  let bottom = body.trimByPlane([0, 0, -1], -o.splitZ);
  let top = body.trimByPlane([0, 0, 1], o.splitZ);
  if (lipped) { bottom = bottom.add(lip); top = top.subtract(recess); }
  for (const a of o.adds?.bottom ?? []) bottom = bottom.add(a);
  for (const a of o.adds?.top ?? []) top = top.add(a);
  for (const c of cuts) { bottom = bottom.subtract(c); top = top.subtract(c); }    // one at a time (manifold batch-union defect)
  return [bottom, top];
}
