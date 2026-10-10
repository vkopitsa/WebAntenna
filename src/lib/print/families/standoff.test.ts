import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { buildPart } from "..";
import { biquadGeometry } from "./standoff";
import { along, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

const PLATE_T = 5;
const bands: [string, object][] = [["2.4 GHz", {}], ["5.8 GHz", { bands: "5725e6-5875e6", d: 1e-3 }]];

describe("biquad standoff", () => {
  for (const [bn, extra] of bands) for (const sp of [0.08, 0.122, 0.25]) {
    it(`${bn} sp ${sp}: builds, holds the 4 legs, plastic only near the feed`, () => {
      const p = { ...extra, sp };
      const { d } = setup("biquad", p);
      const g = biquadGeometry(d);
      expect(g.legs.length).toBe(4);
      const spec = part("biquad", "biquad-standoff", p);
      expect(buildPart(M, spec, "t").ok).toBe(true);
      const s = spec.build(M)[0];
      for (const l of g.legs) {
        expect(inside(s, along(M, l.at, l.dir, 1, 12, g.wireD))).toBeLessThan(1e-3);
        expect(inside(s, along(M, l.at, l.dir, 1, 9, g.wireD + 2))).toBeGreaterThan(0.1);
      }
      const [a, b] = g.ends;
      expect(inside(s, along(M, a, [0, Math.sign(b[1] - a[1]), 0], 0, Math.abs(b[1] - a[1]), g.wireD))).toBeLessThan(1e-3);
      const far = M.Manifold.cylinder(100, 200, 200, 64).subtract(M.Manifold.cylinder(100, 10.5, 10.5, 64)).translate([0, 0, PLATE_T + 0.01]);
      expect(inside(s, far)).toBeLessThan(1e-3);
    });
  }
});
