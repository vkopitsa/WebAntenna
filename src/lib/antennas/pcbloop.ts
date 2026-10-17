import type { AntennaDef, Design, Plate } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { PCB_PARAMS } from "../pcb";
import { rect, v } from "../geom";
import { band, BANDS } from "./common";
import { span } from "./pcbcommon";

const MU0 = 4e-7 * Math.PI;

/**
 * Small rectangular PCB loop with a series tuning capacitor Cs and a shunt matching capacitor Cp
 * (L-network to 50 Ω). Classic small-loop design (Microchip AN831 / TI SWRA046 style):
 *   L  (Grover, rectangle of a × b, equivalent strip radius ρ = 0.2235 (w + t))
 *   Rr = 31171 (A/λ²)² Ω,  Rloss = perimeter/(2w) · Rs,  Rs = √(π f μ0 / σ)
 */
/** Trace width actually used: the sides must stay inside the loop rectangle. */
export const loopTraceW = (a: number, b: number, w: number) => Math.min(w, 0.4 * Math.min(a, b));

export function loopModel(f: number, a: number, b: number, w: number, t: number, sigma: number, qCap: number) {
  const rho = 0.2235 * (w + t);
  const d = Math.hypot(a, b);
  const L = (MU0 / Math.PI) * (a * Math.log((2 * a) / rho) + b * Math.log((2 * b) / rho) + 2 * d - a * Math.asinh(a / b) - b * Math.asinh(b / a) - 2 * (a + b));
  const lam = wavelength(f), w0 = 2 * Math.PI * f;
  const A = a * b;
  const Rr = 31171 * (A / (lam * lam)) ** 2;
  const Rs = Math.sqrt((Math.PI * f * MU0) / sigma);
  const Rl = ((2 * (a + b)) / (2 * w)) * Rs;
  const XL = w0 * L;
  const Rcap = XL / qCap; // the tuning capacitor carries ≈ the loop reactance
  const Rt = Rr + Rl + Rcap;
  const Q = Math.sqrt(Math.max(50 / Rt - 1, 0));
  const Xs = Q * Rt, Xp = 50 / Q;
  const Cs = 1 / (w0 * (XL - Xs));
  const Cp = 1 / (w0 * Xp);
  const eff = Rr / Rt;
  const Qload = XL / (2 * Rt);
  return { L, Rr, Rl, Rcap, Rt, XL, Cs, Cp, eff, Qload, bw: f / Qload, A };
}

/** Input impedance of the matched loop at frequency f (components fixed at the design frequency). */
export function loopZin(fz: number, m: ReturnType<typeof loopModel>, f0: number): [number, number] {
  const w = 2 * Math.PI * fz;
  // R grows ~ √f (skin) and ~ f⁴ (radiation); keep it simple: scale Rr by (f/f0)⁴, Rl by √(f/f0).
  const R = m.Rr * (fz / f0) ** 4 + m.Rl * Math.sqrt(fz / f0) + m.Rcap * (fz / f0);
  const X = w * m.L - 1 / (w * m.Cs);
  // parallel with Cp: Y = jωCp + 1/(R + jX)
  const d = R * R + X * X;
  const yr = R / d, yi = -X / d + w * m.Cp;
  const yd = yr * yr + yi * yi;
  return [yr / yd, -yi / yd];
}

export const pcbloop: AntennaDef = {
  id: "pcbloop",
  name: "PCB small loop",
  category: "Printed",
  traits: { pol: "linear", pattern: "omni" },
  summary: "Rectangular trace loop tuned by a series capacitor and matched with a shunt capacitor. Common at 315/433/868 MHz.",
  params: [
    BANDS,
    { key: "a", label: "Loop width", kind: "length", min: 3e-3, max: 0.2 },
    { key: "b", label: "Loop height", kind: "length", min: 3e-3, max: 0.2 },
    PCB_PARAMS.w,
    { key: "t", label: "Copper thickness", kind: "length", min: 5e-6, max: 0.2e-3 },
    { key: "qc", label: "Capacitor Q", kind: "number", min: 20, max: 2000, step: 10, hint: "C0G/NP0 0402 at UHF ≈ 200–500" },
    PCB_PARAMS.h,
  ],
  defaults: { bands: "433.05e6-434.79e6", a: 30e-3, b: 20e-3, w: 2e-3, t: 35e-6, qc: 300, h: 1.6e-3 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const a = num(p, "a", 0.03), b = num(p, "b", 0.02), wIn = num(p, "w", 2e-3), t = num(p, "t", 35e-6), qc = num(p, "qc", 300), h = num(p, "h", 1.6e-3);
    const w = loopTraceW(a, b, wIn);
    const m = loopModel(f, a, b, w, t, 5.8e7, qc);
    const lam = wavelength(f);
    // Drawing: substrate + the four loop sides with gaps for Cp (bottom, feed) and Cs (top).
    const g0 = Math.max(1e-3, w), g = Math.min(g0, 0.5 * a); // the gaps must leave copper on both sides
    const clamped = w < wIn || g < g0;
    const z = h;
    const strip = (x0: number, y0: number, x1: number, y1: number, label: string): Plate =>
      ({ pts: rect(v((x0 + x1) / 2, (y0 + y1) / 2, z), v(Math.abs(x1 - x0) / 2, 0, 0), v(0, Math.abs(y1 - y0) / 2, 0)), thickness: t, material: "metal", label });
    const plates: Plate[] = [
      { pts: rect(v(0, 0, 0), v(a / 2 + 4e-3, 0, 0), v(0, b / 2 + 4e-3, 0)), thickness: h, material: "dielectric", label: "Substrate" },
      strip(-a / 2 - w / 2, -b / 2 - w / 2, -a / 2 + w / 2, b / 2 + w / 2, "Loop"),
      strip(a / 2 - w / 2, -b / 2 - w / 2, a / 2 + w / 2, b / 2 + w / 2, "Loop"),
      strip(-a / 2, -b / 2 - w / 2, -g / 2, -b / 2 + w / 2, "Loop"), strip(g / 2, -b / 2 - w / 2, a / 2, -b / 2 + w / 2, "Loop"),
      strip(-a / 2, b / 2 - w / 2, -g / 2, b / 2 + w / 2, "Loop"), strip(g / 2, b / 2 - w / 2, a / 2, b / 2 + w / 2, "Loop"),
    ];
    const pf = (x: number) => (x * 1e12 >= 10 ? `${(x * 1e12).toFixed(1)} pF` : `${(x * 1e12).toFixed(2)} pF`);
    const bad = !(m.Cs > 0) || !(m.Cp > 0);
    return {
      wires: [
        { a: v(0, -b / 2, z + 1e-4), b: v(0, -b / 2, z + 1e-4), r: w / 2, group: "feed", drawOnly: true, tag: "Cp" },
        { a: v(-g / 2, b / 2, z), b: v(g / 2, b / 2, z), r: w / 2, group: "line", drawOnly: true, tag: "Cs" },
        { a: v(-g / 2, -b / 2, z), b: v(g / 2, -b / 2, z), r: w / 2, group: "feed", drawOnly: true },
      ],
      feed: { wire: 2, at: "center" },
      plates,
      dims: [
        { label: "Free-space wavelength λ", value: lam },
        { key: "a", label: "Loop width (trace centre)", value: a, at: span(-a / 2, 0, a / 2, 0, z) },
        { key: "b", label: "Loop height (trace centre)", value: b, at: span(-a / 2, -b / 2, -a / 2, b / 2, z) },
        { label: "Trace width", value: w, at: span(-a / 2 - w / 2, 0, -a / 2 + w / 2, 0, z) },
        { label: "Capacitor gaps", value: g, at: span(-g / 2, -b / 2, g / 2, -b / 2, z) },
      ],
      tables: [{
        title: "Matching components",
        columns: [{ label: "Part", kind: "text" }, { label: "Value", kind: "text" }, { label: "Where", kind: "text" }],
        rows: bad ? [["—", "—", "Loop too small or too lossy to match with this network"]] : [
          ["Cs", pf(m.Cs), "Series, in the top gap (tunes resonance)"],
          ["Cp", pf(m.Cp), "Shunt across the feed (sets 50 Ω)"],
        ],
      }],
      perf: [
        { label: "Loop inductance", value: `${(m.L * 1e9).toFixed(1)} nH` },
        { label: "Radiation resistance", value: `${(m.Rr * 1e3).toFixed(2)} mΩ` },
        { label: "Loss resistance (copper + capacitor)", value: `${((m.Rl + m.Rcap) * 1e3).toFixed(0)} mΩ` },
        { label: "Radiation efficiency", value: `${(100 * m.eff).toFixed(1)} % (${fmt(10 * Math.log10(m.eff), 1)} dB)` },
        { label: "Gain", value: `≈ ${fmt(1.76 + 10 * Math.log10(m.eff), 1)} dBi` },
        { label: "Bandwidth (matched, −3 dB)", value: `≈ ${(m.bw / 1e6).toFixed(2)} MHz` },
      ],
      notes: [
        ...(bad ? ["Warning: the loop cannot be matched with Cs + Cp at this size; make it larger or use a transformer match."] : []),
        ...(clamped ? ["Warning: the trace width and capacitor gap are too large for this loop; they were reduced to fit."] : []),
        "Small loops are inefficient but robust to hand detuning. Use C0G/NP0 capacitors; fine-tune Cs on the bench (± 0.1 pF matters).",
        "Keep the ground pour at least one loop height away from the loop; nearby copper lowers the efficiency.",
        "Analytic small-loop model (no openEMS export: the lumped matching capacitors need a circuit co-simulation).",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
