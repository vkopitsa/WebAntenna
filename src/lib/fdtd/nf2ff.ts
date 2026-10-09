// Near-field → far-field (equivalence principle) from the DFT of tangential E/H on the recording box.
//   J = n̂ × H, M = −n̂ × E,  N = ∮ J e^{jk r̂·r'} dA, L = ∮ M e^{jk r̂·r'} dA
//   U = k² / (32 π² η) (|L_φ + η N_θ|² + |L_θ − η N_φ|²)
import type { NfData, RunResult } from "./cpu";
import { C0, ETA0 } from "./setup";

type V3 = [number, number, number];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

export interface FarField {
  /** Radiation intensity U(θ, φ) in W/sr for the run's excitation spectrum. */
  U: (theta: number, phi: number) => number;
  prad: number;
}

export function farField(nf: NfData, fi: number): FarField {
  const f = nf.freqs[fi], k = (2 * Math.PI * f) / C0;
  // Flatten all face points: position, area, J and M (complex, 3D).
  const P: number[] = [], A: number[] = [], J: number[] = [], M: number[] = [];
  for (const fc of nf.faces) {
    const [u, v] = [0, 1, 2].filter((a) => a !== fc.axis);
    const n: V3 = [0, 0, 0]; n[fc.axis] = fc.sign;
    const D = fc.data[fi];
    for (let p = 0; p < fc.pu.length; p++) {
      const pos: V3 = [0, 0, 0]; pos[fc.axis] = fc.plane; pos[u] = fc.pu[p]; pos[v] = fc.pv[p];
      const o = 8 * p;
      const Er: V3 = [0, 0, 0], Ei: V3 = [0, 0, 0], Hr: V3 = [0, 0, 0], Hi: V3 = [0, 0, 0];
      Er[u] = D[o]; Ei[u] = D[o + 1]; Er[v] = D[o + 2]; Ei[v] = D[o + 3];
      Hr[u] = D[o + 4]; Hi[u] = D[o + 5]; Hr[v] = D[o + 6]; Hi[v] = D[o + 7];
      const Jr = cross(n, Hr), Ji = cross(n, Hi), Mr = cross(n, Er).map((x) => -x), Mi = cross(n, Ei).map((x) => -x);
      P.push(...pos); A.push(fc.area[p]); J.push(...Jr, ...Ji); M.push(...Mr, ...Mi);
    }
  }
  const np = A.length;
  const U = (th: number, ph: number) => {
    const st = Math.sin(th), ct = Math.cos(th), sp = Math.sin(ph), cp = Math.cos(ph);
    const r: V3 = [st * cp, st * sp, ct], tH: V3 = [ct * cp, ct * sp, -st], pH: V3 = [-sp, cp, 0];
    let Ntr = 0, Nti = 0, Npr = 0, Npi = 0, Ltr = 0, Lti = 0, Lpr = 0, Lpi = 0;
    for (let p = 0; p < np; p++) {
      const ph0 = k * (r[0] * P[3 * p] + r[1] * P[3 * p + 1] + r[2] * P[3 * p + 2]);
      const c = Math.cos(ph0) * A[p], s = Math.sin(ph0) * A[p];
      const j = 6 * p;
      // e^{jφ}(Jr + jJi) = (Jr c − Ji s) + j(Jr s + Ji c)
      const jt_r = tH[0] * J[j] + tH[1] * J[j + 1] + tH[2] * J[j + 2], jt_i = tH[0] * J[j + 3] + tH[1] * J[j + 4] + tH[2] * J[j + 5];
      const jp_r = pH[0] * J[j] + pH[1] * J[j + 1], jp_i = pH[0] * J[j + 3] + pH[1] * J[j + 4];
      const mt_r = tH[0] * M[j] + tH[1] * M[j + 1] + tH[2] * M[j + 2], mt_i = tH[0] * M[j + 3] + tH[1] * M[j + 4] + tH[2] * M[j + 5];
      const mp_r = pH[0] * M[j] + pH[1] * M[j + 1], mp_i = pH[0] * M[j + 3] + pH[1] * M[j + 4];
      Ntr += jt_r * c - jt_i * s; Nti += jt_r * s + jt_i * c;
      Npr += jp_r * c - jp_i * s; Npi += jp_r * s + jp_i * c;
      Ltr += mt_r * c - mt_i * s; Lti += mt_r * s + mt_i * c;
      Lpr += mp_r * c - mp_i * s; Lpi += mp_r * s + mp_i * c;
    }
    const a_r = Lpr + ETA0 * Ntr, a_i = Lpi + ETA0 * Nti, b_r = Ltr - ETA0 * Npr, b_i = Lti - ETA0 * Npi;
    return ((k * k) / (32 * Math.PI * Math.PI * ETA0)) * (a_r * a_r + a_i * a_i + b_r * b_r + b_i * b_i);
  };
  // Radiated power: integrate U over the sphere (5° grid, midpoint rule).
  let prad = 0;
  const d = (5 * Math.PI) / 180;
  for (let t = d / 2; t < Math.PI; t += d) for (let p = d / 2; p < 2 * Math.PI; p += d) prad += U(t, p) * Math.sin(t) * d * d;
  return { U, prad };
}

/** Accepted port power at f with the same DFT normalisation as the near-field data (Σ x(t) e^{−jωt} Δt). */
export function acceptedPower(r: RunResult, f: number): number {
  const w = 2 * Math.PI * f;
  let vr = 0, vi = 0, ir = 0, ii = 0;
  for (let n = 0; n < r.steps; n++) {
    const tv = (n + 1) * r.dt, ti = (n + 0.5) * r.dt;
    vr += r.v[n] * Math.cos(w * tv) * r.dt; vi -= r.v[n] * Math.sin(w * tv) * r.dt;
    ir += r.i[n] * Math.cos(w * ti) * r.dt; ii -= r.i[n] * Math.sin(w * ti) * r.dt;
  }
  return 0.5 * (vr * ir + vi * ii);
}
