import type { AntennaDef, Design, Wire } from "../types";
import { num, str } from "../types";
import { dB, deg, fmt, wavelength } from "../rf";
import { disc, v, wireGrid } from "../geom";
import { band, BANDS } from "./common";

/** Kraus axial-mode helix estimates. cl = C/λ, sl = S/λ. */
export function helixEstimates(cl: number, sl: number, n: number) {
  return {
    directivityDbi: dB(15 * cl * cl * n * sl),
    hpbwDeg: 52 / (cl * Math.sqrt(n * sl)),
    impedance: 140 * cl,
    axialRatio: (2 * n + 1) / (2 * n),
  };
}

export const helix: AntennaDef = {
  id: "helix",
  name: "Axial-mode helix",
  category: "Circular polarisation",
  traits: { pol: "circular", pattern: "beam" },
  multiband: "broadband",
  summary: "Kraus helix over a ground plane: circular polarisation, gain grows with turns.",
  params: [
    BANDS,
    { key: "turns", label: "Turns", kind: "int", min: 3, max: 40, step: 1 },
    { key: "cl", label: "Circumference (λ)", kind: "number", min: 0.75, max: 1.33, step: 0.01, hint: "Kraus: 0.75–1.33, best ≈ 1.0" },
    { key: "pitch", label: "Pitch angle", kind: "angle", min: 10, max: 16, step: 0.5, hint: "12–14° typical" },
    { key: "d", label: "Wire diameter", kind: "length", min: 0.1e-3, max: 0.05 },
    { key: "gp", label: "Ground plane diameter (λ)", kind: "number", min: 0.5, max: 2, step: 0.05 },
    { key: "hand", label: "Polarisation", kind: "select", options: [["rhcp", "RHCP (right hand)"], ["lhcp", "LHCP (left hand)"]] },
  ],
  defaults: { bands: "1574.42e6-1576.42e6", turns: 8, cl: 1, pitch: 13, d: 2e-3, gp: 0.8, hand: "rhcp" },
  build(p): Design {
    const { f, sweeps, bands } = band(p);
    const n = Math.max(1, Math.round(num(p, "turns", 8))), cl = num(p, "cl", 1), alpha = deg(num(p, "pitch", 13));
    const dIn = num(p, "d");
    const gpl = num(p, "gp", 0.8), hand = str(p, "hand", "rhcp") === "lhcp" ? -1 : 1;
    const lam = wavelength(f);
    const C = cl * lam, R = C / (2 * Math.PI), S = C * Math.tan(alpha);
    const d = Math.min(dIn, 0.8 * S), r = d / 2; // thicker wire would make the turns intersect
    const h0 = Math.max(0.02 * lam, 3 * d);
    const Lturn = Math.hypot(C, S);
    const gpR = (gpl * lam) / 2;

    const wires: Wire[] = [
      { a: v(0, 0, 0), b: v(0, 0, h0), r, group: "feed" },
      { a: v(0, 0, h0), b: v(R, 0, h0), r, group: "driven" },
    ];
    const seg = 16;
    let prev = v(R, 0, h0);
    for (let i = 1; i <= n * seg; i++) {
      const t = (2 * Math.PI * i) / seg;
      const pt = v(R * Math.cos(t), hand * R * Math.sin(t), h0 + (S * i) / seg);
      wires.push({ a: prev, b: pt, r, group: "driven", tag: i === Math.round(seg / 2) ? "H" : undefined });
      prev = pt;
    }
    // NEC: square wire grid with a node at the centre (feed point); CAD/drawing: copper disc.
    const m = 2 * Math.max(2, Math.ceil(gpR / (0.1 * lam)));
    const grid = wireGrid(v(-gpR, -gpR, 0), v(2 * gpR, 0, 0), v(0, 2 * gpR, 0), m, m, r);
    const e = helixEstimates(cl, Math.tan(alpha) * cl, n);
    // Axial mode holds for 0.75 < C/λ < 1.33 (Kraus): check every band edge.
    const fLo = Math.min(...bands.map((b) => b[0])), fHi = Math.max(...bands.map((b) => b[1]));
    const clLo = C / wavelength(fLo), clHi = C / wavelength(fHi);
    const outOfMode = clLo < 0.75 || clHi > 1.33;
    return {
      wires: [...wires, ...grid],
      plates: [{ pts: disc(0, 0, 0, gpR), thickness: Math.max(0.5e-3, 0.002 * lam), material: "metal", label: "Ground plane" }],
      feed: { wire: 0, at: "start" },
      feedZ0: 140 * cl,
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "D", label: "Helix diameter (wire centre)", value: 2 * R, at: [v(-R, 0, h0 + S / 2), v(R, 0, h0 + S / 2)] },
        { label: "Circumference", value: C },
        { key: "S", label: "Turn spacing (pitch)", value: S, at: [wires[1].b, wires[1 + seg].b] },
        { label: "Helix length (axial)", value: n * S, at: [wires[1].b, wires[1 + n * seg].b] },
        { label: "Wire per turn", value: Lturn },
        ...(d < dIn ? [{ label: "Wire diameter used (reduced to fit the pitch)", value: d }] : []),
        { label: "Total wire length", value: n * Lturn },
        { label: "Height of the first turn above the ground plane", value: h0, at: [wires[0].a, wires[0].b] },
        { label: "Ground plane diameter", value: 2 * gpR, at: [v(-gpR, 0, 0), v(gpR, 0, 0)] },
      ],
      tables: [],
      perf: [
        { label: "Directivity (Kraus, optimistic)", value: `≈ ${fmt(e.directivityDbi, 1)} dBi` },
        { label: "Beamwidth (−3 dB)", value: `≈ ${fmt(e.hpbwDeg, 0)}°` },
        { label: "Feed impedance (match to 50 Ω)", value: `≈ ${fmt(e.impedance, 0)} Ω` },
        { label: "C/λ across the bands", value: `${fmt(clLo, 2)}–${fmt(clHi, 2)} (0.75–1.33)` },
        { label: "Axial ratio", value: `${fmt(e.axialRatio, 3)} (${fmt(20 * Math.log10(e.axialRatio), 2)} dB)` },
      ],
      notes: [
        ...(d < dIn ? ["Warning: the wire is thicker than the turn spacing allows; the diameter was reduced to 80 % of the pitch."] : []),
        ...(outOfMode ? ["Warning: some bands fall outside the axial-mode range 0.75 < C/λ < 1.33."] : []),
        "The Kraus directivity formula is optimistic by 3–4 dB: NEC-2 gives ≈ 11 dBi for the default 8-turn design.",
        "Match the ≈140 Ω feed to 50 Ω with a tapered first quarter turn or a copper strip close to the ground plane.",
        "In the NEC model the ground plane is a wire grid and the feed rises from its centre.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
