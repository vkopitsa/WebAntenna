import type { AntennaDef, Design, Wire } from "../types";
import { num } from "../types";
import { deg, endEffect, fmt, interp, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS, DIAM } from "./common";

export const groundplane: AntennaDef = {
  id: "groundplane",
  name: "Quarter-wave ground plane",
  category: "Vertical",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "λ/4 vertical radiator over sloping radials.",
  params: [
    BANDS, DIAM,
    { key: "radials", label: "Number of radials", kind: "int", min: 2, max: 8, step: 1 },
    { key: "droop", label: "Radial droop", kind: "angle", min: 0, max: 60, step: 5, hint: "≈45° gives ≈50 Ω" },
  ],
  defaults: { bands: "144e6-146e6", d: 2e-3, radials: 4, droop: 45 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const d = num(p, "d"), n = Math.round(num(p, "radials", 4)), droopDeg = num(p, "droop", 45);
    const lam = wavelength(f), k = endEffect(lam, d), r = d / 2;
    const vert = 0.25 * lam * k * 0.97; // NEC-tuned: X ≈ 0 with 5 % longer radials at 45°
    const rad = vert * 1.05;
    const dr = deg(droopDeg);
    const wires: Wire[] = [{ a: v(0, 0, 0), b: v(0, 0, vert), r, tag: "A", group: "driven" }];
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n + Math.PI / 4;
      wires.push({ a: v(0, 0, 0), b: v(rad * Math.cos(dr) * Math.cos(t), rad * Math.cos(dr) * Math.sin(t), -rad * Math.sin(dr)), r, tag: i === 0 ? "B" : undefined, group: "ground" });
    }
    const z = interp([[0, 36], [30, 44], [45, 50], [60, 57]], droopDeg);
    return {
      wires,
      plates: [],
      feed: { wire: 0, at: "start" },
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "A", label: "Vertical radiator", value: vert, at: [wires[0].a, wires[0].b] },
        { key: "B", label: "Each radial", value: rad, at: [wires[1].a, wires[1].b] },
        { label: "Radial span (tip to tip, horizontal)", value: 2 * rad * Math.cos(dr), at: n % 2 ? undefined : [wires[1].b, wires[1 + n / 2].b] },
      ],
      tables: [],
      perf: [
        { label: "Shortening factor K", value: fmt(k, 3) },
        { label: "Gain (free space)", value: "≈ 1.5–2 dBi" },
        { label: "Feed impedance", value: `≈ ${fmt(z, 0)} Ω` },
        { label: "Polarisation", value: "Vertical" },
      ],
      notes: [
        "Radiator to the coax centre conductor, radials to the braid.",
        "Radials are 5 % longer than the radiator; trim the radiator to tune. Lengths were checked in NEC-2 (≈ 51 Ω at 45° droop).",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
