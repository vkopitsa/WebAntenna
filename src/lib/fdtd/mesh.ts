// Graded rectilinear FDTD mesh for a PCB model (openEMS-style): fixed lines at copper edges with the
// "thirds" rule (1/3 of the edge resolution inside the metal, 2/3 outside), port and substrate lines,
// then smoothing so no cell exceeds the max size and neighbours differ by at most a ratio of 1.4.
import { copperPlanes, minCopperFeature, polyBox, slabs, stackBox, stackZ, type Pcb } from "../pcb";

const C0 = 299792458;

export interface FdtdMesh { x: Float64Array; y: Float64Array; z: Float64Array }

/** Merge lines closer than tol; "keep" lines (port terminals, board, copper planes) always survive exactly. */
function uniq(keep: number[], v: number[], tol: number): number[] {
  const out = [...new Set(keep.map((x) => +x.toPrecision(12)))].sort((a, b) => a - b);
  const near = (x: number) => out.some((y) => Math.abs(x - y) < tol);
  for (const x of [...v].sort((a, b) => a - b)) if (!near(x)) { out.push(x); out.sort((a, b) => a - b); }
  return out;
}

/**
 * Graded fill between fixed lines. Target cell size grows linearly away from every fixed line
 * (cells placed evenly in ∫dx/h with h = s_i + ln(r)·distance grow geometrically by exactly r), capped at maxCell; each gap gets the
 * number of cells that ∫dx/h(x) asks for, placed evenly in that measure.
 */
export function smooth(fixed: number[], maxCell: number, ratio = 1.4): number[] {
  // seeds = the smallest real cell next to each fixed line; a short gap that itself gets split
  // shrinks its seeds, so iterate until the seeds stop changing (2–3 passes)
  let s = fixed.map((x, i) => Math.min(maxCell, i > 0 ? x - fixed[i - 1] : Infinity, i < fixed.length - 1 ? fixed[i + 1] - x : Infinity));
  let out = fill(fixed, s, maxCell, ratio);
  for (let it = 0; it < 4; it++) {
    const idx = fixed.map((f) => out.indexOf(f));
    const s2 = idx.map((k, i) => Math.min(s[i], k > 0 ? out[k] - out[k - 1] : Infinity, k < out.length - 1 ? out[k + 1] - out[k] : Infinity));
    if (s2.every((v, i) => v >= s[i] * 0.999)) break;
    s = s2;
    out = fill(fixed, s, maxCell, ratio);
  }
  return out;
}

function fill(F: number[], s: number[], maxCell: number, ratio: number): number[] {
  const h = (x: number) => {
    let m = maxCell;
    for (let i = 0; i < F.length; i++) m = Math.min(m, s[i] + Math.log(ratio) * Math.abs(x - F[i]));
    return m;
  };
  const out: number[] = [F[0]];
  for (let g = 0; g < F.length - 1; g++) {
    const a = F[g], b = F[g + 1];
    if (b - a <= h((a + b) / 2) * 1.0001) { out.push(b); continue; }
    // cumulative t(x) = ∫ dx / h on a fine sub-grid
    const M = 400, xs: number[] = [a], ts: number[] = [0];
    for (let q = 1; q <= M; q++) {
      const x0 = a + ((b - a) * (q - 1)) / M, x1 = a + ((b - a) * q) / M;
      xs.push(x1); ts.push(ts[q - 1] + (x1 - x0) / h((x0 + x1) / 2));
    }
    const n = Math.max(1, Math.ceil(ts[M] - 1e-9));
    let q = 0;
    for (let c = 1; c < n; c++) {
      const target = (ts[M] * c) / n;
      while (ts[q + 1] < target) q++;
      const fr = (target - ts[q]) / (ts[q + 1] - ts[q]);
      out.push(xs[q] + fr * (xs[q + 1] - xs[q]));
    }
    out.push(b);
  }
  return out;
}

export interface MeshOptions { fmin: number; fmax: number; airFactor?: number }

export function buildMesh(p: Pcb, o: MeshOptions): FdtdMesh {
  const f0 = (o.fmin + o.fmax) / 2, fc = Math.max(((o.fmax - o.fmin) / 2) * 1.3, 0.25 * f0);
  const lamMin = C0 / (f0 + fc);
  const resAir = lamMin / 20;
  const resSub = lamMin / 20 / Math.sqrt(p.er);
  const minFeat = minCopperFeature(p);
  const edge = Math.min(resSub / 2, Math.max(minFeat / 3, p.h / 2));
  const air = C0 / Math.max(o.fmin, f0 - fc) / (o.airFactor ?? 2);
  const b = stackBox(p), [zlo, zhi] = stackZ(p);
  const X: number[] = [], Y: number[] = [], Z: number[] = [];
  const kx: number[] = [b.x0, b.x1, b.x0 - air, b.x1 + air], ky: number[] = [b.y0, b.y1, b.y0 - air, b.y1 + air];
  const kz: number[] = [zlo - air, zhi + air];
  for (const sl of slabs(p)) for (let i = 0; i <= 4; i++) kz.push(sl.z0 + ((sl.z1 - sl.z0) * i) / 4);
  for (const c of copperPlanes(p)) {
    kz.push(c.z);
    for (const q of c.rects) {
      // thirds rule: metal occupies [x0, x1]
      X.push(q.x0 + edge / 3, q.x0 - (2 * edge) / 3, q.x1 - edge / 3, q.x1 + (2 * edge) / 3);
      Y.push(q.y0 + edge / 3, q.y0 - (2 * edge) / 3, q.y1 - edge / 3, q.y1 + (2 * edge) / 3);
    }
    // polygons are staircased: a line at every vertex, and lines every minFeat/2 over their bounding box so a diagonal
    // strip stays a connected staircase (coarser cells break it into islands: a 90° V dipole then "resonated" 23 % high)
    for (const q of c.polys) {
      // curved shapes (w given) get the fill only: a line at each of their many vertices would make the mesh needlessly fine
      if (!q.w) for (const [x, y] of q.pts) { X.push(x); Y.push(y); }
      const bb = polyBox(q), st = minFeat / 2;
      // curved shapes fill on one common grid (multiples of minFeat/2), so overlapping shapes share their lines
      const g0 = (a: number) => (q.w ? Math.ceil(a / st) * st : a + st);
      for (let x = g0(bb.x0); x < bb.x1; x += st) X.push(x);
      for (let y = g0(bb.y0); y < bb.y1; y += st) Y.push(y);
    }
  }
  for (const q of p.pec ?? []) {
    // a solid conductor only needs its faces on lines (no thin-sheet edge singularity to resolve)
    X.push(q.x0, q.x1);
    Y.push(q.y0, q.y1);
    if (Number.isFinite(q.z1)) kz.push(q.z1);
    if (Number.isFinite(q.z0) && q.z0 > zlo - air) kz.push(q.z0);
  }
  const { start: s, stop: t } = p.port;
  kx.push(s[0], t[0]); ky.push(s[1], t[1]); kz.push(s[2], t[2]);
  const tol = edge / 4;
  const fixedSmooth = (k: number[], v: number[]) => smooth(uniq(k, v, tol), resAir);
  return { x: new Float64Array(fixedSmooth(kx, X)), y: new Float64Array(fixedSmooth(ky, Y)), z: new Float64Array(fixedSmooth(kz, Z)) };
}

export function excitation(fmin: number, fmax: number) {
  const f0 = (fmin + fmax) / 2, fc = Math.max(((fmax - fmin) / 2) * 1.3, 0.25 * f0);
  return { f0, fc };
}
