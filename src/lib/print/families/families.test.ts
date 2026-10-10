import { beforeAll, describe, expect, it } from "vitest";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { rod, type V3 } from "../shapes";
import { CLEAR, FLANGE_PITCH, INSULATE, M3_NUT, ZIP_T, ZIP_W } from "../rules";
import { dipoleArms } from "./centre";
import { hubGeometry, radialDirs, PLATE } from "./hub";
import { yagiStraps } from "./boom";

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
  const CASES = [0, 15, 30, 45, 60].flatMap((droop) => [2, 3, 4, 6, 8].map((radials) => ({ droop, radials })));
  it("hub: bores follow the radials (within 0.5°) and are surrounded by plastic along the lugs", () => {
    for (const c of CASES) {
      const { d } = setup("groundplane", c);
      radialDirs(d).forEach((u) => expect(Math.abs((Math.asin(-u[2]) * 180) / Math.PI - c.droop)).toBeLessThan(0.5));
      const g = hubGeometry(d);
      const hub = part("groundplane", "gp-hub", c).build(M)[0];
      for (const r of g.paths) {
        expect(inside(hub, along(r.start, r.dir, 2, r.lugFrom + 30, g.wireD)), JSON.stringify(c)).toBeLessThan(1e-3);
        expect(inside(hub, along(r.start, r.dir, r.lugFrom + 5, r.lugFrom + 30, g.wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  }, 60_000);
  it("hub: the jack flange seats flat on top, the nut pockets open downwards and the coax plug has room", () => {
    const h = FLANGE_PITCH / 2;
    for (const c of CASES) {
      const hub = part("groundplane", "gp-hub", c).build(M)[0];
      const msg = JSON.stringify(c);
      expect(inside(hub, M.Manifold.cube([25.4, 25.4, 10], true).translate([0, 0, 5.01])), msg).toBeLessThan(1e-3);
      for (const [x, y] of [[h, h], [-h, h], [-h, -h], [h, -h]])
        expect(inside(hub, M.Manifold.cylinder(40, M3_NUT * 0.4, M3_NUT * 0.4, 6).translate([x, y, -40 - PLATE + 0.5])), msg).toBeLessThan(1e-3);
      expect(inside(hub, M.Manifold.cylinder(35, 10.5, 10.5).translate([0, 0, -35 - PLATE - 0.01])), msg).toBeLessThan(1e-3);
    }
  }, 60_000);
  it("hub: each radial end lies in a groove that is open from above, for soldering", () => {
    for (const c of CASES) {
      const { d } = setup("groundplane", c);
      const g = hubGeometry(d);
      const hub = part("groundplane", "gp-hub", c).build(M)[0];
      for (const r of g.paths) {
        const top = M.Manifold.cylinder(10, g.wireD / 2, g.wireD / 2).translate([r.start[0] + r.dir[0] * 1.5, r.start[1] + r.dir[1] * 1.5, r.start[2]]);
        expect(inside(hub, top), JSON.stringify(c)).toBeLessThan(1e-3);
      }
    }
  }, 60_000);
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

describe("yagi zip ties", () => {
  it("the strap slots are open top to bottom and never cross an element channel", () => {
    for (const extra of [{}, { driven: "split" }, { d: 3e-3 }, { d: 25e-3, bd: 50e-3 }] as Params[]) {
      const { d } = setup("yagi", extra);
      const elemD = 2000 * d.wires.find((w) => !w.drawOnly)!.r;
      for (const id of ["yagi-clip", "yagi-driven"]) {
        const solid = part("yagi", id, extra).build(M)[0];
        const b = solid.boundingBox();
        const straps = yagiStraps(d);
        expect(straps.length).toBeGreaterThanOrEqual(2);
        for (const [x, y] of straps) {
          const slot = M.Manifold.cube([ZIP_W * 0.9, ZIP_T * 0.8, b.max[2] - b.min[2] + 2], true).translate([x, y, (b.max[2] + b.min[2]) / 2]);
          expect(inside(solid, slot), `${id} ${JSON.stringify(extra)}`).toBeLessThan(1e-3);
          const element = M.Manifold.cylinder(400, (elemD + CLEAR) / 2, (elemD + CLEAR) / 2, undefined, true).rotate([90, 0, 0]);
          expect(slot.intersect(element).volume(), `${id} ${JSON.stringify(extra)} strap crosses the element`).toBeLessThan(1e-3);
        }
      }
    }
  });
});

describe("dipole close-wire warning", () => {
  it("warns when the arms are closer than the insulating wall, not otherwise", () => {
    expect(part("dipole", "dipole-centre").warn).toBeUndefined();
    const w = part("dipole", "dipole-centre", { bands: "2400e6-2483e6", d: 0.3e-3 }).warn;
    expect(w?.s).toBe("Wires closer than {0} apart: add sleeving.");
  });
});
