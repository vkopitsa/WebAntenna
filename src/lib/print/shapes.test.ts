import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "./manifold";
import { buildPart, msg, PartError, FAIL, type PartSpec } from "./parts";
import { dShape, pieceBottoms, stack, twistGroove, toZ } from "./shapes";
import { SEG_H } from "./rules";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const ball = (p: [number, number, number], d: number) => M.Manifold.sphere(d / 2, 24).translate(p);

describe("PartError", () => {
  it("buildPart reports the part's own message", () => {
    const spec: PartSpec = { id: "x", title: "x", use: "jig", qty: 1, purpose: msg("x"), howTo: [], build: () => { throw new PartError(msg(FAIL.thick)); } };
    const r = buildPart(M, spec, "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.s).toBe(FAIL.thick);
  });
});

describe("twistGroove", () => {
  const R = 30, d = 2, S = 40, z0 = 5;
  const at = (t: number, hand: 1 | -1): [number, number, number] => [R * Math.cos(t), hand * R * Math.sin(t), z0 + (S * t) / (2 * Math.PI)];
  for (const hand of [1, -1] as const) {
    it(`hand ${hand}: a wire ball on the helix fits, the mirrored helix does not`, () => {
      const g = twistGroove(M, R, d, z0, z0 + 2 * S, S, hand);
      for (const t of [0.3, 1.7, 3.1, 4.4, 6.0, 8.5]) {
        const p = at(t, hand);
        expect(ball(p, d).subtract(g).volume(), `t=${t}`).toBeLessThan(1e-3);       // whole ball inside the groove
      }
      expect(ball(at(Math.PI / 2, -hand as 1 | -1), d).subtract(g).volume()).toBeGreaterThan(1);
    });
  }
});

describe("dShape, stack", () => {
  it("dShape is a circle cut flat at x = flat", () => {
    const b = dShape(M, 10, 4).bounds();
    expect(b.max[0]).toBeCloseTo(4, 3);
    expect(b.min[0]).toBeCloseTo(-10, 1);
  });
  it("cuts a tall body into pieces no taller than SEG_H + the joint, standing on z = 0", () => {
    const H = 400, body = M.Manifold.cylinder(H, 20, 20, 48);
    const zs = pieceBottoms(H);
    expect(zs.length).toBe(3);
    const pieces = stack(body, H, (zc) => ({ below: M.Manifold.cylinder(8, 5, 5, 24).translate([0, 0, zc]) }));
    expect(pieces.length).toBe(3);
    pieces.forEach((p) => { const b = p.boundingBox(); expect(b.min[2]).toBeCloseTo(0, 6); expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(SEG_H + 8 + 1e-6); });
    expect(stack(body, 100, () => { throw new Error("no joint for one piece"); }).length).toBe(1);
  });
  it("toZ turns a direction to +z and moves the point to the origin", () => {
    const m = M.Manifold.cylinder(10, 1, 1, 12).rotate([0, 90, 0]).translate([5, 5, 0]);   // along +x from (5,5,0)
    const b = toZ(m, [5, 5, 0], [1, 0, 0]).boundingBox();
    expect(b.min[2]).toBeCloseTo(0, 4); expect(b.max[2]).toBeCloseTo(10, 4);
  });
});
