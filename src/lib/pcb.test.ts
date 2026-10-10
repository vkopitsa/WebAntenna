import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { toOpenEMS } from "./openems";
import { excellon, fabZip, gerberCopper, gerberOutline, toDXF } from "./fab";
import { inPoly } from "./pcb";
import { setup } from "./fdtd/setup";
import { loopModel } from "./antennas/pcbloop";
import { meanderRects } from "./antennas/meander";
import { printedEeff } from "./antennas/pcbmonopole";
import { ifaEeff } from "./antennas/ifa";
import { parseOpenEMS, parseTouchstone } from "./importers";
import { simulate, toS1P } from "./simulate";

const PCB = ["pcbmonopole", "meander", "ifa", "printeddipole", "printedvdipole", "dualbanddipole", "sleevedipole", "pagoda", "patch"];

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
      for (const q of p.polys ?? []) for (const [x, y] of q.pts) expect(x >= p.board.x0 && x <= p.board.x1 && y >= p.board.y0 && y <= p.board.y1, `${id} ${q.label}`).toBe(true);
      const levels = p.levels ?? [];
      expect(d.plates.length, id).toBe(1 + levels.length + p.rects.length + (p.polys?.length ?? 0) + levels.reduce((n, l) => n + l.rects.length + (l.polys?.length ?? 0), 0) + (p.pec?.length ?? 0));
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
      expect(py).toContain("(z_lo + z_hi) / 2 * 1e-3]");
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

describe("polygon copper (printed V dipole)", () => {
  const def = ANTENNA_BY_ID.printedvdipole, d = def.build(def.defaults), p = d.pcb!;
  it("Gerber gets one region per rectangle and polygon, DXF one polyline each", () => {
    const top = gerberCopper(p, "top");
    expect(top.match(/G36\*/g)!.length).toBe(p.rects.length + p.polys!.length);
    const dxf = toDXF(p);
    expect(dxf.split("\nTOP\n").length - 1).toBeGreaterThanOrEqual(p.rects.length + p.polys!.length);
  });
  it("openEMS script lists the polygons and adds them as metal", () => {
    const s = toOpenEMS(def, d);
    expect(s).toContain("copper_polys = [");
    expect(s).toContain("AddPolygon(");
    expect(s.match(/# Arm [+−]/g)!.length).toBe(4);
  });
  it("FDTD staircases the polygon: PEC edges follow the diagonal arm", () => {
    const s = setup(p, 1e9, 1.5e9), { x, y, z } = s.mesh, nx = x.length, ny = y.length;
    const k = z.findIndex((v) => Math.abs(v - p.h) < 1e-9);
    const pec = (i: number, j: number) => s.cb[0][(k * ny + j) * nx + i] === 0;
    let inside = 0, wrong = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx - 1; i++) {
      const xm = (x[i] + x[i + 1]) / 2, want = p.polys!.some((q) => inPoly(q.pts, xm, y[j])) || p.rects.some((q) => xm >= q.x0 && xm <= q.x1 && y[j] >= q.y0 - 1e-12 && y[j] <= q.y1 + 1e-12);
      if (want) inside++;
      if (want !== pec(i, j)) wrong++;
    }
    expect(inside).toBeGreaterThan(50);
    expect(wrong).toBe(0);
    // a point on the arm's centre line, far from the stub, is copper; its mirror across the y axis is not
    const [a] = p.polys!, c: [number, number] = [(a.pts[1][0] + a.pts[2][0]) / 2 * 0.8, (a.pts[1][1] + a.pts[2][1]) / 2 * 0.8];
    expect(inPoly(a.pts, c[0], c[1])).toBe(true);
    expect(inPoly(a.pts, -c[0], c[1])).toBe(false);
  });
  it("the staircased arm is one connected conductor from the feed stub to the tip", () => {
    const s = setup(p, 0.7 * d.f, 1.3 * d.f), { x, y, z } = s.mesh, nx = x.length, ny = y.length;
    const k = z.findIndex((v) => Math.abs(v - p.h) < 1e-9), id = (i: number, j: number) => (k * ny + j) * nx + i;
    const near = (arr: Float64Array, v: number) => arr.reduce((b, t, i) => (Math.abs(t - v) < Math.abs(arr[b] - v) ? i : b), 0);
    for (const q of p.polys!) {
      const sgn = q.label === "Arm +" ? 1 : -1, stub = p.rects.find((r) => r.label === q.label)!;
      const start = [near(x, 0), near(y, sgn > 0 ? stub.y1 : stub.y0)];
      const tip = [(q.pts[1][0] + q.pts[2][0]) / 2, (q.pts[1][1] + q.pts[2][1]) / 2];
      const seen = new Set([start[0] + start[1] * nx]), todo = [start];
      while (todo.length) {
        const [i, j] = todo.pop()!;
        const go = (a: number, b: number, ok: boolean) => { if (ok && !seen.has(a + b * nx)) { seen.add(a + b * nx); todo.push([a, b]); } };
        go(i + 1, j, i < nx - 1 && s.cb[0][id(i, j)] === 0); go(i - 1, j, i > 0 && s.cb[0][id(i - 1, j)] === 0);
        go(i, j + 1, j < ny - 1 && s.cb[1][id(i, j)] === 0); go(i, j - 1, j > 0 && s.cb[1][id(i, j - 1)] === 0);
      }
      // the farthest reached node is within a cell of the arm's tip
      const far = Math.min(...[...seen].map((n) => Math.hypot(x[n % nx] - tip[0], y[Math.floor(n / nx)] - tip[1])));
      expect(far, q.label).toBeLessThan(3e-3);
    }
  });
});

describe("stacked boards (pagoda)", () => {
  const def = ANTENNA_BY_ID.pagoda, d = def.build(def.defaults), p = d.pcb!;
  it("fab zip: a Gerber, outline, drill and DXF set per board, round outlines and the coax holes", () => {
    const names = unzipNames(fabZip(def, def.defaults, d, "pagoda", "t"));
    for (const k of [1, 2, 3]) for (const ext of ["GTL", "GBL", "GKO", "DRL", "dxf"]) expect(names, `part${k}.${ext}`).toContain(`pagoda_part${k}.${ext}`);
    const out = gerberOutline(p);
    expect(out.match(/D01\*/g)!.length).toBe(p.outline!.length);
    expect(excellon(p)).toContain("T1C1.020");
    expect(excellon({ ...p, ...{ drills: p.levels![0].drills } })).toContain("T1C3.800");
  });
  it("openEMS script carries the extra boards, their copper and the shield column", () => {
    const s = toOpenEMS(def, d);
    const rows = (key: string) => s.slice(s.indexOf(`${key} = [`), s.indexOf("\n]", s.indexOf(`${key} = [`))).split("\n").filter((l) => l.trim().startsWith("("));
    expect(rows("levels").length).toBe(2);
    expect(rows("level_copper").length).toBe(p.levels!.reduce((n, l) => n + (l.polys?.length ?? 0), 0));
    expect(rows("pec_boxes")[0]).toContain("None");
    expect(s).toContain("AddLinPoly(");
  });
  it("FDTD: substrate in all three boards, copper on every plane, the shield column PEC, the port free", () => {
    const s = setup(p, 4.8e9, 6.8e9), { x, y, z } = s.mesh, nx = x.length, ny = y.length;
    const kOf = (v: number) => z.findIndex((t) => Math.abs(t - v) < 1e-9);
    const i0 = x.findIndex((v) => Math.abs(v) < 1e-12), j0 = y.findIndex((v) => Math.abs(v) < 1e-12);
    // εr inside each board's slab, 1 above the stack: the x-edge cb scales as 1/ε
    const cbAt = (zz: number, i: number) => s.cb[0][(z.findIndex((t) => t > zz) * ny + j0) * nx + i];
    const iArm = x.findIndex((v) => v > 4e-3);
    for (const z0 of [0, ...p.levels!.map((l) => l.z0)]) expect(cbAt(z0 + p.h / 2, iArm - 1) / cbAt(p.h + 3e-3, iArm - 1), `slab at ${z0}`).toBeCloseTo(1 / p.er, 2);
    // the shield column: z edges on the axis below board 1 are PEC
    expect(s.cb[2][((kOf(-5e-3) >= 0 ? kOf(-5e-3) : z.findIndex((t) => t > -5e-3)) * ny + j0) * nx + i0]).toBe(0);
    for (const e of s.port.edges) expect(s.cb[2][e.idx]).toBeGreaterThan(0);
    expect(s.port.edges.length).toBeGreaterThan(0);
    // copper on board 3's underside (the choke disc) is PEC at its plane
    const k3 = kOf(p.levels![1].z0);
    expect(s.cb[0][(k3 * ny + j0) * nx + x.findIndex((v) => v > 3e-3)]).toBe(0);
  });
});

/** File names in a stored (uncompressed) zip: local headers "PK\x03\x04". */
function unzipNames(z: Uint8Array): string[] {
  const out: string[] = [], dv = new DataView(z.buffer, z.byteOffset, z.byteLength);
  for (let o = 0; o + 30 <= z.length && dv.getUint32(o, true) === 0x04034b50;) {
    const size = dv.getUint32(o + 18, true), nl = dv.getUint16(o + 26, true), xl = dv.getUint16(o + 28, true);
    out.push(new TextDecoder().decode(z.subarray(o + 30, o + 30 + nl)));
    o += 30 + nl + xl + size;
  }
  return out;
}
