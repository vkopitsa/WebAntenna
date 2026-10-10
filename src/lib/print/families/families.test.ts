import { beforeAll, describe, expect, it } from "vitest";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { rod, type V3 } from "../shapes";
import { CLEAR, INSULATE } from "../rules";
import { dipoleArms } from "./centre";
import { radialDirs } from "./hub";

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

describe("ground plane", () => {
  it("hub: bores follow the radials (within 0.5°) and are surrounded by plastic", () => {
    for (const droop of [0, 30, 45, 60]) {
      const { d } = setup("groundplane", { droop });
      const dirs = radialDirs(d);
      dirs.forEach((u) => expect(Math.abs((Math.asin(-u[2]) * 180) / Math.PI - droop)).toBeLessThan(0.5));
      const hub = part("groundplane", "gp-hub", { droop }).build(M)[0];
      const wireD = 2000 * d.wires[1].r;
      for (const u of dirs) {
        expect(inside(hub, along([0, 0, 0], u, 20, 45, wireD))).toBeLessThan(1e-3);
        expect(inside(hub, along([0, 0, 0], u, 20, 45, wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
});

describe("yagi", () => {
  it("insulated: n − 1 clips and a driven block; through-boom: one drilling guide", () => {
    const { p, d } = setup("yagi");
    expect(partsFor("yagi", p, d).map((s) => [s.id, s.qty])).toEqual([["yagi-clip", Number(p.n) - 1], ["yagi-driven", 1]]);
    const t = setup("yagi", { boom: "through" });
    expect(partsFor("yagi", t.p, t.d).map((s) => s.id)).toEqual(["yagi-drill"]);
  });
  it("clip: the element fits with 0.3 mm clearance and sits on 2 mm of plastic above the boom", () => {
    const { d } = setup("yagi");
    const elemD = 2000 * d.wires.find((w) => !w.drawOnly)!.r;
    const clip = part("yagi", "yagi-clip").build(M)[0];
    expect(inside(clip, along([0, 0, 0], [0, 1, 0], -20, 20, elemD))).toBeLessThan(1e-3);
    expect(inside(clip, along([0, 0, 0], [0, 1, 0], -20, 20, elemD + CLEAR + 0.4))).toBeGreaterThan(0.1);
    const wall = M.Manifold.cube([1, 1, INSULATE * 0.8], true).translate([0, 6, -(elemD + CLEAR) / 2 - INSULATE / 2]);
    expect(inside(clip, wall)).toBeCloseTo(INSULATE * 0.8, 3);
  });
  it("folded driven block: both conductors fit, spaced as in the model", () => {
    const { d } = setup("yagi", { driven: "folded" });
    const elemD = 2000 * d.wires.find((w) => !w.drawOnly)!.r;
    const fs = 1000 * Math.max(...d.wires.filter((w) => w.group === "driven").map((w) => w.a[2]));
    const block = part("yagi", "yagi-driven").build(M)[0];
    expect(inside(block, along([0, 0, fs], [0, 1, 0], -20, 20, elemD))).toBeLessThan(1e-3);
    expect(inside(block, along([0, 0, 0], [0, 1, 0], 2, 20, elemD))).toBeLessThan(1e-3);
  });
  it("a boom too wide for the printer is reported, not exported", () => {
    expect(buildPart(M, part("yagi", "yagi-clip", { bd: 0.2 }), "x").ok).toBe(false);
  });
});
