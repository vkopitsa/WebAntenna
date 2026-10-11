import type { AntennaDef, Cell, Design, Vec3, Wire } from "../types";
import { num, str } from "../types";
import { endEffect, fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS, DIAM } from "./common";

/*
 * DL6WU-style long Yagi (empirical model).
 * Spacings (λ) and the director taper reproduce the DL6WU/AntMaker reference design
 * 145.5 MHz, 9 elements, Ø12 mm elements through a Ø30 mm metal boom (docs/ANTENNAS.md):
 * reflector 1019.91, folded dipole 974.58, D1…D7 913.01 … 856.44 mm.
 * Element lengths are scaled to other diameters with the end-effect factor ratio.
 */
const REF_D_OVER_L = 12 / 2060.43;
const SPACING = [0.185, 0.079, 0.18, 0.216, 0.252, 0.281, 0.302, 0.317, 0.332, 0.347, 0.362, 0.377, 0.392];
const SPACING_MAX = 0.4;
const DIRECTOR = [0.4381, 0.4323, 0.4251, 0.4193, 0.4165, 0.4136, 0.4107];
const REFLECTOR = 0.49;
const FOLDED = 0.473;
const SPLIT = 0.462;
/** Through-metal-boom correction from the reference design: 10.3 mm for a 30 mm boom. */
const BOOM_K = 10.3 / 30;

/** Director n (1-based) length in λ at the reference diameter, insulated boom. */
export function directorLambda(n: number): number {
  if (n <= DIRECTOR.length) return DIRECTOR[n - 1];
  return Math.max(0.385, DIRECTOR[DIRECTOR.length - 1] - 0.0173 * Math.log(n / DIRECTOR.length));
}
/** Spacing (λ) before element index i (i = 1 is the driven element, 2 is D1, …). */
export function spacingLambda(i: number): number {
  return SPACING[i - 1] ?? SPACING_MAX;
}
/** NBS (Viezbicke) gain vs boom length, fitted: 0.4λ → 7.1 dBd, 2.2λ → 12.2 dBd, 4.2λ → 14.2 dBd. */
export function yagiGainDbi(boomLambda: number): number {
  return 2.15 + 9.85 + 6.9 * Math.log10(Math.max(boomLambda, 0.15));
}

export const yagi: AntennaDef = {
  id: "yagi",
  name: "Yagi-Uda (DL6WU style)",
  category: "Directional",
  traits: { pol: "horizontal", pattern: "beam" },
  summary: "Reflector, driven element and a tapered row of directors on a boom. 3 to 40 elements.",
  params: [
    BANDS,
    { key: "n", label: "Number of elements", kind: "int", min: 3, max: 40, step: 1 },
    DIAM,
    { key: "driven", label: "Driven element", kind: "select", options: [["folded", "Folded dipole (≈200 Ω, 4:1 balun)"], ["split", "Split dipole (≈25–50 Ω)"]] },
    { key: "boom", label: "Element mounting", kind: "select", options: [["insulated", "Insulated / above the boom"], ["through", "Through a metal boom (bonded)"]] },
    { key: "bd", label: "Boom diameter", kind: "length", min: 1e-3, max: 0.2 },
  ],
  defaults: { bands: "144.5e6-146.5e6", n: 9, d: 12e-3, driven: "folded", boom: "insulated", bd: 30e-3 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const d = num(p, "d"), n = Math.max(3, Math.round(num(p, "n", 9)));
    const driven = str(p, "driven", "folded"), boom = str(p, "boom", "insulated"), bd = num(p, "bd", 0.03);
    const lam = wavelength(f), r = d / 2;
    const sc = endEffect(lam, d) / endEffect(lam, REF_D_OVER_L * lam);
    const bc = boom === "through" ? BOOM_K * bd : 0;

    const names: string[] = ["R", "DE", ...Array.from({ length: n - 2 }, (_, i) => `D${i + 1}`)];
    const lengths = names.map((_, i) => {
      if (i === 0) return REFLECTOR * lam * sc + bc;
      if (i === 1) return (driven === "folded" ? FOLDED : SPLIT) * lam * sc;
      return directorLambda(i - 1) * lam * sc + bc;
    });
    const pos: number[] = [0];
    for (let i = 1; i < n; i++) pos.push(pos[i - 1] + spacingLambda(i) * lam);
    const boomLen = pos[n - 1];

    const wires: Wire[] = [];
    let feedWire = 0;
    const fs = Math.max(3 * d, 0.01 * lam); // folded-dipole conductor spacing
    names.forEach((nm, i) => {
      const L = lengths[i], x = pos[i];
      const group = i === 0 ? "reflector" : i === 1 ? "driven" : "parasitic";
      if (i === 1 && driven === "folded") {
        feedWire = wires.length;
        wires.push({ a: v(x, -L / 2 + fs / 2, 0), b: v(x, L / 2 - fs / 2, 0), r, tag: nm, group });
        wires.push({ a: v(x, -L / 2 + fs / 2, fs), b: v(x, L / 2 - fs / 2, fs), r, group });
        wires.push({ a: v(x, -L / 2 + fs / 2, 0), b: v(x, -L / 2 + fs / 2, fs), r, group });
        wires.push({ a: v(x, L / 2 - fs / 2, 0), b: v(x, L / 2 - fs / 2, fs), r, group });
      } else {
        if (i === 1) feedWire = wires.length;
        wires.push({ a: v(x, -L / 2, 0), b: v(x, L / 2, 0), r, tag: nm, group });
      }
    });
    // Boom, drawn only (not part of the NEC model, not a radiator).
    const bz = boom === "through" ? 0 : -bd / 2 - r;
    const boomWire: Wire = { a: v(-0.03 * lam, 0, bz), b: v(boomLen + 0.03 * lam, 0, bz), r: bd / 2, group: "line", drawOnly: true };

    const rows: Cell[][] = names.map((nm, i) => [nm, pos[i], i === 0 ? "" : pos[i] - pos[i - 1], lengths[i]]);
    const g = yagiGainDbi(boomLen / lam);
    return {
      wires: [...wires, { ...boomWire, tag: undefined }],
      plates: [],
      feed: { wire: feedWire, at: "center" },
      feedZ0: driven === "folded" ? 200 : 50,
      dims: [
        { label: "Wavelength λ", value: lam },
        { label: "Boom length (reflector to last director)", value: boomLen, at: [v(0, 0, bz), v(boomLen, 0, bz)] },
        ...(driven === "folded" ? [{ label: "Folded dipole conductor spacing", value: fs, at: [wires[feedWire].a, wires[feedWire + 1].a] as [Vec3, Vec3] }] : []),
        ...(bc > 0 ? [{ label: "Boom correction added to parasitic elements", value: bc }] : []),
      ],
      tables: [{
        title: "Elements",
        columns: [{ label: "Element", kind: "text" }, { label: "Position on boom", kind: "len" }, { label: "Spacing from previous", kind: "len" }, { label: "Length", kind: "len" }],
        rows,
      }],
      perf: [
        { label: "Boom length", value: `${fmt(boomLen / lam, 2)} λ` },
        { label: "Gain (free space, NBS curve)", value: `≈ ${fmt(g, 1)} dBi` },
        { label: "Beamwidth (E-plane, approx.)", value: `≈ ${fmt(Math.sqrt(41253 / Math.pow(10, g / 10) / 1.15), 0)}°` },
        { label: "Feed impedance", value: driven === "folded" ? "≈ 200 Ω → 4:1 balun / λ/2 coax loop" : "≈ 25–50 Ω (gamma or hairpin match)" },
      ],
      notes: [
        "Empirical DL6WU-style model, verified against a published 145.5 MHz 9-element design. Check in NEC before cutting metal.",
        "Element lengths are tip to tip. Through a metal boom the correction is already added.",
        "Driven element length is a starting point: trim it for best match, not for frequency.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
