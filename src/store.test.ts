import { describe, expect, it } from "vitest";
import { ANTENNAS } from "./lib/antennas";
import { get, set, setParam, showHashUntilEdit } from "./store";

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

describe("store: share link in the address bar", () => {
  it("is removed again at the next state change", () => {
    const calls: string[] = [];
    const g = globalThis as unknown as { history?: unknown; location?: unknown };
    const old = { history: g.history, location: g.location };
    g.history = { replaceState: (_a: unknown, _b: unknown, u: string) => calls.push(u) };
    g.location = { pathname: "/x", search: "", hash: "" };
    try {
      showHashUntilEdit("#t=yagi");
      expect(calls).toEqual(["#t=yagi"]);
      setParam("d", 0.003);
      expect(calls).toEqual(["#t=yagi", "/x"]);
      setParam("d", 0.004);
      expect(calls.length).toBe(2);
    } finally { g.history = old.history; g.location = old.location; }
  });
});
