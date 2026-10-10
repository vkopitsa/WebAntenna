import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { box, rod, type V3 } from "../shapes";
import type { Box3, Exit } from "./geometry";
import { hood } from "./hood";
import { PartError } from "../parts";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const inner: Box3 = { lo: [-20, -15, -10], hi: [20, 15, 12] };
const s = Math.SQRT1_2;
const xs: Exit[] = [
  { at: [0, 15, 0], dir: [0, 1, 0], d: 3 },                 // sideways
  { at: [20, 0, -4], dir: [s, 0, -s], d: 4 },               // drooping
  { at: [5, 5, 12], dir: [0, 0, 1], d: 8 },                 // up: a round hole through the roof
];

describe("hood", () => {
  it("one piece, one solid, open at the bottom, cavity empty", () => {
    const parts = hood(M, { inner, wall: 2, exits: xs });
    expect(parts.length).toBe(1);
    const h = parts[0];
    expect(h.decompose().length).toBe(1);
    expect(h.intersect(box(M, inner.lo, inner.hi)).volume()).toBeLessThan(1e-3);
    expect(h.boundingBox().min[2]).toBeCloseTo(inner.lo[2], 6);                    // no floor below the cavity
    expect(h.intersect(box(M, [-19, -14, -10.5], [19, 14, -9])).volume()).toBeLessThan(1e-3);   // and none at its level
  });
  it("roof closed except the up hole; the up hole is round (not a slot)", () => {
    const h = hood(M, { inner, wall: 2, exits: xs })[0];
    const roof = box(M, [-20, -15, 12], [20, 15, 14]);
    const hole = Math.PI * 4.65 ** 2 * 2;
    expect(roof.volume() - h.intersect(roof).volume()).toBeCloseTo(hole, -1);
    expect(h.intersect(rod(M, [5, 5, 11], [5, 5, 20], 8)).volume()).toBeLessThan(1e-3);
  });
  it("each side exit passes clear, and its slot is open straight down past the bottom", () => {
    const h = hood(M, { inner, wall: 2, exits: xs })[0];
    for (const x of xs.slice(0, 2)) {
      const end: V3 = [x.at[0] + x.dir[0] * 20, x.at[1] + x.dir[1] * 20, x.at[2] + x.dir[2] * 20];
      expect(h.intersect(rod(M, x.at, end, x.d)).volume()).toBeLessThan(1e-3);
      expect(h.intersect(rod(M, x.at, [x.at[0], x.at[1], inner.lo[2] - 5], x.d)).volume()).toBeLessThan(1e-3);
    }
  });
  it("walls away from the exits are intact", () => {
    const h = hood(M, { inner, wall: 2, exits: xs })[0];
    const band = box(M, [-22, -17, -10], [-20, 17, 12]);                            // the -x wall has no exit
    expect(h.intersect(band).volume() / band.volume()).toBeGreaterThan(0.999);
  });
  it("crumbs between close slots are dropped; the hood stays one solid", () => {
    // like a wide fan dipole hub: fat lug slots at 0 and ±45 degrees on both narrow end walls
    const hub: Box3 = { lo: [-10.45, -34, -33], hi: [10.45, 34, 18.15] };
    const s2 = Math.SQRT1_2;
    const fan: Exit[] = [1, -1].flatMap((sy): Exit[] => [
      { at: [0, sy * 34, 0], dir: [0, sy, 0], d: 21.1 },
      { at: [0, sy * 34, 9], dir: [0, sy * s2, s2 - 1e-3], d: 25.8 },
      { at: [0, sy * 34, -9], dir: [0, sy * s2, -s2], d: 25.8 },
      { at: [0, sy * 25, 18.15], dir: [0, 0, 1], d: 21.1 },
    ]);
    const h = hood(M, { inner: hub, wall: 2, exits: fan })[0];
    expect(h.decompose().length).toBe(1);
    expect(h.volume()).toBeGreaterThan(5000);
  });
  it("hole or slot depends on the face: a steep exit through a side wall is still a slot", () => {
    const steep: Exit = { at: [-20, 0, 2], dir: [-0.3, 0, Math.sqrt(1 - 0.09)], d: 3 };
    const h = hood(M, { inner, wall: 2, exits: [steep] })[0];
    expect(h.intersect(rod(M, steep.at, [steep.at[0], steep.at[1], inner.lo[2] - 5], steep.d)).volume()).toBeLessThan(1e-3);
  });
  it("a hood that loses more than 1 % to loose pieces is an error, not silently trimmed", () => {
    // two fat roof holes across a narrow roof cut it in two halves
    const narrow: Box3 = { lo: [-20, -6, -10], hi: [20, 6, 12] };
    const cut: Exit[] = [{ at: [0, 0, 12], dir: [0, 0, 1], d: 17 }, { at: [0, 6, 0], dir: [0, 1, 0], d: 20 }, { at: [0, -6, 0], dir: [0, -1, 0], d: 20 }];
    expect(() => hood(M, { inner: narrow, wall: 2, exits: cut })).toThrow(PartError);
  });
});
