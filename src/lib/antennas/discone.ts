import type { AntennaDef, Design, Wire } from "../types";
import { num } from "../types";
import { deg, fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS } from "./common";

export const discone: AntennaDef = {
  id: "discone",
  name: "Discone",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "Disc over a cone: about 10:1 bandwidth, vertical, omnidirectional. Built from rods.",
  multiband: "broadband",
  maxRatio: 8 / 1.25, // the cone is sized for fLow / 1.25; SWR ≲ 2 up to ≈ 8 × that (NEC-2)
  params: [
    { ...BANDS, label: "Frequency bands (all must fit in the range)" },
    { key: "d", label: "Rod diameter", kind: "length", min: 0.1e-3, max: 0.05 },
    { key: "rods", label: "Rods (disc and cone each)", kind: "int", min: 6, max: 32, step: 2 },
    { key: "half", label: "Cone half-angle", kind: "angle", min: 20, max: 45, step: 1, hint: "30° (60° apex) is standard" },
    { key: "mast", label: "Mast diameter", kind: "length", min: 10e-3, max: 50e-3, hint: "For the printed hub" },
  ],
  defaults: { bands: "100e6-800e6", d: 3e-3, rods: 16, half: 30, mast: 25e-3 },
  build(p): Design {
    const { bands, sweeps: perBand } = band(p);
    const fLow = Math.min(...bands.map((b) => b[0])), fHigh = Math.max(...bands.map((b) => b[1]));
    // NEC-2: SWR ≲ 2 from ≈ 1.25 × the λ/4 frequency upwards, so size the cone for fLow / 1.25.
    const f = fLow / 1.25;
    // one sweep over the whole range, plus each band's own when there are several (a narrow band can fall
    // between the wide sweep's points)
    const sweeps = [{ start: fLow * 0.9, stop: Math.max(fHigh * 1.05, fLow * 1.5), steps: 41 }, ...(bands.length > 1 ? perBand : [])];
    const d = num(p, "d"), n = Math.round(num(p, "rods", 16)), half = deg(num(p, "half", 30));
    const lam = wavelength(f), r = d / 2;
    const slant = 0.25 * lam;
    const baseR = slant * Math.sin(half), coneH = slant * Math.cos(half);
    const discD = 0.7 * slant;
    const g = Math.max(3 * d, 0.0025 * lam);
    const wires: Wire[] = [{ a: v(0, 0, 0), b: v(0, 0, g), r, group: "feed" }];
    for (let i = 0; i < n; i++) {
      const t = (2 * Math.PI * i) / n;
      wires.push({ a: v(0, 0, g), b: v((discD / 2) * Math.cos(t), (discD / 2) * Math.sin(t), g), r, group: "driven", tag: i === 0 ? "D" : undefined });
      wires.push({ a: v(0, 0, 0), b: v(baseR * Math.cos(t), baseR * Math.sin(t), -coneH), r, group: "ground", tag: i === 0 ? "L" : undefined });
    }
    return {
      wires,
      plates: [],
      feed: { wire: 0, at: "center" },
      dims: [
        { label: "Wavelength at the cut-off (λ/4) frequency", value: lam },
        { key: "L", label: "Cone rod length (slant)", value: slant, at: [wires[2].a, wires[2].b] },
        { label: "Cone base diameter", value: 2 * baseR, at: n % 2 ? undefined : [wires[2].b, wires[2 + n].b] },
        { label: "Cone height", value: coneH, at: [v(0, 0, 0), v(0, 0, -coneH)] },
        { key: "D", label: "Disc diameter (0.7 × λ/4)", value: discD, at: n % 2 ? undefined : [wires[1].b, wires[1 + n].b] },
        { label: "Each disc rod", value: discD / 2, at: [wires[1].a, wires[1].b] },
        { label: "Gap between disc and cone apex", value: g, at: [wires[0].a, wires[0].b] },
      ],
      tables: [],
      perf: [
        { label: "Usable range (NEC-2: SWR ≲ 2)", value: `≈ ${fmt(fLow / 1e6, 0)}–${fmt((8 * f) / 1e6, 0)}+ MHz` },
        { label: "Gain", value: "≈ 0–2 dBi" },
        { label: "Feed impedance", value: "≈ 50 Ω" },
        { label: "Polarisation", value: "Vertical" },
      ],
      notes: [
        "Disc to the coax centre conductor, cone to the braid; feed through the inside of the cone.",
        "More rods (16 or more) behave closer to solid surfaces at the top of the range.",
        "The cone is sized 20 % below your lowest frequency, because SWR rises quickly near the λ/4 frequency.",
        ...(fHigh > 8 * f ? ["Warning: the highest band is above about 8 × the cut-off; expect higher SWR there. Use more rods and a smaller gap."] : []),
        "Keep the disc-to-cone gap small; a large gap spoils the top of the range.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
