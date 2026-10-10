import type { AntennaDef, Design, Wire } from "../types";
import { num } from "../types";
import { wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS, DIAM } from "./common";

export const quad: AntennaDef = {
  id: "quad",
  name: "Cubical quad (2 elements)",
  category: "Directional",
  traits: { pol: "horizontal", pattern: "beam" },
  summary: "Full-wave square loops: a driven loop and a reflector loop.",
  params: [BANDS, DIAM, { key: "sp", label: "Element spacing (λ)", kind: "number", min: 0.08, max: 0.3, step: 0.01 },
    { key: "rod", label: "Spreader rod diameter", kind: "length", min: 3e-3, max: 25e-3, hint: "For the printed parts; 8.5 mm = 3/8\" fibreglass" },
    { key: "bd", label: "Boom diameter", kind: "length", min: 10e-3, max: 60e-3 }],
  defaults: { bands: "144e6-146e6", d: 2e-3, sp: 0.15, rod: 8.5e-3, bd: 25e-3 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const d = num(p, "d"), sp = num(p, "sp", 0.15);
    const lam = wavelength(f), r = d / 2;
    const Pd = 1.022 * lam, Pr = 1.047 * lam; // 1005/f and 1030/f ft (ARRL)
    const sd = Pd / 4, sr = Pr / 4, S = sp * lam;
    const loop = (x: number, s: number, group: Wire["group"], tag: string, split: boolean): Wire[] => {
      const h = s / 2;
      const pts = [v(x, -h, -h), v(x, h, -h), v(x, h, h), v(x, -h, h)];
      const w: Wire[] = [];
      if (split) {
        w.push({ a: v(x, -h, -h), b: v(x, h, -h), r, group: "driven", tag });
      } else w.push({ a: pts[0], b: pts[1], r, group, tag });
      w.push({ a: pts[1], b: pts[2], r, group }, { a: pts[2], b: pts[3], r, group }, { a: pts[3], b: pts[0], r, group });
      return w;
    };
    const wires = [...loop(S / 2, sd, "driven", "DE", true), ...loop(-S / 2, sr, "reflector", "R", false)];
    return {
      wires,
      plates: [],
      feed: { wire: 0, at: "center" },
      dims: [
        { label: "Wavelength λ", value: lam },
        { label: "Driven loop perimeter", value: Pd },
        { label: "Driven loop side", value: sd },
        { label: "Reflector loop perimeter", value: Pr },
        { label: "Reflector loop side", value: sr },
        { label: "Element spacing", value: S },
        { label: "Spreader length (centre to corner, driven)", value: sd / Math.SQRT2 },
        { label: "Spreader length (centre to corner, reflector)", value: sr / Math.SQRT2 },
      ],
      tables: [],
      perf: [
        { label: "Gain (free space)", value: "≈ 7.5 dBi" },
        { label: "Front-to-back", value: "≈ 15–20 dB" },
        { label: "Feed impedance", value: "≈ 50–60 Ω" },
        { label: "Polarisation", value: "Horizontal (fed at the bottom)" },
      ],
      notes: [
        "Loop perimeters from the classic 1005/f and 1030/f (feet, MHz) formulas.",
        "Feed at the middle of the bottom side with 50 Ω coax and a choke balun (≈ 52 Ω in NEC-2 at 0.15 λ spacing).",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
