import type { AntennaDef, Design, Wire } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS, DIAM } from "./common";

/**
 * L. B. Cebik's Moxon rectangle regression (as used by MoxGen), valid for 1e-5 < d/λ < 1e-2.
 * Returns A…E in wavelengths.
 */
export function moxonLambda(dOverLambda: number) {
  const x = Math.log10(dOverLambda);
  const A = -0.0008571428571 * x * x - 0.009571428571 * x + 0.3398571429;
  const B = -0.002142857143 * x * x - 0.02035714286 * x + 0.008285714286;
  const C = 0.001809523381 * x * x + 0.01780952381 * x + 0.05164285714;
  const D = 0.001 * x + 0.07178571429;
  return { A, B, C, D, E: B + C + D };
}

export const moxon: AntennaDef = {
  id: "moxon",
  name: "Moxon rectangle",
  category: "Directional",
  traits: { pol: "horizontal", pattern: "beam" },
  summary: "Two-element beam with folded-back tips. Direct 50 Ω feed and a deep rear null.",
  params: [BANDS, DIAM],
  defaults: { bands: "144e6-146e6", d: 2e-3 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const d = num(p, "d");
    const lam = wavelength(f), r = d / 2;
    const q = moxonLambda(d / lam);
    const [A, B, C, D, E] = [q.A, q.B, q.C, q.D, q.E].map((x) => x * lam);
    const xd = E / 2, xr = -E / 2;
    const wires: Wire[] = [
      { a: v(xd - B, -A / 2, 0), b: v(xd, -A / 2, 0), r, tag: "B", group: "driven" },
      { a: v(xd, -A / 2, 0), b: v(xd, A / 2, 0), r, tag: "A", group: "driven" },
      { a: v(xd, A / 2, 0), b: v(xd - B, A / 2, 0), r, group: "driven" },
      { a: v(xr + D, -A / 2, 0), b: v(xr, -A / 2, 0), r, tag: "D", group: "reflector" },
      { a: v(xr, -A / 2, 0), b: v(xr, A / 2, 0), r, group: "reflector" },
      { a: v(xr, A / 2, 0), b: v(xr + D, A / 2, 0), r, group: "reflector" },
    ];
    const outOfRange = d / lam < 1e-5 || d / lam > 1e-2;
    return {
      wires,
      plates: [],
      feed: { wire: 1, at: "center" },
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "A", label: "Width (driver and reflector)", value: A },
        { key: "B", label: "Driver tail", value: B },
        { key: "C", label: "Gap between tips", value: C },
        { key: "D", label: "Reflector tail", value: D },
        { key: "E", label: "Depth (driver to reflector)", value: E },
        { label: "Driver wire, total", value: A + 2 * B },
        { label: "Reflector wire, total", value: A + 2 * D },
      ],
      tables: [],
      perf: [
        { label: "Gain (free space)", value: "≈ 5.8 dBi" },
        { label: "Front-to-back", value: "> 25 dB at the design frequency" },
        { label: "Feed impedance", value: "≈ 50 Ω, direct coax feed" },
        { label: "d/λ", value: `${fmt((d / lam) * 1e3, 3)}·10⁻³` },
      ],
      notes: [
        ...(outOfRange ? ["Warning: d/λ is outside the 1e-5 to 1e-2 range of the Cebik equations."] : []),
        "Dimensions after L. B. Cebik's Moxon regression (MoxGen). The gap C is critical: keep it within a few millimetres.",
        "Feed the centre of the driver with a 1:1 choke balun.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
