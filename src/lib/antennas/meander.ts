import type { AntennaDef, Design } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { pcbPlates, PCB_PARAMS, PRINTED_TRIM, r, type PcbRect } from "../pcb";
import { band, BANDS } from "./common";
import { gapPort, groundedBoard, span } from "./pcbcommon";
import { MONO_K, printedEeff } from "./pcbmonopole";

/**
 * A meander needs more trace than a straight monopole (coupling between runs): total = K_M × straight.
 * openEMS (FR-4 1.6 mm, 2.44 GHz, W 8 mm, P 3 mm, w 1 mm): K_M = 1.25 resonated at 2.373 GHz → K_M = 1.215.
 * One calibration point: tighter meanders (P < 3w) need more length; treat as a starting point.
 */
export const MEANDER_K = 1.215;

/** Meander path: up from the feed, then horizontal runs of width W joined by vertical steps of pitch P. */
export function meanderRects(total: number, W: number, P: number, w: number, g: number, x0: number): { rects: PcbRect[]; top: number; runs: number } {
  const rects: PcbRect[] = [];
  let left = total, y = g, x = x0, dir = 1, runs = 0;
  const lead = Math.min(P, left);
  rects.push(r("top", x - w / 2, y, x + w / 2, y + lead + w / 2, "Feed lead"));
  y += lead; left -= lead;
  while (left > 1e-6) {
    const hrun = Math.min(W, left);
    rects.push(r("top", x - (w / 2) * dir, y - w / 2, x + dir * (hrun + w / 2), y + w / 2, "Meander run")); runs++;
    x += dir * hrun; left -= hrun;
    if (left <= 1e-6) break;
    const v = Math.min(P, left);
    rects.push(r("top", x - w / 2, y - w / 2, x + w / 2, y + v + w / 2, "Meander step"));
    y += v; left -= v; dir = -dir;
  }
  return { rects, top: y + w / 2, runs };
}

export const meander: AntennaDef = {
  id: "meander",
  name: "Meander line monopole",
  category: "Printed",
  traits: { pol: "linear", pattern: "omni" },
  summary: "λ/4 monopole folded into a zig-zag to fit a small keep-out area. Smaller but narrower-band.",
  params: [
    BANDS, PCB_PARAMS.er, PCB_PARAMS.h, PCB_PARAMS.tanD, PCB_PARAMS.w,
    { key: "W", label: "Meander width", kind: "length", min: 2e-3, max: 0.1 },
    { key: "P", label: "Meander pitch (run to run)", kind: "length", min: 0.5e-3, max: 0.02, hint: "≥ 3 × trace width keeps coupling moderate" },
    PCB_PARAMS.gl, PCB_PARAMS.bw, PRINTED_TRIM,
  ],
  defaults: { bands: "868e6-870e6", er: 4.4, h: 1.6e-3, tanD: 0.02, w: 1e-3, W: 20e-3, P: 3e-3, gl: 60e-3, bw: 40e-3, trim: 0 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const er = num(p, "er", 4.4), h = num(p, "h", 1.6e-3), w = num(p, "w", 1e-3), W = num(p, "W", 0.02), Pin = num(p, "P", 3e-3);
    const P = Math.max(Pin, w + 0.2e-3); // runs keep a 0.2 mm gap, or they merge into one blob
    const lam = wavelength(f), ee = printedEeff(er, h, w);
    const straight = (MONO_K * lam) / 4 / Math.sqrt(ee);
    const total = MEANDER_K * straight * (1 + num(p, "trim", 0) / 100);
    const g = Math.max(0.5e-3, w);
    const x0 = -W / 2;
    const m = meanderRects(total, W, P, w, g, x0);
    const pcb = groundedBoard(p, m.top + 2e-3, m.rects, gapPort(x0, w, g, h));
    const lead = Math.min(P, total), yr = g + lead, last = m.rects[m.rects.length - 1], xl = (last.x0 + last.x1) / 2;
    return {
      wires: [], plates: pcbPlates(pcb), pcb,
      dims: [
        { label: "Free-space wavelength λ", value: lam },
        { label: "Equivalent straight monopole", value: straight },
        { key: "Lt", label: "Total trace length (along the centre line)", value: total },
        { key: "W", label: "Meander width", value: W, at: m.runs > 1 ? span(x0, yr, x0 + W, yr, h) : undefined },
        { key: "P", label: "Meander pitch", value: P, at: m.runs > 1 ? span(x0 + W, yr, x0 + W, yr + P, h) : undefined },
        { label: "Antenna height above the ground pour", value: m.top, at: span(xl, 0, xl, m.top, h) },
      ],
      tables: [{ title: "Meander", columns: [{ label: "Horizontal runs", kind: "num" }, { label: "Height", kind: "len" }, { label: "Area saved vs straight", kind: "text" }], rows: [[m.runs, m.top, `${Math.round(100 * (1 - m.top / (straight + g)))} %`]] }],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(ee, 2) },
        { label: "Gain", value: "≈ −2 to +1 dBi (small antenna)" },
        { label: "Feed impedance", value: "≈ 15–40 Ω: plan a matching network" },
      ],
      notes: [
        ...(W + w > Number(p.bw ?? 0.04) - 2e-3 ? ["Warning: the meander is wider than the board."] : []),
        ...(P > Pin ? ["Warning: the pitch is smaller than the trace width plus 0.2 mm, so the runs would touch; the pitch was widened."] : []),
        "Tune by trimming the last run. Bandwidth shrinks as the meander gets tighter.",
        "Dimensions are a starting point (openEMS-fitted factor); run the exported openEMS script for your exact board.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
