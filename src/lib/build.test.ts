import { describe, expect, it } from "vitest";
import { ANTENNAS, ANTENNA_BY_ID } from "./antennas";
import { advise, buildPack, en, pieces, tuning } from "./build";
import { crc32, zip } from "./zip";
import { excellon, fabZip, gerberCopper, toDXF } from "./fab";
import { buildPackPDF, pcbDrawings, templateKind, templateSVG, templatePages } from "./template";
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

describe("build pack details", () => {
  it("A55 lists its capacitors and both coiled shorting wires", () => {
    const { def, p, d } = build("skyconecage55");
    const pack = buildPack(def, p, d);
    const caps = pack.bom.filter((r) => r.item.s.startsWith("Capacitor"));
    expect(caps.map((r) => r.item.a![0])).toEqual([2.2, 3.6]);
    expect(caps.map((r) => r.qty.a![0])).toEqual([1, 1]);
    const st = pack.steps.map((m) => en(m));
    expect(st.some((x) => x.includes("2.2 pF capacitor in the centre pin"))).toBe(true);
    expect(st.some((x) => x.includes("3.6 pF capacitor in series"))).toBe(true);
    expect(st.some((x) => x.includes("each of the 2 coiled shorting wires"))).toBe(true);
    expect(st.some((x) => x.includes("One wire only"))).toBe(false);
    expect(d.frames!.short!.map((q) => [q.frame, q.cap])).toEqual([[d.frames!.short![0].frame, undefined], [d.frames!.short![0].frame + d.frames!.n / 2, 3.6]]);
    // a single straight wire keeps the old text and has no capacitors
    const w = build("skyconecagemini");
    const wp = buildPack(w.def, w.p, w.d);
    expect(wp.bom.some((r) => r.item.s.startsWith("Capacitor"))).toBe(false);
    expect(wp.steps.some((m) => en(m).includes("One wire only"))).toBe(true);
  });
  it("bare coax option adds a cable row of that length", () => {
    const { def, p, d } = build("skycone8", { coax: "bare2" });
    const row = buildPack(def, p, d).bom.find((r) => r.item.s === "Coax cable, {0}");
    expect(row).toBeTruthy();
    expect((row!.item.a![0] as { len: number }).len).toBeCloseTo(d.coax!.bare!.len, 9);
  });
  it("toner-transfer option: top mirrored, bottom as seen through the board from the top", () => {
    const P = 8, drawing = (pcb: NonNullable<ReturnType<typeof build>["d"]["pcb"]>, mirror: boolean, layer: "Top" | "Bottom") => pcbDrawings(pcb, mirror, "t").find((z) => z.caption.includes(layer))!;
    // top copper: an asymmetric rectangle (the patch is off the board centre)
    for (const id of ["patch", "printedvdipole"]) {
      const pcb = build(id).d.pcb!, b = pcb.board, q = pcb.rects.find((r) => r.layer === "top")!;
      const direct = P + (q.x0 - b.x0) * 1e3, flipped = P + (b.x1 - q.x1) * 1e3;
      expect(Math.abs(direct - flipped), id).toBeGreaterThan(1);
      const x = (mirror: boolean) => (drawing(pcb, mirror, "Top").prims.find((z) => z.k === "rect" && z.fill) as { x: number }).x;
      expect(x(false), id).toBeCloseTo(direct, 6);
      expect(x(true), id).toBeCloseTo(flipped, 6);
    }
    // bottom copper: the probe clearance round the off-centre feed
    const pcb = build("patch", { feed: "probe" }).d.pcb!, b = pcb.board, fx = pcb.port.start[0];
    const direct = P + (fx - b.x0) * 1e3, flipped = P + (b.x1 - fx) * 1e3;
    expect(Math.abs(direct - flipped)).toBeGreaterThan(1);
    const cx = (mirror: boolean) => (drawing(pcb, mirror, "Bottom").prims.find((z) => z.k === "circle" && z.white) as { cx: number }).cx;
    expect(cx(true)).toBeCloseTo(direct, 6);    // toner transfer: the view through the board from the top
    expect(cx(false)).toBeCloseTo(flipped, 6);  // plain: seen from below
    expect(templatePages(ANTENNA_BY_ID.patch, build("patch").d, true).length).toBeGreaterThan(0);
  });
});

describe("build pack accuracy", () => {
  const stepsOf = (id: string, extra = {}) => { const { def, p, d } = build(id, extra); return buildPack(def, p, d).steps.map((m) => en(m)); };
  it("spring and helix cut lengths follow the helix, not its chords", () => {
    const sp = build("spring");
    const need = sp.d.dims.find((x) => x.label === "Wire in the coil")!.value + sp.d.dims.find((x) => x.label === "Straight lead")!.value;
    const row = buildPack(sp.def, sp.p, sp.d).cuts.find((c) => c.what.s.startsWith("Spring wire"))!;
    expect(row.length).toBeCloseTo(need, 9);
    expect(row.cut).toBeGreaterThanOrEqual(need);                       // "2 % long" is never shorter than the design
    const bom = buildPack(sp.def, sp.p, sp.d).bom.find((r) => r.item.s === "Wire or tube Ø{0}" && Math.abs((r.item.a![0] as { len: number }).len - 0.8e-3) < 1e-9)!;
    expect((bom.qty.a![1] as { len: number }).len).toBeCloseTo(row.cut, 9);
    const hx = build("helix");
    const hrow = buildPack(hx.def, hx.p, hx.d).cuts.find((c) => c.what.s === "Helix wire")!;
    const R = hx.d.dims.find((x) => x.key === "D")!.value / 2;
    expect(hrow.length).toBeCloseTo(R + hx.d.dims.find((x) => x.label === "Total wire length")!.value, 9);
    // straight wires are unchanged
    const dp = build("dipole");
    expect(pieces(dp.d).filter((x) => x.group === "driven").reduce((s, x) => s + x.length, 0)).toBeCloseTo(dp.d.wires.filter((w) => w.group === "driven").reduce((s, w) => s + Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]), 0), 9);
  });
  it("no paper template for the spring", () => {
    const { def, d } = build("spring");
    expect(templateKind(def, d)).toBe("none");
    expect(templatePages(def, d, false)).toEqual([]);
  });
  it("biquad reflector is listed at its real size, whatever its orientation", () => {
    const { def, p, d } = build("biquad");
    const row = buildPack(def, p, d).bom.find((r) => r.item.s === "Metal plate {0} × {1}")!;
    const [a, b] = row.item.a as { len: number }[];
    const pl = d.plates.find((x) => x.material === "metal")!;
    const edge = (i: number, j: number) => Math.hypot(...[0, 1, 2].map((k) => pl.pts[i][k] - pl.pts[j][k]));
    expect(a.len).toBeCloseTo(edge(0, 1), 9);
    expect(b.len).toBeCloseTo(edge(1, 2), 9);
  });
  it("PCB loop gets board, capacitor and trimmer steps, and a PCB template", () => {
    const st = stepsOf("pcbloop");
    expect(st.some((x) => x.startsWith("Cut every part"))).toBe(false);
    expect(st.some((x) => x.startsWith("Make the board"))).toBe(true);
    expect(st.some((x) => x.includes("Cs in the top gap") && x.includes("Cp across the feed"))).toBe(true);
    expect(st.some((x) => x.includes("Cs trimmer"))).toBe(true);
    const { def, d } = build("pcbloop");
    const pdf = new TextDecoder("latin1").decode(templatePages(def, d, false).length ? buildPackPDF(def, def.defaults, d, "t", false) : new Uint8Array());
    expect(pdf).toContain("PCB template");
    expect(pdf).not.toContain("Bend the wire over");
  });
  it("A55: the washer is not soldered straight to the pin when a capacitor sits there", () => {
    const st = stepsOf("skyconecage55");
    expect(st[1]).toContain("through the capacitor");
    expect(st[1]).not.toContain("solder the washer onto the coax centre pin");
    expect(stepsOf("skyconecage")[1]).toContain("solder the washer onto the coax centre pin");
  });
  it("generic steps only mention trimming and a balun when they apply", () => {
    const long = (st: string[]) => st.some((x) => x.includes("cut long"));
    const match = (st: string[]) => st.some((x) => x.includes("balun or match"));
    for (const id of ["biquad", "helix", "collinear", "cloverleaf", "discone"]) expect(long(stepsOf(id)), id).toBe(false);
    expect(long(stepsOf("dipole"))).toBe(true);
    for (const id of ["cloverleaf", "spring", "groundplane"]) expect(match(stepsOf(id)), id).toBe(false);
    for (const id of ["dipole", "helix"]) expect(match(stepsOf(id)), id).toBe(true);
    expect(buildPack(ANTENNA_BY_ID.collinear, ANTENNA_BY_ID.collinear.defaults).tuneNote!.s).not.toContain("top whip.");
    // printed dipoles list a balun, so a step says where it goes
    for (const id of ["printeddipole", "printedvdipole"]) expect(stepsOf(id).some((x) => x.includes("balun or feed network")), id).toBe(true);
    expect(stepsOf("ifa").some((x) => x.includes("balun or feed network"))).toBe(false);
  });
  it("sheet-metal steps mention a skirt only when there is one", () => {
    const skirt = (id: string) => stepsOf(id).some((x) => x.includes("skirt"));
    expect(skirt("skycone7")).toBe(false);
    expect(skirt("skycone8")).toBe(false);
  });
  it("long lengths read in metres in files", () => {
    expect(en({ s: "{0}", a: [{ len: 36.986 }] })).toBe("36.986 m");
    expect(en({ s: "{0}", a: [{ len: 0.1234 }] })).toBe("123.4 mm");
  });
});
