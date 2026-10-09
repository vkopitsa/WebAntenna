import type { AntennaDef, Design } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { pcbPlates, PCB_PARAMS, PRINTED_TRIM, r } from "../pcb";
import { band, BANDS } from "./common";
import { gapPort, groundedBoard } from "./pcbcommon";

/**
 * εeff of a trace on a substrate with no ground below, fitted to openEMS runs of this monopole
 * (FR-4 1.6 / 0.8 mm, εr 10.2 1.27 mm, w = 1 mm; docs/ANTENNAS.md): q = 0.048 √(h/w) εr^0.47.
 */
export function printedEeff(er: number, h: number, w: number): number {
  return 1 + 0.048 * Math.sqrt(h / w) * Math.pow(er, 0.47) * (er - 1);
}
/** Length factor on λeff/4 (openEMS fit). */
export const MONO_K = 1.0;

export const pcbmonopole: AntennaDef = {
  id: "pcbmonopole",
  name: "PCB trace monopole",
  category: "Printed",
  traits: { pol: "linear", pattern: "omni" },
  summary: "Straight λ/4 trace off the edge of the board's ground pour. Simplest PCB antenna.",
  params: [BANDS, PCB_PARAMS.er, PCB_PARAMS.h, PCB_PARAMS.tanD, PCB_PARAMS.w, PCB_PARAMS.gl, PCB_PARAMS.bw, PRINTED_TRIM],
  defaults: { bands: "2.4e9-2.4835e9", er: 4.4, h: 1.6e-3, tanD: 0.02, w: 1e-3, gl: 40e-3, bw: 30e-3, trim: 0 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const er = num(p, "er", 4.4), w = num(p, "w", 1e-3), h = num(p, "h", 1.6e-3);
    const lam = wavelength(f), ee = printedEeff(er, h, w);
    const L = ((MONO_K * lam) / 4 / Math.sqrt(ee)) * (1 + num(p, "trim", 0) / 100);
    const g = Math.max(0.5e-3, w);
    const trace = r("top", -w / 2, g, w / 2, g + L, "Antenna trace");
    const pcb = groundedBoard(p, g + L + 2e-3, [trace], gapPort(0, w, g, h));
    return {
      wires: [], plates: pcbPlates(pcb), pcb,
      dims: [
        { label: "Free-space wavelength λ", value: lam },
        { key: "L", label: "Trace length (from the ground edge gap)", value: L },
        { label: "Trace width", value: w },
        { label: "Feed gap to the ground pour", value: g },
        { label: "Keep-out above the ground pour", value: g + L + 2e-3 },
      ],
      tables: [],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(ee, 2) },
        { label: "Gain", value: "≈ 1–3 dBi (depends on the ground pour)" },
        { label: "Feed impedance", value: "≈ 70–120 Ω at resonance (openEMS): plan a π matching network" },
      ],
      notes: [
        "Keep all copper (both layers) out of the antenna area; the ground pour is the other half of the antenna.",
        "Leave room for a π matching network (0 Ω + two DNP) at the feed.",
        "Dimensions come from an openEMS-calibrated εeff; run the exported openEMS script for your exact board.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
