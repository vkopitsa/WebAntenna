// Build pack: what to buy, what to cut, and how to tune. Derived from the design geometry, no DOM.
// Wires are chained into physical pieces (wires that meet two-by-two at a node are one bent piece),
// and trim sensitivity comes from the antenna's own formulas: rebuild at +1 % frequency and see how
// the resonant parts shrink. Messages are English keys with arguments, translated and formatted in the UI.
import type { AntennaDef, Design, Params, Vec3, Wire } from "./types";
import { num } from "./types";
import { centre, formatBands, parseBands } from "./bands";
import { boardsOf, copperBoxes, isProbe, type Pcb } from "./pcb";
import type { ZPoint } from "./simulate";

export type Arg = string | number | { len: number } | { hz: number } | { pct: number };
export interface Msg { s: string; a?: Arg[] }
const M = (s: string, ...a: Arg[]): Msg => ({ s, a });

// ---------------------------------------------------------------- pieces

export interface Piece {
  tag: string;
  group: string;
  /** Total conductor length along the piece (m). */
  length: number;
  dia: number;
  closed: boolean;
  bends: number;
  /** Free ends (not touching any other conductor): where you trim. */
  ends: number;
  /** Boom, mast, probes (drawOnly). */
  mech: boolean;
  wires: number[];
}

const len = (w: Wire) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]);

export function pieces(d: Design): Piece[] {
  const scale = Math.max(1e-3, ...d.wires.map(len));
  const tol = scale * 1e-6;
  const key = (p: Vec3) => p.map((c) => Math.round(c / tol)).join(",");
  const live = d.wires.map((w, i) => ({ w, i })).filter(({ w }) => !w.necOnly && len(w) > 0);
  // all conductors touching each node (any group): a free end touches nothing else
  const anyAt = new Map<string, number>();
  for (const { w } of live) for (const p of [w.a, w.b]) anyAt.set(key(p), (anyAt.get(key(p)) ?? 0) + 1);
  const kind = (w: Wire) => `${w.group ?? ""}|${w.drawOnly ? 1 : 0}|${w.r.toExponential(4)}`;
  const parent = live.map((_, j) => j);
  const find = (j: number): number => (parent[j] === j ? j : (parent[j] = find(parent[j])));
  const sameAt = new Map<string, number[]>();
  live.forEach(({ w }, j) => { for (const p of [w.a, w.b]) { const k = `${kind(w)}@${key(p)}`; (sameAt.get(k) ?? sameAt.set(k, []).get(k)!).push(j); } });
  // join two parts of one kind at a node when nothing else is attached there, or when they continue in a
  // straight line (a tube with a tap or a side branch is still one tube)
  const straight = (u: Wire, w: Wire) => {
    const du = [u.b[0] - u.a[0], u.b[1] - u.a[1], u.b[2] - u.a[2]], dw = [w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]];
    return Math.abs(du[0] * dw[0] + du[1] * dw[1] + du[2] * dw[2]) > 0.9998 * len(u) * len(w);
  };
  for (const [k, js] of sameAt) if (js.length === 2 && (anyAt.get(k.split("@")[1]) === 2 || straight(live[js[0]].w, live[js[1]].w))) parent[find(js[0])] = find(js[1]);
  const comps = new Map<number, number[]>();
  live.forEach((_, j) => { const r = find(j); (comps.get(r) ?? comps.set(r, []).get(r)!).push(j); });
  const out: Piece[] = [];
  for (const js of [...comps.values()].sort((a, b) => a[0] - b[0])) {
    const ws = js.map((j) => live[j].w);
    const deg = new Map<string, number>();
    for (const w of ws) for (const p of [w.a, w.b]) deg.set(key(p), (deg.get(key(p)) ?? 0) + 1);
    let bends = 0;
    for (const [k, n] of deg) {
      if (n !== 2) continue;
      const [u, v] = ws.filter((w) => key(w.a) === k || key(w.b) === k);
      const dir = (w: Wire, at: string) => { const [p, q] = key(w.a) === at ? [w.a, w.b] : [w.b, w.a]; const L = len(w); return [(q[0] - p[0]) / L, (q[1] - p[1]) / L, (q[2] - p[2]) / L]; };
      const a = dir(u, k), b = dir(v, k);
      if (a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > -0.9998) bends++;
    }
    const closed = [...deg.values()].every((n) => n === 2);
    const ends = [...deg.entries()].filter(([k, n]) => n === 1 && anyAt.get(k) === 1).length;
    out.push({
      tag: ws.find((w) => w.tag)?.tag ?? "",
      group: ws[0].group ?? "",
      length: ws.reduce((s, w) => s + len(w), 0),
      dia: 2 * ws[0].r,
      closed, bends, ends,
      mech: !!ws[0].drawOnly,
      wires: js.map((j) => live[j].i),
    });
  }
  // only the first of a set of identical parts carries the drawing tag: share it
  for (const pc of out) if (!pc.tag) pc.tag = out.find((q) => q.tag && q.group === pc.group && q.mech === pc.mech && Math.abs(q.dia - pc.dia) < 1e-6 && Math.abs(q.length - pc.length) < 0.5e-3)?.tag ?? "";
  return out;
}

// ---------------------------------------------------------------- tuning sensitivity

export interface TuneRow {
  tag: string;
  what: Msg;
  /** Pieces sharing the tag (both halves of a dipole). */
  n: number;
  /** Trim points per tag: free ends, or 1 for a loop / printed trace. */
  points: number;
  /** Suggested step per trim point (m) and the resulting frequency rise (Hz). */
  step: number;
  df: number;
  /** Frequency this part sets (Hz). */
  f: number;
  /** d(piece length)/df (m/Hz, negative). */
  dLdf: number;
  /** "Trim {0} off …" with the step as argument. */
  how: string;
}

/** Types whose match is not set by trimming one resonant length. */
const NOT_TRIMMED: Record<string, string> = {
  helix: "Broadband: the helix is not tuned by length. Match it to 50 Ω with the feed strip or a λ/4 transformer and check the SWR across the band.",
  discone: "Broadband: check the SWR across your bands rather than trimming. Lengthen the cone rods to lower the cut-off frequency.",
  collinear: "The coax sections are fixed by the velocity factor. Check the SWR; small corrections are made on the top whip.",
  biquad: "The biquad is broadband (roughly 10 %): check the SWR across the band. The spacing to the reflector sets the match.",
  pagoda: "Not tuned by trimming: the board spacing sets the centre frequency (Baert's table: D1 grows about 0.15 mm and D2 about 0.24 mm per 100 MHz lower). Check the SWR across the band.",
  pcbloop: "Tune the small loop with the capacitors: Cs sets the resonance, Cp the match. A trimmer capacitor for Cs makes this easy.",
  skyconecage: "Broadband: not tuned by trimming. The pin gap sets the top of the band and the rim height the bottom; check the SWR across the band.",
  skyconecagemini: "Broadband: not tuned by trimming. The pin gap sets the top of the band, the shorting wire and the rim height the bottom; check the SWR across the band.",
  skyconecage40: "Broadband: not tuned by trimming. The pin gap sets the top of the band, the shorting wire and the rim height the bottom; check the SWR across the band.",
  skycone7: "Broadband: not tuned by trimming. The pin gap sets the top of the band and the rim height the bottom; check the SWR across the band.",
  skycone8: "Broadband: not tuned by trimming. The pin gap sets the top of the band and the rim height the bottom; check the SWR across the band.",
  skycone21: "Broadband: not tuned by trimming. The pin gap sets the top of the band and the rim height the bottom; check the SWR across the band.",
};

const NICE = [0.25e-3, 0.5e-3, 1e-3, 2e-3, 3e-3, 5e-3, 10e-3, 20e-3, 30e-3, 50e-3, 100e-3, 200e-3];
const nice = (x: number) => NICE.reduce((a, b) => (Math.abs(Math.log(b / x)) < Math.abs(Math.log(a / x)) ? b : a));

function scaled(def: AntennaDef, p: Params, k: number): Design | null {
  const b = parseBands(String(p.bands ?? ""));
  if (!b.length) return null;
  try { return def.build({ ...p, bands: formatBands(b.map(([a, c]) => [a * k, c * k])) }); } catch { return null; }
}

/** Resonant dimension of a printed layout (m) and how it is trimmed. */
const PRINTED: Record<string, { what: string; how: string; points: number; dim: (pcb: Pcb) => number }> = {
  pcbmonopole: { what: "Antenna trace", how: "Trim {0} off the open end of the trace", points: 1, dim: (p) => sumLong(p, /Antenna trace/) },
  ifa: { what: "Radiating arm", how: "Trim {0} off the open end of the arm", points: 1, dim: (p) => sumLong(p, /Radiating arm/) },
  meander: { what: "Meander trace (total)", how: "Trim {0} off the end of the last run", points: 1, dim: (p) => sumLong(p, /Meander|Feed lead/) },
  printeddipole: { what: "Dipole arms", how: "Trim {0} off the end of each arm", points: 2, dim: (p) => sumLong(p, /^Arm/) },
  printedvdipole: { what: "Dipole arms", how: "Trim {0} off the end of each arm", points: 2, dim: (p) => sumLong(p, /^Arm/) + polyLong(p, /^Arm/) },
  dualbanddipole: { what: "Main strips", how: "Trim {0} off the end of each main strip (band 1; the branches set band 2)", points: 2, dim: (p) => sumLong(p, /^Arm/) },
  sleevedipole: { what: "Radiator", how: "Trim {0} off the radiator tip", points: 1, dim: (p) => sumLong(p, /^Radiator/) },
  patch: { what: "Patch length", how: "Trim {0} off the radiating edge opposite the feed", points: 1, dim: (p) => extentX(p, /Patch/) },
};
function sumLong(p: Pcb, re: RegExp) { return p.rects.filter((q) => re.test(q.label)).reduce((s, q) => s + Math.max(q.x1 - q.x0, q.y1 - q.y0), 0); }
/** Polygon strips: the longest edge of each. */
function polyLong(p: Pcb, re: RegExp) {
  return (p.polys ?? []).filter((q) => re.test(q.label)).reduce((s, q) => s + Math.max(...q.pts.map((a, i) => { const b = q.pts[(i + 1) % q.pts.length]; return Math.hypot(b[0] - a[0], b[1] - a[1]); })), 0);
}
function extentX(p: Pcb, re: RegExp) { const rs = p.rects.filter((q) => re.test(q.label)); return Math.max(...rs.map((q) => q.x1)) - Math.min(...rs.map((q) => q.x0)); }

function whatFor(pc: Piece, def: AntennaDef): string {
  if (/^E\d/.test(pc.tag) && def.multiband === "per-band") return "Band element";
  if (def.id === "yagi" && pc.closed) return "Folded dipole";
  if (pc.closed) return pc.group === "reflector" ? "Reflector loop" : "Driven loop";
  return pc.group === "ground" ? "Radiator" : "Driven element";
}

export function tuning(def: AntennaDef, p: Params, d = def.build(p)): { rows: TuneRow[]; note?: Msg } {
  if (NOT_TRIMMED[def.id]) return { rows: [], note: M(NOT_TRIMMED[def.id]) };
  const d2 = scaled(def, p, 1.01);
  if (!d2) return { rows: [] };
  const rows: TuneRow[] = [];
  const pick = (dLdf: number, points: number, n: number, f: number) => {
    // aim at ≈ 0.3 % per step, rounded to a step you can measure
    const step = nice((0.003 * f * Math.abs(dLdf) * n) / points);
    return { step, df: (step * points) / (n * Math.abs(dLdf)) };
  };
  if (d.pcb && d2.pcb) {
    const P = PRINTED[def.id];
    if (!P) return { rows: [] };
    const L1 = P.dim(d.pcb), L2 = P.dim(d2.pcb);
    const dLdf = (L2 - L1) / (0.01 * d.f);
    if (!(dLdf < 0)) return { rows: [] };
    const { step, df } = pick(dLdf, P.points, 1, d.f);
    rows.push({ tag: "", what: M(P.what), n: 1, points: P.points, step, df, f: d.f, dLdf, how: P.how });
    return { rows };
  }
  const a = pieces(d), b = pieces(d2);
  if (a.length !== b.length) return { rows: [] };
  const resonant = (pc: Piece) => !pc.mech && (pc.group === "driven" || (def.multiband === "per-band" && /^E\d/.test(pc.tag)));
  const tags = [...new Set(a.filter(resonant).map((pc) => pc.tag))];
  // per-band types: longest element ↔ lowest band
  const bands = parseBands(String(p.bands ?? "")).map(centre).sort((x, y) => x - y);
  const byLen = [...tags].sort((x, y) => Math.max(...a.filter((q) => q.tag === y).map((q) => q.length)) - Math.max(...a.filter((q) => q.tag === x).map((q) => q.length)));
  for (const tag of tags) {
    const idx = a.map((pc, i) => (resonant(pc) && pc.tag === tag ? i : -1)).filter((i) => i >= 0);
    const n = idx.length;
    const L1 = a[idx[0]].length, L2 = b[idx[0]].length;
    const f = def.multiband === "per-band" && bands.length === byLen.length ? bands[byLen.indexOf(tag)] : d.f;
    const dLdf = (L2 - L1) / (0.01 * f);
    if (!(dLdf < 0)) continue;
    const pc = a[idx[0]];
    // a folded dipole is shortened by moving both end bends in: each mm in takes 2 mm off the conductor
    const folded = def.id === "yagi" && pc.closed;
    const points = folded ? 4 : pc.closed ? 1 : idx.reduce((s, i) => s + a[i].ends, 0);
    if (points === 0) continue;
    const { step, df } = pick(dLdf, points, n, f);
    const how = folded ? "Move each end of the folded dipole in by {0}" : pc.closed ? "Shorten the loop by {0} (at the joint or overlap)" : points === 1 ? "Trim {0} off the open end" : "Trim {0} off each end";
    rows.push({ tag, what: M(whatFor(pc, def)), n, points, step, df, f, dLdf, how });
  }
  return { rows };
}

// ---------------------------------------------------------------- bill of materials and cut list

export interface BomRow { item: Msg; qty: Msg; note?: Msg }
export interface CutRow { tag: string; what: Msg; qty: number; length: number; cut: number; dia: number; note?: Msg }

const BALANCED = new Set(["dipole", "fandipole", "yagi", "moxon", "quad", "printeddipole", "printedvdipole", "dualbanddipole"]);

function connector(f: number, printed: boolean, probe: boolean): Msg {
  if (probe) return M("SMA panel jack (probe through the board)");
  if (printed) return f >= 1.5e9 ? M("SMA edge-mount or u.FL connector") : M("SMA edge-mount connector");
  if (f < 500e6) return M("SO-239 (UHF) or N chassis socket");
  return f < 3e9 ? M("N or SMA chassis socket") : M("SMA chassis socket");
}

function feedMatch(def: AntennaDef, d: Design): Msg | null {
  const z = d.feedZ0 ?? 50;
  if (BALANCED.has(def.id)) {
    if (def.id === "printeddipole") return M("Balun or differential feed ({0} Ω)", Math.round(z));
    if (z >= 150) return M("4:1 balun ({0} Ω to 50 Ω), e.g. a coax half-wave loop", Math.round(z));
    return M("1:1 current balun (choke) at the feed point");
  }
  if (Math.abs(z - 50) > 20) return M("Impedance transformer {0} Ω to 50 Ω (λ/4 line or tapered strip)", Math.round(z));
  return null;
}

function cutWhat(pc: Piece, def: AntennaDef): string {
  if (pc.mech) return "Boom or support";
  if (def.id === "helix" && pc.group === "driven") return "Helix wire";
  if (def.id === "cloverleaf" && pc.group === "driven") return "Leaf wire";
  if (def.id === "spring" && pc.group === "driven") return "Spring wire (lead + coil, straightened)";
  if (def.id === "discone") return pc.group === "ground" ? "Cone rod" : "Disc rod";
  if (def.id === "collinear" && pc.group === "line") return "Top whip";
  if (def.id === "yagi" && pc.closed) return "Folded dipole";
  if (def.id === "collinear" && /^S\d/.test(pc.tag)) return "Coax section (cut braid to braid)";
  if (/^E\d/.test(pc.tag) && def.multiband === "per-band") return "Band element";
  if (/^D\d/.test(pc.tag) && pc.group === "parasitic") return "Director";
  switch (pc.group) {
    case "driven": return pc.closed ? "Driven loop" : "Driven element";
    case "reflector": return pc.closed ? "Reflector loop" : "Reflector";
    case "parasitic": return "Parasitic element";
    case "ground": return def.id === "discone" ? "Radiator" : "Radial";
    case "line": return "Matching section or stub";
    default: return "Wire";
  }
}

export function cutList(def: AntennaDef, d: Design, trimmedTags: Set<string>): CutRow[] {
  if (d.cuts) return d.cuts.map((c) => ({ tag: "", what: M(c.what), qty: c.qty, length: c.length, cut: c.length, dia: c.dia, note: c.note ? M(c.note) : undefined }));
  const rows: CutRow[] = [];
  for (const pc of pieces(d)) {
    if (pc.group === "feed" || (pc.mech && pc.length < 5e-3)) continue;
    const tunable = !pc.mech && trimmedTags.has(pc.tag) && (pc.group === "driven" || /^E\d/.test(pc.tag));
    const what = M(cutWhat(pc, def));
    const same = rows.find((r) => r.what.s === what.s && Math.abs(r.length - pc.length) < 0.5e-3 && Math.abs(r.dia - pc.dia) < 1e-5 && (r.tag === pc.tag || !tunable));
    if (same) {
      same.qty++;
      if (pc.tag && !same.tag.split(/[,–]/).map((x) => x.trim()).includes(pc.tag)) same.tag = same.tag ? `${same.tag.split(/[,–]/)[0].trim()}–${pc.tag}` : pc.tag;
      continue;
    }
    const note = tunable ? M("2 % long, trim to resonance") : def.id === "helix" ? M("Wind it on a former; see the helix dimensions") : pc.bends > 0 ? M("Bends: {0}, see the template", pc.bends) : undefined;
    rows.push({ tag: pc.tag, what, qty: 1, length: pc.length, cut: tunable ? Math.ceil(pc.length * 1.02 * 1e3) / 1e3 : pc.length, dia: pc.dia, note });
  }
  return rows;
}

function plateSize(pts: Vec3[]): { disc: boolean; a: number; b: number } {
  // plates are planar: measure in their own plane
  const o = pts[0];
  let ax: number[] = [0, 0, 0];
  for (const q of pts) { const v = [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; if (Math.hypot(...v) > Math.hypot(...ax)) ax = v; }
  const la = Math.hypot(...ax) || 1; const u = ax.map((c) => c / la);
  const proj = pts.map((q) => { const v = [q[0] - o[0], q[1] - o[1], q[2] - o[2]]; const s = v[0] * u[0] + v[1] * u[1] + v[2] * u[2]; return { s, t: Math.hypot(v[0] - s * u[0], v[1] - s * u[1], v[2] - s * u[2]) }; });
  const ss = proj.map((x) => x.s), ts = proj.map((x) => x.t);
  const disc = pts.length > 8;
  if (disc) { let m = 0; for (const p of pts) for (const q of pts) m = Math.max(m, Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])); return { disc, a: m, b: m }; }
  return { disc, a: Math.max(...ss) - Math.min(...ss), b: Math.max(...ts) - Math.min(...ts) };
}

export function bom(def: AntennaDef, d: Design, cuts: CutRow[]): BomRow[] {
  const rows: BomRow[] = [];
  const pcb = d.pcb;
  if (def.id === "pcbloop") {
    const a = d.dims.find((x) => x.key === "a")?.value ?? 0, b = d.dims.find((x) => x.key === "b")?.value ?? 0;
    rows.push({ item: M("PCB with the loop trace ({0} × {1} loop)", { len: a }, { len: b }), qty: M("{0} pc", 1) });
    rows.push({ item: connector(d.f, true, false), qty: M("{0} pc", 1) });
    for (const r of d.tables.find((t) => t.title === "Matching components")?.rows ?? []) {
      if (r[0] === "Cs" || r[0] === "Cp") rows.push({ item: M("Capacitor {0}, C0G/NP0", String(r[0])), qty: M("{0}", String(r[1])), note: M(String(r[2])) });
    }
    rows.push({ item: M("Trimmer capacitor in parallel with Cs (optional, for tuning)"), qty: M("{0} pc", 1) });
    return rows;
  }
  if (pcb) {
    for (const { pcb: bd } of boardsOf(pcb)) {
      const bb = bd.board, layers = new Set(copperBoxes(bd).map((q) => q.layer)).size;
      rows.push({ item: M("PCB {0} × {1}, {2} thick, εr {3}", { len: bb.x1 - bb.x0 }, { len: bb.y1 - bb.y0 }, { len: pcb.h }, pcb.er), qty: M("{0} pc", 1), note: layers > 1 ? M("Copper on both sides") : M("Copper on the top side") });
    }
    if (pcb.coaxFeed) rows.push({ item: M("Semi-rigid coax RG402 (Ø3.6 mm) with an SMA plug, about 9 cm"), qty: M("{0} pc", 1), note: M("Runs through the boards: the shield is soldered to them") });
    else rows.push({ item: connector(d.f, true, isProbe(pcb)), qty: M("{0} pc", 1) });
  } else {
    const byDia = new Map<string, { dia: number; n: number; L: number; coax: boolean }>();
    for (const c of cuts) {
      if (c.what.s === "Boom or support") continue;
      const coax = c.what.s.startsWith("Coax");
      const k = `${coax}|${c.dia.toFixed(5)}`;
      const e = byDia.get(k) ?? { dia: c.dia, n: 0, L: 0, coax };
      e.n += c.qty; e.L += c.qty * c.cut; byDia.set(k, e);
    }
    for (const e of byDia.values()) {
      rows.push(e.coax
        ? { item: M("Coax for the sections (velocity factor as set)"), qty: M("{0} pieces, {1} in total", e.n, { len: e.L }) }
        : { item: M("Wire or tube Ø{0}", { len: e.dia }), qty: M("{0} pieces, {1} in total", e.n, { len: e.L }), note: M("Add a little for bends and joints") });
    }
    for (const c of cuts.filter((x) => x.what.s === "Boom or support")) {
      rows.push({ item: M("Boom or support tube Ø{0}", { len: c.dia }), qty: M("{0} pc, {1}", c.qty, { len: c.cut }) });
      const elems = cuts.filter((x) => x.what.s !== "Boom or support" && !x.what.s.startsWith("Matching")).reduce((s, x) => s + x.qty, 0);
      if (elems) rows.push({ item: M("Element mounts (insulators or boom clamps)"), qty: M("{0} pc", elems) });
    }
    if (d.sheets?.length) {
      // formed parts: the flat patterns' bounding rectangles, laid side by side, give the sheet to buy
      const area = d.sheets.reduce((a, x) => a + (x.kind === "sector" ? (x.angle >= 180 ? 4 * x.r1 * x.r1 : 2 * x.r1 * x.r1 * Math.max(Math.sin((x.angle * Math.PI) / 360), 0.5)) : x.kind === "strip" ? x.w * x.h : x.d * x.d), 0);
      const side = Math.sqrt(area * 1.3);
      rows.push({ item: M("Brass or copper sheet 0.3–0.5 mm, about {0} × {1}", { len: side }, { len: side }), qty: M("{0} pc", 1), note: M("Cut the flat patterns from the 1:1 template") });
      for (const x of d.sheets) rows.push({ item: x.kind === "sector" ? M("{0}: annular sector R {1} – {2}, {3}°", x.label, { len: x.r0 }, { len: x.r1 }, +x.angle.toFixed(1)) : x.kind === "strip" ? M("{0}: strip {1} × {2}", x.label, { len: x.w }, { len: x.h }) : M("{0}: disc Ø{1}, hole Ø{2}", x.label, { len: x.d }, { len: x.hole }), qty: M("{0} pc", 1) });
      rows.push({ item: M("Semi-rigid coax UT-141 / RG-402 (Ø3.6 mm) with an SMA plug"), qty: M("{0} pc", 1), note: M("The jacket is soldered into the ground cone apex") });
      if (def.id === "skycone7") rows.push({ item: M("Ferrite beads for the coax (material 43 or 61, inner Ø ≥ 3.7 mm)"), qty: M("{0} pc", 6), note: M("Stacked on the first 11 cm of coax below the ground cone (ferrite sleeve)") });
      else rows.push({ item: M("Clip-on ferrite for the coax (about 150 Ω at the lowest band)"), qty: M("{0} pc", 1) });
    }
    for (const pl of d.plates.filter((x) => x.material === "metal" && x.sheet == null)) {
      const s = plateSize(pl.pts);
      rows.push({ item: s.disc ? M("Metal disc Ø{0}", { len: s.a }) : M("Metal plate {0} × {1}", { len: s.a }, { len: s.b }), qty: M("{0} pc", 1), note: M(pl.label) });
    }
    if (d.frames) {
      const washers = d.tables.find((t) => t.title.startsWith("Hub washers"))?.rows ?? [];
      for (const w of washers) rows.push({ item: M("{0}: disc Ø{1}, hole Ø{2}", String(w[0]), { len: +w[1] }, { len: +w[2] }), qty: M("{0} pc", 1), note: M("Brass or copper, 0.3–0.5 mm: the frames are soldered round its edge") });
      rows.push({ item: M("Semi-rigid coax UT-141 / RG-402 (Ø3.6 mm) with an SMA plug"), qty: M("{0} pc", 1), note: M("The ground collar is soldered onto its jacket") });
      rows.push({ item: M("Ferrite beads for the coax (material 43 or 61, inner Ø ≥ 3.7 mm)"), qty: M("{0} pc", 6), note: M("Stacked on the first 11 cm of coax below the ground cone (ferrite sleeve)") });
    }
    if (!d.sheets?.length && !d.frames) rows.push({ item: connector(d.f, false, false), qty: M("{0} pc", 1) });
  }
  const fm = feedMatch(def, d);
  if (fm) rows.push({ item: fm, qty: M("{0} pc", 1) });
  return rows;
}

// ---------------------------------------------------------------- substrate notes (printed)

export function substrateNotes(def: AntennaDef, p: Params, d: Design): Msg[] {
  const P = PRINTED[def.id];
  if (!d.pcb || !P) return [];
  const er = d.pcb.er;
  const L0 = P.dim(d.pcb);
  const fAt = (er2: number) => { try { const d2 = def.build({ ...p, er: er2 }); return d2.pcb ? (d.f * P.dim(d2.pcb)) / L0 : NaN; } catch { return NaN; } };
  const out: Msg[] = [];
  const f1 = fAt(er + 0.1);
  if (Number.isFinite(f1)) out.push(M("If the real εr is 0.1 higher, this layout resonates {0} lower ({1}).", { hz: d.f - f1 }, { pct: (100 * (d.f - f1)) / d.f }));
  if (er >= 4 && er <= 5) {
    const lo = fAt(4.7), hi = fAt(4.2);
    if (Number.isFinite(lo) && Number.isFinite(hi)) out.push(M("FR-4 εr varies from about 4.2 to 4.7 between suppliers and with frequency: this layout would resonate between {0} and {1}. Ask the fab for εr at your frequency, or tune after the first board.", { hz: lo }, { hz: hi }));
    const ro = fAt(3.38);
    if (Number.isFinite(ro)) out.push(M("The same layout on RO4003C (εr 3.38) would resonate at about {0}: set εr to 3.38 and regenerate instead of reusing it.", { hz: ro }));
  } else if (er < 4) {
    const fr = fAt(4.4);
    if (Number.isFinite(fr)) out.push(M("The same layout on FR-4 (εr 4.4) would resonate at about {0}.", { hz: fr }));
  }
  if (d.pcb.tanD >= 0.01 && d.f > 3e9) out.push(M("FR-4 loss (tan δ ≈ 0.02) costs noticeable efficiency above about 3 GHz; a low-loss laminate such as RO4003C helps."));
  out.push(M("Solder mask over the antenna lowers the resonance slightly. Keep the antenna area unmasked, or tune with the mask applied."));
  return out;
}

// ---------------------------------------------------------------- build steps

export function steps(d: Design, hasBoom: boolean, tunable: boolean): Msg[] {
  const s: Msg[] = [];
  if (d.pcb) {
    s.push(M("Order the board from the Gerber files, or etch it at home with the 1:1 template (for toner transfer, print it mirrored)."));
    if (d.pcb.levels?.length) s.push(M("Stack the boards on the coax at the listed spacings (a printed jig holds them to ±0.1 mm) and solder them in place."));
    else s.push(M("Solder the connector at the feed port and keep the joint short."));
    const grounds = d.pcb.rects.filter((q) => /Ground/.test(q.label));
    if (new Set(grounds.map((q) => q.layer)).size > 1) s.push(M("Stitch the top and bottom ground pours with vias along their edges (usual practice; not part of the model)."));
  } else if (d.sheets?.length) {
    s.push(M("Print the 1:1 flat patterns, glue them onto the sheet and cut the parts out (tin snips, then file the edges)."));
    s.push(M("Roll each sector into its cone and each strip into its ring over a former, overlap or butt the seam and solder it along its length."));
    s.push(M("Solder the hot element together (washer, cones, rim, lid) and the ground cone with its skirt. Solder the coax jacket into the ground cone apex and the centre pin into the washer, keeping the listed gap."));
  } else if (d.frames) {
    s.push(M("Print the 1:1 frame template (or the bending jig) and bend every frame over it with flat-nose pliers: all frames of a side must be identical."));
    s.push(M("Solder the hot frames to the washer in the printed cradle and the ground frames to the collar on the coax jacket in the cup: one groove per frame keeps them at equal angles. Then solder the washer onto the coax centre pin at the listed gap."));
    s.push(M("Bend each hoop on its step of the printed hoop mandrel (or into a ring of the listed diameter) and solder it against the outside of the frames at its bend, at every crossing. Keep the frames in their grooves while you do it."));
    if (d.frames.short) s.push(M("Last, with the hot cage on the centre pin: solder the straight shorting wire from one hot frame down to the ground frame under it, at the marks of the template (its distance from the axis is in the table, ±0.5 mm). One wire only, on one frame; it passes just outside the small ground hoop, so keep the two from touching."));
  } else {
    s.push(M("Cut every part to the cut length in the list. Driven parts are cut long so you can trim them."));
    if (hasBoom) s.push(M("Tape the 1:1 drilling strip to the boom, mark the element positions, then drill and fit the elements."));
    else s.push(M("Bend and assemble the parts using the dimensions and, where it fits on paper, the 1:1 template."));
    s.push(M("Fit the feed line at the feed point, with the balun or match from the bill of materials."));
  }
  s.push(M("Put the antenna in its final position, clear of metal, before you measure."));
  s.push(M("Measure S11 or SWR with a VNA or antenna analyser and note the frequency of the best match."));
  if (tunable) s.push(M("Trim in small steps using the tuning table and measure again after each step. If the resonance is already too high, the part is too short: add length or cut a new one."));
  if (d.pcb) s.push(M("Measure again inside the final enclosure: plastic close to the antenna lowers the resonance."));
  s.push(M("Load the measured .s1p in the Simulation tab to compare it with the model and get a trim suggestion."));
  if (!d.pcb) s.push(M("Seal the feed point against water (self-amalgamating tape) if the antenna goes outdoors."));
  return s;
}

// ---------------------------------------------------------------- the pack

export interface BuildPack {
  bom: BomRow[];
  cuts: CutRow[];
  tune: TuneRow[];
  tuneNote?: Msg;
  substrate: Msg[];
  steps: Msg[];
  hasBoom: boolean;
}

export function buildPack(def: AntennaDef, p: Params, d = def.build(p)): BuildPack {
  const t = tuning(def, p, d);
  const cuts = d.pcb ? [] : cutList(def, d, new Set(t.rows.map((r) => r.tag)));
  const hasBoom = !d.pcb && pieces(d).some((pc) => pc.mech && pc.length > 0.05);
  return { bom: bom(def, d, cuts), cuts, tune: t.rows, tuneNote: t.note, substrate: substrateNotes(def, p, d), steps: steps(d, hasBoom, t.rows.length > 0), hasBoom };
}

// ---------------------------------------------------------------- measured vs model

/** Best match (lowest |Γ|) inside [lo, hi]. */
export function bestMatch(z: ZPoint[], z0: number, lo: number, hi: number): { f: number; swr: number } | null {
  let best: { f: number; swr: number } | null = null;
  for (const q of z) {
    if (q.f < lo || q.f > hi) continue;
    const g = Math.hypot(q.r - z0, q.x) / Math.hypot(q.r + z0, q.x);
    const swr = g < 1 ? (1 + g) / (1 - g) : Infinity;
    if (!best || swr < best.swr) best = { f: q.f, swr };
  }
  return best;
}

export interface Advice {
  rows: { row: TuneRow; fMeas: number; swr: number; /** per trim point, m; > 0 shorten, < 0 lengthen */ change: number }[];
  /** Whole-design rescale that would put the measured resonance on target (percent), single-band types with a trim knob. */
  trim?: number;
}

export function advise(def: AntennaDef, p: Params, tune: TuneRow[], z: ZPoint[], z0: number): Advice {
  const rows: Advice["rows"] = [];
  for (const row of tune) {
    const m = bestMatch(z, z0, row.f * 0.8, row.f * 1.2);
    if (!m || m.swr > 3) continue;
    const change = ((row.f - m.f) * row.n * Math.abs(row.dLdf)) / row.points;
    rows.push({ row, fMeas: m.f, swr: m.swr, change });
  }
  let trim: number | undefined;
  if (rows.length === 1 && def.multiband !== "per-band" && def.params.some((q) => q.key === "trim")) {
    const k = (1 + num(p, "trim", 0) / 100) * (rows[0].fMeas / rows[0].row.f);
    trim = +((k - 1) * 100).toFixed(2);
  }
  return { rows, trim };
}

/** Every English message this module can emit (i18n coverage test). */
export const BUILD_STRINGS = [
  ...Object.values(NOT_TRIMMED), ...Object.values(PRINTED).flatMap((x) => [x.what, x.how]),
  "Band element", "Folded dipole", "Move each end of the folded dipole in by {0}", "Disc rod", "Cone rod", "Top whip",
  "Wind it on a former; see the helix dimensions", "PCB with the loop trace ({0} × {1} loop)", "Reflector loop", "Driven loop", "Radiator", "Driven element", "Director", "Reflector", "Parasitic element", "Radial",
  "Matching section or stub", "Wire", "Boom or support", "Helix wire", "Leaf wire", "Semi-rigid coax RG402 (Ø3.6 mm) with an SMA plug, about 9 cm", "Runs through the boards: the shield is soldered to them", "Stack the boards on the coax at the listed spacings (a printed jig holds them to ±0.1 mm) and solder them in place.", "Spring wire (lead + coil, straightened)", "Coax section (cut braid to braid)",
  "Shorten the loop by {0} (at the joint or overlap)", "Trim {0} off the open end", "Trim {0} off each end",
  "SMA panel jack (probe through the board)", "SMA edge-mount or u.FL connector", "SMA edge-mount connector",
  "SO-239 (UHF) or N chassis socket", "N or SMA chassis socket", "SMA chassis socket",
  "Balun or differential feed ({0} Ω)", "4:1 balun ({0} Ω to 50 Ω), e.g. a coax half-wave loop", "1:1 current balun (choke) at the feed point",
  "Impedance transformer {0} Ω to 50 Ω (λ/4 line or tapered strip)",
  "2 % long, trim to resonance", "Bends: {0}, see the template",
  "PCB {0} × {1}, {2} thick, εr {3}", "{0} pc", "Copper on both sides", "Copper on the top side",
  "Coax for the sections (velocity factor as set)", "{0} pieces, {1} in total", "Wire or tube Ø{0}", "Add a little for bends and joints",
  "Boom or support tube Ø{0}", "{0} pc, {1}", "Element mounts (insulators or boom clamps)", "Metal disc Ø{0}", "Metal plate {0} × {1}",
  "Capacitor {0}, C0G/NP0", "Trimmer capacitor in parallel with Cs (optional, for tuning)",
  "If the real εr is 0.1 higher, this layout resonates {0} lower ({1}).",
  "FR-4 εr varies from about 4.2 to 4.7 between suppliers and with frequency: this layout would resonate between {0} and {1}. Ask the fab for εr at your frequency, or tune after the first board.",
  "The same layout on RO4003C (εr 3.38) would resonate at about {0}: set εr to 3.38 and regenerate instead of reusing it.",
  "The same layout on FR-4 (εr 4.4) would resonate at about {0}.",
  "FR-4 loss (tan δ ≈ 0.02) costs noticeable efficiency above about 3 GHz; a low-loss laminate such as RO4003C helps.",
  "Solder mask over the antenna lowers the resonance slightly. Keep the antenna area unmasked, or tune with the mask applied.",
  "Order the board from the Gerber files, or etch it at home with the 1:1 template (for toner transfer, print it mirrored).",
  "Solder the connector at the feed port and keep the joint short.",
  "Stitch the top and bottom ground pours with vias along their edges (usual practice; not part of the model).",
  "Cut every part to the cut length in the list. Driven parts are cut long so you can trim them.",
  "Tape the 1:1 drilling strip to the boom, mark the element positions, then drill and fit the elements.",
  "Bend and assemble the parts using the dimensions and, where it fits on paper, the 1:1 template.",
  "Fit the feed line at the feed point, with the balun or match from the bill of materials.",
  "Put the antenna in its final position, clear of metal, before you measure.",
  "Measure S11 or SWR with a VNA or antenna analyser and note the frequency of the best match.",
  "Trim in small steps using the tuning table and measure again after each step. If the resonance is already too high, the part is too short: add length or cut a new one.",
  "Measure again inside the final enclosure: plastic close to the antenna lowers the resonance.",
  "Load the measured .s1p in the Simulation tab to compare it with the model and get a trim suggestion.",
  "Seal the feed point against water (self-amalgamating tape) if the antenna goes outdoors.",
  "Brass or copper sheet 0.3–0.5 mm, about {0} × {1}", "Cut the flat patterns from the 1:1 template",
  "{0}: annular sector R {1} – {2}, {3}°", "{0}: strip {1} × {2}", "{0}: disc Ø{1}, hole Ø{2}",
  "Semi-rigid coax UT-141 / RG-402 (Ø3.6 mm) with an SMA plug", "The jacket is soldered into the ground cone apex",
  "Clip-on ferrite for the coax (about 150 Ω at the lowest band)",
  "Ferrite beads for the coax (material 43 or 61, inner Ø ≥ 3.7 mm)",
  "Stacked on the first 11 cm of coax below the ground cone (ferrite sleeve)",
  "Brass or copper, 0.3–0.5 mm: the frames are soldered round its edge", "The ground collar is soldered onto its jacket", "Bends: see the template", "Bend into a ring and solder the ends",
  "Print the 1:1 frame template (or the bending jig) and bend every frame over it with flat-nose pliers: all frames of a side must be identical.",
  "Solder the hot frames to the washer in the printed cradle and the ground frames to the collar on the coax jacket in the cup: one groove per frame keeps them at equal angles. Then solder the washer onto the coax centre pin at the listed gap.",
  "Bend each hoop on its step of the printed hoop mandrel (or into a ring of the listed diameter) and solder it against the outside of the frames at its bend, at every crossing. Keep the frames in their grooves while you do it.",
  "Last, with the hot cage on the centre pin: solder the straight shorting wire from one hot frame down to the ground frame under it, at the marks of the template (its distance from the axis is in the table, ±0.5 mm). One wire only, on one frame; it passes just outside the small ground hoop, so keep the two from touching.",
  "Straight: solder it on at the marks of the template",
  "Print the 1:1 flat patterns, glue them onto the sheet and cut the parts out (tin snips, then file the edges).",
  "Roll each sector into its cone and each strip into its ring over a former, overlap or butt the seam and solder it along its length.",
  "Solder the hot element together (washer, cones, rim, lid) and the ground cone with its skirt. Solder the coax jacket into the ground cone apex and the centre pin into the washer, keeping the listed gap.",
];


/** English rendering of a message for files (README, PDF): lengths in mm. */
export function en(m: Msg): string {
  const f = (a: Arg): string => {
    if (typeof a === "number") return String(+a.toPrecision(4));
    if (typeof a === "string") return a;
    if ("len" in a) { const mm = a.len * 1e3; return `${mm.toFixed(Math.abs(mm) < 10 ? 2 : 1)} mm`; }
    if ("hz" in a) { const x = Math.abs(a.hz); return x >= 1e9 ? `${(a.hz / 1e9).toFixed(3)} GHz` : x >= 1e6 ? `${(a.hz / 1e6).toFixed(3)} MHz` : `${(a.hz / 1e3).toFixed(1)} kHz`; }
    return `${a.pct.toFixed(2)} %`;
  };
  return (m.a ?? []).reduce<string>((s, a, i) => s.split(`{${i}}`).join(f(a)), m.s);
}
