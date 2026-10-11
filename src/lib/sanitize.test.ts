import { describe, expect, it } from "vitest";
import { ANTENNAS } from "./antennas";
import { MAX_BANDS, sanitizeParam } from "./sanitize";
import { parseBands } from "./bands";

describe("sanitizeParam (share links, saved settings)", () => {
  const yagi = ANTENNAS.find((a) => a.id === "yagi")!;
  const pd = (k: string) => yagi.params.find((q) => q.key === k)!;
  it("clamps numbers to the param range and rounds ints", () => {
    const n = pd("n");
    expect(sanitizeParam(n, "1e9")).toBe(n.max);
    expect(sanitizeParam(n, -5)).toBe(n.min);
    expect(sanitizeParam(n, "7.6")).toBe(8);
    expect(sanitizeParam(n, "abc")).toBeUndefined();
    expect(sanitizeParam(n, "Infinity")).toBeUndefined();
  });
  it("drops bands outside the allowed range and caps the count", () => {
    const b = pd("bands");
    expect(sanitizeParam(b, "1-2")).toBeUndefined();
    expect(sanitizeParam(b, "1-2;144e6-146e6")).toBe("144000000-146000000");
    expect(parseBands(sanitizeParam(b, Array(50).fill("144e6-146e6").join(";")) as string)).toHaveLength(MAX_BANDS);
    expect(sanitizeParam(b, 5)).toBeUndefined();
  });
  it("selects only accept their options", () => {
    for (const def of ANTENNAS) for (const q of def.params) if (q.kind === "select") expect(sanitizeParam(q, "<script>")).toBeUndefined();
  });
  it("every default passes through unchanged", () => {
    for (const def of ANTENNAS) for (const q of def.params) expect(sanitizeParam(q, def.defaults[q.key]), `${def.id}.${q.key}`).toEqual(q.kind === "bands" ? parseBands(def.defaults[q.key] as string).map(([a, c]) => `${a}-${c}`).join(";") : def.defaults[q.key]);
  });
});
