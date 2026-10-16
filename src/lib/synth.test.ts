import { describe, expect, it } from "vitest";
import { synthesize } from "./synth";
import { ANTENNA_BY_ID } from "./antennas";

const base = { goal: "balanced" as const, family: "wire" as const, pol: "any" as const, pattern: "any" as const, d: 2e-3, er: 4.4, h: 1.6e-3 };

describe("synthesis", () => {
  it("2 m single band: the winner is matched (SWR < 1.6 over the band)", () => {
    const r = synthesize({ ...base, bands: [[144e6, 146e6]], pattern: "omni" });
    expect(r.length).toBeGreaterThan(2);
    expect(Math.max(...r[0].swr)).toBeLessThan(1.6);
  }, 120000);
  it("2 m + 70 cm: a multi-band capable type beats single-band ones", () => {
    const r = synthesize({ ...base, bands: [[144e6, 146e6], [430e6, 440e6]] });
    expect(ANTENNA_BY_ID[r[0].id].multiband).toBeTruthy();
  }, 240000);
  it("beam filter only returns directional types, smallest goal prefers small ones", () => {
    const r = synthesize({ ...base, bands: [[430e6, 440e6]], pattern: "beam", goal: "small" });
    expect(r.every((c) => ["yagi", "moxon", "quad", "biquad", "helix"].includes(c.id))).toBe(true);
  }, 240000);
  it("sky-tilted bicones are scored from their precomputed sweep", () => {
    const r = synthesize({ ...base, bands: [[960e6, 1360e6]], pol: "vertical", pattern: "omni" });
    const a55 = r.find((c) => c.id === "skyconecage55");
    expect(a55 && Math.max(...a55.swr)).toBeLessThan(2);
  }, 240000);
  it("bands wider than a broadband type's range fail it (70 MHz – 9.4 GHz is 134:1)", () => {
    const r = synthesize({ ...base, bands: [[70e6, 9.4e9]], pol: "vertical", pattern: "omni" });
    for (const id of ["skycone21", "skyconecage55", "discone"]) expect(r.find((c) => c.id === id)?.swr[0]).toBe(99);
  }, 240000);
});
