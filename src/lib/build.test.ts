import { describe, expect, it } from "vitest";
import { ANTENNAS, ANTENNA_BY_ID } from "./antennas";
import { advise, buildPack, en, pieces, tuning } from "./build";
import { crc32, zip } from "./zip";
import { excellon, fabZip, gerberCopper, toDXF } from "./fab";
import { buildPackPDF, templateKind, templateSVG } from "./template";
import type { ZPoint } from "./simulate";

const build = (id: string, extra = {}) => { const def = ANTENNA_BY_ID[id]; const p = { ...def.defaults, ...extra }; return { def, p, d: def.build(p) }; };

describe("pieces", () => {
  it("dipole: two halves, one free end each; feed gap is its own piece", () => {
    const { d } = build("dipole");
    const ps = pieces(d).filter((x) => x.group === "driven");
    expect(ps).toHaveLength(2);
    expect(ps.every((x) => x.ends === 1 && !x.closed && x.tag === "A")).toBe(true);
  });
  it("quad: driven and reflector are closed loops with four bends", () => {
    const ps = pieces(build("quad").d);
    expect(ps.filter((x) => x.closed).map((x) => x.bends)).toEqual([4, 4]);
  });
  it("yagi: the boom is a mechanical piece, identical radials share the tag", () => {
    expect(pieces(build("yagi").d).filter((x) => x.mech)).toHaveLength(1);
    expect(pieces(build("groundplane").d).filter((x) => x.group === "ground").every((x) => x.tag === "B")).toBe(true);
  });
});

describe("tuning", () => {
  it("dipole: trimming each end by s raises f by ≈ f·2s/L", () => {
    const { def, p, d } = build("dipole");
    const [r] = tuning(def, p, d).rows;
    const L = pieces(d).filter((x) => x.group === "driven").reduce((s, x) => s + x.length, 0);
    expect(r.points).toBe(2);
    expect(r.df / ((d.f * 2 * r.step) / L)).toBeGreaterThan(0.9);
    expect(r.df / ((d.f * 2 * r.step) / L)).toBeLessThan(1.1);
  });
  it("fan dipole: one row per band element, each at its own band", () => {
    const { def, p } = build("fandipole");
    const rows = tuning(def, p).rows;
    expect(rows.map((r) => r.tag)).toEqual(["E1", "E2", "E3"]);
    expect(rows[0].f).toBeLessThan(rows[1].f);
  });
  it("broadband types explain instead of trimming", () => {
    for (const id of ["helix", "discone", "biquad"]) { const t = tuning(ANTENNA_BY_ID[id], ANTENNA_BY_ID[id].defaults); expect(t.rows).toEqual([]); expect(t.note?.s).toBeTruthy(); }
  });
  it("printed antennas have a trim step", () => {
    for (const id of ["ifa", "pcbmonopole", "meander", "printeddipole", "printedvdipole", "patch"]) expect(tuning(ANTENNA_BY_ID[id], ANTENNA_BY_ID[id].defaults).rows).toHaveLength(1);
  });
});

describe("measured vs model", () => {
  it("a resonance 2 % low asks to shorten, and a −2 % rescale", () => {
    const { def, p, d } = build("dipole");
    const rows = tuning(def, p, d).rows;
    const fr = d.f * 0.98;
    const z: ZPoint[] = Array.from({ length: 201 }, (_, i) => { const f = d.f * (0.85 + 0.003 * i); return { f, r: 50, x: 400 * (f / fr - fr / f) }; });
    const a = advise(def, p, rows, z, 50);
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0].fMeas / fr).toBeCloseTo(1, 2);
    // ≈ 2 % of a 483 mm half, taken off the free end
    expect(a.rows[0].change).toBeGreaterThan(0.007);
    expect(a.rows[0].change).toBeLessThan(0.012);
    expect(a.trim).toBeCloseTo(-2, 0);
  });
});

describe("build pack for every antenna", () => {
  it("renders without NaN, with a BOM and steps", () => {
    for (const def of ANTENNAS) {
      const pack = buildPack(def, def.defaults);
      expect(pack.bom.length, def.id).toBeGreaterThan(0);
      expect(pack.steps.length, def.id).toBeGreaterThan(3);
      const all = [...pack.bom.flatMap((r) => [r.item, r.qty, r.note]), ...pack.cuts.map((c) => c.what), ...pack.substrate, ...pack.steps].filter((m) => m).map((m) => en(m!));
      expect(all.filter((s) => /NaN|undefined|Infinity/.test(s)), def.id).toEqual([]);
    }
  });
  it("PDF is well formed (xref offsets point at objects) for every antenna", () => {
    for (const def of ANTENNAS) {
      const d = def.build(def.defaults);
      const b = buildPackPDF(def, def.defaults, d, "test", false);
      const s = new TextDecoder("latin1").decode(b);
      expect(s.startsWith("%PDF-1.4")).toBe(true);
      const xref = Number(s.match(/startxref\n(\d+)/)![1]);
      expect(s.slice(xref, xref + 4)).toBe("xref");
      const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
      offs.forEach((o, i) => expect(s.slice(o, o + 12).startsWith(`${i + 1} 0 obj`), def.id).toBe(true));
      const count = Number(s.match(/\/Type \/Pages \/Kids \[[^\]]*\] \/Count (\d+)/)![1]);
      expect(count, def.id).toBeGreaterThan(0);
    }
  });
  it("template kinds", () => {
    const k = (id: string) => templateKind(ANTENNA_BY_ID[id], ANTENNA_BY_ID[id].build(ANTENNA_BY_ID[id].defaults));
    expect([k("ifa"), k("patch"), k("yagi"), k("biquad"), k("helix"), k("dipole")]).toEqual(["pcb", "pcb", "strip", "wire", "wire", "none"]);
    const { def, d } = build("ifa");
    const svg = templateSVG(def, d, true)!;
    expect(svg).toMatch(/width="[\d.]+mm"/);
    expect(svg.match(/<rect /g)!.length).toBeGreaterThan(5);
  });
});

describe("fabrication files", () => {
  it("zip: stored entries with correct CRC and central directory", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const z = zip([{ name: "a.txt", data: "hello" }, { name: "b.txt", data: "world!" }]);
    const v = new DataView(z.buffer);
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    const eocd = z.length - 22;
    expect(v.getUint32(eocd, true)).toBe(0x06054b50);
    expect(v.getUint16(eocd + 10, true)).toBe(2);
  });
  it("Gerber: one region per copper rectangle, probe clearance and drill", () => {
    const { def, p, d } = build("patch", { feed: "probe" });
    const top = gerberCopper(d.pcb!, "top"), bot = gerberCopper(d.pcb!, "bottom");
    expect(top.match(/G36\*/g)!.length).toBe(d.pcb!.rects.filter((q) => q.layer === "top").length);
    expect(top).toContain("%FSLAX46Y46*%");
    expect(bot).toContain("%LPC*%");
    expect(excellon(d.pcb!)).toContain("T1C1.300");
    expect(toDXF(d.pcb!)).toContain("DRILL");
    expect(fabZip(def, p, d, "x", "t").length).toBeGreaterThan(1000);
    expect(excellon(build("ifa").d.pcb!)).toBeNull();
  });
});
