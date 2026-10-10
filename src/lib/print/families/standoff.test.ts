import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { biquadGeometry } from "./standoff";
import { along, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

describe("biquad standoff", () => {
  for (const sp of [0.08, 0.122, 0.25]) {
    it(`sp ${sp}: holds the 4 legs at the element height, plastic only near the feed`, () => {
      const { d } = setup("biquad", { sp });
      const g = biquadGeometry(d);
      const lam = 299792458 / ((2.4e9 + 2.4835e9) / 2) * 1000;
      expect(g.X).toBeCloseTo(sp * lam, 0);
      expect(g.legs.length).toBe(4);
      const s = part("biquad", "biquad-standoff", { sp }).build(M)[0];
      for (const l of g.legs) {
        expect(inside(s, along(M, l.at, l.dir, 4, 9, g.wireD))).toBeLessThan(1e-3);
        expect(inside(s, along(M, l.at, l.dir, 4, 9, g.wireD + 2))).toBeGreaterThan(0.1);
      }
      const far = M.Manifold.cylinder(100, 200, 200, 64).subtract(M.Manifold.cylinder(100, 12, 12, 64)).translate([0, 0, g.X / 2]);
      expect(inside(s, far)).toBeLessThan(1e-3);
    });
  }
});
