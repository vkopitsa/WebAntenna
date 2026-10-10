import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { CLEAR } from "../rules";
import { dipoleArms, fanSpreaders } from "./centre";
import { along, inside, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

describe("fan dipole", () => {
  it("HF defaults: centre and spreaders build, spreaders fit the bed", () => {
    const { p, d } = setup("fandipole");
    const specs = partsFor("fandipole", p, d);
    expect(specs.map((s) => s.id)).toEqual(["fan-centre", "fan-spreader-1", "fan-spreader-2"]);
    for (const s of specs) expect(buildPart(M, s, s.id).ok, s.id).toBe(true);
  });
  it("centre channels follow every element's arm", () => {
    const { p, d } = setup("fandipole");
    const { wireD, arms } = dipoleArms(d, ["driven", "parasitic"]);
    expect(arms.length).toBe(6);
    const c = partsFor("fandipole", p, d)[0].build(M)[0];
    for (const a of arms) expect(inside(c, along(M, a.start, a.dir, 12, 30, wireD))).toBeLessThan(1e-3);
  });
  it("spreader channels follow the wires", () => {
    const { p, d } = setup("fandipole");
    const sp = fanSpreaders(d);
    const wireD = dipoleArms(d).wireD;
    expect(sp.length).toBeGreaterThanOrEqual(1);
    sp.forEach((s, i) => {
      expect(s.holes.length).toBeGreaterThanOrEqual(2);
      const part = partsFor("fandipole", p, d)[i + 1].build(M)[0];
      for (const h of s.holes) {
        expect(inside(part, along(M, h.p, h.u, -3, 3, wireD))).toBeLessThan(1e-3);
        expect(inside(part, along(M, h.p, h.u, -1.5, 1.5, wireD + CLEAR + 2))).toBeGreaterThan(0.1);
      }
    });
  });
  it("spreaders: clear of the centre block, through holes, steep wires skipped", () => {
    const bands5 = "3.5e6-3.8e6;7e6-7.2e6;10.1e6-10.15e6;14e6-14.35e6;18e6-18.2e6";
    for (const fan of [5, 20, 30, 35, 45]) for (const bands of ["7e6-7.2e6;14e6-14.35e6;28e6-29.7e6", bands5]) {
      const { p, d } = setup("fandipole", { fan, bands });
      const { wireD, gap } = dipoleArms(d);
      const specs = partsFor("fandipole", p, d);
      const sp = fanSpreaders(d);
      expect(specs.map((s) => s.id), `${fan}`).toEqual(["fan-centre", ...sp.map((_, i) => `fan-spreader-${i + 1}`)]);
      sp.forEach((s, i) => {
        const tag = `fan ${fan} ${bands.split(";").length} bands spreader ${i + 1}`;
        expect(s.Y, tag).toBeGreaterThanOrEqual(gap / 2 + 35 + 15 - 1e-9);
        expect(buildPart(M, specs[i + 1], tag).ok, tag).toBe(true);
        const part = specs[i + 1].build(M)[0];
        for (const h of s.holes) {
          expect(h.u[1], tag).toBeGreaterThanOrEqual(0.5);
          const k = 3 / h.u[1];
          expect(inside(part, along(M, h.p, h.u, -k, k, wireD)), tag).toBeLessThan(1e-3);
          expect(inside(part, along(M, h.p, h.u, -1.5, 1.5, wireD + CLEAR + 2)), tag).toBeGreaterThan(0.1);
        }
      });
    }
  }, 120000);
  it("a single band has no spreaders", () => {
    const { p, d } = setup("fandipole", { bands: "14e6-14.35e6" });
    expect(partsFor("fandipole", p, d).map((s) => s.id)).toEqual(["fan-centre"]);
  });
  it("channels stay clear at wide fans with five bands, and the eye and zip slots survive", () => {
    const bands = "3.5e6-3.8e6;7e6-7.2e6;10.1e6-10.15e6;14e6-14.35e6;18e6-18.2e6";
    for (const fan of [5, 20, 45]) {
      const { p, d } = setup("fandipole", { fan, bands });
      const c = partsFor("fandipole", p, d)[0].build(M)[0];
      const { wireD, arms } = dipoleArms(d, ["driven", "parasitic"]);
      for (const a of arms) expect(inside(c, along(M, a.start, a.dir, 12, 30, wireD)), `fan ${fan}`).toBeLessThan(1e-3);
      expect(inside(c, along(M, [0, 0, 9.75], [1, 0, 0], -2, 2, 9)), `eye ring ${fan}`).toBeGreaterThan(0.9 * Math.PI / 4 * (81 - 36) * 4);
    }
  }, 30000);
});
