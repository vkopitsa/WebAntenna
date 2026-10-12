import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./index";
import { SKYCONE_8 } from "./skycone.data";
import { skyconeCurrents, skyconeGain, skyconeZ } from "./skycone";
import { radiationEligible, s11, simulate } from "../simulate";
import { partsFor } from "../print";
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

  it("compact 6.7:1 at 960 MHz is design S73: Ø73 × 71 mm, SWR < 2, a ferrite sleeve", () => {
    const def = ANTENNA_BY_ID.skycone7, p = { bands: "960e6-6400e6" }, d = def.build(p);
    expect(dim("skycone7", "960e6-6400e6", "Overall height") * 1e3).toBeCloseTo(71.0, 0);
    expect(dim("skycone7", "960e6-6400e6", "Hot element diameter") * 1e3).toBeCloseTo(73.1, 0);
    const r = simulate(def, p, d);
    expect(Math.max(...r.z.filter((q) => q.f >= 960e6 && q.f <= 6.4e9).map((q) => s11(q, 50).swr))).toBeLessThan(2);
    expect(d.notes.some((n) => n.startsWith("Ferrite sleeve required"))).toBe(true);
    const parts = partsFor("skycone7", def.defaults, d);
    expect(parts.map((q) => q.id)).toEqual(expect.arrayContaining(["shell", "skycone-cup", "skycone-handle", "skycone-former", "skycone-tpl-1"]));
    expect(parts.find((q) => q.id === "skycone-handle")!.purpose.s).toContain("ferrite sleeve");
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

  it("Radiation view: rings of the solved surface current, scaled with the size", () => {
    const def = ANTENNA_BY_ID.skycone8, d = def.build(def.defaults);
    expect(radiationEligible("skycone8", d)).toBe(true);
    const c = skyconeCurrents("skycone8", d)!;
    expect(c.els.length).toBe(12 * SKYCONE_8.cur.seg.length);
    expect(c.els.every((e) => Number.isFinite(e.cr) && Number.isFinite(e.ci))).toBe(true);
    const zmax = Math.max(...c.els.map((e) => e.mid[2]));
    expect(zmax).toBeCloseTo(0.089, 2);                                 // up to the lid at 89 mm
    const half = skyconeCurrents("skycone8", def.build({ bands: "1600e6-12800e6" }))!;
    expect(Math.max(...half.els.map((e) => e.mid[2]))).toBeCloseTo(zmax / 2, 6);
  });

  it("print kit: B gets every part in one piece each; A's cover comes in glued pieces", () => {
    const ids = (id: string) => { const def = ANTENNA_BY_ID[id]; return partsFor(id, def.defaults, def.build(def.defaults)).map((p) => p.id); };
    expect(ids("skycone8")).toEqual(expect.arrayContaining(["shell", "skycone-cup", "skycone-handle", "skycone-stand", "skycone-former", "skycone-wedge", "skycone-fork", "skycone-tpl-1"]));
    expect(ids("skycone21")).toContain("shell");
    expect(ids("skycone21")).not.toContain("skycone-cup");               // Ø279 mm: larger than the bed
  });
});
