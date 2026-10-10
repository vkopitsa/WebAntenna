import type { AntennaDef, Design } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { pcbPlates, PCB_PARAMS, PRINTED_TRIM, r, type Pcb } from "../pcb";
import { band, BANDS } from "./common";
import { printedEeff } from "./pcbmonopole";

/**
 * Length factors on λ/4 / √εeff(monopole fit) from the gap: the radiating strip and the U-shaped sleeve (two legs
 * either side of the cable slot, joined at the feed). From the in-browser FDTD (CPU engine, FR-4 0.8 mm,
 * w = 3 mm, 863–870 MHz, docs/ANTENNAS.md): 0.855 resonated at 921 MHz, 0.909 at 870 MHz (62 Ω).
 */
export const SLEEVE_K = 0.909;
export const SLEEVE_KS = 0.909;

export const sleevedipole: AntennaDef = {
  id: "sleevedipole",
  name: "Printed sleeve dipole",
  category: "Printed",
  traits: { pol: "linear", pattern: "omni" },
  summary: "Strip-and-sleeve dipole on a narrow board (FPC style): the coax runs up the slot of the U-shaped lower half to the feed.",
  params: [
    BANDS,
    { key: "slot", label: "Cable slot width", kind: "length", min: 0.5e-3, max: 6e-3, hint: "Room for the coax: 1.13 mm cable → 1.5–2 mm" },
    PCB_PARAMS.er, PCB_PARAMS.h, PCB_PARAMS.tanD, PCB_PARAMS.w, PRINTED_TRIM,
  ],
  defaults: { bands: "863e6-870e6", slot: 2e-3, er: 4.4, h: 0.8e-3, tanD: 0.02, w: 3e-3, trim: 0 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const er = num(p, "er", 4.4), h = num(p, "h", 0.8e-3), w = num(p, "w", 3e-3), tanD = num(p, "tanD", 0.02);
    const slot = Math.max(num(p, "slot", 2e-3), 0.3e-3);
    const lam = wavelength(f), ee = printedEeff(er, h, w), k = 1 + num(p, "trim", 0) / 100;
    const g = Math.max(1e-3, w / 2);
    const a = Math.max((SLEEVE_K * lam) / 4 / Math.sqrt(ee) * k - g / 2, 4 * w);
    const b = Math.max((SLEEVE_KS * lam) / 4 / Math.sqrt(ee) * k - g / 2, 4 * w);
    const W = slot + 2 * w;
    const pcb: Pcb = {
      board: { x0: -W / 2 - 2e-3, y0: -g / 2 - b - 3e-3, x1: W / 2 + 2e-3, y1: g / 2 + a + 3e-3 }, h, er, tanD, t: 35e-6,
      rects: [
        r("top", -w / 2, g / 2, w / 2, g / 2 + a, "Radiator"),
        r("top", -W / 2, -g / 2 - w, W / 2, -g / 2, "Sleeve"),
        r("top", -W / 2, -g / 2 - b, -W / 2 + w, -g / 2 - w, "Sleeve"),
        r("top", W / 2 - w, -g / 2 - b, W / 2, -g / 2 - w, "Sleeve"),
      ],
      port: { start: [-w / 2, -g / 2, h], stop: [w / 2, g / 2, h], dir: "y", R: 50 },
    };
    return {
      wires: [], plates: pcbPlates(pcb), pcb, feedZ0: 50,
      dims: [
        { label: "Free-space wavelength λ", value: lam },
        { key: "L", label: "Radiator (from the gap)", value: a },
        { key: "S", label: "Sleeve length (from the gap)", value: b },
        { label: "Sleeve width", value: W },
        { label: "Cable slot width", value: slot },
        { label: "Centre feed gap", value: g },
        { label: "Trace width", value: w },
        { label: "Board width", value: pcb.board.x1 - pcb.board.x0 },
        { label: "Board length", value: pcb.board.y1 - pcb.board.y0 },
      ],
      tables: [],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(ee, 2) },
        { label: "Gain", value: "≈ 2 dBi" },
        { label: "Feed impedance", value: "≈ 60 Ω (FDTD), direct 50 Ω coax" },
        { label: "Pattern", value: "Omnidirectional around the board's long axis" },
      ],
      notes: [
        "Run the coax up the slot between the sleeve legs; solder the shield across the top of the sleeve and the centre conductor to the radiator.",
        "The sleeve is the lower half of the dipole and keeps current off the cable shield; a ferrite bead where the cable leaves the board helps further.",
        "Dimensions come from an FDTD-calibrated εeff; run the in-browser FDTD or the exported openEMS script for your exact board.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
