import { describe, expect, it } from "vitest";
import { affected } from "./affects";
import { ANTENNA_BY_ID } from "./antennas";

const d = (id: string) => ANTENNA_BY_ID[id];

describe("affected", () => {
  it("bands move every wire, flagged as all", () => {
    const def = d("dipole");
    const a = affected(def, def.defaults, "bands")!;
    expect(a.wires.length).toBe(def.build(def.defaults).wires.length);
    expect(a.all).toBe(true);
  });
  it("dipole droop moves the two arms but not the feed gap", () => {
    const def = d("dipole");
    expect(affected(def, def.defaults, "droop")).toEqual({ wires: [1, 2], plates: [], all: false });
  });
  it("yagi element count changes wires", () => {
    const def = d("yagi");
    const key = def.params.find((p) => p.kind === "int")!.key;
    const a = affected(def, def.defaults, key)!;
    expect(a.wires.length).toBeGreaterThan(0);
  });
  it("dipole parameters give a subset or null; unknown key is null", () => {
    const def = d("dipole");
    expect(affected(def, def.defaults, "nope")).toBeNull();
    for (const p of def.params) {
      const a = affected(def, def.defaults, p.key);
      if (a) expect(a.wires.every((i) => i < def.build(def.defaults).wires.length)).toBe(true);
    }
  });
  it("printed antenna lights plates or wires", () => {
    const def = d("ifa");
    const hit = def.params.some((p) => affected(def, def.defaults, p.key));
    expect(hit).toBe(true);
  });
});
