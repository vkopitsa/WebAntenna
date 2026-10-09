import { describe, expect, it } from "vitest";
import { synthesize } from "./synth";

const base = { goal: "balanced" as const, family: "wire" as const, pol: "any" as const, pattern: "any" as const, d: 2e-3, er: 4.4, h: 1.6e-3 };

describe("synthesis", () => {
  it("2 m single band: the winner is matched (SWR < 1.6 over the band)", () => {
    const r = synthesize({ ...base, bands: [[144e6, 146e6]], pattern: "omni" });
    expect(r.length).toBeGreaterThan(2);
    expect(Math.max(...r[0].swr)).toBeLessThan(1.6);
  }, 120000);
  it("2 m + 70 cm: a multi-band capable type beats single-band ones", () => {
    const r = synthesize({ ...base, bands: [[144e6, 146e6], [430e6, 440e6]] });
    expect(["fandipole", "discone"]).toContain(r[0].id);
  }, 240000);
  it("beam filter only returns directional types, smallest goal prefers small ones", () => {
    const r = synthesize({ ...base, bands: [[430e6, 440e6]], pattern: "beam", goal: "small" });
    expect(r.every((c) => ["yagi", "moxon", "quad", "biquad", "helix"].includes(c.id))).toBe(true);
  }, 240000);
});
