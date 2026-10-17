// PCB fabrication outputs for printed antennas: Gerber RS-274X (X2 attributes), Excellon drill, DXF R12.
// Origin at the board's lower-left corner, millimetres. Copper is the exact rectangle set the FDTD and
// openEMS models use, so what you order is what was simulated.
import { boardsOf, copperBoxes, isProbe, type Pcb, type PcbRect } from "./pcb";
import type { AntennaDef, Design, Params } from "./types";
import { buildPack, en } from "./build";
import { zip } from "./zip";

/** SMA panel jack: Ø1.27 mm pin, Ø4.1 mm PTFE. Hole for the pin, clearance in the ground for the dielectric. */
export const PROBE_DRILL = 1.3e-3, PROBE_CLEAR = 4.2e-3;

const g = (m: number) => Math.round(m * 1e9).toString(); // 4.6 format, mm → integer (1e-6 mm)

function header(fn: string, gen: string): string[] {
  return [`%TF.GenerationSoftware,AntennaGenerator,,${gen}*%`, `%TF.FileFunction,${fn}*%`, "%TF.FilePolarity,Positive*%", "%FSLAX46Y46*%", "%MOMM*%", "%LPD*%", "G01*"];
}

/**
 * The board rectangle a fab gets: the design's board, grown to enclose all copper when some sticks out
 * (the IFA "arm too long" case), so the outline never clips copper. A custom polygon outline is left alone.
 */
export function fabBox(p: Pcb): { x0: number; y0: number; x1: number; y1: number; grown: boolean } {
  const b = p.board, e = 1e-7;
  if (p.outline) return { ...b, grown: false };
  let { x0, y0, x1, y1 } = b;
  for (const q of copperBoxes(p)) { x0 = Math.min(x0, q.x0); y0 = Math.min(y0, q.y0); x1 = Math.max(x1, q.x1); y1 = Math.max(y1, q.y1); }
  const grown = x0 < b.x0 - e || y0 < b.y0 - e || x1 > b.x1 + e || y1 > b.y1 + e;
  return grown ? { x0, y0, x1, y1, grown } : { ...b, grown: false };
}

const corners = (q: PcbRect): [number, number][] => [[q.x0, q.y0], [q.x1, q.y0], [q.x1, q.y1], [q.x0, q.y1]];

/** Filled G36/G37 region, closed back to its first vertex. */
function region(pts: [number, number][], ox: number, oy: number): string[] {
  const at = ([x, y]: [number, number], op: string) => `X${g(x - ox)}Y${g(y - oy)}${op}*`;
  return ["G36*", at(pts[0], "D02"), ...pts.slice(1).map((p) => at(p, "D01")), at(pts[0], "D01"), "G37*"];
}

export function gerberCopper(p: Pcb, layer: "top" | "bottom", gen = "1"): string {
  const { x0: ox, y0: oy } = fabBox(p);
  const L = header(layer === "top" ? "Copper,L1,Top" : "Copper,L2,Bot", gen);
  if (isProbe(p)) L.push(`%ADD10C,${(PROBE_CLEAR * 1e3).toFixed(6)}*%`);
  for (const q of p.rects.filter((r) => r.layer === layer)) L.push(...region(corners(q), ox, oy));
  for (const q of (p.polys ?? []).filter((r) => r.layer === layer)) L.push(...region(q.pts, ox, oy));
  if (isProbe(p) && layer === "bottom") {
    // the probe passes the ground through a clearance hole
    L.push("%LPC*%", "D10*", `X${g(p.port.start[0] - ox)}Y${g(p.port.start[1] - oy)}D03*`, "%LPD*%");
  }
  L.push("M02*");
  return L.join("\n") + "\n";
}

export function gerberOutline(p: Pcb, gen = "1"): string {
  const fb = fabBox(p), w = fb.x1 - fb.x0, h = fb.y1 - fb.y0;
  const L = [...header("Profile,NP", gen), "%ADD10C,0.100000*%", "D10*"];
  if (p.outline) {
    const at = ([x, y]: [number, number], op: string) => `X${g(x - fb.x0)}Y${g(y - fb.y0)}${op}*`;
    L.push(at(p.outline[0], "D02"), ...p.outline.slice(1).map((q) => at(q, "D01")), at(p.outline[0], "D01"));
  } else L.push(`X0Y0D02*`, `X${g(w)}Y0D01*`, `X${g(w)}Y${g(h)}D01*`, `X0Y${g(h)}D01*`, `X0Y0D01*`);
  return [...L, "M02*"].join("\n") + "\n";
}

/** Plated holes: the board's own list, or the probe-feed hole. */
const holes = (p: Pcb) => p.drills ?? (isProbe(p) ? [{ x: p.port.start[0], y: p.port.start[1], d: PROBE_DRILL }] : []);

export function excellon(p: Pcb): string | null {
  const hs = holes(p), fb = fabBox(p);
  if (!hs.length) return null;
  const sizes = [...new Set(hs.map((q) => +(q.d * 1e3).toFixed(3)))];
  const L = ["M48", isProbe(p) ? "; Antenna Generator: probe-feed hole" : "; Antenna Generator: plated holes", "; #@! TF.FileFunction,Plated,1,2,PTH", "FMAT,2", "METRIC,TZ", ...sizes.map((d, i) => `T${i + 1}C${d.toFixed(3)}`), "%", "G05"];
  sizes.forEach((d, i) => {
    L.push(`T${i + 1}`);
    for (const q of hs.filter((h) => +(h.d * 1e3).toFixed(3) === d)) L.push(`X${((q.x - fb.x0) * 1e3).toFixed(3)}Y${((q.y - fb.y0) * 1e3).toFixed(3)}`);
  });
  return [...L, "T0", "M30", ""].join("\n");
}

/** DXF R12 (AutoCAD 12 ASCII), mm. Layers OUTLINE, TOP, BOTTOM, PORT, DRILL. */
export function toDXF(p: Pcb): string {
  const fb = fabBox(p), ox = fb.x0, oy = fb.y0, mm = (v: number) => (v * 1e3).toFixed(4);
  const out: string[] = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "0", "ENDSEC",
    "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "5"];
  for (const [name, col] of [["OUTLINE", 7], ["TOP", 1], ["BOTTOM", 5], ["PORT", 3], ["DRILL", 6]] as const) out.push("0", "LAYER", "2", name, "70", "0", "62", String(col), "6", "CONTINUOUS");
  out.push("0", "ENDTAB", "0", "ENDSEC", "0", "SECTION", "2", "ENTITIES");
  const poly = (layer: string, pts: [number, number][]) => {
    out.push("0", "POLYLINE", "8", layer, "66", "1", "10", "0.0", "20", "0.0", "30", "0.0", "70", "1");
    for (const [x, y] of pts) out.push("0", "VERTEX", "8", layer, "10", mm(x - ox), "20", mm(y - oy), "30", "0.0");
    out.push("0", "SEQEND", "8", layer);
  };
  const box = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  poly("OUTLINE", p.outline ?? box(fb.x0, fb.y0, fb.x1, fb.y1));
  for (const q of p.drills ?? []) out.push("0", "CIRCLE", "8", "DRILL", "10", mm(q.x - ox), "20", mm(q.y - oy), "30", "0.0", "40", (q.d * 500).toFixed(4));
  for (const q of p.rects) poly(q.layer === "top" ? "TOP" : "BOTTOM", box(q.x0, q.y0, q.x1, q.y1));
  for (const q of p.polys ?? []) poly(q.layer === "top" ? "TOP" : "BOTTOM", q.pts);
  const s = p.port.start, t = p.port.stop;
  if (isProbe(p)) {
    out.push("0", "CIRCLE", "8", "DRILL", "10", mm(s[0] - ox), "20", mm(s[1] - oy), "30", "0.0", "40", (PROBE_DRILL * 500).toFixed(4));
    out.push("0", "CIRCLE", "8", "BOTTOM", "10", mm(s[0] - ox), "20", mm(s[1] - oy), "30", "0.0", "40", (PROBE_CLEAR * 500).toFixed(4));
  } else {
    const x0 = Math.min(s[0], t[0]), x1 = Math.max(s[0], t[0]), y0 = Math.min(s[1], t[1]), y1 = Math.max(s[1], t[1]);
    poly("PORT", x1 > x0 && y1 > y0 ? box(x0, y0, x1, y1) : [[x0, y0], [x1 === x0 ? x0 + 1e-5 : x1, y1 === y0 ? y0 + 1e-5 : y1]]);
  }
  out.push("0", "ENDSEC", "0", "EOF");
  return out.join("\n") + "\n";
}

/** Gerber set + drill + DXF + README in one zip, with the Protel extensions every fab recognises (GTL/GBL/GKO/DRL). */
export function fabZip(def: AntennaDef, p: Params, d: Design, base: string, gen: string): Uint8Array {
  const boards = boardsOf(d.pcb!);
  const files: { name: string; data: string }[] = [];
  boards.forEach(({ pcb }, i) => {
    // a stacked build gets one file set per board: base_part1, base_part2, …
    const b = boards.length > 1 ? `${base}_part${i + 1}` : base;
    files.push({ name: `${b}.GTL`, data: gerberCopper(pcb, "top", gen) });
    if (copperBoxes(pcb).some((q) => q.layer === "bottom")) files.push({ name: `${b}.GBL`, data: gerberCopper(pcb, "bottom", gen) });
    files.push({ name: `${b}.GKO`, data: gerberOutline(pcb, gen) });
    const drl = excellon(pcb);
    if (drl) files.push({ name: `${b}.DRL`, data: drl });
    files.push({ name: `${b}.dxf`, data: toDXF(pcb) });
  });
  files.push({ name: "README.txt", data: readme(def, p, d, files.map((f) => f.name)) });
  return zip(files);
}

function readme(def: AntennaDef, p: Params, d: Design, names: string[]): string {
  const pcb = d.pcb!, pack = buildPack(def, p, d);
  const mm = (v: number) => `${(v * 1e3).toFixed(2)} mm`;
  const port = pcb.port, fb = fabBox(pcb), ox = fb.x0, oy = fb.y0;
  const L = [
    `${def.name}: fabrication files from Antenna Generator`,
    "",
    `Design frequency: ${(d.f / 1e6).toFixed(3)} MHz`,
    `Board: ${mm(fb.x1 - fb.x0)} x ${mm(fb.y1 - fb.y0)}, ${mm(pcb.h)} thick, er ${pcb.er}, tan d ${pcb.tanD}, copper ${(pcb.t * 1e6).toFixed(0)} um`,
    ...(pcb.levels?.length ? [
      `Stack: ${pcb.levels.length + 1} boards of the same laminate (files _part1 = the top board, then downwards):`,
      ...boardsOf(pcb).map(({ label, pcb: b }, i) => `  part${i + 1}: ${label}, ${mm(b.board.x1 - b.board.x0)} across, bottom face at z = ${mm(i === 0 ? 0 : pcb.levels![i - 1].z0)}`),
    ] : []),
    ...(fb.grown ? [`Note: some copper extends past the designed board edge, so the outline (.GKO/.dxf) was enlarged to enclose all copper. Check the design warnings: the antenna does not fit the board it was drawn for.`] : []),
    `Layers: ${copperBoxes(pcb).some((q) => q.layer === "bottom") ? "2 (top + bottom)" : "1 (top only; bottom copper not used)"}`,
    "Units: millimetres. Origin: lower-left corner of the board.",
    "",
    "Files (Gerber RS-274X with X2 attributes; Protel extensions):",
    "  .GTL top copper, .GBL bottom copper, .GKO board outline, .DRL plated drill (Excellon), .dxf all layers for CAD import",
    ...names.map((n) => `  ${n}`),
    `  README.txt`,
    "",
    "Feed:",
    pcb.coaxFeed
      ? `  Coax through the stack: core to the centre pad on top of part1, shield to the pads of the other boards (port ${port.R} ohm).`
      : isProbe(pcb)
      ? `  Probe feed at X ${mm(port.start[0] - ox)} Y ${mm(port.start[1] - oy)}: ${(PROBE_DRILL * 1e3).toFixed(2)} mm plated hole, ${(PROBE_CLEAR * 1e3).toFixed(1)} mm clearance in the bottom ground (SMA panel jack from below).`
      : Math.abs(port.stop[0] - port.start[0]) < 1e-9 || Math.abs(port.stop[1] - port.start[1]) < 1e-9
      ? "  Edge-mount SMA: centre pin to the feed line, body to the bottom ground."
      : `  Port between X ${mm(Math.min(port.start[0], port.stop[0]) - ox)}..${mm(Math.max(port.start[0], port.stop[0]) - ox)}, Y ${mm(Math.min(port.start[1], port.stop[1]) - oy)}..${mm(Math.max(port.start[1], port.stop[1]) - oy)} (${port.R} ohm). Solder the connector across this gap.`,
    "",
    "Order notes:",
    "  - No solder mask or silkscreen files: leave the antenna area unmasked (mask lowers the resonance slightly).",
    "  - Ask the fab for the laminate's er at your frequency; FR-4 varies.",
    "",
    "Substrate:",
    ...pack.substrate.map((m) => `  - ${en(m)}`),
    "",
    "Tuning:",
    ...(pack.tune.length ? pack.tune.map((r) => `  - ${en(r.what)}: ${en({ s: r.how, a: [{ len: r.step }] })} -> resonance up by about ${en({ s: "{0}", a: [{ hz: r.df }] })}`) : ["  - " + (pack.tuneNote ? en(pack.tuneNote) : "Not tuned by trimming.")]),
    "",
    "Steps:",
    ...pack.steps.map((m, i) => `  ${i + 1}. ${en(m)}`),
    "",
  ];
  return L.join("\n").replace(/[^ -~\n]/g, (c) => ({ "ε": "e", "λ": "lambda", "Ω": "ohm", "×": "x", "δ": "d", "≈": "~", "Ø": "dia ", "–": "-", "−": "-", "°": " deg", "µ": "u" } as Record<string, string>)[c] ?? "?");
}
