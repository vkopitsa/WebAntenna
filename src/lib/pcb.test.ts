import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { toOpenEMS } from "./openems";
import { loopModel } from "./antennas/pcbloop";
import { meanderRects } from "./antennas/meander";
import { printedEeff } from "./antennas/pcbmonopole";
import { ifaEeff } from "./antennas/ifa";
import { parseOpenEMS, parseTouchstone } from "./importers";
import { simulate, toS1P } from "./simulate";

const PCB = ["pcbmonopole", "meander", "ifa", "printeddipole", "patch"];

describe("printed antennas", () => {
  it("every printed type has a board, copper inside the board and a port", () => {
    for (const id of PCB) {
      const def = ANTENNA_BY_ID[id];
      const d = def.build(def.defaults);
      const p = d.pcb!;
      expect(p, id).toBeTruthy();
      for (const q of p.rects) {
        expect(q.x0 >= p.board.x0 - 1e-9 && q.x1 <= p.board.x1 + 1e-9 && q.y0 >= p.board.y0 - 1e-9 && q.y1 <= p.board.y1 + 1e-9, `${id} ${q.label}`).toBe(true);
      }
      expect(d.plates.length).toBe(p.rects.length + 1);
    }
  });
  it("εeff fit reproduces the openEMS calibration points", () => {
    // q = (εeff − 1)/(εr − 1) measured: FR-4 1.6 mm 0.121, FR-4 0.8 mm 0.082, εr 10.2 1.27 mm 0.16 (w = 1 mm)
    const q = (er: number, h: number) => (printedEeff(er, h, 1e-3) - 1) / (er - 1);
    expect(q(4.4, 1.6e-3)).toBeCloseTo(0.121, 2);
    expect(q(4.4, 0.8e-3)).toBeCloseTo(0.082, 2);
    expect(q(10.2, 1.27e-3)).toBeCloseTo(0.16, 2);
  });
  it("IFA fit reproduces its calibration runs (f·(La + 0.225 H) = c/4√εIFA)", () => {
    // FR-4 1.6 mm: 43.35 GHz·mm; RO4003C 0.8 mm: 51.47 GHz·mm
    const K = (er: number, h: number) => 299792458 / (4 * Math.sqrt(ifaEeff(er, h)));
    expect(K(4.4, 1.6e-3) / 1e6).toBeCloseTo(43.35, 0);
    expect(K(3.38, 0.8e-3) / 1e6).toBeCloseTo(51.47, 0);
  });
  it("meander path has the requested total length", () => {
    const m = meanderRects(0.1, 0.02, 0.003, 1e-3, 1e-3, 0);
    // centre-line length = sum of run/step lengths (rect long side minus the w/2 overlaps)
    const lens = m.rects.map((q) => Math.max(q.x1 - q.x0, q.y1 - q.y0) - 0.5e-3 - (q.label === "Feed lead" ? 0 : 0.5e-3));
    expect(lens.reduce((a, b) => a + b, 0)).toBeCloseTo(0.1, 6);
    expect(m.runs).toBeGreaterThan(3);
  });
  it("small loop: textbook magnitudes at 433 MHz (30 × 20 mm)", () => {
    const m = loopModel(433.92e6, 0.03, 0.02, 2e-3, 35e-6, 5.8e7, 300);
    expect(m.L * 1e9).toBeGreaterThan(60); expect(m.L * 1e9).toBeLessThan(110);
    expect(m.Rr).toBeGreaterThan(0.03); expect(m.Rr).toBeLessThan(0.07); // 31171 (A/λ²)² ≈ 49 mΩ
    expect(m.eff).toBeGreaterThan(0.02); expect(m.eff).toBeLessThan(0.1);
    expect(m.Cs * 1e12).toBeGreaterThan(0.5); expect(m.Cs * 1e12).toBeLessThan(5);
    const r = simulate(ANTENNA_BY_ID.pcbloop, ANTENNA_BY_ID.pcbloop.defaults, ANTENNA_BY_ID.pcbloop.build(ANTENNA_BY_ID.pcbloop.defaults));
    const best = r.z.reduce((a, b) => (Math.hypot(a.r - 50, a.x) < Math.hypot(b.r - 50, b.x) ? a : b));
    expect(Math.abs(best.f - 433.92e6) / 433.92e6).toBeLessThan(0.002);
    expect(Math.hypot(best.r - 50, best.x)).toBeLessThan(5);
  });
});

describe("openEMS export", () => {
  it("writes a script with every copper rectangle, the port and the far-field centre in metres", () => {
    for (const id of PCB) {
      const def = ANTENNA_BY_ID[id];
      const d = def.build(def.defaults);
      const py = toOpenEMS(def, d, "t");
      const rows = py.slice(py.indexOf("copper = ["), py.indexOf("]", py.indexOf("copper = [") + 12)).split("\n").filter((l) => l.trim().startsWith("("));
      expect(rows.length, id).toBe(d.pcb!.rects.length);
      expect(py).toContain("AddLumpedPort(1, port_R");
      expect(py).toContain("* 1e-3, h / 2 * 1e-3]");
      expect(py).toContain("read_cached=False");
    }
  });
  it("is refused for wire antennas", () => {
    const def = ANTENNA_BY_ID.dipole;
    expect(() => toOpenEMS(def, def.build(def.defaults))).toThrow();
  });
});

describe("importers", () => {
  it("Touchstone round trip through toS1P", () => {
    const z = [{ f: 1e9, r: 30, x: 12 }, { f: 1.1e9, r: 75, x: -20 }];
    const back = parseTouchstone(toS1P("x", z, 50), "x").z;
    back.forEach((p, i) => { expect(p.r).toBeCloseTo(z[i].r, 4); expect(p.x).toBeCloseTo(z[i].x, 4); });
  });
  it("Touchstone MA / DB in MHz", () => {
    const t = parseTouchstone("# MHz S DB R 50\n100 -999 0\n", "m");
    expect(t.z[0].f).toBe(100e6);
    expect(t.z[0].r).toBeCloseTo(50, 3);
  });
  it("openEMS results JSON", () => {
    const theta = Array.from({ length: 181 }, (_, i) => -180 + 2 * i);
    const o = { f: [1, 2], zin_re: [50, 60], zin_im: [0, 5], theta, cut_xz: theta.map(() => 1), cut_yz: theta.map(() => 2), cut_xy: Array(181).fill(3), dmax_dbi: 3.1 };
    const r = parseOpenEMS(o, "run", 2);
    expect(r.z[1]).toEqual({ f: 2, r: 60, x: 5 });
    expect(r.pattern!.cuts.map((c) => c.dbi[10])).toEqual([3, 1, 2]);
    expect(r.pattern!.max.dbi).toBe(3.1);
  });
});
