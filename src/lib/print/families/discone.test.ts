import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { CLEAR, INSULATE } from "../rules";
import { D_IN, D_LUG, disconeGeometry } from "./hub";
import { along, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const CASES = [20, 30, 45].flatMap((half) => [6, 16, 32].map((rods) => ({ half, rods })));

describe("discone hub", () => {
  it("cone bores follow the cone angle and are held; disc channels are flat and held", () => {
    for (const c of CASES) {
      const { d } = setup("discone", c);
      const g = disconeGeometry(d);
      expect(Math.abs((g.half * 180) / Math.PI - c.half)).toBeLessThan(0.5);
      const hub = part("discone", "discone-hub", c).build(M)[0];
      for (const u of g.coneDirs) {
        expect(inside(hub, along(M, [0, 0, 0], u, g.sN + 2, g.sN + D_LUG, g.wireD)), JSON.stringify(c)).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, 0], u, g.sN + 5, g.sN + D_LUG, g.wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
      for (const u of g.discDirs) {
        expect(u[2]).toBeCloseTo(0, 9);
        expect(inside(hub, along(M, [0, 0, g.discZ], u, D_IN, D_IN + D_LUG, g.wireD))).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, g.discZ], u, D_IN + 4, D_IN + D_LUG, g.wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  }, 180_000);
  it("keeps the disc and the cone apart by the insulating wall", () => {
    for (const c of CASES) {
      const g = disconeGeometry(setup("discone", c).d);
      expect(g.discZ - g.ch / 2 - (g.grooveZ + g.grooveH / 2)).toBeGreaterThanOrEqual(INSULATE);
    }
  });
  it("has a mast socket below the neck: clear bore, held wall, cone channels still clear", () => {
    for (const half of [20, 45]) for (const rods of [6, 16, 32]) {
      const c = { half, rods };
      const { d } = setup("discone", c);
      const g = disconeGeometry(d);
      const mast = 25;
      const hub = part("discone", "discone-hub", c).build(M)[0];
      const z0 = hub.boundingBox().min[2];
      const cyl = (r: number, a: number, b: number) => M.Manifold.cylinder(b - a, r, r, 64).translate([0, 0, z0 + a]);
      expect(inside(hub, cyl(mast / 2, 1, 29)), JSON.stringify(c)).toBeLessThan(1e-3);
      expect(inside(hub, cyl((mast + CLEAR + 2) / 2, 1, 29)), JSON.stringify(c)).toBeGreaterThan(1);
      for (const u of g.coneDirs) expect(inside(hub, along(M, [0, 0, 0], u, g.sN + 2, g.sN + D_LUG, g.wireD))).toBeLessThan(1e-3);
    }
  }, 180_000);
  it("keeps a solid core round the braid groove", () => {
    for (const half of [20, 45]) for (const dd of [3e-3, 12e-3]) {
      const c = { half, d: dd };
      const g = disconeGeometry(setup("discone", c).d);
      const hub = part("discone", "discone-hub", c).build(M)[0];
      const slab = M.Manifold.cube([400, 400, 0.5], true).translate([0, 0, g.grooveZ]);
      expect(inside(hub, slab) / 0.5, JSON.stringify(c)).toBeGreaterThanOrEqual(150);
    }
  }, 180_000);
});
