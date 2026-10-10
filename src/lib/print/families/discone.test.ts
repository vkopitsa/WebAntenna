import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { CLEAR, INSULATE } from "../rules";
import { disconeGeometry } from "./hub";
import { along, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const CASES = [20, 30, 45].flatMap((half) => [6, 16].map((rods) => ({ half, rods })));

describe("discone hub", () => {
  it("cone bores follow the cone angle and are held; disc channels are flat and held", () => {
    for (const c of CASES) {
      const { d } = setup("discone", c);
      const g = disconeGeometry(d);
      expect(Math.abs((g.half * 180) / Math.PI - c.half)).toBeLessThan(0.5);
      const hub = part("discone", "discone-hub", c).build(M)[0];
      for (const u of g.coneDirs) {
        expect(inside(hub, along(M, [0, 0, 0], u, g.sN + 2, g.sN + 30, g.wireD)), JSON.stringify(c)).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, 0], u, g.sN + 5, g.sN + 30, g.wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
      for (const u of g.discDirs) {
        expect(u[2]).toBeCloseTo(0, 9);
        expect(inside(hub, along(M, [0, 0, g.discZ], u, 6, 36, g.wireD))).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, g.discZ], u, 10, 36, g.wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  }, 60_000);
  it("keeps the disc and the cone apart by the insulating wall", () => {
    for (const c of CASES) {
      const g = disconeGeometry(setup("discone", c).d);
      expect(g.discZ - g.ch / 2 - (g.grooveZ + g.grooveH / 2)).toBeGreaterThanOrEqual(INSULATE);
    }
  });
});
