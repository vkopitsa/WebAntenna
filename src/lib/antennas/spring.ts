import type { AntennaDef, Design, Vec3, Wire } from "../types";
import { num } from "../types";
import { fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS } from "./common";

/** Pieces per turn in the model (the MoM fit below used the same polygon). */
export const SPRING_SEG = 8;

const SD = [0.15, 0.25, 0.4, 0.6, 1.0];
const DS = [0.3, 0.5, 0.75];
const TURNS = [4, 6, 10, 16, 25, 40];
/**
 * First resonance of a normal-mode helix (coil diameter D at the wire centre, pitch S, wire d, straight lead D)
 * over four horizontal λ/4 radials, from the built-in MoM (docs/ANTENNAS.md): D/λ at resonance and R there (Ω),
 * by pitch S/D (rows), wire d/S (sub-rows) and turns (columns, TURNS).
 */
const SPRING_FIT: Record<number, Record<number, [number, number][]>> = {
  0.15: {
    0.3: [[0.02377, 2.12], [0.0173, 1.63], [0.01174, 1.2], [0.00825, 0.93], [0.00587, 0.76], [0.00406, 0.66]],
    0.5: [[0.0237, 2.27], [0.01737, 1.72], [0.01187, 1.25], [0.00837, 0.96], [0.00597, 0.79], [0.00414, 0.68]],
    0.75: [[0.02357, 2.41], [0.01741, 1.81], [0.01198, 1.3], [0.00848, 1.0], [0.00607, 0.81], [0.00422, 0.7]],
  },
  0.25: {
    0.3: [[0.02608, 2.8], [0.01921, 2.25], [0.01308, 1.8], [0.00913, 1.54], [0.00643, 1.4], [0.00441, 1.34]],
    0.5: [[0.02649, 3.06], [0.01963, 2.45], [0.01344, 1.93], [0.00941, 1.65], [0.00665, 1.5], [0.00456, 1.43]],
    0.75: [[0.02681, 3.33], [0.02, 2.64], [0.01377, 2.07], [0.00968, 1.76], [0.00685, 1.6], [0.00471, 1.52]],
  },
  0.4: {
    0.3: [[0.02808, 4.13], [0.02076, 3.58], [0.01407, 3.14], [0.00973, 2.93], [0.00678, 2.86], [0.00459, 2.88]],
    0.5: [[0.02911, 4.65], [0.02163, 4.01], [0.01473, 3.51], [0.01022, 3.26], [0.00714, 3.18], [0.00484, 3.2]],
    0.75: [[0.03006, 5.22], [0.02246, 4.48], [0.01537, 3.89], [0.01069, 3.62], [0.00749, 3.52], [0.00508, 3.54]],
  },
  0.6: {
    0.3: [[0.02912, 6.14], [0.02148, 5.68], [0.01441, 5.36], [0.00985, 5.27], [0.00679, 5.34], [0.00454, 5.51]],
    0.5: [[0.03071, 7.1], [0.02276, 6.56], [0.01535, 6.18], [0.01052, 6.07], [0.00726, 6.13], [0.00485, 6.32]],
    0.75: [[0.03225, 8.17], [0.02401, 7.52], [0.01626, 7.06], [0.01117, 6.93], [0.00772, 6.98], [0.00517, 7.18]],
  },
  1.0: {
    0.3: [[0.0284, 10.2], [0.02069, 10.03], [0.01361, 10.03], [0.00912, 10.21], [0.00616, 10.48], [0.00404, 10.84]],
    0.5: [[0.03031, 12.05], [0.02214, 11.77], [0.0146, 11.74], [0.00979, 11.91], [0.00662, 12.18], [0.00433, 12.53]],
    0.75: [[0.03245, 15.59], [0.02355, 13.8], [0.01555, 13.62], [0.01042, 13.67], [0.00703, 13.9], [0.0046, 14.22]],
  },
};

/** Index and weight of x in a sorted grid (clamped at the ends). */
function cell(grid: number[], x: number): [number, number] {
  if (x <= grid[0]) return [0, 0];
  for (let i = 0; i < grid.length - 1; i++) if (x <= grid[i + 1]) return [i, (x - grid[i]) / (grid[i + 1] - grid[i])];
  return [grid.length - 2, 1];
}

/** Resonant turns (and R there) for coil D/λ, pitch S/D and wire d/S: log–log in turns, bilinear in S/D and d/S. */
export function springTurns(dl: number, sd: number, ds: number): { n: number; R: number } {
  const [i, u] = cell(SD, sd), [j, w] = cell(DS, ds);
  const one = (a: number, b: number) => {
    const row = SPRING_FIT[SD[a]][DS[b]], x = Math.log(dl);
    const lx = row.map((q) => Math.log(q[0])); // decreasing with turns
    let k = 0;
    while (k < row.length - 2 && x < lx[k + 1]) k++;
    const t = (x - lx[k]) / (lx[k + 1] - lx[k]);
    const n = Math.exp(Math.log(TURNS[k]) + t * (Math.log(TURNS[k + 1]) - Math.log(TURNS[k])));
    const R = row[k][1] + Math.max(0, Math.min(1, t)) * (row[k + 1][1] - row[k][1]);
    return { n, R };
  };
  const mix = (a: { n: number; R: number }, b: { n: number; R: number }, s: number) => ({ n: a.n + s * (b.n - a.n), R: a.R + s * (b.R - a.R) });
  return mix(mix(one(i, j), one(i, j + 1), w), mix(one(i + 1, j), one(i + 1, j + 1), w), u);
}

export const spring: AntennaDef = {
  id: "spring",
  name: "Spring (normal-mode helix)",
  category: "Vertical",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "Tightly wound coil a fraction of λ/4 tall: the compact 315/433/868 MHz module antenna, resonated by its number of turns.",
  params: [
    BANDS,
    { key: "D", label: "Coil diameter (wire centre)", kind: "length", min: 1e-3, max: 0.1 },
    { key: "pitch", label: "Turn spacing (pitch)", kind: "length", min: 0.2e-3, max: 0.05 },
    { key: "d", label: "Wire diameter", kind: "length", min: 0.1e-3, max: 5e-3 },
    { key: "lead", label: "Straight lead (feed to the first turn)", kind: "length", min: 0, max: 0.05 },
  ],
  defaults: { bands: "433.05e6-434.79e6", D: 4.5e-3, pitch: 1.2e-3, d: 0.8e-3, lead: 5e-3 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const D = num(p, "D", 4.5e-3), d = Math.min(num(p, "d", 0.8e-3), 0.9 * num(p, "pitch", 1.2e-3));
    const S = Math.max(num(p, "pitch", 1.2e-3), d / 0.9), lead = Math.max(0, num(p, "lead", 5e-3));
    const lam = wavelength(f), r = d / 2, R = D / 2;
    const fit = springTurns(D / lam, S / D, d / S);
    const N = Math.max(1, fit.n);
    const pieces = Math.max(SPRING_SEG, Math.round(N * SPRING_SEG));
    const wires: Wire[] = [];
    if (lead > 1e-6) wires.push({ a: v(0, 0, 0), b: v(0, 0, lead), r, group: "driven" });
    let prev: Vec3 = v(0, 0, lead);
    for (let i = 1; i <= pieces; i++) {
      const t = (2 * Math.PI * i) / SPRING_SEG;
      const pt = v(-R + R * Math.cos(t), R * Math.sin(t), lead + (S * i) / SPRING_SEG);
      wires.push({ a: prev, b: pt, r, group: "driven", tag: i === Math.round(pieces / 2) ? "H" : undefined });
      prev = pt;
    }
    const rad = 0.25 * lam;
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 + Math.PI / 4;
      wires.push({ a: v(0, 0, 0), b: v(rad * Math.cos(a), rad * Math.sin(a), 0), r: Math.max(r, 0.5e-3), group: "ground", tag: k === 0 ? "B" : undefined });
    }
    const turns = pieces / SPRING_SEG, H = turns * S;
    const wire = turns * Math.hypot(Math.PI * D, S);
    return {
      wires,
      plates: [],
      feed: { wire: 0, at: "start" },
      feedZ0: 50,
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "H", label: "Coil length (axial)", value: H },
        { label: "Coil diameter (wire centre)", value: D },
        { label: "Turn spacing (pitch)", value: S },
        { label: "Straight lead", value: lead },
        { label: "Wire in the coil", value: wire },
        { label: "Overall height", value: lead + H },
        { key: "B", label: "Each radial (counterpoise)", value: rad },
      ],
      tables: [{
        title: "Coil",
        columns: [{ label: "Turns", kind: "text" }, { label: "Height / λ", kind: "text" }, { label: "Wire / λ", kind: "text" }],
        rows: [[fmt(turns, 2), fmt((lead + H) / lam, 3), fmt(wire / lam, 3)]],
      }],
      perf: [
        { label: "Radiation resistance (MoM)", value: `≈ ${fmt(fit.R, 1)} Ω` },
        { label: "Gain", value: "≈ 0 dBi with a full counterpoise, less with conductor loss" },
        { label: "Polarisation", value: "Vertical" },
        { label: "Bandwidth", value: "Narrow: a few MHz at 433 MHz" },
      ],
      notes: [
        "The radiation resistance is only a few ohms: the feed needs a matching network (an L-match or a tap on the first turn) for 50 Ω, and copper loss eats a large share of the power.",
        "The model stands the coil over four λ/4 radials. On a module the board's ground pour is the counterpoise: a smaller one raises the resonance, so stretch or compress the coil to tune.",
        "Stretching the coil (more pitch) raises the resonance and the radiation resistance; adding turns lowers it.",
      ],
      necSupported: true,
      f, sweeps,
    };
  },
};
