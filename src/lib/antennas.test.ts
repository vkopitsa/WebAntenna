import { describe, expect, it } from "vitest";
import { ANTENNAS, ANTENNA_BY_ID } from "./antennas";
import { moxonLambda } from "./antennas/moxon";
import { patchDesign } from "./antennas/patch";
import { simulate } from "./simulate";
import { helixEstimates } from "./antennas/helix";
import { leafK } from "./antennas/cloverleaf";
import { springTurns } from "./antennas/spring";
import { buildMesh, solve } from "./mom";
import { yagiGainDbi } from "./antennas/yagi";
import { endEffect, microstripWidth, microstripZ0, wavelength } from "./rf";
import { dist } from "./geom";
import { bandSweep, formatBands, parseBands } from "./bands";
import type { Params } from "./types";

const dim = (id: string, label: string, p = {}) => {
  const def = ANTENNA_BY_ID[id];
  const d = def.build({ ...def.defaults, ...p }).dims.find((x) => x.label === label);
  if (!d) throw new Error(`no dim ${label}`);
  return d.value;
};

describe("registry", () => {
  it("dimension spans drawn on hover are as long as the value, also after a trim", () => {
    for (const a of ANTENNAS) {
      for (const p of [a.defaults, { ...a.defaults, trim: 5 }]) {
        for (const x of a.build(p).dims) {
          if (!x.at) continue;
          expect(Math.abs(dist(x.at[0], x.at[1]) - x.value), `${a.id}: ${x.label}`).toBeLessThanOrEqual(Math.max(1e-4, 0.01 * x.value));
        }
      }
    }
  });
  it("every antenna builds with its defaults and gives finite, positive geometry", () => {
    for (const a of ANTENNAS) {
      const d = a.build(a.defaults);
      expect(d.dims.length, a.id).toBeGreaterThan(0);
      for (const x of d.dims) expect(Number.isFinite(x.value) && x.value >= 0, `${a.id}: ${x.label}`).toBe(true);
      for (const w of d.wires) {
        for (const c of [...w.a, ...w.b, w.r]) expect(Number.isFinite(c), a.id).toBe(true);
      }
      if (d.feed) expect(d.feed.wire).toBeLessThan(d.wires.length);
      for (const k of Object.keys(a.defaults)) expect(a.params.some((p) => p.key === k), `${a.id}.${k}`).toBe(true);
    }
  });
  it("ids are unique", () => {
    expect(new Set(ANTENNAS.map((a) => a.id)).size).toBe(ANTENNAS.length);
  });
});

describe("end-effect factor", () => {
  it("follows the ARRL curve", () => {
    const lam = 1;
    expect(endEffect(lam, lam / 200)).toBeCloseTo(0.951, 2); // λ/2d = 100
    expect(endEffect(lam, lam / 2000)).toBeCloseTo(0.967, 2); // 1000
    expect(endEffect(lam, lam / 20000)).toBeCloseTo(0.976, 2); // 10000
  });
});

describe("dipole", () => {
  it("146 MHz, 2 mm wire is ≈ 0.48 λ", () => {
    const lam = wavelength(146e6);
    const L = dim("dipole", "Total length (tip to tip, along the wire)", { bands: "145e6-147e6", d: 2e-3 });
    expect(L / lam).toBeGreaterThan(0.475);
    expect(L / lam).toBeLessThan(0.49);
  });
  it("arms plus gap make the total", () => {
    const tot = dim("dipole", "Total length (tip to tip, along the wire)");
    expect(2 * dim("dipole", "Each arm") + dim("dipole", "Centre gap at the feed")).toBeCloseTo(tot, 9);
  });
});

describe("Moxon (Cebik)", () => {
  it("2 m band, 2 mm wire: the familiar ≈ 750 × 277 mm rectangle with a ≈ 30 mm gap", () => {
    const lam = wavelength(144.5e6);
    const q = moxonLambda(2e-3 / lam);
    const mm = (x: number) => x * lam * 1000;
    expect(mm(q.A)).toBeGreaterThan(740); expect(mm(q.A)).toBeLessThan(760);
    expect(mm(q.C)).toBeGreaterThan(27); expect(mm(q.C)).toBeLessThan(33);
    expect(mm(q.E)).toBeGreaterThan(270); expect(mm(q.E)).toBeLessThan(285);
    expect(q.E).toBeCloseTo(q.B + q.C + q.D, 12);
  });
});

describe("Yagi (DL6WU style)", () => {
  // Reference: AntMaker/DL6WU output, 145.5 MHz, 9 el, Ø12 mm through a Ø30 mm metal boom.
  const ref = { R: 1019.91, DE: 974.58, D1: 913.01, D2: 901.11, D3: 886.24, D4: 874.33, D5: 868.38, D6: 862.43, D7: 856.44 };
  const sp = [381.18, 162.77, 370.88, 445.05, 519.23, 578.98, 622.25, 653.16];
  it("reproduces the reference design within 0.5 % (boom 3733.49 mm)", () => {
    const d = ANTENNA_BY_ID.yagi.build({ bands: "145.5e6-145.5e6", n: 9, d: 12e-3, driven: "folded", boom: "through", bd: 30e-3 });
    const rows = d.tables.find((t) => t.title === "Elements")!.rows;
    for (const r of rows) {
      const want = ref[r[0] as keyof typeof ref];
      expect(Math.abs((r[3] as number) * 1000 - want) / want, String(r[0])).toBeLessThan(0.005);
    }
    rows.slice(1).forEach((r, i) => expect(Math.abs((r[2] as number) * 1000 - sp[i]) / sp[i]).toBeLessThan(0.005));
    expect((rows[rows.length - 1][1] as number) * 1000).toBeCloseTo(3733.49, -1);
  });
  it("gain fit follows the NBS curve", () => {
    expect(yagiGainDbi(0.4) - 2.15).toBeCloseTo(7.1, 0);
    expect(yagiGainDbi(4.2) - 2.15).toBeCloseTo(14.2, 0);
  });
  it("directors get shorter away from the driven element", () => {
    const rows = ANTENNA_BY_ID.yagi.build({ ...ANTENNA_BY_ID.yagi.defaults, n: 25 }).tables.find((t) => t.title === "Elements")!.rows;
    for (let i = 3; i < rows.length; i++) expect(rows[i][3] as number).toBeLessThan(rows[i - 1][3] as number);
  });
});

describe("patch (Balanis)", () => {
  it("Balanis example 14.1: 10 GHz, εr 2.2, h 1.588 mm → W 11.86 mm, L 9.06 mm", () => {
    const q = patchDesign(10e9, 2.2, 1.588e-3, 50);
    expect(q.W * 1000).toBeCloseTo(11.86, 1);
    expect(q.eeff).toBeCloseTo(1.972, 2);
    expect(q.L * 1000).toBeCloseTo(9.06, 1);
  });
  it("2.45 GHz FR-4 1.6 mm: W ≈ 37.3 mm, L ≈ 28.8 mm, inset inside the patch", () => {
    const q = patchDesign(2.45e9, 4.4, 1.6e-3, 50);
    expect(q.W * 1000).toBeCloseTo(37.26, 0);
    expect(q.L * 1000).toBeCloseTo(28.8, 0);
    expect(q.Rin).toBeGreaterThan(150);
    expect(q.Rin).toBeLessThan(400);
    expect(q.y0).toBeGreaterThan(0);
    expect(q.y0).toBeLessThan(q.L / 2);
  });
  it("air dielectric (εr 1) keeps a finite bandwidth, so the impedance sweep stays finite", () => {
    const q = patchDesign(2.45e9, 1, 3e-3, 50);
    expect(q.bw).toBeGreaterThan(0);
    expect(q.bw).toBeCloseTo(patchDesign(2.45e9, 2, 3e-3, 50).bw * (q.W / q.L) / (patchDesign(2.45e9, 2, 3e-3, 50).W / patchDesign(2.45e9, 2, 3e-3, 50).L), 6);
    const p = { ...ANTENNA_BY_ID.patch.defaults, er: 1 };
    const r = simulate(ANTENNA_BY_ID.patch, p, ANTENNA_BY_ID.patch.build(p));
    expect(r.z.every((z) => Number.isFinite(z.r) && Number.isFinite(z.x))).toBe(true);
  });
  it("microstrip synthesis round-trips through the analysis formula", () => {
    for (const [z, er, h] of [[50, 4.4, 1.6e-3], [50, 3.38, 0.508e-3], [100, 2.2, 0.8e-3], [25, 10.2, 0.635e-3]] as const) {
      expect(microstripZ0(microstripWidth(z, er, h), er, h)).toBeCloseTo(z, -0.3);
    }
    expect(microstripWidth(50, 4.4, 1.6e-3) * 1000).toBeCloseTo(3.06, 1);
  });
});

describe("helix (Kraus)", () => {
  it("C = λ, 13°, 8 turns", () => {
    const e = helixEstimates(1, Math.tan((13 * Math.PI) / 180), 8);
    expect(e.impedance).toBe(140);
    expect(e.hpbwDeg).toBeCloseTo(52 / Math.sqrt(8 * Math.tan((13 * Math.PI) / 180)), 9);
    expect(e.axialRatio).toBeCloseTo(17 / 16, 9);
  });
  it("the wire really is a helix of the right circumference", () => {
    const d = ANTENNA_BY_ID.helix.build(ANTENNA_BY_ID.helix.defaults);
    const diam = d.dims.find((x) => x.key === "D")!.value;
    expect(Math.PI * diam / wavelength(1575.42e6)).toBeCloseTo(1, 6);
  });
});

describe("connectivity", () => {
  it("every NEC wire touches another wire at one end at least (no floating driven parts)", () => {
    for (const id of ["dipole", "fandipole", "groundplane", "jpole", "moxon", "quad", "biquad", "helix", "cloverleaf", "discone"]) {
      const d = ANTENNA_BY_ID[id].build(ANTENNA_BY_ID[id].defaults);
      const ws = d.wires.filter((w) => !w.drawOnly);
      const ends = ws.flatMap((w) => [w.a, w.b]);
      for (const w of ws) {
        const touch = (p: typeof w.a) => ends.filter((q) => dist(p, q) < 1e-9).length > 1;
        if (w.group === "reflector" || w.group === "parasitic") continue;
        expect(touch(w.a) || touch(w.b), `${id}`).toBe(true);
      }
    }
  });
});

describe("bands", () => {
  it("sweeps of very wide bands never start at or below 0 Hz; narrow ones keep the ±2 % margin", () => {
    expect(bandSweep([1e5, 1e11]).start).toBeGreaterThan(0);
    expect(bandSweep([70e6, 6.4e9]).start).toBeGreaterThan(0);
    expect(bandSweep([144e6, 146e6]).start).toBeCloseTo(144e6 - 0.02 * 145e6, 0);
  });
  it("parse, normalise and format", () => {
    expect(parseBands("146e6-144e6;430e6-440e6;bad;5e9")).toEqual([[144e6, 146e6], [430e6, 440e6], [5e9, 5e9]]);
    expect(parseBands(formatBands([[144e6, 146e6], [433.05e6, 434.79e6]]))).toEqual([[144e6, 146e6], [433.05e6, 434.79e6]]);
  });
  it("single-band types design for the centre of band 1 and sweep every band", () => {
    const def = ANTENNA_BY_ID.moxon;
    const one = def.build({ ...def.defaults, bands: "144e6-146e6" });
    const two = def.build({ ...def.defaults, bands: "144e6-146e6;430e6-440e6" });
    expect(one.f).toBe(145e6);
    expect(two.dims).toEqual(one.dims);
    expect(two.sweeps).toHaveLength(2);
    expect(two.sweeps[1].start).toBeLessThan(430e6);
    expect(two.sweeps[1].stop).toBeGreaterThan(440e6);
    expect(two.notes[0]).toMatch(/^Single-band antenna/);
    expect(two.tables[0].title).toBe("Bands");
    expect(two.tables[0].rows).toHaveLength(2);
  });
  it("fan dipole: one element per band, tuned by MoM to resonate at every band centre", () => {
    const d = ANTENNA_BY_ID.fandipole.build({ bands: "14e6-14.35e6;7e6-7.2e6", d: 2e-3, fan: 20 });
    const el = d.tables.find((t) => t.title === "Elements")!.rows;
    expect(el).toHaveLength(2);
    expect(el[0][2] as number).toBeGreaterThan(el[1][2] as number);
    expect(d.wires.filter((w) => w.tag)).toHaveLength(4);
    // converged-model fit: 20 m element ≈ 2.7 % longer than a free dipole next to the 40 m element
    const alone = ANTENNA_BY_ID.fandipole.build({ bands: "14e6-14.35e6", d: 2e-3, fan: 20 }).tables.find((t) => t.title === "Elements")!.rows[0][2] as number;
    expect((el[1][2] as number) / alone).toBeGreaterThan(1.02);
    expect((el[1][2] as number) / alone).toBeLessThan(1.035);
    // near 3× the shorter element must be shortened instead
    const odd = ANTENNA_BY_ID.fandipole.build({ bands: "7e6-7.2e6;21e6-21.45e6", d: 2e-3, fan: 20 }).tables.find((t) => t.title === "Elements")!.rows;
    expect(odd[1][4]).toMatch(/^-/);
  });
  it("discone is sized 25 % below the lowest band and covers all bands", () => {
    const d = ANTENNA_BY_ID.discone.build({ ...ANTENNA_BY_ID.discone.defaults, bands: "430e6-440e6;144e6-146e6" });
    expect(d.f).toBeCloseTo(144e6 / 1.25, 0);
    expect(d.sweeps).toHaveLength(3); // the whole range, then each band (a narrow band can fall between the wide points)
    expect(d.sweeps[0].start).toBeLessThan(144e6);
    expect(d.sweeps[0].stop).toBeGreaterThan(440e6);
  });
  it("helix warns when a band leaves the axial mode", () => {
    const h = ANTENNA_BY_ID.helix;
    expect(h.build(h.defaults).notes.some((n) => n.startsWith("Warning"))).toBe(false);
    expect(h.build({ ...h.defaults, bands: "1575e6-1576e6;2400e6-2480e6" }).notes.some((n) => n.startsWith("Warning"))).toBe(true);
  });
});

describe("cloverleaf", () => {
  it("leaves of wire length K·λ, legs L/4, every leaf from the pin (top) to the shield (bottom)", () => {
    const def = ANTENNA_BY_ID.cloverleaf;
    for (const leaves of ["3", "4"]) {
      const d = def.build({ ...def.defaults, leaves });
      const L = d.dims.find((x) => x.key === "L")!.value, lam = wavelength(5.8e9);
      expect(L / lam).toBeGreaterThan(1.05); expect(L / lam).toBeLessThan(1.2);
      // the cut length is the wire actually modelled: every driven wire, per leaf
      const total = d.wires.filter((w) => w.group === "driven").reduce((s, w) => s + dist(w.a, w.b), 0);
      expect(total / +leaves).toBeCloseTo(L, 9);
      const feed = d.wires[0];
      const atPin = d.wires.filter((w) => w.group === "driven" && dist(w.a, feed.b) < 1e-12).length;
      const atShield = d.wires.filter((w) => w.group === "driven" && dist(w.b, feed.a) < 1e-12).length;
      expect([atPin, atShield]).toEqual([+leaves, +leaves]);
    }
  });
  it("leafK interpolates the fitted table and clamps outside it", () => {
    expect(leafK(3, 45, 0.02)).toBeCloseTo(1.138, 6);
    expect(leafK(4, 30, 0.005)).toBeCloseTo(1.006, 6);
    expect(leafK(3, 42.5, 0.02)).toBeCloseTo((1.116 + 1.138) / 2, 6);
    expect(leafK(3, 10, 1)).toBeCloseTo(1.052, 6);
  });
  it("LHCP is the mirror image of RHCP", () => {
    const def = ANTENNA_BY_ID.cloverleaf;
    const r = def.build(def.defaults), l = def.build({ ...def.defaults, hand: "lhcp" });
    r.wires.forEach((w, i) => {
      for (const k of ["a", "b"] as const) { expect(l.wires[i][k][0]).toBe(w[k][0]); expect(l.wires[i][k][1]).toBeCloseTo(-w[k][1], 12); expect(l.wires[i][k][2]).toBe(w[k][2]); }
    });
  });
});

describe("printed V dipole", () => {
  it("length along the arms follows the FDTD resonances, and the V folds the tips together", () => {
    const def = ANTENNA_BY_ID.printedvdipole;
    const straight = def.build({ ...def.defaults, vang: 180 }), v90 = def.build({ ...def.defaults, vang: 90 });
    const L = (d: typeof v90) => d.dims.find((x) => x.key === "L")!.value;
    // FDTD with equal lengths: 180° resonated at 1.237 GHz, 90° at 1.212 GHz
    expect(L(v90) / L(straight)).toBeCloseTo(1237 / 1212, 9);
    expect(L(straight)).toBeCloseTo(ANTENNA_BY_ID.printeddipole.build({ ...ANTENNA_BY_ID.printeddipole.defaults, bands: "1.15e9-1.3e9", w: 3e-3 }).dims.find((x) => x.key === "L")!.value * 1225 / 1237, 9);
    const span = (d: typeof v90) => d.dims.find((x) => x.label === "Span between the tips")!.value;
    expect(span(v90)).toBeLessThan(span(straight) * 0.8);
    // the arms really are at the requested angle
    const [a, b] = v90.pcb!.polys!;
    const dir = (q: typeof a) => { const [p0, p1] = q.pts; return Math.atan2(p1[1] - p0[1], p1[0] - p0[0]); };
    expect(Math.abs(dir(a) - dir(b)) * 180 / Math.PI).toBeCloseTo(90, 6);
  });
});

describe("spring (normal-mode helix)", () => {
  it("resonates at the design frequency in the MoM (the fitted table) from 315 to 868 MHz and on a 2 m coil", () => {
    const def = ANTENNA_BY_ID.spring;
    for (const p of [{}, { bands: "315e6-316e6" }, { bands: "868e6-868.6e6" }, { bands: "144e6-146e6", D: 20e-3, pitch: 6e-3, d: 2e-3 }] as Params[]) {
      const d = def.build({ ...def.defaults, ...p });
      const x = (k: number) => { const f = d.f * k, m = buildMesh(d, wavelength(f), 60, 450)!; return solve(m, f)!.z[1]; };
      expect(x(0.98), JSON.stringify(p)).toBeLessThan(0);
      expect(x(1.02), JSON.stringify(p)).toBeGreaterThan(0);
    }
  }, 120_000);
  it("more turns for a smaller coil (in λ), a few-ohm radiation resistance", () => {
    const H = (bands: string) => dim("spring", "Coil length (axial)", { bands });
    expect(H("315e6-316e6")).toBeGreaterThan(H("433.05e6-434.79e6"));
    expect(springTurns(0.00722, 0.267, 0.67).R).toBeGreaterThan(1);
    expect(springTurns(0.00722, 0.267, 0.67).R).toBeLessThan(3);
  });
});

describe("pagoda", () => {
  const def = ANTENNA_BY_ID.pagoda;
  it("reproduces Baert's published Pagoda-3 spacings (assembly drawing table)", () => {
    for (const [f, d1, d2] of [[5.3e9, 4.39e-3, 11.63e-3], [5.8e9, 3.65e-3, 10.45e-3], [6.0e9, 3.36e-3, 9.98e-3]]) {
      const d = def.build({ ...def.defaults, bands: `${f - 1e6}-${f + 1e6}` });
      expect(d.dims.find((x) => x.key === "D1")!.value).toBeCloseTo(d1, 5);
      expect(d.dims.find((x) => x.key === "D2")!.value).toBeCloseTo(d2, 5);
    }
  });
  it("three boards on a shield column; LHCP mirrors RHCP; outside 5.3–6 GHz the whole design scales", () => {
    const r = def.build(def.defaults), l = def.build({ ...def.defaults, hand: "lhcp" }), p = r.pcb!;
    expect(p.levels!.length).toBe(2);
    expect(p.pec![0].z1).toBe(0);
    expect(p.port.start[2]).toBe(0); expect(p.port.stop[2]).toBe(p.h);
    // x → −x maps the RHCP legs onto the LHCP legs (as a set: legs 210° and 330° swap; pads and rings are round)
    const all = (d: typeof r) => [...d.pcb!.polys!, ...d.pcb!.levels!.flatMap((v) => v.polys!)].filter((q) => q.label === "Arm");
    const r3 = (v: number) => Math.round(v * 1e9) / 1e3 + 0;
    const key = (pts: [number, number][], sx: number) => pts.map(([x, y]) => `${r3(sx * x)},${r3(y)}`).sort().join(" ");
    const mirrored = new Set(all(r).map((q) => key(q.pts, -1)));
    expect(all(l).length).toBe(all(r).length);
    for (const q of all(l)) expect(mirrored.has(key(q.pts, 1))).toBe(true);
    const s = def.build({ ...def.defaults, bands: "2.899e9-2.901e9" });
    expect(s.pcb!.h / p.h).toBeCloseTo(5.3 / 2.9, 9); // scaled from the nearest published end
    expect(s.notes.some((n) => n.startsWith("Outside 5.3–6.0 GHz"))).toBe(true);
  });
});
