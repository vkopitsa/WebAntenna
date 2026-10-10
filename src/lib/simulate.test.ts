import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { buildMesh, cpGainFn, gainFn, solve } from "./mom";
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

describe("circular polarisation (cpGainFn)", () => {
  it("a right-hand helix radiates RHCP along its axis, the left-hand one LHCP; RHCP + LHCP = total", () => {
    const helix = (hand: string) => { const def = ANTENNA_BY_ID.helix, d = def.build({ ...def.defaults, hand }); return { s: solve(buildMesh(d, wavelength(d.f), 30, 1500)!, d.f)! }; };
    const r = helix("rhcp"), l = helix("lhcp");
    const cr = cpGainFn(r.s)(0.01, 0), cl = cpGainFn(l.s)(0.01, 0);
    expect(cr.rhcp - cr.lhcp).toBeGreaterThan(20);
    expect(cl.lhcp - cl.rhcp).toBeGreaterThan(20);
    const tot = gainFn(r.s)(0.01, 0);
    expect(10 * Math.log10(10 ** (cr.rhcp / 10) + 10 ** (cr.lhcp / 10))).toBeCloseTo(tot, 6);
  }, 60_000);
  it("cloverleaf: matched to 50 Ω across the FPV band, omni RHCP with the cross-polar well down (MoM ≈ NEC-2)", () => {
    const def = ANTENNA_BY_ID.cloverleaf;
    for (const [leaves, hand] of [["3", "rhcp"], ["4", "lhcp"]]) {
      const d = def.build({ ...def.defaults, leaves, hand });
      const m = buildMesh(d, wavelength(d.f), 40, 1500)!;
      for (const f of [5.65e9, 5.8e9, 5.95e9]) {
        const z = solve(m, f)!.z, g = Math.hypot(z[0] - 50, z[1]) / Math.hypot(z[0] + 50, z[1]);
        expect((1 + g) / (1 - g), `${leaves} ${f}`).toBeLessThan(1.5);
      }
      const cp = cpGainFn(solve(m, d.f)!);
      for (const phi of [0, 1, 2, 3, 4, 5]) {
        const q = cp((65 * Math.PI) / 180, phi), co = hand === "rhcp" ? q.rhcp : q.lhcp, x = hand === "rhcp" ? q.lhcp : q.rhcp;
        expect(co, `${leaves} φ=${phi}`).toBeGreaterThan(-1.5);
        expect(co - x, `${leaves} φ=${phi}`).toBeGreaterThan(5);
      }
    }
  }, 60_000);
});
