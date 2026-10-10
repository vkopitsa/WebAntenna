import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Params } from "../../types";
import { partsFor } from "..";
import { rod, type V3 } from "../shapes";

/** Test helpers shared by the family tests. */
export const setup = (id: string, extra: Params = {}) => { const def = ANTENNA_BY_ID[id]; const p = { ...def.defaults, ...extra }; return { p, d: def.build(p) }; };
export const part = (id: string, partId: string, extra: Params = {}) => { const { p, d } = setup(id, extra); return partsFor(id, p, d).find((s) => s.id === partId)!; };
/** Volume of plastic inside a probe solid (mm³). */
export const inside = (solid: Manifold, probe: Manifold) => solid.intersect(probe).volume();
export const along = (M: ManifoldToplevel, a: V3, u: V3, s0: number, s1: number, d: number) =>
  rod(M, [a[0] + u[0] * s0, a[1] + u[1] * s0, a[2] + u[2] * s0], [a[0] + u[0] * s1, a[1] + u[1] * s1, a[2] + u[2] * s1], d);
export const ball = (M: ManifoldToplevel, p: V3, d: number) => M.Manifold.sphere(d / 2, 24).translate(p);
