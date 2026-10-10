import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR, M3_HOLE } from "../rules";
import { rod, stack } from "../shapes";

/** Dome radome round the z axis: a tube with a cone top steeper than 45° (prints without supports) and either a flange
 *  that screws to the reflector over the antenna's own base flange, or a bottom plate with a mast hole. */
export type DomeBase = { kind: "flange"; pocketR: number; pocketH: number; ringR: number; holeR: number } | { kind: "mast"; mastD: number };
export type DomeOpts = { r: number; z0: number; z1: number; wall: number; base: DomeBase; drain: boolean };

const SKIRT = 6;                   // joint between stacked pieces: an outer skirt on the piece above, hanging over the piece below
const CONNECT = 1.5;               // the skirt is tied into the wall of the piece above by a ledge this tall
const FLANGE_T = 2;
const sides = (r: number) => Math.max(48, Math.ceil((2 * Math.PI) / Math.sqrt(0.4 / r)));

/** World z of the body's z = 0 (the body is built standing on z = 0). */
export const domeOffset = (o: DomeOpts) => (o.base.kind === "flange" ? o.z0 : o.z0 - o.wall);
/** Height of the body from z = 0 to the cone apex. */
export const domeHeight = (o: DomeOpts) => (o.z1 - domeOffset(o)) + o.r + o.wall * Math.SQRT2;

/** Pieces standing on z = 0; stacked at `pieceBottoms(domeHeight(o))` they form the dome. Every piece above the first
 *  has a skirt that reaches SKIRT below its cut (so its lowest point is z = -SKIRT) and slides over the piece below. */
export function dome(M: ManifoldToplevel, o: DomeOpts): Manifold[] {
  const ro = o.r + o.wall, n = sides(ro), off = domeOffset(o);
  const top = o.z1 - off;                                       // inner top of the tube in body coordinates
  const H = domeHeight(o);
  const outer = M.Manifold.cylinder(top, ro, ro, n).add(
    M.Manifold.hull([M.Manifold.cylinder(0.01, ro, ro, n).translate([0, 0, top]), M.Manifold.sphere(0.05, 8).translate([0, 0, H])]),
  );
  const innerTop = M.Manifold.cylinder(o.r, o.r, 0, n).translate([0, 0, top]);
  let body = outer;
  const cuts: Manifold[] = [M.Manifold.cylinder(top + 1, o.r, o.r, n).translate([0, 0, o.base.kind === "flange" ? -1 : o.wall]), innerTop];
  if (o.base.kind === "flange") {
    const b = o.base;
    body = body.add(M.Manifold.cylinder(b.pocketH + FLANGE_T, b.ringR, b.ringR, sides(b.ringR)));
    cuts.push(M.Manifold.cylinder(b.pocketH + 0.01, b.pocketR, b.pocketR, sides(b.pocketR)).translate([0, 0, -0.01]));
    for (const a of [0, 120, 240]) cuts.push(M.Manifold.cylinder(b.pocketH + FLANGE_T + 2, M3_HOLE / 2, M3_HOLE / 2, 16).translate([b.holeR * Math.cos((a * Math.PI) / 180), b.holeR * Math.sin((a * Math.PI) / 180), -1]));
    if (o.drain) cuts.push(rod(M, [o.r - 2, 0, b.pocketH + 1], [b.ringR + 1, 0, b.pocketH + 1], 3));
  } else {
    cuts.push(M.Manifold.cylinder(o.wall + 2, (o.base.mastD + CLEAR) / 2, (o.base.mastD + CLEAR) / 2, 48).translate([0, 0, -1]));
    if (o.drain) cuts.push(M.Manifold.cylinder(o.wall + 2, 1.5, 1.5, 16).translate([o.r - 4, 0, -1]));
  }
  for (const c of cuts) body = body.subtract(c);                // one at a time (batch booleans of disjoint operands lose volume)
  return stack(body, H, (zc) => {
    const rc = zc <= top ? ro : (ro * (H - zc)) / (H - top);    // outer radius of the body at the cut
    const Ro = ro + o.wall + CLEAR / 2, ri = ro + CLEAR / 2, rIn = Math.max(0, rc - o.wall);
    // skirt: bore ri below the cut, then a ledge CONNECT tall that overlaps the wall of this piece (bore rIn above the cut)
    const skirt = M.Manifold.cylinder(SKIRT + CONNECT, Ro, Ro, n).translate([0, 0, zc - SKIRT])
      .subtract(M.Manifold.cylinder(SKIRT + 1, ri, ri, n).translate([0, 0, zc - SKIRT - 1]))
      .subtract(M.Manifold.cylinder(CONNECT + 2, rIn, rIn, n).translate([0, 0, zc - 1]));
    return { aboveAdd: skirt };
  });
}
