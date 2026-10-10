import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { msg, PartError } from "../parts";
import { CLEAR } from "../rules";
import { add, bar, box, rod, scale, sub, type V3 } from "../shapes";
import { grow, type Box3, type Exit } from "./geometry";

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Feedpoint hood: one piece, a box of `wall` round `inner` with no floor, lowered over the feed part from above and
 *  printed upside down on its flat top. Exits through the roof face are round holes; every exit through a side wall,
 *  whatever its angle, is a slot (the hole swept straight down past the bottom edge), so the hood slides down over the
 *  wires. Loose crumbs left between close slots are dropped, up to 1 % of the hood (more is an error). Sealed with silicone; water drains out of the open bottom. */
export type HoodOpts = { inner: Box3; wall: number; exits: Exit[] };

export function hood(M: ManifoldToplevel, o: HoodOpts): [Manifold] {
  const out = grow(o.inner, o.wall), z0 = o.inner.lo[2];
  let body = box(M, [out.lo[0], out.lo[1], z0], out.hi).subtract(box(M, [o.inner.lo[0], o.inner.lo[1], z0 - 1], o.inner.hi));
  for (const x of o.exits) {
    if (Math.abs(x.at[2] - z0) < 1e-6 && x.dir[2] < 0) continue;      // leaves through the open bottom
    // a thick exit crossing its wall at an angle θ to the face normal covers wall/cos θ + d/2·tan θ along its axis
    const c = Math.max(0.2, ...[0, 1, 2].filter((i) => Math.abs(x.at[i] - o.inner.lo[i]) < 1e-6 || Math.abs(x.at[i] - o.inner.hi[i]) < 1e-6).map((i) => Math.abs(x.dir[i])));
    const e = o.wall / c + (x.d / 2) * Math.sqrt(1 / (c * c) - 1);
    const back = x.from ? Math.min(e + 2, Math.max(0, -dot(sub(x.from, x.at), x.dir))) : e + 2;   // not behind the lug's start
    const p0 = add(x.at, scale(x.dir, -back)), p1 = add(x.at, scale(x.dir, e + 8));
    const r = x.w ? bar(M, p0, p1, x.w + CLEAR + 1) : rod(M, p0, p1, x.d + CLEAR + 1);   // a lug's hole follows the lug
    const roof = Math.abs(x.at[2] - o.inner.hi[2]) < 1e-6;
    const cut = roof ? r : M.Manifold.hull([r, r.translate([0, 0, -(x.at[2] - z0) - 2 * o.wall - 10])]);
    body = body.subtract(cut);                                        // one at a time (manifold batch-union defect)
  }
  // slots close together (a wide fan) can leave loose crumbs of wall between them: drop pieces under 1 % of the hood
  const parts = body.decompose();
  if (parts.length > 1) {
    const v = body.volume(), keep = parts.filter((q) => q.volume() >= 0.01 * v);
    const kept = keep.reduce((a, q) => a + q.volume(), 0);
    if (keep.length !== 1 || v - kept >= 0.01 * v) throw new PartError(msg("Could not build this part: {0}", "hood cut apart"));
    body = keep[0];
  }
  return [body];
}
