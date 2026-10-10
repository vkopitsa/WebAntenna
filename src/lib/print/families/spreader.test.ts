import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { CLEAR } from "../rules";
import { toZ, unit, type V3 } from "../shapes";
import { cornerCap, moxonGeometry, quadGeometry } from "./spreader";
import { along, ball, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

describe("moxon", () => {
  it("hub sockets point at the four corners and hold the rods", () => {
    for (const rod of [5e-3, 8.5e-3, 12e-3]) {
      const { d } = setup("moxon", { rod });
      const g = moxonGeometry(d);
      const hub = part("moxon", "moxon-hub", { rod }).build(M)[0];
      for (const c of [[g.xE, g.yA], [g.xE, -g.yA], [g.xR, g.yA], [g.xR, -g.yA]]) {
        const u = unit([c[0], c[1], 0]);
        expect(inside(hub, along(M, [0, 0, 0], u, 20, 50, rod * 1000)), `${rod} ${c}`).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, 0], u, 25, 50, rod * 1000 + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
  it("gap insulator holes are exactly C apart", () => {
    const { d } = setup("moxon");
    const g = moxonGeometry(d);
    const gap = part("moxon", "moxon-gap").build(M)[0];
    for (const x of [-g.C / 2, g.C / 2]) expect(inside(gap, M.Manifold.cylinder(10, g.wireD / 2, g.wireD / 2, 24).translate([x, 0, -1]))).toBeLessThan(1e-3);
    expect(inside(gap, M.Manifold.cylinder(10, g.wireD / 2, g.wireD / 2, 24).translate([g.C / 2 + g.wireD, 0, -1]))).toBeGreaterThan(0.1);
    expect(g.C).toBeCloseTo(g.tipD - g.tipR, 9);
  });
});

describe("quad", () => {
  it("hub: boom bore along x, four sockets at 45° in the loop plane", () => {
    const hub = part("quad", "quad-hub").build(M)[0];
    expect(inside(hub, along(M, [0, 0, 0], [1, 0, 0], -40, 40, 25))).toBeLessThan(1e-3);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const u = unit([0, y, z]);
      expect(inside(hub, along(M, [0, 0, 0], u, 22, 50, 8.5))).toBeLessThan(1e-3);
      expect(inside(hub, along(M, [0, 0, 0], u, 25, 50, 8.5 + CLEAR + 2))).toBeGreaterThan(1);
    }
    expect(quadGeometry(setup("quad").d).loops.length).toBe(2);
  });
  it("corner cap: the wire corner is clear and the rod fits", () => {
    const at: V3 = [0, 300, 300], dir = unit([0, 1, 1]);
    const cap = cornerCap(M, at, dir, [[0, -1, 0], [0, 0, -1]], 8.5, 2);
    expect(inside(cap, ball(M, at, 2))).toBeLessThan(1e-3);
    expect(inside(cap, ball(M, [0, 295, 300], 2))).toBeLessThan(1e-3);
    expect(inside(cap, along(M, at, dir, -25, -6, 8.5))).toBeLessThan(1e-3);
    expect(inside(cap, along(M, at, dir, -25, -6, 8.5 + CLEAR + 2))).toBeGreaterThan(1);
  });
  it("toZ with a general direction: the cap corner lands at the origin, the rod sleeve below", () => {
    const at: V3 = [0, 300, 300], dir = unit([0, 1, 1]);
    const bb = toZ(cornerCap(M, at, dir, [[0, -1, 0], [0, 0, -1]], 8.5, 2), at, dir).boundingBox();
    expect(bb.max[2]).toBeLessThan(6);
    expect(bb.max[2]).toBeGreaterThan(-1);
    expect(bb.min[2]).toBeGreaterThan(-40);
    expect(bb.min[2]).toBeLessThan(-30);
    for (const k of [0, 1]) expect(Math.abs(bb.min[k] + bb.max[k]) / 2).toBeLessThan(8);
  });
});
