import { describe, expect, it } from "vitest";
import { hzUnit, parseHz } from "./units";

describe("parseHz", () => {
  it("reads prefixes, exponents and explicit Hz", () => {
    expect(parseHz("435M")).toBe(435e6);
    expect(parseHz("1,2 GHz")).toBe(1.2e9);
    expect(parseHz("433.92e6")).toBe(433.92e6);
    expect(parseHz("100 Hz", [1e6], 1e3)).toBe(100);
    expect(parseHz("abc")).toBeNull();
  });
  it("a bare number takes the unit the field shows, else the first unit in range", () => {
    const units = (f: number) => [hzUnit(f), 1e6, 1e9, 1e3, 1];
    expect(parseHz("430", units(144e6), 100e3, 100e9)).toBe(430e6);
    expect(parseHz("5.8", units(2.4e9), 100e3, 100e9)).toBe(5.8e9);
    expect(parseHz("2400", units(5.8e9), 100e3, 100e9)).toBe(2400e6); // 2400 GHz is out of range
    expect(parseHz("100"), "no units given: Hz").toBe(100);
  });
});
