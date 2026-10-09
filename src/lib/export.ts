// File exporters. Pure string builders: the UI turns them into downloads.
import type { AntennaDef, Design, Params, Wire } from "./types";
import { wavelength } from "./rf";
import { dist, plateNormal } from "./geom";

const g6 = (x: number) => {
  const s = Number(x.toPrecision(7));
  return Object.is(s, -0) || Math.abs(s) < 1e-12 ? "0" : String(s);
};

/** Wires that belong in the NEC model, with their 1-based tag numbers. */
export function necWires(design: Design): { wire: Wire; index: number; tag: number }[] {
  const out: { wire: Wire; index: number; tag: number }[] = [];
  design.wires.forEach((w, index) => {
    if (w.drawOnly || dist(w.a, w.b) < 1e-9) return;
    out.push({ wire: w, index, tag: out.length + 1 });
  });
  return out;
}

/**
 * Segment count: ≈ λ/NEC_PER_LAMBDA at the top of the sweep (λ/10 for plate grids), odd when the wire carries a centre feed.
 */
export function segmentsFor(w: Wire, lambdaMin: number, needOdd: boolean): number {
  let n = Math.max(1, Math.ceil(dist(w.a, w.b) / (lambdaMin / (w.necOnly ? 10 : NEC_PER_LAMBDA)) - 1e-9));
  if (needOdd && n % 2 === 0) n += 1;
  return n;
}

/**
 * Segments per wavelength at the top of the sweep. λ/40 was not converged for close-spaced parts
 * (J-pole stub, Moxon gap): NEC moved 38 → 31 Ω between λ/40 and λ/320. λ/80 is within ≈ 2 Ω there.
 */
export const NEC_PER_LAMBDA = 80;

/** Growth ratio of tapered segments next to the feed (NEC guidance: adjacent segments within ≈ 1:1.5). */
export const TAPER = 1.4;

interface NecCard { line: string; extra?: string }

/**
 * Cards for one wire. A wire that starts or ends at the (short) feed wire is tapered: its first segment
 * matches the feed segment and grows by TAPER up to the normal length (GW + GC), the rest is uniform.
 * Without this, a 5 cm feed segment next to 1 m segments biases the HF dipole impedance by −30 %.
 */
function wireCards(w: Wire, tag: () => number, lamMin: number, feedSeg: number | null, needOdd: boolean): { cards: NecCard[]; first: number; ns: number } {
  const L = dist(w.a, w.b);
  const smax = lamMin / (w.necOnly ? 10 : NEC_PER_LAMBDA);
  const gw = (t: number, ns: number, a: number[], b: number[], r: number) => ["GW", t, ns, ...a.map(g6), ...b.map(g6), g6(r)].join(" ");
  if (feedSeg == null || feedSeg >= smax / TAPER) {
    const ns = segmentsFor(w, lamMin, needOdd);
    const t = tag();
    return { cards: [{ line: gw(t, ns, w.a, w.b, w.r) }], first: t, ns };
  }
  // Taper from the feed end: segments s0, s0·q, s0·q², … until they reach smax.
  const s0 = feedSeg;
  const m = Math.max(1, Math.ceil(Math.log(smax / s0) / Math.log(TAPER)));
  const T = (s0 * (Math.pow(TAPER, m) - 1)) / (TAPER - 1);
  const cards: NecCard[] = [];
  const t1 = tag();
  if (T >= L) {
    // Whole wire tapered: fewest segments whose geometric sum covers L.
    let n = 1;
    while ((s0 * (Math.pow(TAPER, n) - 1)) / (TAPER - 1) < L) n++;
    cards.push({ line: gw(t1, n, w.a, w.b, 0), extra: `GC 0 0 ${TAPER} ${g6(w.r)} ${g6(w.r)}` });
    return { cards, first: t1, ns: n };
  }
  const k = T / L;
  const mid = [w.a[0] + (w.b[0] - w.a[0]) * k, w.a[1] + (w.b[1] - w.a[1]) * k, w.a[2] + (w.b[2] - w.a[2]) * k];
  cards.push({ line: gw(t1, m, w.a, mid, 0), extra: `GC 0 0 ${TAPER} ${g6(w.r)} ${g6(w.r)}` });
  const n2 = Math.max(1, Math.ceil((L - T) / smax - 1e-9));
  cards.push({ line: gw(tag(), n2, mid, w.b, w.r) });
  return { cards, first: t1, ns: m + n2 };
}

/** NEC-2 card deck (free space). Opens in 4nec2, xnec2c, EZNEC Pro import, nec2c. */
export function toNEC(def: AntennaDef, params: Params, design: Design): string {
  if (!design.necSupported) throw new Error("NEC export is not available for this antenna type");
  const lines: string[] = [];
  lines.push(`CM ${def.name} — Antenna Generator`);
  for (const [k, val] of Object.entries(params)) lines.push(`CM ${k} = ${typeof val === "number" ? g6(val) : val}`);
  lines.push("CM Units: metres, free space. Feed: EX 0 (voltage source). Segments next to the feed are tapered (GC).");
  lines.push("CE");
  const lamMin = wavelength(Math.max(...design.sweeps.map((s) => s.stop)));
  const wires = necWires(design);
  const feed = design.feed;
  const feedWire = feed ? design.wires[feed.wire] : undefined;
  // A dedicated short feed wire (centre-fed gap): wires touching its ends get tapered.
  const feedIsGap = !!feedWire && feed!.at === "center" && dist(feedWire.a, feedWire.b) < lamMin / NEC_PER_LAMBDA;
  const feedSegLen = feedIsGap ? dist(feedWire!.a, feedWire!.b) / segmentsFor(feedWire!, lamMin, true) : null;
  const touchesFeed = (w: Wire) => feedIsGap && [feedWire!.a, feedWire!.b].some((e) => dist(e, w.a) < 1e-9 || dist(e, w.b) < 1e-9);
  let next = 1;
  const tag = () => next++;
  let feedTag = 1, feedSeg = 1;
  for (const { wire, index } of wires) {
    const isFeed = feed?.wire === index;
    let w = wire;
    const taper = !isFeed && touchesFeed(wire);
    // Orient so the tapered (short-segment) end is at the feed.
    if (taper && ![feedWire!.a, feedWire!.b].some((e) => dist(e, wire.a) < 1e-9)) w = { ...wire, a: wire.b, b: wire.a };
    const { cards, first, ns } = wireCards(w, tag, lamMin, taper ? feedSegLen : null, isFeed && feed?.at === "center");
    if (isFeed) {
      feedTag = first;
      feedSeg = feed!.at === "start" ? 1 : feed!.at === "end" ? ns : (ns + 1) / 2;
    }
    for (const c of cards) { lines.push(c.line); if (c.extra) lines.push(c.extra); }
  }
  lines.push("GE 0");
  lines.push(`EX 0 ${feedTag} ${feedSeg} 0 1 0`);
  // One FR + RP pair per band: NEC runs the solution at each RP card.
  for (const { start, stop, steps } of design.sweeps) {
    const step = steps > 1 ? (stop - start) / (steps - 1) : 0;
    lines.push(`FR 0 ${steps} 0 0 ${g6(start / 1e6)} ${g6(step / 1e6)}`);
    lines.push("RP 0 37 73 1000 0 0 5 5");
  }
  lines.push("EN");
  return lines.join("\n") + "\n";
}

const COLORS: Record<string, [number, number, number]> = {
  driven: [0.85, 0.45, 0.1], parasitic: [0.6, 0.6, 0.65], reflector: [0.45, 0.45, 0.5],
  ground: [0.55, 0.55, 0.6], feed: [0.8, 0.1, 0.1], line: [0.35, 0.35, 0.4],
  metal: [0.85, 0.55, 0.25], dielectric: [0.2, 0.5, 0.25],
};

/** FreeCAD macro (Python). Creates one solid per wire (cylinder) and per plate (extruded polygon), in mm. */
export function toFreeCAD(def: AntennaDef, design: Design): string {
  const mm = (x: number) => g6(x * 1000);
  const vec = (p: number[]) => `(${p.map(mm).join(", ")})`;
  const out: string[] = [
    `# ${def.name} — generated by Antenna Generator`,
    "# Run in FreeCAD: Macro → Macros… → Execute, or paste into the Python console. Units: mm.",
    "import FreeCAD as App",
    "import Part",
    "",
    'doc = App.newDocument("Antenna")',
    "",
    "def _color(o, c):",
    "    if App.GuiUp:",
    "        o.ViewObject.ShapeColor = c",
    "",
    "def rod(name, a, b, r, c):",
    "    a, b = App.Vector(*a), App.Vector(*b)",
    "    d = b - a",
    '    o = doc.addObject("Part::Feature", name)',
    "    o.Shape = Part.makeCylinder(r, d.Length, a, d)",
    "    _color(o, c)",
    "    return o",
    "",
    "def plate(name, pts, normal, t, c):",
    "    vs = [App.Vector(*p) for p in pts]",
    "    face = Part.Face(Part.makePolygon(vs + [vs[0]]))",
    '    o = doc.addObject("Part::Feature", name)',
    "    o.Shape = face.extrude(App.Vector(*normal) * t)",
    "    _color(o, c)",
    "    return o",
    "",
  ];
  const counts: Record<string, number> = {};
  const uniq = (base: string) => {
    const b = base.replace(/[^A-Za-z0-9_]/g, "_");
    counts[b] = (counts[b] ?? 0) + 1;
    return `${b}_${counts[b]}`;
  };
  for (const w of design.wires) {
    if (w.necOnly || dist(w.a, w.b) < 1e-9) continue;
    const name = uniq(w.tag ?? w.group ?? "wire");
    out.push(`rod("${name}", ${vec(w.a)}, ${vec(w.b)}, ${mm(w.r)}, ${JSON.stringify(COLORS[w.group ?? "driven"]).replace("[", "(").replace("]", ")")})`);
  }
  for (const p of design.plates) {
    const n = plateNormal(p);
    const pts = `[${p.pts.map(vec).join(", ")}]`;
    out.push(`plate("${uniq(p.label)}", ${pts}, (${n.map(g6).join(", ")}), ${mm(p.thickness)}, ${JSON.stringify(COLORS[p.material]).replace("[", "(").replace("]", ")")})`);
  }
  out.push("", "doc.recompute()", "if App.GuiUp:", "    import FreeCADGui", '    FreeCADGui.SendMsgToActiveView("ViewFit")', '    FreeCADGui.activeDocument().activeView().viewIsometric()', "");
  return out.join("\n");
}

const csvCell = (s: string | number) => {
  const t = typeof s === "number" ? g6(s) : s;
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** CSV: dimensions (mm), then each table. */
export function toCSV(def: AntennaDef, design: Design): string {
  const rows: (string | number)[][] = [[def.name], [], ["Dimension", "Key", "Value (mm)"]];
  for (const d of design.dims) rows.push([d.label, d.key ?? "", d.value * 1000]);
  for (const t of design.tables) {
    rows.push([], [t.title], t.columns.map((c) => (c.kind === "len" ? `${c.label} (mm)` : c.label)));
    for (const r of t.rows) rows.push(r.map((c, i) => (t.columns[i].kind === "len" && typeof c === "number" ? c * 1000 : c)));
  }
  rows.push([], ["Performance (estimates)"]);
  for (const p of design.perf) rows.push([p.label, "", p.value]);
  return rows.map((r) => r.map(csvCell).join(",")).join("\n") + "\n";
}

export function toJSON(def: AntennaDef, params: Params, design: Design, version: string): string {
  return JSON.stringify({
    generator: "antenna-generator",
    version,
    antenna: def.id,
    name: def.name,
    params,
    units: "SI (metres, hertz)",
    dims: design.dims,
    tables: design.tables,
    perf: design.perf,
    notes: design.notes,
    wires: design.wires.filter((w) => !w.necOnly),
    plates: design.plates,
  }, null, 2);
}
