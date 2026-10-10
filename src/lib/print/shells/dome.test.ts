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
  it("the cone wall is never thinner than 0.7 wall and does not break through the top", () => {
    const o: DomeOpts = { r: 35, z0: 0, z1: 100, wall: 2, base: { kind: "flange", pocketR: 41, pocketH: 2.3, ringR: 51, holeR: 46 }, drain: false };
    const segs = dome(M, o);
    expect(segs.length).toBe(1);
    const H = domeHeight(o), top = o.z1;
    // sample the section along x (y = 0): wall thickness measured perpendicular to the outer cone
    const slope = Math.atan2(H - top, 37);   // outer cone angle from horizontal
    expect(slope).toBeGreaterThan(Math.PI / 4);
    for (const dz of [0.5, 5, 15, 25, 33]) {
      const z = top + dz;
      const slab = segs[0].intersect(M.Manifold.cube([200, 0.2, 0.2], true).translate([0, 0, z]));
      const bb = slab.boundingBox();
      const rOut = bb.max[0];
      expect(slab.volume()).toBeGreaterThan(0);
      const gap = rOut - (o.r - dz);                 // horizontal gap to the inner 45 degree cone
      expect(gap * Math.sin(slope)).toBeGreaterThanOrEqual(0.7 * o.wall - 0.05);
    }
    expect(segs[0].decompose().length).toBe(1);
    expect(segs[0].genus()).toBe(3);                  // only the 3 bolt holes: nothing breaks through the apex
  });
  it("flange: 3 M3 holes at holeR, outside the pocket", () => {
    const whole = restack(dome(M, flange), domeHeight(flange));
    for (const a of [0, 120, 240]) {
      const x = 46 * Math.cos((a * Math.PI) / 180), y = 46 * Math.sin((a * Math.PI) / 180);
      expect(whole.intersect(M.Manifold.cylinder(20, 1.5, 1.5, 16).translate([x, y, -5])).volume()).toBeLessThan(1e-3);
    }
  });
  it("mast base: a mast hole through the bottom plate", () => {
    const o: DomeOpts = { r: 40, z0: -60, z1: 30, wall: 2, base: { kind: "mast", mastD: 25 }, drain: true };
    const segs = dome(M, o);
    expect(segs[0].boundingBox().min[2]).toBeCloseTo(0, 3);
    const whole = restack(segs, domeHeight(o)).translate([0, 0, domeOffset(o)]);   // world coordinates
    expect(domeOffset(o)).toBe(-62);
    expect(whole.intersect(M.Manifold.cylinder(100, 12.4, 12.4, 48).translate([0, 0, -100])).volume()).toBeLessThan(1e-2);
    // the plate itself is there outside the hole
    expect(whole.intersect(M.Manifold.cylinder(1, 30, 30, 48).translate([0, 0, -61.5])).volume()).toBeGreaterThan(1000);
    expect(whole.intersect(M.Manifold.cylinder(1, 12.9, 12.9, 48).translate([0, 0, -61.5])).volume()).toBeGreaterThan(0);
  });
});
