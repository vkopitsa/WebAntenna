import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { buildMesh, gainFn, solve } from "./mom";
import { s11, simulate, toS1P } from "./simulate";
import { wavelength } from "./rf";

const run = (id: string, extra = {}) => {
  const def = ANTENNA_BY_ID[id];
  const p = { ...def.defaults, ...extra };
  const d = def.build(p);
  const m = buildMesh(d, wavelength(d.f), 80, 2000)!;
  return { d, s: solve(m, d.f)! };
};

describe("MoM solver vs references", () => {
  it("half-wave dipole: ≈ 73 Ω, 2.15 dBi (theory, NEC-2)", () => {
    const { s } = run("dipole");
    expect(s.z[0]).toBeGreaterThan(70); expect(s.z[0]).toBeLessThan(76);
    const g = gainFn(s);
    expect(g(Math.PI / 2, Math.PI / 2 - Math.PI / 2)).toBeCloseTo(2.15, 0); // broadside to a y-axis dipole is +x
    expect(g(Math.PI / 2, Math.PI / 2)).toBeLessThan(-20); // along the wire
  });
  it("Moxon ≈ 50 Ω, 6 dBi; quad ≈ 52 Ω (converged NEC-2)", () => {
    const mx = run("moxon").s;
    expect(Math.hypot(mx.z[0] - 50, mx.z[1])).toBeLessThan(12);
    expect(gainFn(mx)(Math.PI / 2, 0)).toBeGreaterThan(5.5);
    const q = run("quad").s;
    expect(Math.hypot(q.z[0] - 52, q.z[1] + 6)).toBeLessThan(8);
  });
  it("Yagi: forward gain within 1 dB of NEC-2 (13.4 dBi), strong rejection to the rear", () => {
    const g = gainFn(run("yagi").s);
    expect(Math.abs(g(Math.PI / 2, 0) - 13.4)).toBeLessThan(1);
    expect(g(Math.PI / 2, 0) - g(Math.PI / 2, Math.PI)).toBeGreaterThan(15);
  });
});

describe("simulate()", () => {
  it("wire antenna: impedance sweep over every band + pattern with sensible summary", () => {
    const def = ANTENNA_BY_ID.moxon, p = { ...def.defaults, bands: "144e6-146e6;430e6-440e6" };
    const r = simulate(def, p, def.build(p), { perBand: 5 });
    expect(r.method).toBe("mom");
    expect(r.z.length).toBe(10);
    expect(r.z.some((z) => z.f > 400e6)).toBe(true);
    expect(r.pattern!.max.dbi).toBeGreaterThan(5);
    expect(r.pattern!.max.dbi - r.pattern!.back).toBeGreaterThan(10);
    expect(r.pattern!.cuts.map((c) => c.id)).toEqual(["xy", "xz", "yz"]);
  });
  it("patch: analytic impedance is matched at the design frequency and the beam points up", () => {
    const def = ANTENNA_BY_ID.patch, p = def.defaults, d = def.build(p);
    const r = simulate(def, p, d, { perBand: 41 });
    const best = r.z.reduce((a, b) => (s11(a, 50).mag < s11(b, 50).mag ? a : b));
    expect(Math.abs(best.f - d.f) / d.f).toBeLessThan(0.01);
    expect(s11(best, 50).db).toBeLessThan(-15);
    expect(r.pattern!.max.theta).toBeLessThan(10);
    expect(r.pattern!.max.dbi).toBeGreaterThan(5);
    expect(r.pattern!.max.dbi).toBeLessThan(9);
  });
  it("collinear: pattern only, gain grows with sections", () => {
    const def = ANTENNA_BY_ID.collinear;
    const g = (n: number) => simulate(def, { ...def.defaults, n }, def.build({ ...def.defaults, n })).pattern!.max.dbi;
    expect(g(8)).toBeGreaterThan(g(2) + 4);
  });
  it("Touchstone export", () => {
    const t = toS1P("x", [{ f: 1e6, r: 50, x: 0 }, { f: 2e6, r: 100, x: 0 }], 50).split("\n");
    expect(t[1]).toBe("# HZ S RI R 50");
    expect(Number(t[2].split(" ")[1])).toBeCloseTo(0, 9);
    expect(Number(t[3].split(" ")[1])).toBeCloseTo(1 / 3, 6);
  });
});
