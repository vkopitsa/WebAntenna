import { describe, expect, it } from "vitest";
import { r, type Pcb } from "../pcb";
import { smooth } from "./mesh";
import { setup } from "./setup";
import { impedance, runCPU } from "./cpu";

const dipole: Pcb = {
  board: { x0: -5e-3, y0: -30e-3, x1: 5e-3, y1: 30e-3 }, h: 1.6e-3, er: 1, tanD: 0, t: 35e-6,
  rects: [r("top", -0.5e-3, 0.5e-3, 0.5e-3, 28.5e-3, "a"), r("top", -0.5e-3, -28.5e-3, 0.5e-3, -0.5e-3, "b")],
  port: { start: [-0.5e-3, -0.5e-3, 1.6e-3], stop: [0.5e-3, 0.5e-3, 1.6e-3], dir: "y", R: 50 },
};

describe("FDTD mesh", () => {
  it("graded fill: keeps fixed lines, max cell and neighbour ratio ≤ 1.4", () => {
    const fixed = [-0.05, -0.001, 0, 0.0004, 0.001, 0.06];
    const L = smooth(fixed, 0.004);
    for (const f of fixed) expect(L).toContain(f);
    const d = L.slice(1).map((x, i) => x - L[i]);
    expect(Math.max(...d)).toBeLessThanOrEqual(0.004 * 1.001);
    // seeds follow the real neighbour cells, so even next to the closely spaced lines growth stays ≤ 1.4
    for (let i = 1; i < d.length; i++) expect(Math.max(d[i] / d[i - 1], d[i - 1] / d[i])).toBeLessThan(1.42);
    expect(L.length).toBeLessThan(80);
  });
  it("reference dipole grid is the size validated against openEMS", () => {
    const s = setup(dipole, 2.4418e9 * 0.6, 2.4418e9 * 1.4);
    expect([s.nx, s.ny, s.nz]).toEqual([77, 112, 65]);
    expect(s.port.edges.length).toBe(30);
    // copper: every PEC edge has ca = cb = 0, the port edges are not PEC
    const pec = Array.from(s.cb[1]).filter((v) => v === 0).length;
    expect(pec).toBeGreaterThan(100);
    for (const e of s.port.edges) expect(s.cb[1][e.idx]).toBeGreaterThan(0);
  });
});

describe("FDTD CPU engine", () => {
  it("is stable and the port signals are finite (short run)", () => {
    const s = setup(dipole, 2.4418e9 * 0.6, 2.4418e9 * 1.4);
    const res = runCPU(s, { maxSteps: 60, endCriteria: 0 });
    expect(res.steps).toBe(60);
    // the Gaussian peaks at t0 ≈ 1 ns (≫ 60 steps), so check that the early fields stay finite and small
    expect(Array.from(res.v).every(Number.isFinite)).toBe(true);
    expect(Array.from(res.i).every(Number.isFinite)).toBe(true);
    expect(Math.max(...Array.from(res.v).map(Math.abs))).toBeLessThan(10);
  }, 60_000);
  it("impedance DFT of a resistor-like signal pair gives R", () => {
    const dt = 1e-12, n = 4000;
    const v = new Float64Array(n), i = new Float64Array(n);
    for (let k = 0; k < n; k++) { const t = (k + 1) * dt, ti = (k + 0.5) * dt; const g = (x: number) => Math.exp(-(((x - 4e-10) / 1e-10) ** 2)); v[k] = 75 * g(t); i[k] = g(ti); }
    const z = impedance({ v, i, steps: n, dt }, [1e9, 2e9]);
    expect(z[0].r).toBeCloseTo(75, 3);
    expect(Math.abs(z[0].x)).toBeLessThan(1e-3);
  });
});
