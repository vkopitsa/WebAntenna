import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { box } from "../shapes";
import { clamshell, earCentres } from "./clamshell";

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
});
