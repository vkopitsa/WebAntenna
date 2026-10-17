import type { AntennaDef, Design } from "../types";
import { num } from "../types";
import { deg, fmt, interp, wavelength } from "../rf";
import { pcbPlates, PCB_PARAMS, PRINTED_TRIM, r, type Pcb, type PcbPoly } from "../pcb";
import { band, BANDS } from "./common";
import { printedEeff } from "./pcbmonopole";
import { boardSpans, span } from "./pcbcommon";

/** Length factor on λ/2 / √εeff(monopole fit), along the arms: the straight printed dipole's 0.855. */
export const VDIP_K = 0.855;

/**
 * In-browser FDTD (CPU engine, FR-4 1.6 mm, w = 3 mm, 1.15–1.3 GHz) with K = 0.855, by angle between the arms:
 * resonance / target and R at resonance (docs/ANTENNAS.md). f ∝ 1/L, so the length is multiplied by that ratio
 * (a V that resonated low at the common length gets shorter).
 */
const VDIP_FDTD: [number, number][] = [[90, 1212 / 1225], [120, 1195 / 1225], [180, 1237 / 1225]];
const VDIP_R: [number, number][] = [[90, 31], [120, 41], [180, 54]];

/** One arm: a strip of width w from c0 along unit vector (ux, uy) for length a (corners counter-clockwise). */
function strip(c0: [number, number], ux: number, uy: number, a: number, w: number, label: string): PcbPoly {
  const nx = uy * (w / 2), ny = -ux * (w / 2), c1: [number, number] = [c0[0] + ux * a, c0[1] + uy * a];
  return { layer: "top", label, pts: [[c0[0] + nx, c0[1] + ny], [c1[0] + nx, c1[1] + ny], [c1[0] - nx, c1[1] - ny], [c0[0] - nx, c0[1] - ny]] };
}

export const printedvdipole: AntennaDef = {
  id: "printedvdipole",
  name: "Printed V dipole",
  category: "Printed",
  traits: { pol: "linear", pattern: "bi" },
  summary: "Printed dipole with its arms folded into a V: shorter than a straight dipole, fed directly with 50 Ω coax.",
  params: [
    BANDS,
    { key: "vang", label: "Angle between the arms", kind: "angle", min: 60, max: 180, step: 5, hint: "Folding lowers R: 180° (straight) ≈ 54 Ω, 120° ≈ 41 Ω, 90° ≈ 31 Ω" },
    PCB_PARAMS.er, PCB_PARAMS.h, PCB_PARAMS.tanD, PCB_PARAMS.w, PRINTED_TRIM,
  ],
  defaults: { bands: "1.15e9-1.3e9", vang: 120, er: 4.4, h: 1.6e-3, tanD: 0.02, w: 3e-3, trim: 0 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const er = num(p, "er", 4.4), h = num(p, "h", 1.6e-3), w = num(p, "w", 3e-3), tanD = num(p, "tanD", 0.02);
    const vang = Math.min(180, Math.max(60, num(p, "vang", 90)));
    const lam = wavelength(f), ee = printedEeff(er, h, w);
    const L = ((VDIP_K * lam) / 2 / Math.sqrt(ee) * interp(VDIP_FDTD, vang)) * (1 + num(p, "trim", 0) / 100);
    const R = interp(VDIP_R, vang);
    const g = Math.max(1e-3, w / 2);
    // each arm: a square stub of width w at the port (exact mesh lines for the port), then a strip bent by ψ off the y axis
    const psi = deg((180 - vang) / 2), s = w;
    const arm = (L - g) / 2, a = Math.max(arm - s / 2, w);
    const sx = Math.sin(psi), cy = Math.cos(psi);
    const polys = [strip([0, g / 2 + s / 2], sx, cy, a, w, "Arm +"), strip([0, -g / 2 - s / 2], sx, -cy, a, w, "Arm −")];
    const xs = polys.flatMap((q) => q.pts.map((t) => t[0])), ys = polys.flatMap((q) => q.pts.map((t) => t[1]));
    const m = 3e-3;
    const pcb: Pcb = {
      board: { x0: Math.min(-w / 2, ...xs) - m, y0: Math.min(...ys) - m, x1: Math.max(w / 2, ...xs) + m, y1: Math.max(...ys) + m }, h, er, tanD, t: 35e-6,
      rects: [r("top", -w / 2, g / 2, w / 2, g / 2 + s, "Arm +"), r("top", -w / 2, -g / 2 - s, w / 2, -g / 2, "Arm −")],
      polys,
      port: { start: [-w / 2, -g / 2, h], stop: [w / 2, g / 2, h], dir: "y", R: 50 },
    };
    const tipY = g / 2 + s / 2 + a * cy, tipX = a * sx;
    const bs = boardSpans(pcb.board, h);
    return {
      wires: [], plates: pcbPlates(pcb), pcb, feedZ0: 50,
      dims: [
        { label: "Free-space wavelength λ", value: lam },
        { key: "L", label: "Total length (tip to tip, along the arms)", value: L },
        { label: "Each arm (from the gap)", value: arm },
        { label: "Span between the tips", value: 2 * tipY, at: span(tipX, -tipY, tipX, tipY, h) },
        { label: "Depth of the V (apex to tips)", value: tipX, at: span(0, tipY, tipX, tipY, h) },
        { label: "Centre feed gap", value: g, at: span(0, -g / 2, 0, g / 2, h) },
        { label: "Trace width", value: w, at: span(-w / 2, g / 2 + s / 2, w / 2, g / 2 + s / 2, h) },
        { label: "Board width", value: pcb.board.x1 - pcb.board.x0, at: bs.w },
        { label: "Board length", value: pcb.board.y1 - pcb.board.y0, at: bs.l },
      ],
      tables: [],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(ee, 2) },
        { label: "Gain", value: "≈ 1.5–2 dBi" },
        { label: "Feed impedance (FDTD)", value: `≈ ${fmt(R, 0)} Ω` },
        { label: "Pattern", value: "Figure eight, maxima broadside to the board's long axis" },
      ],
      notes: [
        "Feed it with thin 50 Ω coax (RG402, RG316): the centre conductor to one arm, the shield to the other, the cable leaving away from the open side of the V.",
        "A ferrite bead or a few turns of the coax at the feed stop current on the shield; it is a balanced antenna.",
        "Dimensions come from an FDTD-calibrated εeff; run the in-browser FDTD or the exported openEMS script for your exact board.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
