import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { simulate } from "./simulate";
import { parseTouchstone } from "./importers";
import type { Design, Params } from "./types";

const build = (id: string, p: Params = {}): Design => ANTENNA_BY_ID[id].build({ ...ANTENNA_BY_ID[id].defaults, ...p });
const warns = (d: Design) => d.notes.filter((n) => n.startsWith("Warning"));
const dimv = (d: Design, label: string) => d.dims.find((x) => x.label === label)!.value;

describe("geometry guards: wires never intersect", () => {
  it("yagi: spacings stay at two element diameters, with a warning", () => {
    const d = build("yagi", { bands: "2.4e9-2.5e9", d: 12e-3 });
    const xs = d.wires.filter((w) => !w.drawOnly && w.tag).map((w) => w.a[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(2 * 12e-3 - 1e-9);
    expect(warns(d).length).toBe(1);
    expect(warns(build("yagi"))).toHaveLength(0);
  });
  it("jpole: tap above d and legs 2 d apart at high frequency; the 2 m design is untouched", () => {
    const d = build("jpole", { bands: "2.4e9-2.5e9", d: 6e-3, sp: 5e-3 });
    expect(dimv(d, "Feed tap height above the shorting bar")).toBeGreaterThanOrEqual(6e-3);
    expect(dimv(d, "Spacing between elements")).toBeGreaterThanOrEqual(12e-3);
    expect(warns(d)).toHaveLength(1);
    const ref = build("jpole");
    expect(warns(ref)).toHaveLength(0);
    expect(dimv(ref, "Spacing between elements")).toBeCloseTo(25e-3, 9);
  });
  it("helix: the wire is thinner than the pitch", () => {
    const d = build("helix", { d: 0.05 });
    expect(dimv(d, "Wire diameter used (reduced to fit the pitch)")).toBeLessThanOrEqual(0.8 * dimv(d, "Turn spacing (pitch)") + 1e-12);
    expect(warns(d)).toHaveLength(1);
    expect(warns(build("helix"))).toHaveLength(0);
  });
  it("spring: coil diameter >= 2 d, clamped wire warns", () => {
    const d = build("spring", { D: 1e-3, d: 0.8e-3, pitch: 5e-3 });
    expect(dimv(d, "Coil diameter (wire centre)")).toBeGreaterThanOrEqual(1.6e-3 - 1e-12);
    expect(warns(d).length).toBeGreaterThan(0);
    expect(warns(build("spring", { pitch: 0.5e-3, d: 0.8e-3 }))).toHaveLength(1);
    expect(warns(build("spring"))).toHaveLength(0);
  });
});

describe("printed guards", () => {
  it("printed dipole: arms stay positive for a wide trace at high frequency", () => {
    const d = build("printeddipole", { bands: "20e9-21e9", w: 8e-3 });
    expect(dimv(d, "Each arm")).toBeGreaterThan(0);
    expect(warns(d)).toHaveLength(1);
  });
  it("pcb loop: every drawn strip has positive size", () => {
    const d = build("pcbloop", { a: 3e-3, b: 3e-3, w: 8e-3 });
    for (const q of d.plates.filter((p) => p.label === "Loop")) {
      const xs = q.pts.map((t) => t[0]), ys = q.pts.map((t) => t[1]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(1e-6);
      expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(1e-6);
    }
    expect(warns(d).some((n) => n.includes("reduced"))).toBe(true);
  });
  it("meander: the pitch keeps a gap between runs", () => {
    const d = build("meander", { P: 0.5e-3 });
    expect(dimv(d, "Meander pitch")).toBeGreaterThanOrEqual(1.2e-3 - 1e-12);
    expect(warns(d).length).toBeGreaterThan(0);
  });
});

describe("pattern sampling", () => {
  it("a straight horizontal half-wave dipole has a 78 degree E-plane beamwidth", () => {
    const def = ANTENNA_BY_ID.dipole;
    const r = simulate(def, def.defaults, def.build(def.defaults));
    expect(r.pattern!.hpbw).toBeGreaterThan(74);
    expect(r.pattern!.hpbw).toBeLessThan(82);
  });
  it("collinear: in phase at the design frequency (beam on the horizon), tilted away from it", () => {
    const def = ANTENNA_BY_ID.collinear, d = def.build(def.defaults);
    const at = (patternF: number) => simulate(def, def.defaults, d, { patternF }).pattern!.max;
    const m0 = at(d.f);
    expect(Math.abs(m0.theta - 90)).toBeLessThanOrEqual(5);
    expect(Math.abs(at(d.f * 1.5).theta - 90)).toBeGreaterThan(10);
  });
});

describe("Touchstone", () => {
  it(".s2p: the noise block (5 columns) is not read as S11", () => {
    const txt = "# GHz S MA R 50\n1 0.5 0 0.1 0 0.1 0 0.5 0\n2 0.4 10 0.1 0 0.1 0 0.4 10\n! noise\n1.5 1.2 0.3 20 0.4\n";
    expect(parseTouchstone(txt, "x.s2p").z).toHaveLength(2);
  });
});
