import { beforeAll, describe, expect, it } from "vitest";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { partsFor } from "..";
import { rod, type V3 } from "../shapes";
import { CLEAR } from "../rules";
import { dipoleArms } from "./centre";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

const setup = (id: string, extra: Params = {}) => { const def = ANTENNA_BY_ID[id]; const p = { ...def.defaults, ...extra }; return { p, d: def.build(p) }; };
const part = (id: string, partId: string, extra: Params = {}) => { const { p, d } = setup(id, extra); return partsFor(id, p, d).find((s) => s.id === partId)!; };
/** Volume of plastic inside a probe solid (mm³). */
const inside = (solid: Manifold, probe: Manifold) => solid.intersect(probe).volume();
const along = (a: V3, u: V3, s0: number, s1: number, d: number) => rod(M, [a[0] + u[0] * s0, a[1] + u[1] * s0, a[2] + u[2] * s0], [a[0] + u[0] * s1, a[1] + u[1] * s1, a[2] + u[2] * s1], d);

describe("dipole", () => {
  it("has a centre insulator and two end insulators", () => {
    const { p, d } = setup("dipole");
    expect(partsFor("dipole", p, d).map((s) => [s.id, s.qty])).toEqual([["dipole-centre", 1], ["dipole-end", 2]]);
  });
  it("centre: the arm channels follow the droop and are clear for the wire", () => {
    for (const droop of [0, 30, 60]) {
      const { d } = setup("dipole", { droop });
      const { wireD, arms } = dipoleArms(d);
      arms.forEach((a) => expect(Math.abs((Math.asin(-a.dir[2]) * 180) / Math.PI - droop)).toBeLessThan(0.5));
      const centre = part("dipole", "dipole-centre", { droop }).build(M)[0];
      for (const a of arms) {
        expect(inside(centre, along(a.start, a.dir, 10, 30, wireD))).toBeLessThan(1e-3);
        expect(inside(centre, along(a.start, a.dir, 10, 30, wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
});
