import type { AntennaDef, Design } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { pcbPlates, PCB_PARAMS, PRINTED_TRIM, r, type Pcb } from "../pcb";
import { band, BANDS } from "./common";
import { printedEeff } from "./pcbmonopole";
import { boardSpans, span } from "./pcbcommon";

/**
 * Length factors on λ/4 / √εeff(monopole fit), each arm measured from the gap: the main strip (low band) and the
 * two side branches of the fork (high band). From the in-browser FDTD (CPU engine, FR-4 0.8 mm, w = 2 mm,
 * 2.4–2.5 / 5.15–5.85 GHz, docs/ANTENNAS.md): SWR ≈ 1.4 at 2.45 GHz, 1.15 at 5.54 GHz.
 */
export const DB_K1 = 0.87;
export const DB_K2 = 0.783;

/** Default high band when only one band is given: the 5 GHz Wi-Fi band over 2.4 GHz. */
const HIGH_RATIO = 5.5 / 2.45;

export const dualbanddipole: AntennaDef = {
  id: "dualbanddipole",
  name: "Dual-band printed dipole",
  category: "Printed",
  traits: { pol: "linear", pattern: "bi" },
  multiband: "per-band",
  summary: "Printed dipole with a fork on each arm: the long strips resonate in band 1, the short side branches in band 2 (2.4 / 5 GHz Wi-Fi).",
  params: [
    BANDS,
    { key: "s", label: "Branch offset from the main strip", kind: "length", min: 1e-3, max: 10e-3, hint: "Centre to centre; 3–4 mm on a 14 mm wide board" },
    PCB_PARAMS.er, PCB_PARAMS.h, PCB_PARAMS.tanD, PCB_PARAMS.w, PRINTED_TRIM,
  ],
  defaults: { bands: "2.4e9-2.5e9;5.15e9-5.85e9", s: 3.5e-3, er: 4.4, h: 0.8e-3, tanD: 0.02, w: 2e-3, trim: 0 },
  build(p): Design {
    const { f, sweeps, bands } = band(p);
    const er = num(p, "er", 4.4), h = num(p, "h", 0.8e-3), w = num(p, "w", 2e-3), tanD = num(p, "tanD", 0.02);
    const f2 = bands.length > 1 ? (bands[1][0] + bands[1][1]) / 2 : f * HIGH_RATIO;
    const s = Math.max(num(p, "s", 3.5e-3), 1.5 * w);
    const ee = printedEeff(er, h, w), k = 1 + num(p, "trim", 0) / 100;
    const lam1 = wavelength(f), lam2 = wavelength(f2);
    const g = Math.max(1e-3, w / 2);
    const a1 = Math.max((DB_K1 * lam1) / 4 / Math.sqrt(ee) * k - g / 2, 4 * w);
    const a2 = Math.min(Math.max((DB_K2 * lam2) / 4 / Math.sqrt(ee) * k - g / 2, 2 * w), a1 - w);
    const rects = [];
    for (const [sg, n] of [[1, "+"], [-1, "−"]] as const) {
      const y0 = (sg * g) / 2, yb = sg * (g / 2 + w);
      rects.push(
        r("top", -w / 2, y0, w / 2, sg * (g / 2 + a1), `Arm ${n}`),
        r("top", -s - w / 2, y0, s + w / 2, yb, `Fork ${n}`),
        r("top", s - w / 2, yb, s + w / 2, sg * (g / 2 + a2), `Branch ${n}`),
        r("top", -s - w / 2, yb, -s + w / 2, sg * (g / 2 + a2), `Branch ${n}`),
      );
    }
    const m = 3e-3, half = g / 2 + a1 + m;
    const pcb: Pcb = {
      board: { x0: -s - w / 2 - m, y0: -half, x1: s + w / 2 + m, y1: half }, h, er, tanD, t: 35e-6,
      rects,
      port: { start: [-w / 2, -g / 2, h], stop: [w / 2, g / 2, h], dir: "y", R: 50 },
    };
    const bs = boardSpans(pcb.board, h), yw = g / 2 + a1 / 2;
    return {
      wires: [], plates: pcbPlates(pcb), pcb, feedZ0: 50,
      dims: [
        { label: "Free-space wavelength λ", value: lam1 },
        { key: "L", label: "Total length (tip to tip)", value: g + 2 * a1, at: span(0, -g / 2 - a1, 0, g / 2 + a1, h) },
        { label: "Main strip, each arm (from the gap)", value: a1, at: span(0, g / 2, 0, g / 2 + a1, h) },
        { key: "B", label: "Side branch, each (from the gap)", value: a2, at: span(s, g / 2, s, g / 2 + a2, h) },
        { label: "Branch offset (centre to centre)", value: s, at: span(0, g / 2 + a2, s, g / 2 + a2, h) },
        { label: "Centre feed gap", value: g, at: span(0, -g / 2, 0, g / 2, h) },
        { label: "Trace width", value: w, at: span(-w / 2, yw, w / 2, yw, h) },
        { label: "Board width", value: pcb.board.x1 - pcb.board.x0, at: bs.w },
        { label: "Board length", value: pcb.board.y1 - pcb.board.y0, at: bs.l },
      ],
      tables: [],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(ee, 2) },
        { label: "High-band design frequency", value: `${fmt(f2 / 1e9, 3)} GHz` },
        { label: "Gain", value: "≈ 2 dBi (band 1), ≈ 3 dBi (band 2)" },
        { label: "Feed impedance", value: "≈ 50–70 Ω, direct 50 Ω coax" },
        { label: "Pattern", value: "Figure eight, maxima broadside to the board's long axis" },
      ],
      notes: [
        ...(bands.length < 2 ? ["Only one band given: the forks are sized for 2.24 × its centre (the 5 GHz band over 2.4 GHz). Add a second band to set it."] : []),
        "Feed it with thin 50 Ω coax (1.13 mm, RG178) along the board: the centre conductor to one arm, the shield to the other; an IPEX/U.FL pigtail is the usual choice.",
        "The long strips set band 1 and the side branches band 2: trim the strip tips to move band 1, the branch tips to move band 2.",
        "Dimensions come from an FDTD-calibrated εeff; run the in-browser FDTD or the exported openEMS script for your exact board.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
