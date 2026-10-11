import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { buildMesh, currentElements, gainFn, segCurrents, solve } from "./mom";
import { wavelength } from "./rf";
import { envelope, fieldAt, fieldScale, fieldSolver, nearField, rampLUT, shade, solveField, type FieldPlane } from "./nearfield";
import { momEligible, radiationEligible } from "./simulate";
import { pcbStandIn } from "./pcbwires";
import type { CurrentElement } from "./mom";

const solved = (id: string, extra = {}) => {
  const def = ANTENNA_BY_ID[id];
  const d = def.build({ ...def.defaults, ...extra });
  const m = buildMesh(d, wavelength(d.f), 60, 450)!;
  return { d, s: solve(m, d.f)! };
};

describe("MoM currents", () => {
  it("segment currents of a centre-fed dipole: 1/Z at the feed, symmetric arms, small at the ends", () => {
    // the dipole is a short feed-gap wire (2 segments, wire 0) and two equal arms running outward from it
    const { s } = solved("dipole");
    const { ir, ii } = segCurrents(s);
    const n = s.mesh.segs.length, arm = (n - 2) / 2;
    const mag = Array.from(ir, (r, i) => Math.hypot(r, ii[i]));
    const iin = 1 / Math.hypot(s.z[0], s.z[1]);
    expect(mag[0]).toBeCloseTo(iin, 3);
    expect(mag[1]).toBeCloseTo(iin, 3);
    for (let i = 0; i < arm; i++) expect(mag[2 + i]).toBeCloseTo(mag[2 + arm + i], 6);
    expect(mag[2 + arm - 1]).toBeLessThan(0.1 * iin);
    for (let i = 1; i < arm; i++) expect(mag[2 + i]).toBeLessThanOrEqual(mag[1 + i] + 1e-12);
  });
  it("currentElements: two per unknown, and gainFn still gives the dipole 2.15 dBi", () => {
    const { s } = solved("dipole");
    expect(currentElements(s).length).toBe(2 * s.mesh.unknowns.length);
    expect(gainFn(s)(Math.PI / 2, 0)).toBeCloseTo(2.15, 0);
  });
});

const C0 = 299792458, ETA = 376.730313668;

/** Analytic Hertzian dipole I·dl along z at the origin (e^{−jkr}): [Er, Eθ] complex. */
function hertz(Idl: number, k: number, r: number, th: number) {
  const C = (ETA * Idl) / (4 * Math.PI);
  const kr = k * r, c = Math.cos(-kr), s = Math.sin(-kr);
  const mul = (a: number, b: number): [number, number] => [a * c - b * s, a * s + b * c];
  // Er = C·2cosθ/r²·(1 + 1/(jkr)) = C·2cosθ/r²·(1 − j/kr)
  const er = mul((C * 2 * Math.cos(th)) / (r * r), (-C * 2 * Math.cos(th)) / (r * r * kr));
  // Eθ = C·jk sinθ/r·(1 + 1/(jkr) − 1/(kr)²) = C sinθ/r² + j·C sinθ·(k/r − 1/(k r³))
  const et = mul((C * Math.sin(th)) / (r * r), C * Math.sin(th) * (k / r - 1 / (k * r * r * r)));
  return { er, et };
}

describe("near field", () => {
  const f = 100e6, k = (2 * Math.PI * f) / C0, lam = C0 / f;
  const el: CurrentElement[] = [{ dl: [0, 0, 1e-3], mid: [0, 0, 0], cr: 1, ci: 0, r: 1e-5 }];
  for (const [r, th] of [[0.1 * lam, Math.PI / 2], [0.1 * lam, Math.PI / 4], [5 * lam, Math.PI / 2], [5 * lam, Math.PI / 4]]) {
    it(`short element matches the Hertzian dipole at r = ${(r / lam).toFixed(1)} λ, θ = ${Math.round((th * 180) / Math.PI)}°`, () => {
      const pt: [number, number, number] = [r * Math.sin(th), 0, r * Math.cos(th)];
      const out = new Float64Array(6);
      fieldAt(el, k, pt, out);
      const { er, et } = hertz(1e-3, k, r, th);
      // x̂ = r̂ sinθ + θ̂ cosθ, ẑ = r̂ cosθ − θ̂ sinθ (φ = 0)
      const ex = [er[0] * Math.sin(th) + et[0] * Math.cos(th), er[1] * Math.sin(th) + et[1] * Math.cos(th)];
      const ez = [er[0] * Math.cos(th) - et[0] * Math.sin(th), er[1] * Math.cos(th) - et[1] * Math.sin(th)];
      const scaleE = Math.hypot(ex[0], ex[1], ez[0], ez[1]);
      for (const [got, want] of [[out[0], ex[0]], [out[1], ex[1]], [out[4], ez[0]], [out[5], ez[1]]])
        expect(Math.abs(got - want)).toBeLessThan(0.01 * scaleE);
      expect(Math.abs(out[2]) + Math.abs(out[3])).toBeLessThan(1e-9 * scaleE);
    });
  }

  it("never returns NaN/Infinity, even on the element itself", () => {
    const out = new Float64Array(6);
    fieldAt(el, k, [0, 0, 0], out);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
  });

  const planeXY = (half: number, n = 41): FieldPlane => ({
    origin: [-half, half, 0], u: [1, 0, 0], v: [0, -1, 0], w: 2 * half, h: 2 * half, nx: n, ny: n, ref: [0, 0, 0],
  });

  it("half-wave dipole: field symmetric about the dipole's centre plane; far |E|·r matches gainFn", () => {
    const { d, s } = solved("dipole");
    const lam0 = C0 / d.f;
    const g = nearField(currentElements(s), d.f, planeXY(lam0, 41));
    expect(Array.from(g.e).every(Number.isFinite)).toBe(true);
    // dipole along y: mirror y → −y is row j ↔ ny−1−j
    const at = (i: number, j: number) => envelope(g.e, j * g.nx + i);
    for (const [i, j] of [[5, 3], [30, 10], [20, 15]]) expect(at(i, j) / at(i, g.ny - 1 - j)).toBeCloseTo(1, 3);
    // far field, broadside (+x), r = 30 λ: G = 4π r²|E|² / (2η Pin), Pin = ½ R/|Z|²
    const out = new Float64Array(6), r = 30 * lam0;
    fieldAt(currentElements(s), (2 * Math.PI * d.f) / C0, [r, 0, 0], out);
    const e2 = out.reduce((a, x) => a + x * x, 0);
    const pin = (0.5 * s.z[0]) / (s.z[0] ** 2 + s.z[1] ** 2);
    const gdb = 10 * Math.log10((4 * Math.PI * r * r * e2) / (2 * ETA * pin));
    expect(Math.abs(gdb - gainFn(s)(Math.PI / 2, 0))).toBeLessThan(0.1);
  });

  it("Yagi: |E|·r on a far arc in front exceeds the arc behind", () => {
    const { d, s } = solved("yagi");
    const kk = (2 * Math.PI * d.f) / C0, R = 20 * (C0 / d.f), out = new Float64Array(6), els = currentElements(s);
    const arc = (phi0: number) => {
      let sum = 0;
      for (let a = -20; a <= 20; a += 5) { const p = phi0 + (a * Math.PI) / 180; fieldAt(els, kk, [R * Math.cos(p), R * Math.sin(p), 0], out); sum += Math.hypot(...out) * R; }
      return sum;
    };
    expect(arc(0)).toBeGreaterThan(3 * arc(Math.PI)); // gainFn: forward is +x
  });

  it("solveField: wire antennas solve with MoM, printed ones on a copper stand-in, analytic ones from assumed currents", () => {
    const def = ANTENNA_BY_ID.dipole, d = def.build(def.defaults);
    const res = solveField("dipole", d, planeXY(C0 / d.f, 20))!;
    expect(res.grid.nx).toBe(20);
    expect(res.segs.length).toBe(6 * res.ir.length);
    expect(res.model).toBe("mom");
    for (const [id, model] of [["patch", "ideal"], ["collinear", "ideal"], ["pcbloop", "ideal"], ["ifa", "standin"], ["printedvdipole", "standin"], ["dualbanddipole", "standin"]]) {
      const dd = ANTENNA_BY_ID[id].build(ANTENNA_BY_ID[id].defaults);
      expect(momEligible(id, dd)).toBe(false);
      expect(radiationEligible(id, dd), id).toBe(true);
      const r = solveField(id, dd, planeXY(0.1, 4))!;
      expect(r.model, id).toBe(model);
      expect(r.f).toBe(dd.f);
      expect(Array.from(r.grid.e).every(Number.isFinite), id).toBe(true);
      expect(Math.max(...Array.from(r.ir).map(Math.abs)), id).toBeGreaterThan(0);
    }
  });

  it("PCB stand-in: the printed dipole's wires resonate near the design frequency, every copper shape is joined", () => {
    for (const id of ["printeddipole", "printedvdipole", "sleevedipole", "pcbmonopole", "ifa", "meander", "dualbanddipole"]) {
      const def = ANTENNA_BY_ID[id], d = def.build(def.defaults), st = pcbStandIn(d)!;
      expect(st, id).not.toBeNull();
      // connected: walking the wire graph from the feed reaches every wire
      const key = (p: number[]) => p.map((c) => c.toFixed(9)).join(",");
      const adj = new Map<string, number[]>();
      st.design.wires.forEach((w, i) => { for (const e of [w.a, w.b]) adj.set(key(e), [...(adj.get(key(e)) ?? []), i]); });
      const seen = new Set([0]), todo = [0];
      while (todo.length) { const w = st.design.wires[todo.pop()!]; for (const e of [w.a, w.b]) for (const j of adj.get(key(e)) ?? []) if (!seen.has(j)) { seen.add(j); todo.push(j); } }
      expect(seen.size, id).toBe(st.design.wires.length);
    }
    for (const id of ["printeddipole", "sleevedipole"]) {
      const def = ANTENNA_BY_ID[id], d = def.build(def.defaults), st = pcbStandIn(d)!;
      const m = buildMesh(st.design, C0 / st.fs, 60, 450)!;
      const lo = solve(m, st.fs * 0.93)!.z[1], hi = solve(m, st.fs * 1.07)!.z[1];
      expect(lo, id).toBeLessThan(0);
      expect(hi, id).toBeGreaterThan(0);
    }
  });

  it("fieldScale handles an all-zero field; shade writes opaque pixels from the LUT", () => {
    const grid = { nx: 2, ny: 1, e: new Float32Array(12), r: new Float32Array(2), d: new Float32Array(2) };
    expect(fieldScale(grid, 0)).toBe(1);
    const lut = rampLUT([0, 0, 0], [128, 64, 0], [255, 255, 200]);
    expect(lut.length).toBe(1024);
    const out = new Uint8ClampedArray(8);
    grid.e[0] = 1; grid.r[0] = 1;
    shade(grid, 0, 1, lut, out);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 200, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 255]);
    shade(grid, Math.PI / 2, 1, lut, out); // Re(1·e^{jπ/2}) = 0 → background
    expect(out[0]).toBe(0);
    shade(grid, null, 1, lut, out); // envelope ignores phase
    expect(out[0]).toBe(255);
  });

  it("fieldScale is set by the radiated field, not by hot spots next to a wire", () => {
    // 100 pixels: 99 far ones at 1 (×r), one next to a wire at 1000
    const n = 100, grid = { nx: n, ny: 1, e: new Float32Array(6 * n), r: new Float32Array(n).fill(1), d: new Float32Array(n).fill(5) };
    for (let p = 0; p < n; p++) grid.e[6 * p] = 1;
    grid.e[0] = 1000; grid.d[0] = 0.01;
    expect(fieldScale(grid, 0.5)).toBeCloseTo(1);
    // nothing far enough: fall back to every pixel
    expect(fieldScale(grid, 10)).toBeCloseTo(1000);
  });

  it("nearField records each pixel's distance to the nearest current element", () => {
    const g = nearField(el, f, { origin: [0, 0, 0], u: [1, 0, 0], v: [0, 1, 0], w: 2, h: 1, nx: 2, ny: 1, ref: [0, 0, 0] });
    expect(g.d[0]).toBeCloseTo(Math.hypot(0.5, 0.5));
    expect(g.d[1]).toBeCloseTo(Math.hypot(1.5, 0.5));
  });

  it("fieldSolver re-solves MoM only when the design changes, not when the plane does", () => {
    const solver = fieldSolver();
    const def = ANTENNA_BY_ID.dipole, d = def.build(def.defaults), lam0 = C0 / d.f;
    const a = solver("dipole", d, planeXY(lam0, 10))!;
    const b = solver("dipole", def.build(def.defaults), planeXY(2 * lam0, 10))!;
    expect(solver.solves).toBe(1);
    expect(b.grid.e).not.toEqual(a.grid.e);
    expect(b.grid.e).toEqual(solveField("dipole", d, planeXY(2 * lam0, 10))!.grid.e);
    solver("dipole", def.build({ ...def.defaults, droop: 30 }), planeXY(lam0, 10));
    expect(solver.solves).toBe(2);
  });
});

describe("PCB stand-in on a board many wavelengths across", () => {
  it("keeps the wire grid bounded (a 0.5 m ground at 40 GHz ran out of memory / overflowed the stack)", () => {
    const def = ANTENNA_BY_ID.pcbmonopole;
    const d = def.build({ ...def.defaults, bands: "40e9-41e9", gl: 0.5, bw: 0.35 });
    const st = pcbStandIn(d)!;
    expect(st.design.wires.length).toBeLessThan(3000);
  });
});
