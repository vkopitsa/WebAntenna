import type { AntennaDef, Design } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { pcbPlates, PCB_PARAMS, PRINTED_TRIM, r } from "../pcb";
import { band, BANDS } from "./common";
import { gapPort, groundedBoard } from "./pcbcommon";

/**
 * Printed IFA model fitted to openEMS runs (w = 1 mm, H = 5 / 8 mm on FR-4 1.6 mm, H = 5 mm on RO4003C 0.8 mm;
 * docs/ANTENNAS.md):
 *   f_res · (La + 0.225 H) = c / (4 √εIFA),  εIFA = 1 + 0.2745 (h / 1 mm)^0.133 εr^0.47 (εr − 1)
 *   50 Ω tap: S = 2.5 mm · √(H / 5 mm)
 * The vertical legs barely count; the arm length sets the frequency.
 */
export const IFA_BETA = 0.225;
export const ifaEeff = (er: number, h: number) => 1 + 0.2745 * Math.pow(h / 1e-3, 0.133) * Math.pow(er, 0.47) * (er - 1);
export function ifaArm(f: number, H: number, er: number, h: number): number {
  return 299792458 / (4 * f * Math.sqrt(ifaEeff(er, h))) - IFA_BETA * H;
}
export const ifaTap = (H: number) => 2.5e-3 * Math.sqrt(H / 5e-3);

export const ifa: AntennaDef = {
  id: "ifa",
  name: "Printed inverted-F (IFA)",
  category: "Printed",
  traits: { pol: "linear", pattern: "omni" },
  summary: "λ/4 arm parallel to the ground edge, shorted at one end and tapped near it for 50 Ω. Compact, common on modules.",
  params: [
    BANDS, PCB_PARAMS.er, PCB_PARAMS.h, PCB_PARAMS.tanD, PCB_PARAMS.w,
    { key: "H", label: "Arm height above the ground edge", kind: "length", min: 1e-3, max: 0.05, hint: "Calibrated for 4–10 mm at 2.4 GHz (≈ 0.03–0.08 λ). Higher: wider bandwidth" },
    PCB_PARAMS.gl, PCB_PARAMS.bw, PRINTED_TRIM,
  ],
  defaults: { bands: "2.4e9-2.4835e9", er: 4.4, h: 1.6e-3, tanD: 0.02, w: 1e-3, H: 5e-3, gl: 40e-3, bw: 35e-3, trim: 0 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const er = num(p, "er", 4.4), w = num(p, "w", 1e-3), h = num(p, "h", 1.6e-3), H = num(p, "H", 5e-3), bw = num(p, "bw", 0.035);
    const lam = wavelength(f), ee = ifaEeff(er, h);
    const La = Math.max(2 * w, ifaArm(f, H, er, h) * (1 + num(p, "trim", 0) / 100));
    const Ltot = La + H; // short → open end along the centre line
    const S = Math.max(1.5 * w, ifaTap(H));
    const g = Math.max(0.5e-3, w);
    const xs = -bw / 2 + 1e-3 + w / 2; // short leg near the board corner
    const xf = xs + S;
    const rects = [
      r("top", xs - w / 2, 0, xs + w / 2, H + w / 2, "Short to ground"),
      r("top", xs - w / 2, H - w / 2, xs + La, H + w / 2, "Radiating arm"),
      r("top", xf - w / 2, g, xf + w / 2, H - w / 2, "Feed leg"),
    ];
    const pcb = groundedBoard(p, H + w / 2 + 2e-3, rects, gapPort(xf, w, g, h));
    const tooLong = xs + La > bw / 2 - 0.5e-3;
    return {
      wires: [], plates: pcbPlates(pcb), pcb,
      dims: [
        { label: "Free-space wavelength λ", value: lam },
        { key: "H", label: "Arm height above the ground edge (centre line)", value: H },
        { key: "L", label: "Arm length from the short (centre line)", value: La },
        { key: "S", label: "Feed tap distance from the short", value: S },
        { label: "Short → open end, total", value: Ltot },
        { label: "Trace width", value: w },
        { label: "Feed gap to the ground pour", value: g },
      ],
      tables: [],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(ee, 2) },
        { label: "Gain", value: "≈ 1–3 dBi (depends on the ground pour)" },
        { label: "Feed impedance", value: "≈ 50 Ω (move the feed tap: further from the short raises R)" },
      ],
      notes: [
        ...(tooLong ? ["Warning: the arm is longer than the board is wide. Widen the board, raise H, or use the meander monopole."] : []),
        "Tune frequency with the arm length (shorter = higher), match with the tap distance S.",
        "Keep both copper layers out of the antenna area; leave a π matching network footprint at the feed.",
        "Dimensions come from an openEMS-calibrated model; run the exported openEMS script for your exact board.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
