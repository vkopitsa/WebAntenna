import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./index";
import { SKYCONE_8 } from "./skycone.data";
import { skyconeGain, skyconeZ } from "./skycone";
import { s11, simulate } from "../simulate";
import { templatePages } from "../template";

// Reference: docs/FPV-DETECTOR-ANTENNA.md (design B_simple and design A, body-of-revolution MoM, no cable).
const dim = (id: string, bands: string, label: string) => ANTENNA_BY_ID[id].build({ bands }).dims.find((d) => d.label === label)!.value;

describe("sky-tilted capped bicones", () => {
  it("8:1 at 800 MHz is design B: Ø113 × 110 mm, the doc's cut list", () => {
    const d = ANTENNA_BY_ID.skycone8.build({ bands: "800e6-6400e6" });
    expect(dim("skycone8", "800e6-6400e6", "Overall height") * 1e3).toBeCloseTo(110.2, 1);
    expect(dim("skycone8", "800e6-6400e6", "Ground cone diameter") * 1e3).toBeCloseTo(113, 1);
    const sectors = d.sheets!.filter((s) => s.kind === "sector").map((s) => (s.kind === "sector" ? +s.angle.toFixed(1) : 0));
    expect(sectors).toEqual([285.6, 203.9, 336.1]);
  });

  it("21:1 at 300 MHz is design A: Ø275 × 294 mm", () => {
    expect(dim("skycone21", "300e6-6400e6", "Overall height") * 1e3).toBeCloseTo(294.2, 1);
    expect(dim("skycone21", "300e6-6400e6", "Hot element diameter") * 1e3).toBeCloseTo(274.7, 1);
  });

  it("the tabulated sweep: SWR ≤ 1.4 over 800 MHz – 6.4 GHz, beam above the horizon", () => {
    const def = ANTENNA_BY_ID.skycone8, p = { bands: "800e6-6400e6" };
    const r = simulate(def, p, def.build(p));
    expect(r.method).toBe("analytic");
    expect(r.z.length).toBeGreaterThan(40);
    expect(Math.max(...r.z.map((q) => s11(q, 50).swr))).toBeLessThan(1.4);
    expect(r.pattern!.max.theta).toBeLessThan(90);   // peak above the horizon
  });

  it("scales exactly: twice the frequency, half the size, the same SWR", () => {
    expect(dim("skycone8", "1600e6-12800e6", "Overall height") * 2).toBeCloseTo(dim("skycone8", "800e6-6400e6", "Overall height"), 9);
    for (const f of [900e6, 2.4e9, 5.8e9]) {
      const a = skyconeZ(SKYCONE_8, 800e6, f)!, b = skyconeZ(SKYCONE_8, 1600e6, 2 * f)!;
      expect(b.r).toBeCloseTo(a.r, 9);
      expect(b.x).toBeCloseTo(a.x, 9);
    }
  });

  it("interpolation returns the table rows at the table frequencies", () => {
    const i = 20, f = SKYCONE_8.f[i] * 800e6;
    expect(skyconeZ(SKYCONE_8, 800e6, f)!.r).toBeCloseTo(SKYCONE_8.r[i], 6);
    const el = 30, j = SKYCONE_8.els.indexOf(el);
    expect(skyconeGain(SKYCONE_8, 800e6, f)(((90 - el) * Math.PI) / 180)).toBeCloseTo(SKYCONE_8.g[i][j], 6);
    expect(skyconeZ(SKYCONE_8, 800e6, 100e6)).toBeNull();
  });

  it("the build sheet carries the 1:1 flat patterns", () => {
    const def = ANTENNA_BY_ID.skycone8, d = def.build(def.defaults);
    expect(templatePages(def, d, false).length).toBeGreaterThan(1);
  });
});
