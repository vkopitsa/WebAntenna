import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { CLEAR } from "../rules";
import { FAIL } from "../parts";
import { jpoleGeometry } from "./spacer";
import { inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const post = (x: number, d: number) => M.Manifold.cylinder(200, d / 2, d / 2, 32).translate([x, 0, -50]);

describe("j-pole", () => {
  it("spacer bores sit at the stub spacing and fit the tube", () => {
    for (const sp of [15e-3, 25e-3, 60e-3]) {
      const g = jpoleGeometry(setup("jpole", { sp }).d);
      expect(g.s).toBeCloseTo(sp * 1000, 6);
      const s = part("jpole", "jpole-spacer", { sp }).build(M)[0];
      for (const x of [0, g.s]) {
        expect(inside(s, post(x, g.tubeD))).toBeLessThan(1e-3);
        expect(inside(s, post(x, g.tubeD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
  it("stub top is the top of the stub leg, above the tap", () => {
    const g = jpoleGeometry(setup("jpole").d);
    expect(g.stubTop).toBeGreaterThan(g.tap * 5);
  });
  it("tap gauge is as tall as the tap above the shorting bar", () => {
    const g = jpoleGeometry(setup("jpole").d);
    const b = part("jpole", "jpole-tap").build(M)[0].boundingBox();
    expect(b.max[2] - b.min[2]).toBeCloseTo(g.tap - g.tubeD / 2, 3);
  });
  it("tap gauge mouths are narrower than the tube but open", () => {
    const g = jpoleGeometry(setup("jpole").d);
    const t = part("jpole", "jpole-tap").build(M)[0];
    const slab = (x: number, w: number, y0: number, y1: number) => M.Manifold.cube([w, y1 - y0, 50]).translate([x - w / 2, y0, -10]);
    for (const x of [0, g.s]) {
      expect(inside(t, slab(x, 0.7 * g.tubeD, -g.tubeD, -g.tubeD / 2 - 0.5))).toBeLessThan(1e-3);   // mouth is open
      expect(inside(t, slab(x, 1.0 * g.tubeD, -g.tubeD, -g.tubeD / 2 - 0.5))).toBeGreaterThan(1);   // narrower than the tube
    }
  });
  it("tube spacing smaller than the tube is reported", () => {
    const { p, d } = setup("jpole", { sp: 3e-3 });
    const r = buildPart(M, partsFor("jpole", p, d)[0], "x");
    expect(r.ok ? "" : r.error.s).toBe(FAIL.thick);
  });
  it("0.5 m spacing is too large, not broken", () => {
    const { p, d } = setup("jpole", { sp: 0.5 });
    for (const s of partsFor("jpole", p, d)) {
      const r = buildPart(M, s, "x");
      expect(r.ok ? "" : r.error.s).toMatch(/^Too large/);
    }
  });
});

describe("collinear", () => {
  it("radome spacer fits the radome and the coax; one per section", () => {
    const s = part("collinear", "collinear-spacer");
    expect(s.qty).toBe(8);
    const b = s.build(M)[0].boundingBox();
    expect(b.max[0] - b.min[0]).toBeCloseTo(20 - CLEAR, 1);
  });
  it("clip-on slot is narrower than the coax but open", () => {
    const s = part("collinear", "collinear-spacer").build(M)[0];
    const slab = (w: number) => M.Manifold.cube([w, 6, 20]).translate([-w / 2, 3.5, -5]);
    expect(inside(s, slab(0.7 * 5))).toBeLessThan(1e-3);
    expect(inside(s, slab(1.1 * 5))).toBeGreaterThan(1);
    expect(inside(s, M.Manifold.cylinder(20, 2.5, 2.5, 32).translate([0, 0, -5]))).toBeLessThan(1e-3);
  });
  it("too narrow a radome is reported", () => {
    const { p, d } = setup("collinear", { rid: 8e-3, od: 6e-3 });
    const r = buildPart(M, partsFor("collinear", p, d)[0], "x");
    expect(r.ok ? "" : r.error.s).toBe(FAIL.radome);
  });
});
