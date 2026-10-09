// Thin-wire Method of Moments (MININEC formulation: current pulses between segment midpoints,
// charge pulses on segments, point matching, reduced kernel). No DOM: runs in a Web Worker and in Node tests.
//
//   Σn Zmn In = Vm,   Zmn = jωμ/4π Σ(t∈m,s∈n) (Δl_t·ŝ_s) ψ(mid_t; s)
//                          + 1/(j4πωε) [Q(b_m; seg_b_n) − Q(b_m; seg_a_n) − Q(a_m; seg_b_n) + Q(a_m; seg_a_n)]
//
// ψ(r; s) = ∫_s e^{−jkR}/R dl', R = √(|r−r'|² + a²);  Q(r; seg) = ψ(r; seg)/L_seg.
// Unknown n is the current on the path a_n (mid of a segment) → node → b_n (mid of the next segment).
import type { Design, Vec3 } from "./types";
import { add, dist, len, scale, sub } from "./geom";

const C0 = 299792458;
const MU0 = 4e-7 * Math.PI;
const EPS0 = 1 / (MU0 * C0 * C0);
const ETA0 = MU0 * C0;

interface Seg { p: Vec3; q: Vec3; mid: Vec3; L: number; r: number }
/** Half-segment oriented along the current path. */
interface Half { from: Vec3; to: Vec3; seg: number }
interface Unknown { h1: Half; h2: Half }

export interface Mesh {
  segs: Seg[];
  unknowns: Unknown[];
  /** Unknowns that carry the source (all get V = 1; input current = their sum). */
  source: number[];
}

/** Gauss–Legendre nodes/weights on [0, 1]. */
const GL8 = (() => {
  const x = [-0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498, 0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363];
  const w = [0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620, 0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763];
  return { x: x.map((v) => (v + 1) / 2), w: w.map((v) => v / 2) };
})();
const GL4 = (() => {
  const x = [-0.8611363115940526, -0.3399810435848563, 0.3399810435848563, 0.8611363115940526];
  const w = [0.3478548451374538, 0.6521451548625461, 0.6521451548625461, 0.3478548451374538];
  return { x: x.map((v) => (v + 1) / 2), w: w.map((v) => v / 2) };
})();

/**
 * ψ = ∫ from p to q of e^{−jkR}/R, R = √(|r−r'|² + a²). The static 1/R part is integrated
 * analytically (asinh), the smooth remainder (e^{−jkR} − 1)/R by Gauss–Legendre.
 */
export function psi(r: Vec3, p: Vec3, q: Vec3, a: number, k: number): [number, number] {
  const d = sub(q, p);
  const L = len(d);
  if (L === 0) return [0, 0];
  const u = scale(d, 1 / L);
  const w = sub(r, p);
  const s0 = w[0] * u[0] + w[1] * u[1] + w[2] * u[2];
  const perp2 = Math.max(0, w[0] * w[0] + w[1] * w[1] + w[2] * w[2] - s0 * s0);
  const rho = Math.sqrt(perp2 + a * a);
  let re = Math.asinh((L - s0) / rho) - Math.asinh(-s0 / rho);
  let im = 0;
  const far = perp2 + Math.min(s0 * s0, (s0 - L) * (s0 - L)) > 9 * L * L;
  const g = far ? GL4 : GL8;
  for (let i = 0; i < g.x.length; i++) {
    const s = g.x[i] * L;
    const R = Math.sqrt(rho * rho + (s - s0) * (s - s0));
    const kr = k * R;
    // (e^{−jkR} − 1)/R, with a series near R → 0
    let fr: number, fi: number;
    if (kr < 1e-3) { fr = -k * kr / 2; fi = -k; }
    else { fr = (Math.cos(kr) - 1) / R; fi = -Math.sin(kr) / R; }
    re += g.w[i] * L * fr;
    im += g.w[i] * L * fi;
  }
  return [re, im];
}

const keyOf = (p: Vec3, tol: number) => p.map((c) => Math.round(c / tol)).join(",");

/**
 * Mesh the design's NEC wires at the given wavelength. Segments ≈ λ/perLambda, capped so the
 * number of unknowns stays below maxUnknowns. The feed wire gets an even count for a centre node.
 */
export function buildMesh(design: Design, lambda: number, perLambda = 20, maxUnknowns = 700): Mesh | null {
  if (!design.necSupported || !design.feed) return null;
  const wires = design.wires.map((w, i) => ({ w, i })).filter(({ w }) => !w.drawOnly && dist(w.a, w.b) > 1e-9);
  const total = wires.reduce((s, { w }) => s + dist(w.a, w.b), 0);
  let segLen = lambda / perLambda;
  if (total / segLen > maxUnknowns) segLen = total / maxUnknowns;
  const scaleLen = Math.max(...wires.map(({ w }) => Math.max(...w.a.map(Math.abs), ...w.b.map(Math.abs))), lambda * 1e-3);
  const tol = scaleLen * 1e-7;

  const segs: Seg[] = [];
  const unknowns: Unknown[] = [];
  /** Per node key: the wire ends meeting there. */
  const ends = new Map<string, { seg: number; atStart: boolean; wire: number }[]>();
  let source: number[] = [];
  const feed = design.feed;

  for (const { w, i } of wires) {
    const L = dist(w.a, w.b);
    const isFeed = feed.wire === i;
    let n = Math.max(1, Math.round(L / segLen));
    if (isFeed && feed.at === "center") n = Math.max(2, n + (n % 2));
    const first = segs.length;
    for (let k = 0; k < n; k++) {
      const p = add(w.a, scale(sub(w.b, w.a), k / n));
      const q = add(w.a, scale(sub(w.b, w.a), (k + 1) / n));
      segs.push({ p, q, mid: scale(add(p, q), 0.5), L: L / n, r: w.r });
    }
    // Interior nodes of this wire.
    for (let k = 1; k < n; k++) {
      const s1 = segs[first + k - 1], s2 = segs[first + k];
      unknowns.push({ h1: { from: s1.mid, to: s1.q, seg: first + k - 1 }, h2: { from: s2.p, to: s2.mid, seg: first + k } });
      if (isFeed && feed.at === "center" && k === n / 2) source = [unknowns.length - 1];
    }
    for (const [atStart, seg] of [[true, first], [false, first + n - 1]] as const) {
      const key = keyOf(atStart ? w.a : w.b, tol);
      if (!ends.has(key)) ends.set(key, []);
      ends.get(key)!.push({ seg, atStart, wire: i });
    }
  }
  // Junctions: k wire ends at one node → k−1 unknowns, all paths starting on a reference end.
  for (const list of ends.values()) {
    if (list.length < 2) continue;
    const refIdx = Math.max(0, list.findIndex((e) => e.wire === feed.wire));
    const ref = list[refIdx];
    const rs = segs[ref.seg];
    // Into the node along the reference segment.
    const h1: Half = ref.atStart ? { from: rs.mid, to: rs.p, seg: ref.seg } : { from: rs.mid, to: rs.q, seg: ref.seg };
    const isFeedNode = feed.at !== "center" && ref.wire === feed.wire && ref.atStart === (feed.at === "start");
    list.forEach((e, j) => {
      if (j === refIdx) return;
      const s = segs[e.seg];
      const h2: Half = e.atStart ? { from: s.p, to: s.mid, seg: e.seg } : { from: s.q, to: s.mid, seg: e.seg };
      unknowns.push({ h1, h2 });
      if (isFeedNode) source.push(unknowns.length - 1);
    });
  }
  if (!source.length || !unknowns.length) return null;
  return { segs, unknowns, source };
}

/** Complex LU solve (partial pivoting), in place. A is n×n row-major [re, im] arrays. */
function luSolve(n: number, ar: Float64Array, ai: Float64Array, br: Float64Array, bi: Float64Array): boolean {
  for (let k = 0; k < n; k++) {
    let p = k, best = 0;
    for (let i = k; i < n; i++) {
      const m = ar[i * n + k] ** 2 + ai[i * n + k] ** 2;
      if (m > best) { best = m; p = i; }
    }
    if (best === 0) return false;
    if (p !== k) {
      for (let j = 0; j < n; j++) {
        const a = k * n + j, b = p * n + j;
        [ar[a], ar[b]] = [ar[b], ar[a]];
        [ai[a], ai[b]] = [ai[b], ai[a]];
      }
      [br[k], br[p]] = [br[p], br[k]];
      [bi[k], bi[p]] = [bi[p], bi[k]];
    }
    const pr = ar[k * n + k], pi = ai[k * n + k], pd = pr * pr + pi * pi;
    for (let i = k + 1; i < n; i++) {
      const xr = ar[i * n + k], xi = ai[i * n + k];
      if (xr === 0 && xi === 0) continue;
      const fr = (xr * pr + xi * pi) / pd, fi = (xi * pr - xr * pi) / pd;
      for (let j = k + 1; j < n; j++) {
        const yr = ar[k * n + j], yi = ai[k * n + j];
        ar[i * n + j] -= fr * yr - fi * yi;
        ai[i * n + j] -= fr * yi + fi * yr;
      }
      br[i] -= fr * br[k] - fi * bi[k];
      bi[i] -= fr * bi[k] + fi * br[k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    let sr = br[i], si = bi[i];
    for (let j = i + 1; j < n; j++) {
      const yr = ar[i * n + j], yi = ai[i * n + j];
      sr -= yr * br[j] - yi * bi[j];
      si -= yr * bi[j] + yi * br[j];
    }
    const pr = ar[i * n + i], pi = ai[i * n + i], pd = pr * pr + pi * pi;
    br[i] = (sr * pr + si * pi) / pd;
    bi[i] = (si * pr - sr * pi) / pd;
  }
  return true;
}

export interface Solution {
  f: number;
  /** Input impedance [R, X] in ohms. */
  z: [number, number];
  /** Path currents (A for a 1 V source). */
  ir: Float64Array;
  ii: Float64Array;
  mesh: Mesh;
}

export function solve(mesh: Mesh, f: number): Solution | null {
  const { segs, unknowns, source } = mesh;
  const n = unknowns.length;
  const k = (2 * Math.PI * f) / C0, w = 2 * Math.PI * f;
  const ar = new Float64Array(n * n), ai = new Float64Array(n * n);
  const cA = (w * MU0) / (4 * Math.PI); // multiplies j·ψ
  const cP = 1 / (4 * Math.PI * w * EPS0); // multiplies −j·Q

  // Q(r; seg) cache for the path end points (segment midpoints) against every segment.
  const ns = segs.length;
  const qr = new Float64Array(ns * ns), qi = new Float64Array(ns * ns);
  for (let i = 0; i < ns; i++)
    for (let j = 0; j < ns; j++) {
      const s = segs[j];
      const [re, im] = psi(segs[i].mid, s.p, s.q, s.r, k);
      qr[i * ns + j] = re / s.L;
      qi[i * ns + j] = im / s.L;
    }
  const halves = (u: Unknown) => [u.h1, u.h2];
  for (let m = 0; m < n; m++) {
    const um = unknowns[m];
    const am = um.h1.seg, bm = um.h2.seg; // test end points are the midpoints of these segments
    const tm = halves(um).map((h) => ({ dl: sub(h.to, h.from), mid: scale(add(h.from, h.to), 0.5) }));
    for (let nn = 0; nn < n; nn++) {
      const un = unknowns[nn];
      let zr = 0, zi = 0;
      // Vector potential: jωμ/4π Σ (Δl_t·ŝ_s) ψ
      for (const t of tm) {
        for (const h of halves(un)) {
          const dl = sub(h.to, h.from);
          const L = len(dl);
          if (L === 0) continue;
          const dot = (t.dl[0] * dl[0] + t.dl[1] * dl[1] + t.dl[2] * dl[2]) / L;
          if (dot === 0) continue;
          const [pr, pi] = psi(t.mid, h.from, h.to, segs[h.seg].r, k);
          zr += -cA * dot * pi;
          zi += cA * dot * pr;
        }
      }
      // Scalar potential: 1/(j4πωε) [Q(b; bn) − Q(b; an) − Q(a; bn) + Q(a; an)]
      const an = un.h1.seg, bn = un.h2.seg;
      const sr = qr[bm * ns + bn] - qr[bm * ns + an] - qr[am * ns + bn] + qr[am * ns + an];
      const si = qi[bm * ns + bn] - qi[bm * ns + an] - qi[am * ns + bn] + qi[am * ns + an];
      // (sr + j si) / j = si − j sr
      zr += cP * si;
      zi += -cP * sr;
      ar[m * n + nn] = zr;
      ai[m * n + nn] = zi;
    }
  }
  const br = new Float64Array(n), bi = new Float64Array(n);
  for (const s of source) br[s] = 1;
  if (!luSolve(n, ar, ai, br, bi)) return null;
  let Ir = 0, Ii = 0;
  for (const s of source) { Ir += br[s]; Ii += bi[s]; }
  const d = Ir * Ir + Ii * Ii;
  return { f, z: [Ir / d, -Ii / d], ir: br, ii: bi, mesh };
}

/**
 * Far-field power gain (dBi, total of both polarisations) in direction (θ, φ) from the solved currents.
 * Gain = 4πU / Pin, with Pin = ½ Re(V I*) for the 1 V source (lossless wires).
 */
export function gainFn(sol: Solution): (theta: number, phi: number) => number {
  const { mesh, ir, ii, f } = sol;
  const k = (2 * Math.PI * f) / C0;
  const w = 2 * Math.PI * f;
  // Each unknown's two halves: current element ∫ŝ dl with its midpoint.
  const el: { dl: Vec3; mid: Vec3; cr: number; ci: number }[] = [];
  mesh.unknowns.forEach((u, i) => {
    for (const h of [u.h1, u.h2]) el.push({ dl: sub(h.to, h.from), mid: scale(add(h.from, h.to), 0.5), cr: ir[i], ci: ii[i] });
  });
  const zr = sol.z[0], zi = sol.z[1];
  // I_in = 1/Z → Pin = ½ Re(1/Z*) = ½ R/|Z|²
  const pin = 0.5 * zr / (zr * zr + zi * zi);
  const kU = ((w * MU0) ** 2) / (32 * Math.PI * Math.PI * ETA0);
  return (theta, phi) => {
    const st = Math.sin(theta), ct = Math.cos(theta), sp = Math.sin(phi), cp = Math.cos(phi);
    const rh: Vec3 = [st * cp, st * sp, ct];
    const th: Vec3 = [ct * cp, ct * sp, -st];
    const ph: Vec3 = [-sp, cp, 0];
    let ftr = 0, fti = 0, fpr = 0, fpi = 0;
    for (const e of el) {
      const arg = k * (rh[0] * e.mid[0] + rh[1] * e.mid[1] + rh[2] * e.mid[2]);
      const c = Math.cos(arg), s = Math.sin(arg);
      const jr = e.cr * c - e.ci * s, ji = e.cr * s + e.ci * c;
      const dt = th[0] * e.dl[0] + th[1] * e.dl[1] + th[2] * e.dl[2];
      const dp = ph[0] * e.dl[0] + ph[1] * e.dl[1];
      ftr += jr * dt; fti += ji * dt; fpr += jr * dp; fpi += ji * dp;
    }
    const U = kU * (ftr * ftr + fti * fti + fpr * fpr + fpi * fpi);
    const g = (4 * Math.PI * U) / pin;
    return 10 * Math.log10(Math.max(g, 1e-12));
  };
}
