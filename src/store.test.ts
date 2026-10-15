import { describe, expect, it } from "vitest";
import { ANTENNAS } from "./lib/antennas";
import { get, set, setParam } from "./store";

describe("store: frequency bands", () => {
  it("a band edit applies to every antenna type", () => {
    set({ type: "yagi" });
    setParam("bands", "430e6-440e6");
    for (const a of ANTENNAS) expect(get().params[a.id].bands, a.id).toBe("430e6-440e6");
    set({ type: "biquad" });
    expect(get().params.biquad.bands).toBe("430e6-440e6");
  });

  it("other params stay per type", () => {
    set({ type: "yagi" });
    const before = get().params.dipole;
    setParam("d", 0.004);
    expect(get().params.yagi.d).toBe(0.004);
    expect(get().params.dipole).toBe(before);
  });
});
