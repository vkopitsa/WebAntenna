import type { AntennaDef, Cell, Design, Wire } from "../types";
import { num } from "../types";
import { dB, fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS } from "./common";

export const collinear: AntennaDef = {
  id: "collinear",
  name: "Coaxial collinear (COCO)",
  category: "Vertical",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "Stacked λ/2 coax sections with crossed centre/braid joints, λ/4 whip on top. Omni gain.",
  params: [
    BANDS,
    { key: "n", label: "Number of λ/2 sections", kind: "int", min: 2, max: 16, step: 1 },
    { key: "vf", label: "Coax velocity factor", kind: "number", min: 0.5, max: 1, step: 0.01, hint: "Solid PE 0.66, foam 0.80–0.85" },
    { key: "od", label: "Coax outer diameter", kind: "length", min: 1e-3, max: 0.03 },
    { key: "rid", label: "Radome inner diameter", kind: "length", min: 8e-3, max: 60e-3, hint: "For the printed spacers" },
  ],
  defaults: { bands: "863e6-870e6", n: 8, vf: 0.66, od: 5e-3, rid: 20e-3 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const n = Math.round(num(p, "n", 8)), vf = num(p, "vf", 0.66), od = num(p, "od", 5e-3);
    const lam = wavelength(f), r = od / 2;
    const sec = 0.5 * lam * vf;
    const whip = 0.25 * lam * 0.95;
    const wires: Wire[] = [];
    const rows: Cell[][] = [];
    for (let i = 0; i < n; i++) {
      wires.push({ a: v(0, 0, i * sec), b: v(0, 0, (i + 1) * sec - Math.min(1e-3, sec * 0.02)), r, group: i % 2 ? "parasitic" : "driven", tag: `S${i + 1}` });
      rows.push([`S${i + 1}`, i * sec, sec]);
    }
    wires.push({ a: v(0, 0, n * sec), b: v(0, 0, n * sec + whip), r: Math.min(r, 1e-3), group: "line", tag: "W" });
    rows.push(["W", n * sec, whip]);
    return {
      wires,
      plates: [],
      dims: [
        { label: "Wavelength λ", value: lam },
        { label: "Section length (λ/2 × VF), cut braid to braid", value: sec, at: [v(0, 0, 0), v(0, 0, sec)], tags: rows.slice(0, n).map((r) => r[0] as string) },
        { label: "Top whip (λ/4)", value: whip, at: [wires[n].a, wires[n].b], tags: ["W"] },
        { label: "Overall length", value: n * sec + whip, at: [v(0, 0, 0), wires[n].b] },
      ],
      tables: [{
        title: "Sections",
        columns: [{ label: "Section", kind: "text" }, { label: "Starts at", kind: "len" }, { label: "Length", kind: "len" }],
        rows,
      }],
      perf: [
        { label: "Ideal gain (upper bound)", value: `≈ ${fmt(2.15 + dB(n), 1)} dBi` },
        { label: "Feed impedance", value: "≈ 50–100 Ω (needs a choke)" },
        { label: "Polarisation", value: "Vertical" },
      ],
      notes: [
        "Real COCO antennas are typically 2–4 dB below the ideal figure, more with many sections.",
        "Measure the velocity factor of your coax: the section length depends on it directly.",
        "No NEC export: a wire model cannot represent the currents inside the coax.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
