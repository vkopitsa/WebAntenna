import type { AntennaDef, Design } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { pcbPlates, PCB_PARAMS, PRINTED_TRIM, r, type Pcb } from "../pcb";
import { band, BANDS } from "./common";
import { printedEeff } from "./pcbmonopole";
import { span } from "./pcbcommon";

/**
 * Length factor on λ/2 / √εeff(monopole fit) for a bare-substrate strip dipole. openEMS (FR-4 1.6 mm, w = 1.5 mm):
 * K = 0.96 resonated at 2.174 GHz instead of 2.442 GHz → K = 0.96 × 2.174 / 2.442 = 0.855 (docs/ANTENNAS.md).
 */
export const DIPOLE_K = 0.855;

export const printeddipole: AntennaDef = {
  id: "printeddipole",
  name: "Printed dipole",
  category: "Printed",
  traits: { pol: "linear", pattern: "bi" },
  summary: "Two λ/4 traces on a bare substrate, fed in the centre with a balanced line (balun or differential RF port).",
  params: [BANDS, PCB_PARAMS.er, PCB_PARAMS.h, PCB_PARAMS.tanD, PCB_PARAMS.w, PRINTED_TRIM],
  defaults: { bands: "2.4e9-2.4835e9", er: 4.4, h: 1.6e-3, tanD: 0.02, w: 1.5e-3, trim: 0 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const er = num(p, "er", 4.4), h = num(p, "h", 1.6e-3), w = num(p, "w", 1.5e-3), tanD = num(p, "tanD", 0.02);
    const lam = wavelength(f), ee = printedEeff(er, h, w);
    const L = ((DIPOLE_K * lam) / 2 / Math.sqrt(ee)) * (1 + num(p, "trim", 0) / 100);
    const g = Math.max(1e-3, w);
    const arm = Math.max((L - g) / 2, 0.5e-3); // a gap wider than the dipole would give negative arms
    const tooShort = (L - g) / 2 < 0.5e-3;
    const m = 3e-3;
    const pcb: Pcb = {
      board: { x0: -w / 2 - m, y0: -L / 2 - m, x1: w / 2 + m, y1: L / 2 + m }, h, er, tanD, t: 35e-6,
      rects: [r("top", -w / 2, g / 2, w / 2, g / 2 + arm, "Arm +"), r("top", -w / 2, -g / 2 - arm, w / 2, -g / 2, "Arm −")],
      port: { start: [-w / 2, -g / 2, h], stop: [w / 2, g / 2, h], dir: "y", R: 75 },
    };
    return {
      wires: [], plates: pcbPlates(pcb), pcb, feedZ0: 75,
      dims: [
        { label: "Free-space wavelength λ", value: lam },
        { key: "L", label: "Total length (tip to tip)", value: L, at: span(0, -L / 2, 0, L / 2, h) },
        { label: "Each arm", value: arm, at: span(0, g / 2, 0, L / 2, h) },
        { label: "Centre feed gap", value: g, at: span(0, -g / 2, 0, g / 2, h) },
        { label: "Trace width", value: w, at: span(-w / 2, L / 4, w / 2, L / 4, h) },
      ],
      tables: [],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(ee, 2) },
        { label: "Gain", value: "≈ 2 dBi" },
        { label: "Feed impedance", value: "≈ 70–75 Ω balanced (openEMS port: 75 Ω)" },
      ],
      notes: [
        ...(tooShort ? ["Warning: the trace is too wide for this frequency; the arms were kept at 0.5 mm. Use a narrower trace."] : []),
        "Balanced antenna: feed it through a balun (or a differential RF output) and keep ground copper away from the arms.",
        "Dimensions come from an openEMS-calibrated εeff; run the exported openEMS script for your exact board.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
