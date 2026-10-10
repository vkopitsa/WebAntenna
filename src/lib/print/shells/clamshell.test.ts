import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { box } from "../shapes";
import { clamshell, EAR_R, earCentres } from "./clamshell";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const inner = { lo: [-30, -20, -10] as [number, number, number], hi: [30, 20, 15] as [number, number, number] };

describe("clamshell", () => {
  it("two halves split at splitZ, the cavity is empty, the walls are closed", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0, drain: true });
    const cavity = box(M, inner.lo, inner.hi);
    expect(bot.intersect(cavity).volume()).toBeLessThan(1e-3);
    expect(top.intersect(cavity).volume()).toBeLessThan(1e-3);
    expect(bot.boundingBox().max[2]).toBeGreaterThan(0);          // the lip rises above the split
    expect(top.boundingBox().min[2]).toBeCloseTo(0, 3);
    // the lip of the bottom half fits into the recess of the top half
    expect(bot.intersect(top).volume()).toBeLessThan(1e-3);
    // walls closed: a box just outside the cavity (inside the wall) is mostly plastic, except the drain
    const wallBand = box(M, [inner.lo[0] - 1.5, inner.lo[1] - 1.5, inner.lo[2] - 1.5], [inner.hi[0] + 1.5, inner.hi[1] + 1.5, inner.hi[2] + 1.5]).subtract(cavity);
    const shell = bot.add(top);
    expect(shell.intersect(wallBand).volume() / wallBand.volume()).toBeGreaterThan(0.95);
  });
  it("screw ears: an M3 hole goes through both halves at every ear", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0 });
    for (const c of earCentres(inner, 2)) {
      const screw = M.Manifold.cylinder(100, 1.5, 1.5, 16).translate([c[0], c[1], -50]);
      expect(bot.add(top).intersect(screw).volume()).toBeLessThan(1e-3);
      const ring = M.Manifold.cylinder(10, 3.5, 3.5, 24).subtract(M.Manifold.cylinder(10, 2.2, 2.2, 24)).translate([c[0], c[1], -5]);
      expect(bot.add(top).intersect(ring).volume()).toBeGreaterThan(1);
    }
  });
  it("applies the cuts to both halves", () => {
    const hole = M.Manifold.cylinder(40, 4, 4, 24).rotate([0, 90, 0]).translate([20, 0, 0]);
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0, cuts: [hole] });
    expect(bot.add(top).intersect(M.Manifold.cylinder(10, 3.5, 3.5, 24).rotate([0, 90, 0]).translate([28, 0, 0])).volume()).toBeLessThan(1e-3);
  });
  it("ears stay within 7 mm of the outer wall", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0 });
    const bb = bot.add(top).boundingBox();
    expect(bb.max[0]).toBeCloseTo(30 + 2 + 7, 3);
    expect(bb.min[1]).toBeCloseTo(-20 - 2 - 7, 3);
  });

  const thin = { lo: [-20, -15, -2.3] as [number, number, number], hi: [20, 15, 2.3] as [number, number, number] };
  const cases: [string, typeof inner, number][] = [["default", inner, 2], ["thin FPV-like", thin, 1.2]];
  const frac = (m: ReturnType<typeof box>, region: ReturnType<typeof box>) => m.intersect(region).volume() / region.volume();
  for (const [name, inn, wall] of cases) {
    it(`${name}: each half is one solid, roof and floor intact`, () => {
      const [bot, top] = clamshell(M, { inner: inn, wall, splitZ: 0 });
      expect(bot.decompose().length).toBe(1);
      expect(top.decompose().length).toBe(1);
      const roof = box(M, [inn.lo[0], inn.lo[1], inn.hi[2]], [inn.hi[0], inn.hi[1], inn.hi[2] + wall]);
      const floor = box(M, [inn.lo[0], inn.lo[1], inn.lo[2] - wall], [inn.hi[0], inn.hi[1], inn.lo[2]]);
      const rf = frac(top, roof), ff = frac(bot, floor);
      console.log(name, "roof fill", rf.toFixed(4), "floor fill", ff.toFixed(4));
      expect(rf).toBeGreaterThanOrEqual(0.99);
      expect(ff).toBeGreaterThanOrEqual(0.99);
    });
  }
  it("outdoor: the outer wall beside the recess is at least 0.6 mm", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0 });
    const band = box(M, [31.4, -15, 0], [32, 15, 3.3]);
    const f = frac(top, band);
    console.log("outdoor wall band fill", f.toFixed(4));
    expect(f).toBeGreaterThanOrEqual(0.99);
    expect(bot.boundingBox().max[2]).toBeGreaterThan(0);
  });
  it("thin FPV-like case gets a flat joint (no lip)", () => {
    const [bot, top] = clamshell(M, { inner: thin, wall: 1.2, splitZ: 0 });
    expect(bot.boundingBox().max[2]).toBeCloseTo(0, 3);
    expect(top.boundingBox().min[2]).toBeCloseTo(0, 3);
  });
  it("splitZ outside the cavity throws", () => {
    expect(() => clamshell(M, { inner, wall: 2, splitZ: 15 })).toThrow();
    expect(() => clamshell(M, { inner, wall: 2, splitZ: -10 })).toThrow();
  });
  it("nut pocket is at the bottom only: the top face of the top half is solid round the hole", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0 });
    const c = earCentres(inner, 2)[0];
    const hex = M.Manifold.cylinder(2.8, 3.3, 3.3, 6).subtract(M.Manifold.cylinder(2.8, 2, 2, 16)).translate([c[0], c[1], 17 - 2.8]);
    expect(top.intersect(hex).volume()).toBeGreaterThan(0.9 * hex.volume());
    const pocket = M.Manifold.cylinder(2.8, 3.3, 3.3, 6).subtract(M.Manifold.cylinder(2.8, 2, 2, 16)).translate([c[0], c[1], -12]);
    expect(bot.intersect(pocket).volume()).toBeLessThan(1e-3);
  });
  it("the drain goes through the floor only", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0, drain: true });
    const probe = M.Manifold.cylinder(60, 1, 1, 16).translate([-26, -16, -20]);
    expect(bot.intersect(probe).volume()).toBeLessThan(1e-3);        // open through the floor (z -12..-10 and below)
    const roofProbe = M.Manifold.cylinder(2, 1, 1, 16).translate([-26, -16, 15]);
    expect(top.intersect(roofProbe).volume()).toBeGreaterThan(0.99 * roofProbe.volume());
    expect(bot.add(top).volume()).toBeLessThan(clamshell(M, { inner, wall: 2, splitZ: 0 }).reduce((a, m) => a + m.volume(), 0));
  });
  it("ear bridges stay at their corner for a box far from the origin", () => {
    const far = { lo: [300, 40, 10] as [number, number, number], hi: [360, 80, 40] as [number, number, number] }, wall = 2;
    const out = { lo: far.lo.map((v) => v - wall) as [number, number, number], hi: far.hi.map((v) => v + wall) as [number, number, number] };
    for (const half of clamshell(M, { inner: far, wall, splitZ: 25 })) {
      const bb = half.boundingBox(), h = bb.max[2] - bb.min[2];
      let rest = half.subtract(box(M, [out.lo[0], out.lo[1], bb.min[2] - 1], [out.hi[0], out.hi[1], bb.max[2] + 1]));
      for (const c of earCentres(far, wall)) rest = rest.subtract(M.Manifold.cylinder(h + 2, EAR_R, EAR_R, 24).translate([c[0], c[1], bb.min[2] - 1]));
      // a correct bridge only fills the corner between the ear circle and the box corner (16 − π·4²/4 ≈ 3.4 mm² each)
      expect(rest.volume()).toBeLessThan(4 * 5 * h);
    }
  });
});
