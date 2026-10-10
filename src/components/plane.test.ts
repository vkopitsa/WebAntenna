import { describe, expect, it } from "vitest";
import { cameraBasis, screenPlane } from "./plane";

const dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];

describe("screen plane", () => {
  it("basis is orthonormal and matches Preview's camera for the top view (x right, y up)", () => {
    const { right, down, depth } = cameraBasis(90, 90);
    expect(right[0]).toBeCloseTo(1); expect(down[1]).toBeCloseTo(-1); expect(depth[2]).toBeCloseTo(-1);
    for (const [yaw, pitch] of [[120, 25], [180, 0], [37, -60]]) {
      const b = cameraBasis(yaw, pitch);
      expect(dot(b.right, b.down)).toBeCloseTo(0); expect(dot(b.right, b.depth)).toBeCloseTo(0); expect(dot(b.down, b.depth)).toBeCloseTo(0);
      expect(dot(b.right, b.right)).toBeCloseTo(1); expect(dot(b.down, b.down)).toBeCloseTo(1);
    }
  });
  it("plane covers the view box and passes through the reference point's depth", () => {
    const ref: [number, number, number] = [0.1, 0.2, 0.3];
    const p = screenPlane(120, 25, { ox: 400, oy: 270, k: 1000, W: 800, H: 540 }, ref, 200);
    expect(p.w).toBeCloseTo(0.8); expect(p.h).toBeCloseTo(0.54);
    expect(p.nx).toBe(200); expect(p.ny).toBe(135);
    const { right, down, depth } = cameraBasis(120, 25);
    expect(dot(p.origin, depth)).toBeCloseTo(dot(ref, depth));
    // the SVG centre (400, 270) is screen coords (0, 0)
    const c = [0, 1, 2].map((i) => p.origin[i] + p.u[i] * 0.4 + p.v[i] * 0.27);
    expect(dot(c, right)).toBeCloseTo(0); expect(dot(c, down)).toBeCloseTo(0);
  });
});
