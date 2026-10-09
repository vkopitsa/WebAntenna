// CPU reference FDTD engine (Float32, like the GPU). Used for validation and as a fallback without WebGPU.
import { EPS0, excite, type Setup } from "./setup";

export interface RunResult {
  /** Port voltage at t = (n+1)Δt and current at t = (n+½)Δt. */
  v: Float64Array; i: Float64Array; steps: number; dt: number;
  /** Near-field DFT on the NF2FF box at the pattern frequencies (filled when requested). */
  nf?: NfData;
}
export interface NfData { freqs: number[]; faces: NfFace[] }
/** One face of the NF2FF box: tangential E and H DFTs on face-centre sample points. */
export interface NfFace {
  axis: 0 | 1 | 2; sign: 1 | -1; plane: number;
  /** Sample points (u, v positions) and areas. */
  pu: Float64Array; pv: Float64Array; area: Float64Array;
  /** Per frequency: [Eu, Ev, Hu, Hv] complex (re, im interleaved), length 8·npts. */
  data: Float64Array[];
}

export interface RunOptions {
  maxSteps?: number;
  /** Stop when the port energy has decayed this much (amplitude ratio). */
  endCriteria?: number;
  nf2ffFreqs?: number[];
  onProgress?: (step: number, decay: number) => void;
}

export function runCPU(s: Setup, o: RunOptions = {}): RunResult {
  const { nx, ny, nz, dt } = s;
  const N = nx * ny * nz, sx = 1, sy = nx, sz = nx * ny;
  const E = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const H = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const [Ex, Ey, Ez] = E, [Hx, Hy, Hz] = H;
  const [cax, cay, caz] = s.ca, [cbx, cby, cbz] = s.cb;
  const { idx, idy, idz, iddx, iddy, iddz } = s;
  const hk = dt / (4e-7 * Math.PI);
  const maxSteps = o.maxSteps ?? 200000;
  const endC = o.endCriteria ?? 1e-3;
  const V = new Float64Array(maxSteps), I = new Float64Array(maxSteps);
  const pe = s.port.edges, pc = s.port.comp, Ep = E[pc];
  const Re = (s.port.R * s.port.nPar) / s.port.nSeries;
  const old = new Float32Array(pe.length);
  // Mur: saved inner-neighbour values of boundary tangential components.
  const nf = o.nf2ffFreqs?.length ? makeNf(s, o.nf2ffFreqs) : null;
  const excLen = 2 * s.exc.t0;
  let peak = 0, steps = 0;
  const murPlanes = murSetup(s);

  for (let n = 0; n < maxSteps; n++) {
    // ---- H update (n+½)
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) {
      let m = (k * ny + j) * nx;
      for (let i = 0; i < nx; i++, m++) {
        if (j < ny - 1 && k < nz - 1) Hx[m] -= hk * ((Ez[m + sy] - Ez[m]) * idy[j] - (Ey[m + sz] - Ey[m]) * idz[k]);
        if (i < nx - 1 && k < nz - 1) Hy[m] -= hk * ((Ex[m + sz] - Ex[m]) * idz[k] - (Ez[m + sx] - Ez[m]) * idx[i]);
        if (i < nx - 1 && j < ny - 1) Hz[m] -= hk * ((Ey[m + sx] - Ey[m]) * idx[i] - (Ex[m + sy] - Ex[m]) * idy[j]);
      }
    }
    // ---- save Mur neighbours and port E
    for (const pl of murPlanes) { const A = pl.arr(E); for (let t = 0; t < pl.idx.length; t++) { pl.prevIn[t] = A[pl.inner[t]]; pl.prevB[t] = A[pl.idx[t]]; } }
    for (let t = 0; t < pe.length; t++) old[t] = Ep[pe[t].idx];
    // ---- E update (n+1)
    for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) {
      let m = (k * ny + j) * nx + 1;
      for (let i = 1; i < nx - 1; i++, m++) {
        Ex[m] = cax[m] * Ex[m] + cbx[m] * ((Hz[m] - Hz[m - sy]) * iddy[j] - (Hy[m] - Hy[m - sz]) * iddz[k]);
        Ey[m] = cay[m] * Ey[m] + cby[m] * ((Hx[m] - Hx[m - sz]) * iddz[k] - (Hz[m] - Hz[m - sx]) * iddx[i]);
        Ez[m] = caz[m] * Ez[m] + cbz[m] * ((Hy[m] - Hy[m - sx]) * iddx[i] - (Hx[m] - Hx[m - sy]) * iddy[j]);
      }
    }
    // i = 0 / j = 0 / k = 0 lines of the components that are interior there (Ex at i=0 etc.)
    edgeRows(s, E, H);
    // ---- lumped resistive source on the port edges
    const vs = excite(s, (n + 0.5) * dt) / s.port.nSeries;
    let vSum = 0, iSum = 0;
    for (let t = 0; t < pe.length; t++) {
      const e = pe[t];
      const eps = dt / s.cb[pc][e.idx]; // ε of the edge (cb = Δt/ε for port edges)
      const curl = (Ep[e.idx] - old[t]) / s.cb[pc][e.idx];
      const beta = (dt * e.len) / (2 * Re * eps * e.area);
      const e1 = ((1 - beta) * old[t] + (dt / eps) * curl - (dt / (Re * eps * e.area)) * vs) / (1 + beta);
      Ep[e.idx] = e1;
      vSum += -e1 * e.len;
      if (e.series === s.port.midSeries) iSum += (e.len * (e1 + old[t]) / 2 + vs) / Re;
    }
    V[n] = vSum / s.port.nPar;
    I[n] = iSum; // current into the antenna terminals (validated: dipole R = +72 Ω)
    // ---- Mur boundaries
    for (const pl of murPlanes) {
      const A = pl.arr(E);
      for (let t = 0; t < pl.idx.length; t++) A[pl.idx[t]] = pl.prevIn[t] + pl.k * (A[pl.inner[t]] - pl.prevB[t]);
    }
    if (nf) accumulateNf(s, nf, E, H, n);
    steps = n + 1;
    const a = Math.abs(V[n]) + Math.abs(I[n]) * s.port.R;
    peak = Math.max(peak, a);
    if (n % 500 === 0) {
      let recent = 0;
      for (let q = Math.max(0, n - 500); q <= n; q++) recent = Math.max(recent, Math.abs(V[q]) + Math.abs(I[q]) * s.port.R);
      o.onProgress?.(n, recent / (peak || 1));
      if ((n + 1) * dt > excLen && recent < endC * peak) break;
    }
  }
  return { v: V.slice(0, steps), i: I.slice(0, steps), steps, dt, nf: nf ? finishNf(nf) : undefined };
}

/** Edge components lying on index-0 lines that are still interior (e.g. Ex at j=0 is a boundary, but Ex at i=0 is not). */
function edgeRows(s: Setup, E: Float32Array[], H: Float32Array[]) {
  const { nx, ny, nz } = s;
  const [Ex, Ey, Ez] = E, [Hx, Hy, Hz] = H;
  const sx = 1, sy = nx, sz = nx * ny;
  // Ex at i = 0 (j, k interior)
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) {
    const m = (k * ny + j) * nx;
    Ex[m] = s.ca[0][m] * Ex[m] + s.cb[0][m] * ((Hz[m] - Hz[m - sy]) * s.iddy[j] - (Hy[m] - Hy[m - sz]) * s.iddz[k]);
  }
  // Ey at j = 0
  for (let k = 1; k < nz - 1; k++) for (let i = 1; i < nx - 1; i++) {
    const m = (k * ny) * nx + i;
    Ey[m] = s.ca[1][m] * Ey[m] + s.cb[1][m] * ((Hx[m] - Hx[m - sz]) * s.iddz[k] - (Hz[m] - Hz[m - sx]) * s.iddx[i]);
  }
  // Ez at k = 0
  for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const m = j * nx + i;
    Ez[m] = s.ca[2][m] * Ez[m] + s.cb[2][m] * ((Hy[m] - Hy[m - sx]) * s.iddx[i] - (Hx[m] - Hx[m - sy]) * s.iddy[j]);
  }
}

interface MurPlane { comp: 0 | 1 | 2; idx: Int32Array; inner: Int32Array; prevIn: Float32Array; prevB: Float32Array; k: number; arr: (E: Float32Array[]) => Float32Array }

/** First-order Mur on the 6 faces for the tangential E components. */
export function murSetup(s: Setup): MurPlane[] {
  const { nx, ny, nz } = s;
  const planes: MurPlane[] = [];
  const add = (comp: 0 | 1 | 2, axis: 0 | 1 | 2, side: 0 | 1) => {
    const n = [nx, ny, nz];
    const b = side === 0 ? 0 : n[axis] - 1, inn = side === 0 ? 1 : n[axis] - 2;
    const idx: number[] = [], inner: number[] = [];
    const [u, v] = [0, 1, 2].filter((a) => a !== axis);
    // tangential component comp lives on edges; its own axis runs to n-2
    for (let a = 0; a < n[u] - (comp === u ? 1 : 0); a++) for (let c = 0; c < n[v] - (comp === v ? 1 : 0); c++) {
      const ijk = [0, 0, 0]; ijk[axis] = b; ijk[u] = a; ijk[v] = c;
      const q = [...ijk]; q[axis] = inn;
      idx.push((ijk[2] * ny + ijk[1]) * nx + ijk[0]);
      inner.push((q[2] * ny + q[1]) * nx + q[0]);
    }
    const kk = axis === 0 ? (side ? s.murK.x1 : s.murK.x0) : axis === 1 ? (side ? s.murK.y1 : s.murK.y0) : (side ? s.murK.z1 : s.murK.z0);
    planes.push({ comp, idx: Int32Array.from(idx), inner: Int32Array.from(inner), prevIn: new Float32Array(idx.length), prevB: new Float32Array(idx.length), k: kk, arr: (E) => E[comp] });
  };
  for (const axis of [0, 1, 2] as const) for (const side of [0, 1] as const) for (const comp of [0, 1, 2] as const) if (comp !== axis) add(comp, axis, side);
  return planes;
}

/** Input impedance from the recorded port signals (with the half-step correction for the current). */
export function impedance(r: RunResult, freqs: number[]): { f: number; r: number; x: number }[] {
  const { v, i, dt, steps } = r;
  return freqs.map((f) => {
    const w = 2 * Math.PI * f;
    let vr = 0, vi = 0, ir = 0, ii = 0;
    for (let n = 0; n < steps; n++) {
      const tv = (n + 1) * dt, ti = (n + 0.5) * dt;
      vr += v[n] * Math.cos(w * tv); vi -= v[n] * Math.sin(w * tv);
      ir += i[n] * Math.cos(w * ti); ii -= i[n] * Math.sin(w * ti);
    }
    const d = ir * ir + ii * ii;
    return { f, r: (vr * ir + vi * ii) / d, x: (vi * ir - vr * ii) / d };
  });
}

// ---------------- NF2FF recording (DFT of tangential fields on a box) ----------------
export interface NfWork { freqs: number[]; faces: (NfFace & { sE: [number[], number[]]; sH: [number[], number[]] })[] }

export function makeNf(s: Setup, freqs: number[]): NfWork {
  const { nx, ny, nz } = s;
  const { x, y, z } = s.mesh;
  const off = 4; // cells inside the Mur boundary
  const lim = [[off, nx - 1 - off], [off, ny - 1 - off], [off, nz - 1 - off]];
  const axes = [x, y, z];
  const faces: NfWork["faces"] = [];
  for (const axis of [0, 1, 2] as const) for (const sign of [-1, 1] as const) {
    const plane = sign < 0 ? lim[axis][0] : lim[axis][1];
    const [u, v] = [0, 1, 2].filter((a) => a !== axis) as (0 | 1 | 2)[];
    const pu: number[] = [], pv: number[] = [], area: number[] = [];
    const sE: [number[], number[]] = [[], []], sH: [number[], number[]] = [[], []];
    for (let a = lim[u][0]; a < lim[u][1]; a++) for (let c = lim[v][0]; c < lim[v][1]; c++) {
      pu.push((axes[u][a] + axes[u][a + 1]) / 2); pv.push((axes[v][c] + axes[v][c + 1]) / 2);
      area.push((axes[u][a + 1] - axes[u][a]) * (axes[v][c + 1] - axes[v][c]));
      const ijk = [0, 0, 0]; ijk[axis] = plane; ijk[u] = a; ijk[v] = c;
      const id = (q: number[]) => (q[2] * ny + q[1]) * nx + q[0];
      // E_u at (u-centre a, v-line c) and (u-centre a, v-line c+1): average → face centre
      const q1 = [...ijk]; q1[v] = c + 1;
      sE[0].push(id(ijk), id(q1));
      const q2 = [...ijk]; q2[u] = a + 1;
      sE[1].push(id(ijk), id(q2));
      // H_u lives at (u-line, v-centre, axis-centre): average u-lines a, a+1 and axis cells plane-1, plane
      const h = (du: number, dax: number) => { const q = [...ijk]; q[u] = a + du; q[axis] = plane - 1 + dax; return id(q); };
      sH[0].push(h(0, 0), h(1, 0), h(0, 1), h(1, 1));
      const g = (dv: number, dax: number) => { const q = [...ijk]; q[v] = c + dv; q[axis] = plane - 1 + dax; return id(q); };
      sH[1].push(g(0, 0), g(1, 0), g(0, 1), g(1, 1));
    }
    faces.push({ axis, sign, plane: axes[axis][plane], pu: Float64Array.from(pu), pv: Float64Array.from(pv), area: Float64Array.from(area), data: freqs.map(() => new Float64Array(8 * pu.length)), sE, sH });
  }
  return { freqs, faces };
}

function accumulateNf(s: Setup, nf: NfWork, E: Float32Array[], H: Float32Array[], n: number) {
  const tE = (n + 1) * s.dt, tH = (n + 0.5) * s.dt;
  nf.freqs.forEach((f, fi) => {
    const w = 2 * Math.PI * f;
    const ceR = Math.cos(w * tE) * s.dt, ceI = -Math.sin(w * tE) * s.dt;
    const chR = Math.cos(w * tH) * s.dt, chI = -Math.sin(w * tH) * s.dt;
    for (const fc of nf.faces) {
      const [u, v] = [0, 1, 2].filter((a) => a !== fc.axis);
      const D = fc.data[fi];
      const m = fc.pu.length;
      for (let p = 0; p < m; p++) {
        const eu = 0.5 * (E[u][fc.sE[0][2 * p]] + E[u][fc.sE[0][2 * p + 1]]);
        const ev = 0.5 * (E[v][fc.sE[1][2 * p]] + E[v][fc.sE[1][2 * p + 1]]);
        const hu = 0.25 * (H[u][fc.sH[0][4 * p]] + H[u][fc.sH[0][4 * p + 1]] + H[u][fc.sH[0][4 * p + 2]] + H[u][fc.sH[0][4 * p + 3]]);
        const hv = 0.25 * (H[v][fc.sH[1][4 * p]] + H[v][fc.sH[1][4 * p + 1]] + H[v][fc.sH[1][4 * p + 2]] + H[v][fc.sH[1][4 * p + 3]]);
        const o = 8 * p;
        D[o] += eu * ceR; D[o + 1] += eu * ceI; D[o + 2] += ev * ceR; D[o + 3] += ev * ceI;
        D[o + 4] += hu * chR; D[o + 5] += hu * chI; D[o + 6] += hv * chR; D[o + 7] += hv * chI;
      }
    }
  });
}

export function finishNf(nf: NfWork): NfData {
  return { freqs: nf.freqs, faces: nf.faces.map(({ axis, sign, plane, pu, pv, area, data }) => ({ axis, sign, plane, pu, pv, area, data })) };
}

export { EPS0 };
