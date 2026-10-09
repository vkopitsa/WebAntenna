import type { AntennaDef, Design, Wire } from "../types";
import { num } from "../types";
import { wavelength } from "../rf";
import { rect, v, wireGrid } from "../geom";
import { band, BANDS, DIAM } from "./common";

export const biquad: AntennaDef = {
  id: "biquad",
  name: "Biquad with reflector",
  category: "Directional",
  traits: { pol: "vertical", pattern: "beam" },
  summary: "Two λ/4-sided squares in front of a flat reflector. Popular for 2.4 and 5.8 GHz.",
  params: [
    BANDS, DIAM,
    { key: "sp", label: "Element to reflector spacing (λ)", kind: "number", min: 0.08, max: 0.25, step: 0.005 },
    { key: "refl", label: "Reflector size (λ)", kind: "number", min: 0.6, max: 1.5, step: 0.05 },
  ],
  defaults: { bands: "2.4e9-2.4835e9", d: 1.5e-3, sp: 0.122, refl: 1 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const d = num(p, "d"), sp = num(p, "sp", 0.122), rl = num(p, "refl", 1);
    const lam = wavelength(f), r = d / 2;
    const a = 0.25 * lam; // side of each square
    const h = a / Math.SQRT2; // half diagonal
    const g = Math.max(2 * d, 0.02 * lam); // feed gap at the centre
    const x = sp * lam;
    const U = v(x, 0, g / 2), Lo = v(x, 0, -g / 2);
    const diamond = (s: number): Wire[] => {
      const top = v(x, s * h, h), out = v(x, s * 2 * h, 0), bot = v(x, s * h, -h);
      return [
        { a: U, b: top, r, group: "driven", tag: s < 0 ? "a" : undefined },
        { a: top, b: out, r, group: "driven" },
        { a: out, b: bot, r, group: "driven" },
        { a: bot, b: Lo, r, group: "driven" },
      ];
    };
    const R = (rl * lam) / 2;
    const wires: Wire[] = [{ a: Lo, b: U, r, group: "feed" }, ...diamond(-1), ...diamond(1)];
    const m = Math.max(4, 2 * Math.ceil(R / (0.1 * lam)));
    const grid = wireGrid(v(0, -R, -R), v(0, 2 * R, 0), v(0, 0, 2 * R), m, m, r);
    return {
      wires: [...wires, ...grid],
      plates: [{ pts: rect(v(0, 0, 0), v(0, R, 0), v(0, 0, R)), thickness: 1e-3, material: "metal", label: "Reflector" }],
      feed: { wire: 0, at: "center" },
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "a", label: "Side of each square", value: a },
        { label: "Square diagonal", value: 2 * h },
        { label: "Overall width (tip to tip)", value: 4 * h },
        { label: "Feed gap at the centre", value: g },
        { label: "Element to reflector spacing", value: x },
        { label: "Reflector side", value: 2 * R },
        { label: "Total wire length", value: 8 * a },
      ],
      tables: [],
      perf: [
        { label: "Gain", value: "≈ 10–11 dBi" },
        { label: "Beamwidth (−3 dB)", value: "≈ 50–70°" },
        { label: "Feed impedance", value: "≈ 50 Ω" },
        { label: "Polarisation", value: "Vertical (squares side by side)" },
      ],
      notes: [
        "Centre conductor to one pair of inner corners; braid to the other pair and to the reflector.",
        "Typical build: 1.5–2.5 mm copper wire, side length measured centre to centre of the wire.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
