import type { AntennaDef, Cell, Design, Wire } from "../types";
import { num } from "../types";
import { deg, endEffect, wavelength } from "../rf";
import { v } from "../geom";
import { centre } from "../bands";
import { buildMesh, solve } from "../mom";
import { band, BANDS, DIAM } from "./common";

/**
 * Fan (parallel) dipole: one λ/2 dipole per band, all on one feed point, fanned apart vertically.
 * Each element is cut as a free dipole (0.5 λ K) for its band centre; interaction shifts the
 * resonances a little, so the model says which to trim. The NEC deck sweeps every band.
 */
/**
 * Tune each element's length factor (vs a free λ/2 dipole) so the antenna is resonant at every band centre.
 * Secant iteration on X(f_i) with the MoM solver; two Gauss–Seidel passes over the elements are enough
 * (converged-model fit: 40/20 m → 1.00 / 1.027, 7/21 MHz → 1.00 / 0.950).
 */
function tuneElements(geometry: (facs: number[]) => Wire[], fc: number[], lambda: (f: number) => number) {
  // Starting guess from the converged fit: shorter elements +3 %, except near 3× a longer one (−5 %).
  const facs: number[] = fc.map((f, i) => {
    if (i === 0) return 1;
    const near3 = fc.slice(0, i).some((g) => Math.abs(f / g / 3 - 1) < 0.08);
    return near3 ? 0.95 : 1.03;
  });
  const zAt = (i: number) => {
    const d: Design = { wires: geometry(facs), plates: [], dims: [], tables: [], perf: [], notes: [], necSupported: true, f: fc[i], sweeps: [], feed: { wire: 0, at: "center" } };
    const m = buildMesh(d, lambda(fc[i]), 30, 260);
    const s = m && solve(m, fc[i]);
    return s ? s.z : ([NaN, NaN] as [number, number]);
  };
  if (fc.length > 1) {
    for (let pass = 0; pass < 2; pass++) {
      if (pass > 0 && fc.every((_, i) => Math.abs(zAt(i)[1]) < 2)) break;
      for (let i = 0; i < fc.length; i++) {
        let a = facs[i], b = facs[i] * 1.005;
        facs[i] = a; let xa = zAt(i)[1];
        if (Math.abs(xa) < 0.5) continue;
        facs[i] = b; let xb = zAt(i)[1];
        for (let k = 0; k < 4 && Math.abs(xb) > 1 && xb !== xa && Number.isFinite(xb); k++) {
          const c = Math.min(1.15, Math.max(0.85, b - (xb * (b - a)) / (xb - xa)));
          a = b; xa = xb; b = c; facs[i] = c; xb = zAt(i)[1];
        }
        facs[i] = Number.isFinite(xb) ? b : 1;
      }
    }
  }
  return { facs, z: fc.map((_, i) => zAt(i)) };
}

export const fandipole: AntennaDef = {
  id: "fandipole",
  name: "Fan (parallel) dipole",
  category: "Wire",
  traits: { pol: "horizontal", pattern: "bi" },
  multiband: "per-band",
  summary: "One λ/2 dipole per band on a common feed. Add a band for each element.",
  params: [
    { ...BANDS, label: "Frequency bands (one element each)" },
    DIAM,
    { key: "fan", label: "Fan angle between elements", kind: "angle", min: 5, max: 45, step: 1, hint: "15–30° keeps interaction low" },
  ],
  defaults: { bands: "7e6-7.2e6;14e6-14.35e6;28e6-29.7e6", d: 2e-3, fan: 20 },
  build(p): Design {
    const { bands, sweeps } = band(p);
    const d = num(p, "d"), fan = deg(num(p, "fan", 20)), r = d / 2;
    const order = [...bands].sort((a, b) => centre(a) - centre(b)); // longest element first, lies flat
    const lamMin = wavelength(centre(order[order.length - 1]));
    const gap = Math.max(4 * d, Math.min(0.015 * lamMin, 0.05));
    const fc = order.map(centre);
    const free = fc.map((f) => 0.5 * wavelength(f) * endEffect(wavelength(f), d));
    const geometry = (facs: number[]): Wire[] => {
      const wires: Wire[] = [{ a: v(0, -gap / 2, 0), b: v(0, gap / 2, 0), r, group: "feed" }];
      facs.forEach((k, i) => {
        const arm = (free[i] * k - gap) / 2;
        const t = i === 0 ? 0 : (i % 2 ? -1 : 1) * Math.ceil(i / 2) * fan; // 0, −fan, +fan, −2fan, …
        for (const s of [-1, 1]) {
          wires.push({ a: v(0, (s * gap) / 2, 0), b: v(0, s * (gap / 2 + arm * Math.cos(t)), arm * Math.sin(t)), r, tag: `E${i + 1}`, group: i === 0 ? "driven" : "parasitic" });
        }
      });
      return wires;
    };
    const { facs, z } = tuneElements(geometry, fc, wavelength);
    const wires = geometry(facs);
    const rows: Cell[][] = fc.map((f, i) => [`E${i + 1}`, f, free[i] * facs[i], (free[i] * facs[i] - gap) / 2, `${((facs[i] - 1) * 100).toFixed(1)} %`]);
    const lowR = z.some(([R]) => R < 30);
    return {
      wires,
      plates: [],
      feed: { wire: 0, at: "center" },
      dims: [
        { label: "Centre gap at the feed", value: gap },
        { label: "Span of the longest element (tip to tip)", value: rows[0][2] as number },
      ],
      tables: [{
        title: "Elements",
        columns: [{ label: "Element", kind: "text" }, { label: "Centre", kind: "freq" }, { label: "Length", kind: "len" }, { label: "Each arm", kind: "len" }, { label: "vs free dipole", kind: "text" }],
        rows,
      }],
      perf: [
        { label: "Gain (free space)", value: "≈ 2 dBi per band" },
        { label: "Feed impedance at each band centre (MoM)", value: z.map(([R, X], i) => `E${i + 1}: ${R.toFixed(0)} ${X >= 0 ? "+" : "−"} j${Math.abs(X).toFixed(0)} Ω`).join(" · ") },
        { label: "Feed", value: "1:1 current balun" },
      ],
      notes: [
        "Element lengths are tuned with the built-in MoM solver so every band is resonant (X = 0) at its centre, with all elements in place.",
        "Real-world tuning: trim the longest element first, then each shorter one.",
        ...(lowR ? ["Warning: one band has a feed resistance below 30 Ω because of element interaction. Widen the fan angle or drop a band."] : []),
      ],
      necSupported: true,
      f: centre(order[0]),
      sweeps,
    };
  },
};
