// Near field of the MoM currents on a plane, for the Preview's radiation view. Each current element
// (a half-segment, the same basis gainFn integrates) is a short electric dipole I·dl with its full field:
//   E = η I dl e^{−jkr}/(4π) · [ r̂(r̂·p̂)(a + b) − p̂ b ],  a = 2/r² − 2j/(k r³),  b = jk/r + 1/r² − j/(k r³)
// (from Er = η I dl cosθ/(2πr²)(1 + 1/(jkr)) and Eθ = jηk I dl sinθ/(4πr)(1 + 1/(jkr) − 1/(kr)²), θ̂ sinθ = r̂(r̂·p̂) − p̂).
// Also the pure per-frame shading, so the UI only blits pixels.
import type { Design, Vec3 } from "./types";
import { buildMesh, currentElements, segCurrents, solve, type CurrentElement } from "./mom";
import { momEligible } from "./simulate";
import { C0, wavelength } from "./rf";

const ETA0 = 4e-7 * Math.PI * C0;

/** Pixel (i, j) centre = origin + u·(i+½)·w/nx + v·(j+½)·h/ny; u, v unit vectors (v points down the screen). r is measured from ref. */
export interface FieldPlane { origin: Vec3; u: Vec3; v: Vec3; w: number; h: number; nx: number; ny: number; ref: Vec3 }
/** e: 6 floats per pixel (ExR ExI EyR EyI EzR EzI, V/m for a 1 V source); r: distance from the plane's ref; d: to the nearest current element. */
export interface FieldGrid { nx: number; ny: number; e: Float32Array; r: Float32Array; d: Float32Array }
/** segs: 6 floats per MoM segment (p, q); ir/ii: segment midpoint currents along p → q. */
export interface RadiationField { f: number; grid: FieldGrid; segs: Float64Array; ir: Float64Array; ii: Float64Array }
export type RGB = [number, number, number];

/** Total E (complex, 3 components) at pt into out = [ExR, ExI, EyR, EyI, EzR, EzI]. */
export function fieldAt(els: CurrentElement[], k: number, pt: Vec3, out: Float64Array): void {
  out.fill(0);
  for (const el of els) {
    const L = Math.sqrt(el.dl[0] * el.dl[0] + el.dl[1] * el.dl[1] + el.dl[2] * el.dl[2]);
    if (L === 0) continue;
    const px = el.dl[0] / L, py = el.dl[1] / L, pz = el.dl[2] / L;
    let dx = pt[0] - el.mid[0], dy = pt[1] - el.mid[1], dz = pt[2] - el.mid[2];
    let r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const rmin = Math.max(el.r, L);
    if (r < rmin) {
      // Inside the element's own reach: evaluate at rmin, broadside if exactly on it (no singularity).
      if (r < 1e-12 * rmin) {
        const t = Math.abs(px) < 0.9 ? [1, 0, 0] : [0, 1, 0];
        dx = t[1] * pz - t[2] * py; dy = t[2] * px - t[0] * pz; dz = t[0] * py - t[1] * px;
        r = Math.sqrt(dx * dx + dy * dy + dz * dz);
      }
      const s = rmin / r;
      dx *= s; dy *= s; dz *= s; r = rmin;
    }
    const rx = dx / r, ry = dy / r, rz = dz / r, rp = rx * px + ry * py + rz * pz;
    const kr = k * r, r2 = r * r, r3 = r2 * r;
    const ar = 2 / r2, ai = -2 / (k * r3);
    const br = 1 / r2, bi = k / r - 1 / (k * r3);
    // C = η I L e^{−jkr} / 4π
    const m = (ETA0 * L) / (4 * Math.PI), c = Math.cos(kr), s = -Math.sin(kr);
    const Cr = m * (el.cr * c - el.ci * s), Ci = m * (el.cr * s + el.ci * c);
    // radial coefficient C·(a + b)·rp, axial coefficient −C·b
    const sr = (ar + br) * rp, si = (ai + bi) * rp;
    const Rr = Cr * sr - Ci * si, Ri = Cr * si + Ci * sr;
    const Pr = -(Cr * br - Ci * bi), Pi = -(Cr * bi + Ci * br);
    out[0] += Rr * rx + Pr * px; out[1] += Ri * rx + Pi * px;
    out[2] += Rr * ry + Pr * py; out[3] += Ri * ry + Pi * py;
    out[4] += Rr * rz + Pr * pz; out[5] += Ri * rz + Pi * pz;
  }
}

export function nearField(els: CurrentElement[], f: number, plane: FieldPlane): FieldGrid {
  const { origin: o, u, v, w, h, nx, ny, ref } = plane;
  const k = (2 * Math.PI * f) / C0;
  const e = new Float32Array(6 * nx * ny), rr = new Float32Array(nx * ny), dd = new Float32Array(nx * ny), out = new Float64Array(6);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = ((i + 0.5) * w) / nx, b = ((j + 0.5) * h) / ny;
      const pt: Vec3 = [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
      fieldAt(els, k, pt, out);
      const p = j * nx + i;
      e.set(out, 6 * p);
      rr[p] = Math.hypot(pt[0] - ref[0], pt[1] - ref[1], pt[2] - ref[2]);
      let dmin = Infinity;
      for (const el of els) { const x = pt[0] - el.mid[0], y = pt[1] - el.mid[1], z = pt[2] - el.mid[2]; dmin = Math.min(dmin, x * x + y * y + z * z); }
      dd[p] = Math.sqrt(dmin);
    }
  return { nx, ny, e, r: rr, d: dd };
}

/** Solve the design at d.f and sample its near field on the plane; null when the wire solver can't model it. */
export function solveField(defId: string, d: Design, plane: FieldPlane): RadiationField | null {
  return fieldSolver()(defId, d, plane);
}

type Solved = { els: CurrentElement[]; segs: Float64Array; ir: Float64Array; ii: Float64Array } | null;

/**
 * solveField that keeps the last MoM solution: a new view (plane) of the same design only re-samples the field.
 * `solves` counts the MoM solves.
 */
export function fieldSolver(): ((defId: string, d: Design, plane: FieldPlane) => RadiationField | null) & { solves: number } {
  let key = "", last: Solved = null;
  const run = (defId: string, d: Design, plane: FieldPlane): RadiationField | null => {
    const k = JSON.stringify([defId, d.f, d.feed, d.wires]);
    if (k !== key) {
      key = k;
      last = null;
      if (momEligible(defId, d)) {
        const m = buildMesh(d, wavelength(d.f), 60, 450);
        const s = m && solve(m, d.f);
        run.solves++;
        if (s) {
          const segs = new Float64Array(6 * s.mesh.segs.length);
          s.mesh.segs.forEach((g, i) => segs.set([...g.p, ...g.q], 6 * i));
          last = { els: currentElements(s), segs, ...segCurrents(s) };
        }
      }
    }
    if (!last) return null;
    // copies: the worker transfers these buffers away
    return { f: d.f, grid: nearField(last.els, d.f, plane), segs: last.segs.slice(), ir: last.ir.slice(), ii: last.ii.slice() };
  };
  run.solves = 0;
  return run;
}

/** Peak over φ of |Re(E e^{jφ})| at pixel p (handles elliptical polarisation). */
export function envelope(e: Float32Array, p: number): number {
  let a = 0, b = 0, c = 0;
  for (let q = 0; q < 3; q++) { const re = e[6 * p + 2 * q], im = e[6 * p + 2 * q + 1]; a += re * re; b += im * im; c += re * im; }
  return Math.sqrt((a + b) / 2 + Math.sqrt(((a - b) / 2) ** 2 + c * c));
}

/**
 * 99th percentile of envelope·r over the pixels at least minDist from every wire (the radiated field; the near
 * field next to the wires then saturates), or over every pixel when none is that far. 1 for an all-zero field.
 */
export function fieldScale(grid: FieldGrid, minDist: number): number {
  const n = grid.nx * grid.ny, all = new Float32Array(n), far: number[] = [];
  for (let p = 0; p < n; p++) { all[p] = envelope(grid.e, p) * grid.r[p]; if (grid.d[p] >= minDist) far.push(all[p]); }
  const v = far.length ? Float32Array.from(far) : all;
  v.sort();
  const s = v[Math.min(v.length - 1, Math.floor(0.99 * v.length))];
  return s > 0 && Number.isFinite(s) ? s : 1;
}

/** 256-entry RGBA ramp lo → mid → hi. */
export function rampLUT(lo: RGB, mid: RGB, hi: RGB): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    const [x, y, s] = t < 0.5 ? [lo, mid, t * 2] : [mid, hi, t * 2 - 1];
    for (let c = 0; c < 3; c++) lut[4 * i + c] = Math.round(x[c] + (y[c] - x[c]) * s);
    lut[4 * i + 3] = 255;
  }
  return lut;
}

/** > 1 keeps the background dark and the crests thin. */
const GAMMA = 2.5;

/** RGBA pixels for |Re(E e^{jφ})|·r / scale (phase null: the envelope), through the LUT. */
export function shade(grid: FieldGrid, phase: number | null, scale: number, lut: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const { e, r } = grid, n = grid.nx * grid.ny;
  const c = phase == null ? 0 : Math.cos(phase), s = phase == null ? 0 : Math.sin(phase);
  for (let p = 0; p < n; p++) {
    let m: number;
    if (phase == null) m = envelope(e, p);
    else {
      const x = e[6 * p] * c - e[6 * p + 1] * s, y = e[6 * p + 2] * c - e[6 * p + 3] * s, z = e[6 * p + 4] * c - e[6 * p + 5] * s;
      m = Math.sqrt(x * x + y * y + z * z);
    }
    const t = Math.min(1, (m * r[p]) / scale);
    const i = 4 * Math.round(255 * t ** GAMMA);
    out[4 * p] = lut[i]; out[4 * p + 1] = lut[i + 1]; out[4 * p + 2] = lut[i + 2]; out[4 * p + 3] = 255;
  }
}
