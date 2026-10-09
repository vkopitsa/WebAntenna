import type { AntennaDef, Design, Wire } from "../types";
import { num } from "../types";
import { endEffect, fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS, DIAM } from "./common";

export const jpole: AntennaDef = {
  id: "jpole",
  name: "J-pole",
  category: "Vertical",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "End-fed λ/2 radiator matched by a λ/4 shorted stub. No radials needed.",
  params: [BANDS, DIAM, { key: "sp", label: "Stub spacing (centre to centre)", kind: "length", min: 1e-3, max: 0.5 }],
  defaults: { bands: "144e6-146e6", d: 6e-3, sp: 25e-3 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const d = num(p, "d"), s = num(p, "sp", 25e-3);
    const lam = wavelength(f), k = endEffect(lam, d), r = d / 2;
    // Tuned on converged models (MoM λ/120 and NEC-2 λ/320, 2 m, Ø6 mm, 25 mm spacing → ≈ 45–48 − j7 Ω):
    // stub ≈ λ/4 physical, radiator λ/2 × K above it, tap 0.019 λ.
    const stub = 0.25 * lam * k * 1.04;
    const long = stub + 0.5 * lam * k;
    const tap = 0.019 * lam;
    const wires: Wire[] = [
      { a: v(0, 0, 0), b: v(s, 0, 0), r, tag: "D", group: "line" },
      { a: v(0, 0, 0), b: v(0, 0, tap), r, group: "driven" },
      { a: v(0, 0, tap), b: v(0, 0, long), r, tag: "A", group: "driven" },
      { a: v(s, 0, 0), b: v(s, 0, tap), r, group: "line" },
      { a: v(s, 0, tap), b: v(s, 0, stub), r, tag: "B", group: "line" },
      { a: v(0, 0, tap), b: v(s, 0, tap), r: r / 2, tag: "C", group: "feed" },
    ];
    return {
      wires,
      plates: [],
      feed: { wire: 5, at: "center" },
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "A", label: "Long element (radiator + stub section)", value: long },
        { key: "B", label: "Short stub", value: stub },
        { key: "C", label: "Feed tap height above the shorting bar", value: tap },
        { key: "D", label: "Spacing between elements", value: s },
        { label: "Radiating section (above the stub)", value: long - stub },
      ],
      tables: [],
      perf: [
        { label: "Shortening factor K", value: fmt(k, 3) },
        { label: "Gain (free space)", value: "≈ 1–2 dBi" },
        { label: "Feed impedance", value: "50 Ω (slide the tap)" },
        { label: "Polarisation", value: "Vertical" },
      ],
      notes: [
        "Slide the feed tap up or down for lowest SWR, then trim the long element for frequency.",
        "Add a choke (a few turns of coax) at the feed to keep current off the feedline.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
