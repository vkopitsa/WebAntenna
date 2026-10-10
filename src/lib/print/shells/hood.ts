import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR } from "../rules";
import { add, box, rod, scale } from "../shapes";
import { grow, type Box3, type Exit } from "./geometry";

/** Feedpoint hood: one piece, a box of `wall` round `inner` with no floor, lowered over the feed part from above and
 *  printed upside down on its flat top. Exits pointing up (dir z > UP) are round holes through the roof; every other
 *  exit is a slot (the hole swept straight down past the bottom edge), so the hood slides down over wires that leave
 *  sideways or downwards. Loose crumbs left between close slots are dropped. Sealed with silicone; water drains out of the open bottom. */
export type HoodOpts = { inner: Box3; wall: number; exits: Exit[] };

export const UP = 0.7;

export function hood(M: ManifoldToplevel, o: HoodOpts): [Manifold] {
  const out = grow(o.inner, o.wall), z0 = o.inner.lo[2];
  let body = box(M, [out.lo[0], out.lo[1], z0], out.hi).subtract(box(M, [o.inner.lo[0], o.inner.lo[1], z0 - 1], o.inner.hi));
  for (const x of o.exits) {
    if (Math.abs(x.at[2] - z0) < 1e-6 && x.dir[2] < 0) continue;      // leaves through the open bottom
    // a thick exit crossing its wall at an angle θ to the face normal covers wall/cos θ + d/2·tan θ along its axis
    const c = Math.max(0.2, ...[0, 1, 2].filter((i) => Math.abs(x.at[i] - o.inner.lo[i]) < 1e-6 || Math.abs(x.at[i] - o.inner.hi[i]) < 1e-6).map((i) => Math.abs(x.dir[i])));
    const e = o.wall / c + (x.d / 2) * Math.sqrt(1 / (c * c) - 1);
    const r = rod(M, add(x.at, scale(x.dir, -e - 2)), add(x.at, scale(x.dir, e + 8)), x.d + CLEAR + 1);
    const cut = x.dir[2] > UP ? r : M.Manifold.hull([r, r.translate([0, 0, -(x.at[2] - z0) - 2 * o.wall - 10])]);
    body = body.subtract(cut);                                        // one at a time (manifold batch-union defect)
  }
  // slots close together (a wide fan) can leave loose crumbs of wall between them: drop pieces under 1 % of the hood
  const parts = body.decompose();
  if (parts.length > 1) {
    const v = body.volume(), keep = parts.filter((q) => q.volume() >= 0.01 * v);
    body = keep.slice(1).reduce((a, q) => a.add(q), keep[0]);
  }
  return [body];
}
