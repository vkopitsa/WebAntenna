import type { AntennaDef, Design, Wire } from "../types";
import { num, str } from "../types";
import { besselJ0, C0, fmt, microstripEeff, microstripWidth, simpson, wavelength } from "../rf";
import { v } from "../geom";
import { pcbPlates, r as pr, type Pcb } from "../pcb";
import { band, BANDS } from "./common";
import { span } from "./pcbcommon";

/** Rectangular microstrip patch (Balanis, Antenna Theory, ch. 14: transmission-line model). */
export function patchDesign(f: number, er: number, h: number, z0: number) {
  const lam = wavelength(f), k0 = (2 * Math.PI) / lam;
  const W = (C0 / (2 * f)) * Math.sqrt(2 / (er + 1));
  const eeff = (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + (12 * h) / W, -0.5);
  const dL = (0.412 * h * (eeff + 0.3) * (W / h + 0.264)) / ((eeff - 0.258) * (W / h + 0.8));
  const L = C0 / (2 * f * Math.sqrt(eeff)) - 2 * dL;
  const slot = (t: number) => {
    const c = Math.cos(t), x = (k0 * W) / 2;
    const s = Math.abs(c) < 1e-9 ? x : Math.sin(x * c) / c;
    return s * s * Math.sin(t) ** 3;
  };
  const G1 = simpson(slot, 0, Math.PI, 600) / (120 * Math.PI ** 2);
  const G12 = simpson((t) => slot(t) * besselJ0(k0 * L * Math.sin(t)), 0, Math.PI, 600) / (120 * Math.PI ** 2);
  const Rin = 1 / (2 * (G1 + G12));
  const y0 = Rin > z0 ? (L / Math.PI) * Math.acos(Math.sqrt(z0 / Rin)) : 0;
  const wf = microstripWidth(z0, er, h);
  const eeffLine = microstripEeff(er, wf / h);
  // Jackson–Alexopoulos fit, for εr ≳ 2: its (εr − 1)/εr² peaks at 2 and falls to 0 for air (Q = ∞ → NaN
  // impedance), while real low-εr patches are wider still. Hold the term at its εr = 2 value below that.
  const eb = Math.max(er, 2);
  const bw = ((3.77 * (eb - 1)) / (eb * eb)) * (W / L) * (h / lam);
  return { lam, W, eeff, dL, L, G1, G12, Rin, y0, wf, eeffLine, lamG: lam / Math.sqrt(eeffLine), bw };
}

export const patch: AntennaDef = {
  id: "patch",
  name: "Rectangular microstrip patch",
  category: "Printed",
  traits: { pol: "linear", pattern: "beam" },
  summary: "PCB patch on a grounded substrate, inset-fed microstrip or coax probe.",
  params: [
    BANDS,
    { key: "er", label: "Substrate εr", kind: "number", min: 1, max: 15, step: 0.05, hint: "FR-4 ≈ 4.3–4.6, RO4003C 3.38" },
    { key: "h", label: "Substrate thickness", kind: "length", min: 0.05e-3, max: 0.02 },
    { key: "t", label: "Copper thickness", kind: "length", min: 5e-6, max: 0.5e-3 },
    { key: "z0", label: "Feed impedance (Ω)", kind: "number", min: 10, max: 200, step: 1 },
    { key: "feed", label: "Feed type", kind: "select", options: [["inset", "Inset microstrip"], ["probe", "Coax probe"]] },
    { key: "tanD", label: "Loss tangent tan δ", kind: "number", min: 0, max: 0.1, step: 0.001, hint: "FR-4 ≈ 0.02, RO4003C 0.0027" },
  ],
  defaults: { bands: "2.4e9-2.4835e9", er: 4.4, h: 1.6e-3, t: 35e-6, z0: 50, feed: "inset", tanD: 0.02 },
  build(p): Design {
    const { f, sweeps, f1, f2 } = band(p);
    const er = num(p, "er", 4.4), h = num(p, "h", 1.6e-3), t = num(p, "t", 35e-6), z0 = num(p, "z0", 50);
    const feed = str(p, "feed", "inset");
    const q = patchDesign(f, er, h, z0);
    const { W, L, y0, wf } = q;
    const Lg = L + 6 * h + (feed === "inset" ? q.lamG / 4 : 0), Wg = W + 6 * h;
    const xg0 = -L / 2 - (Lg - L) + 3 * h; // ground/substrate left edge (feed side gets the extra room)
    const gap = Math.max(wf / 2, 0.3e-3);
    // PCB model (copper as rectangles) → drawing plates and the openEMS export.
    const xL = -L / 2, xi = -L / 2 + (feed === "inset" ? y0 : 0);
    const copper = feed === "inset" && y0 > 0 ? [
      pr("top", xi, -W / 2, L / 2, W / 2, "Patch"),
      pr("top", xL, wf / 2 + gap, xi, W / 2, "Patch"),
      pr("top", xL, -W / 2, xi, -wf / 2 - gap, "Patch"),
      pr("top", xg0, -wf / 2, xi, wf / 2, "Feed line"),
    ] : [pr("top", -L / 2, -W / 2, L / 2, W / 2, "Patch")];
    const pcb: Pcb = {
      board: { x0: xg0, y0: -Wg / 2, x1: xg0 + Lg, y1: Wg / 2 }, h, er, tanD: num(p, "tanD", 0.02), t,
      rects: [pr("bottom", xg0, -Wg / 2, xg0 + Lg, Wg / 2, "Ground"), ...copper],
      port: feed === "inset" && y0 > 0
        ? { start: [xg0, -wf / 2, 0], stop: [xg0, wf / 2, h], dir: "z", R: z0 }
        : { start: [-L / 2 + y0, 0, 0], stop: [-L / 2 + y0, 0, h], dir: "z", R: z0 },
    };
    const plates = pcbPlates(pcb);
    const wires: Wire[] = feed === "inset" ? [] : [{ a: v(-L / 2 + y0, 0, -t), b: v(-L / 2 + y0, 0, h), r: 0.65e-3, group: "feed", tag: "P", drawOnly: true }];
    const notch = feed === "inset" && y0 > 0;
    return {
      wires,
      plates,
      pcb,
      dims: [
        { label: "Free-space wavelength λ", value: q.lam },
        { key: "W", label: "Patch width W (non-radiating edges)", value: W, at: span(L / 2, -W / 2, L / 2, W / 2, h) },
        { key: "L", label: "Patch length L (resonant)", value: L, at: span(xL, W / 2, L / 2, W / 2, h) },
        { label: "Fringing extension ΔL (each edge)", value: q.dL },
        { key: "y0", label: feed === "inset" ? "Inset depth y0" : "Probe distance from the radiating edge", value: y0, at: notch ? span(xL, wf / 2 + gap, xi, wf / 2 + gap, h) : y0 > 0 ? span(xL, 0, xL + y0, 0, h) : undefined },
        ...(feed === "inset" ? [
          { key: "wf", label: "Feed line width", value: wf, at: notch ? span(xL, -wf / 2, xL, wf / 2, h) : undefined },
          { label: "Inset notch gap (each side)", value: gap, at: notch ? span((xL + xi) / 2, wf / 2, (xL + xi) / 2, wf / 2 + gap, h) : undefined },
          { label: "Guided wavelength on the feed line λg", value: q.lamG },
        ] : []),
        { label: "Ground / substrate length", value: Lg, at: span(xg0, -Wg / 2, xg0 + Lg, -Wg / 2, h) },
        { label: "Ground / substrate width", value: Wg, at: span(xg0, -Wg / 2, xg0, Wg / 2, h) },
      ],
      tables: [],
      perf: [
        { label: "Effective permittivity εeff", value: fmt(q.eeff, 3) },
        { label: "Edge resistance Rin (G1 + G12)", value: `${fmt(q.Rin, 0)} Ω` },
        { label: "Bandwidth (VSWR < 2, Jackson)", value: `≈ ${fmt(q.bw * 100, 2)} % (${fmt((q.bw * f) / 1e6, 1)} MHz)` },
        { label: "Gain", value: "≈ 5–7 dBi (lower on lossy FR-4)" },
        { label: "Polarisation", value: "Linear, along L" },
      ],
      notes: [
        "Transmission-line model (Balanis): expect the real resonance within 1–3 %. Make L slightly adjustable or simulate first.",
        "FR-4 εr varies between boards and with frequency; above 3 GHz use a low-loss laminate.",
        ...((f2 - f1) / f > q.bw ? ["Warning: the band is wider than the patch bandwidth. Use a thicker or lower-εr substrate."] : []),
        ...(q.Rin <= z0 ? ["Edge resistance is below the feed impedance: feed at the edge with a λ/4 transformer."] : []),
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
