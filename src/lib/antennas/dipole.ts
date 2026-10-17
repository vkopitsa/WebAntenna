import type { AntennaDef, Design, Vec3, Wire } from "../types";
import { num } from "../types";
import { deg, endEffect, fmt, interp, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS, DIAM } from "./common";

export const dipole: AntennaDef = {
  id: "dipole",
  name: "Half-wave dipole / inverted V",
  category: "Wire",
  traits: { pol: "horizontal", pattern: "bi" },
  summary: "Centre-fed λ/2 element. Droop the arms for an inverted V.",
  params: [BANDS, DIAM, { key: "droop", label: "Arm droop (0 = flat)", kind: "angle", min: 0, max: 60, step: 5 }],
  defaults: { bands: "144e6-146e6", d: 2e-3, droop: 0 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const d = num(p, "d"), droop = deg(num(p, "droop"));
    const lam = wavelength(f), k = endEffect(lam, d);
    const total = 0.5 * lam * k;
    // 4d for fat elements, but never more than a quarter of the element (a 0.2 m tube at UHF gave negative arms)
    const gap = Math.min(Math.max(4 * d, Math.min(0.015 * lam, 0.05)), total / 4);
    const arm = (total - gap) / 2;
    const r = d / 2;
    const ay = arm * Math.cos(droop), az = -arm * Math.sin(droop);
    const wires: Wire[] = [
      { a: v(0, -gap / 2, 0), b: v(0, gap / 2, 0), r, group: "feed" },
      { a: v(0, -gap / 2, 0), b: v(0, -gap / 2 - ay, az), r, tag: "A", group: "driven" },
      { a: v(0, gap / 2, 0), b: v(0, gap / 2 + ay, az), r, tag: "A", group: "driven" },
    ];
    const tipL = wires[1].b, tipR = wires[2].b;
    const droopDeg = num(p, "droop");
    const z = interp([[0, 73], [30, 62], [45, 52], [60, 42]], droopDeg);
    return {
      wires,
      plates: [],
      feed: { wire: 0, at: "center" },
      dims: [
        { label: "Wavelength λ", value: lam },
        { label: "Total length (tip to tip, along the wire)", value: total, at: droopDeg > 0 ? undefined : [tipL, tipR] },
        { key: "A", label: "Each arm", value: arm, at: [wires[2].a, tipR] },
        { label: "Centre gap at the feed", value: gap, at: [wires[0].a, wires[0].b] },
        ...(droopDeg > 0 ? [
          { label: "Span between tips", value: 2 * ay + gap, at: [tipL, tipR] as [Vec3, Vec3] },
          { label: "Tip drop below the apex", value: -az, at: [v(0, gap / 2 + ay, 0), tipR] as [Vec3, Vec3] },
        ] : []),
      ],
      tables: [],
      perf: [
        { label: "Shortening factor K", value: fmt(k, 3) },
        { label: "Gain (free space)", value: droopDeg > 0 ? "≈ 1.5–2.0 dBi" : "≈ 2.15 dBi" },
        { label: "Feed impedance", value: `≈ ${fmt(z, 0)} Ω` },
        { label: "Feed", value: "1:1 current balun" },
      ],
      notes: [
        "Cut slightly long and trim both arms equally to resonance.",
        "Drooping the arms lowers the feed impedance towards 50 Ω.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
