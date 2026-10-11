import { describe, expect, it } from "vitest";
import { parseOpenEMS, parseTouchstone } from "./importers";

describe("importers with hostile input", () => {
  it("Touchstone: skips the open (Γ = 1) and f ≤ 0, sorts by frequency, ignores a bad R", () => {
    const r = parseTouchstone("# MHz S RI R abc\n146 0 0\n0 0 0\n144 1 0\n145 0.2 0\n", "x");
    expect(r.z.map((p) => p.f)).toEqual([145e6, 146e6]);
    expect(r.z[1].r).toBeCloseTo(50);
    expect(r.z.every((p) => Number.isFinite(p.r) && Number.isFinite(p.x))).toBe(true);
  });
  it("openEMS: mismatched arrays are trimmed, empty results rejected", () => {
    expect(parseOpenEMS({ f: [1e9, 2e9], zin_re: [50], zin_im: [0] }, "x", 1e9).z).toHaveLength(1);
    expect(() => parseOpenEMS({ f: [1e9], zin_re: [] }, "x", 1e9)).toThrow();
    const r = parseOpenEMS({ f: [1e9], zin_re: [50], zin_im: [0], theta: [0, 90], cut_xz: [0], cut_yz: [0, 1], cut_xy: [1] }, "x", 1e9);
    expect(r.pattern!.cuts.every((c) => c.dbi.every(Number.isFinite))).toBe(true);
  });
});
