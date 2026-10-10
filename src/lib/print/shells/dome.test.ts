import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { pieceBottoms } from "../shapes";
import { dome, domeHeight, domeOffset, type DomeOpts } from "./dome";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const restack = (segs: ReturnType<typeof dome>, H: number) => {
  const zs = pieceBottoms(H);
  return segs.map((s, i) => s.translate([0, 0, segs.length > 1 ? zs[i] : 0])).reduce((a, b) => a.add(b));
};

describe("dome", () => {
  const flange: DomeOpts = { r: 35, z0: 0, z1: 380, wall: 2, base: { kind: "flange", pocketR: 41, pocketH: 2.3, ringR: 51, holeR: 46 }, drain: true };
  it("the inside (cylinder r, up to z1) is empty, the pieces fit the bed and add up", () => {
    const segs = dome(M, flange), H = domeHeight(flange);
    expect(segs.length).toBe(pieceBottoms(H).length);
    expect(segs.length).toBeGreaterThan(1);
    segs.forEach((s) => { const b = s.boundingBox(); expect(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2])).toBeLessThanOrEqual(180); });
    const whole = restack(segs, H);
    expect(whole.intersect(M.Manifold.cylinder(380 - 2.4, 34.9, 34.9, 64).translate([0, 0, 2.4])).volume()).toBeLessThan(1e-2);
    expect(whole.intersect(M.Manifold.cylinder(2.3, 40.8, 40.8, 64)).volume()).toBeLessThan(1e-2);   // pocket over the former flange
    expect(whole.intersect(M.Manifold.cylinder(1, 50, 50, 64).translate([0, 0, 3])).volume()).toBeGreaterThan(100);   // the ring is solid above the pocket
  });
  it("every piece is a single solid and the skirt clears the piece below", () => {
    const segs = dome(M, flange);
    segs.forEach((s) => expect(s.decompose().length).toBe(1));
    const ro = 37, zs = pieceBottoms(domeHeight(flange));
    // lower piece (outer radius ro) must not touch the skirt of the piece above: they only meet if overlapped in volume
    for (let i = 1; i < segs.length; i++) {
      const lower = segs[i - 1].translate([0, 0, zs[i - 1]]), upper = segs[i].translate([0, 0, zs[i]]);
      expect(lower.intersect(upper).volume()).toBeLessThan(1e-3);
      expect(segs[i].boundingBox().min[2]).toBeCloseTo(-6, 1);   // the skirt hangs 6 mm below the cut
      const sk = segs[i].intersect(M.Manifold.cylinder(5, 60, 60, 64).translate([0, 0, -5.5]));
      const b = sk.boundingBox();
      expect(Math.min(b.max[0], b.max[1])).toBeGreaterThan(ro + 0.1);   // skirt radius is outside the lower piece
      expect(sk.intersect(M.Manifold.cylinder(10, ro + 0.1, ro + 0.1, 64).translate([0, 0, -7])).volume()).toBeLessThan(1e-3);
    }
  });
  it("the cone wall is a full wall thick (a ball half a wall wide fits mid-wall) and does not break through the top", () => {
    const o: DomeOpts = { r: 35, z0: 0, z1: 100, wall: 2, base: { kind: "flange", pocketR: 41, pocketH: 2.3, ringR: 51, holeR: 46 }, drain: false };
    const segs = dome(M, o);
    expect(segs.length).toBe(1);
    const top = o.z1, c = Math.SQRT1_2;
    // A ball of radius (wall - 0.1) / 2 centred half a wall from the inner 45 degree cone, along its normal, touches both
    // surfaces if the perpendicular thickness is >= wall - 0.1; any thinner and it pokes out into air.
    const br = (o.wall - 0.1) / 2;
    for (const dz of [0, 0.3, 0.6, 1, 5, 15, 25, 33]) {
      const ball = M.Manifold.sphere(br, 32).translate([o.r - dz + (o.wall / 2) * c, 0, top + dz + (o.wall / 2) * c]);
      expect(ball.subtract(segs[0]).volume()).toBeLessThan(1e-3);
    }
    expect(domeHeight(o)).toBeCloseTo(top + o.r + o.wall * Math.SQRT2, 6);
    expect(segs[0].decompose().length).toBe(1);
    expect(segs[0].genus()).toBe(3);                  // only the 3 bolt holes: nothing breaks through the apex
  });
  it("a cut that falls in the cone still gives single solids with a skirt-ring first layer", () => {
    const o: DomeOpts = { r: 90, z0: 0, z1: 78, wall: 2, base: { kind: "flange", pocketR: 96, pocketH: 2.3, ringR: 106, holeR: 101 }, drain: false };
    const H = domeHeight(o), zs = pieceBottoms(H);
    expect(zs.length).toBe(2);
    expect(zs[1]).toBeGreaterThan(o.z1);
    const segs = dome(M, o);
    segs.forEach((s) => expect(s.decompose().length).toBe(1));
    expect(segs[1].boundingBox().min[2]).toBeCloseTo(-6, 1);
  });
  it("tube cuts: single solids, and the first layer of an upper piece is just the skirt ring", () => {
    const segs = dome(M, flange);
    const ro = 37, Ro = ro + 2 + 0.15, ri = ro + 0.15, ring = Math.PI * (Ro * Ro - ri * ri);
    for (let i = 1; i < segs.length; i++) {
      const z = segs[i].boundingBox().min[2];
      const slab = segs[i].intersect(M.Manifold.cube([300, 300, 0.3], true).translate([0, 0, z + 0.15]));
      expect(slab.volume() / 0.3).toBeLessThanOrEqual(ring * 1.05);
    }
  });
  it("flange: the drain is a shallow channel at 60 degrees, the 0 degree bolt hole stays a full circle", () => {
    const whole = restack(dome(M, flange), domeHeight(flange));
    const around = M.Manifold.cylinder(1, 2.8, 2.8, 48).subtract(M.Manifold.cylinder(1, 2.0, 2.0, 48)).translate([46, 0, 2.5]);
    expect(around.intersect(whole).volume()).toBeGreaterThan(around.volume() * 0.98);
    for (const rho of [38, 44, 48, 50]) {
      const probe = M.Manifold.cube([1, 1, 0.6], true).translate([rho, 0, 2.8]).rotate([0, 0, 60]);
      expect(whole.intersect(probe).volume()).toBeLessThan(1e-3);
    }
    // the channel is shallow: the plate is intact below it and above it at 60 degrees
    for (const z of [1, 3.8]) expect(whole.intersect(M.Manifold.cube([1, 1, 0.4], true).translate([48, 0, z]).rotate([0, 0, 60])).volume()).toBeGreaterThan(0.3);
  });
  it("flange: 3 M3 holes at holeR, outside the pocket", () => {
    const whole = restack(dome(M, flange), domeHeight(flange));
    for (const a of [0, 120, 240]) {
      const x = 46 * Math.cos((a * Math.PI) / 180), y = 46 * Math.sin((a * Math.PI) / 180);
      expect(whole.intersect(M.Manifold.cylinder(20, 1.5, 1.5, 16).translate([x, y, -5])).volume()).toBeLessThan(1e-3);
    }
  });
  it("mast base: a mast hole through the bottom plate, one solid, empty inside", () => {
    const o: DomeOpts = { r: 40, z0: -60, z1: 30, wall: 2, base: { kind: "mast", mastD: 25 }, drain: true };
    const segs = dome(M, o);
    expect(segs[0].boundingBox().min[2]).toBeCloseTo(0, 3);
    segs.forEach((s) => expect(s.decompose().length).toBe(1));
    const whole = restack(segs, domeHeight(o)).translate([0, 0, domeOffset(o)]);   // world coordinates
    expect(domeOffset(o)).toBe(-62);
    expect(whole.intersect(M.Manifold.cylinder(100, 12.6, 12.6, 48).translate([0, 0, -100])).volume()).toBeLessThan(1e-2);
    expect(whole.intersect(M.Manifold.cylinder(90, 39.9, 39.9, 48).translate([0, 0, -60])).volume()).toBeLessThan(1e-2);   // plate top to z1
    // the plate itself is there outside the hole
    expect(whole.intersect(M.Manifold.cylinder(1, 30, 30, 48).translate([0, 0, -61.5])).volume()).toBeGreaterThan(1000);
    expect(whole.intersect(M.Manifold.cylinder(1, 12.9, 12.9, 48).translate([0, 0, -61.5])).volume()).toBeGreaterThan(0);
  });
});
