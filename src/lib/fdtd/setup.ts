// FDTD problem setup shared by the CPU reference and the WebGPU engine.
// Yee grid on mesh lines x[0..Nx-1] etc. Ex(i,j,k) is the edge (i→i+1, j, k); Hx(i,j,k) the face at x[i]
// spanning j..j+1, k..k+1 (and cyclic). All arrays are Nx·Ny·Nz, index = (k·Ny + j)·Nx + i.
import type { Pcb } from "../pcb";
import { buildMesh, excitation, type FdtdMesh } from "./mesh";

export const C0 = 299792458, MU0 = 4e-7 * Math.PI, EPS0 = 1 / (MU0 * C0 * C0), ETA0 = MU0 * C0;

export interface PortEdge { idx: number; comp: 0 | 1 | 2; len: number; area: number; series: number; par: number }
export interface Setup {
  mesh: FdtdMesh; nx: number; ny: number; nz: number; dt: number;
  /** E update coefficients per component: E = ca·E + cb·curlH (cb already includes 1/ε and Δt). */
  ca: [Float32Array, Float32Array, Float32Array];
  cb: [Float32Array, Float32Array, Float32Array];
  /** Inverse primary (d) and dual (dd) spacings per axis. */
  idx: Float32Array; idy: Float32Array; idz: Float32Array; iddx: Float32Array; iddy: Float32Array; iddz: Float32Array;
  port: { comp: 0 | 1 | 2; edges: PortEdge[]; R: number; nSeries: number; nPar: number; midSeries: number };
  exc: { f0: number; fc: number; t0: number; w: number };
  murK: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
  fmin: number; fmax: number;
}

export const id3 = (s: { nx: number; ny: number }, i: number, j: number, k: number) => (k * s.ny + j) * s.nx + i;

export function setup(p: Pcb, fmin: number, fmax: number): Setup {
  const mesh = buildMesh(p, { fmin, fmax });
  const { x, y, z } = mesh;
  const nx = x.length, ny = y.length, nz = z.length, N = nx * ny * nz;
  const d = (a: Float64Array) => Float64Array.from({ length: a.length - 1 }, (_, i) => a[i + 1] - a[i]);
  const dx = d(x), dy = d(y), dz = d(z);
  const dual = (dd: Float64Array, n: number) => Float64Array.from({ length: n }, (_, i) => ((dd[i - 1] ?? dd[i]) + (dd[i] ?? dd[i - 1])) / 2);
  const ddx = dual(dx, nx), ddy = dual(dy, ny), ddz = dual(dz, nz);
  const inv = (a: Float64Array) => Float32Array.from(a, (v) => 1 / v);
  const minD = (a: Float64Array) => Math.min(...a);
  const dt = 0.95 / (C0 * Math.sqrt(1 / minD(dx) ** 2 + 1 / minD(dy) ** 2 + 1 / minD(dz) ** 2));

  // Cell materials: substrate where the cell centre is inside the board box and 0 < z < h.
  const { f0, fc } = excitation(fmin, fmax);
  const sigSub = 2 * Math.PI * f0 * EPS0 * p.er * p.tanD;
  const b = p.board;
  const inSub = (i: number, j: number, k: number) => {
    if (i < 0 || j < 0 || k < 0 || i >= nx - 1 || j >= ny - 1 || k >= nz - 1) return false;
    const xc = (x[i] + x[i + 1]) / 2, yc = (y[j] + y[j + 1]) / 2, zc = (z[k] + z[k + 1]) / 2;
    return xc > b.x0 && xc < b.x1 && yc > b.y0 && yc < b.y1 && zc > 0 && zc < p.h;
  };
  const ca: Setup["ca"] = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  const cb: Setup["cb"] = [new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  // Average the 4 cells around each edge.
  const edgeMat = (comp: number, i: number, j: number, k: number) => {
    const cells: [number, number, number][] =
      comp === 0 ? [[i, j - 1, k - 1], [i, j, k - 1], [i, j - 1, k], [i, j, k]]
      : comp === 1 ? [[i - 1, j, k - 1], [i, j, k - 1], [i - 1, j, k], [i, j, k]]
      : [[i - 1, j - 1, k], [i, j - 1, k], [i - 1, j, k], [i, j, k]];
    let er = 0, sg = 0;
    for (const [a, bb, c] of cells) { const s = inSub(a, bb, c); er += s ? p.er : 1; sg += s ? sigSub : 0; }
    return [er / 4, sg / 4];
  };
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const n = (k * ny + j) * nx + i;
    for (let c = 0; c < 3; c++) {
      const [er, sg] = edgeMat(c, i, j, k);
      const eps = EPS0 * er, a = (sg * dt) / (2 * eps);
      ca[c][n] = (1 - a) / (1 + a);
      cb[c][n] = dt / eps / (1 + a);
    }
  }
  // PEC sheets: tangential edges in the copper plane whose midpoint lies inside the rectangle.
  const near = (v: number, t: number) => Math.abs(v - t) < 1e-9 + 1e-6 * Math.abs(t);
  for (const q of p.rects) {
    const zc = q.layer === "top" ? p.h : 0;
    const k = z.findIndex((v) => near(v, zc));
    if (k < 0) throw new Error("copper plane not on a mesh line");
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const n = (k * ny + j) * nx + i;
      if (i < nx - 1) { const xm = (x[i] + x[i + 1]) / 2; if (xm >= q.x0 && xm <= q.x1 && y[j] >= q.y0 - 1e-12 && y[j] <= q.y1 + 1e-12) { ca[0][n] = 0; cb[0][n] = 0; } }
      if (j < ny - 1) { const ym = (y[j] + y[j + 1]) / 2; if (ym >= q.y0 && ym <= q.y1 && x[i] >= q.x0 - 1e-12 && x[i] <= q.x1 + 1e-12) { ca[1][n] = 0; cb[1][n] = 0; } }
    }
  }
  // Lumped port: edges of the port component inside the port box.
  const comp = ({ x: 0, y: 1, z: 2 } as const)[p.port.dir];
  const lo = p.port.start.map((v, i) => Math.min(v, p.port.stop[i])), hi = p.port.start.map((v, i) => Math.max(v, p.port.stop[i]));
  const inR = (v: number, a: number, bb: number) => v >= a - 1e-9 && v <= bb + 1e-9;
  const axes = [x, y, z];
  const along = axes[comp];
  const seriesIdx: number[] = [];
  for (let s = 0; s < along.length - 1; s++) if (along[s] >= lo[comp] - 1e-9 && along[s + 1] <= hi[comp] + 1e-9) seriesIdx.push(s);
  const others = [0, 1, 2].filter((c) => c !== comp);
  const parLines = others.map((c) => Array.from(axes[c].keys()).filter((t) => inR(axes[c][t], lo[c], hi[c])));
  const nSeries = seriesIdx.length, nPar = parLines[0].length * parLines[1].length;
  if (!nSeries || !nPar) throw new Error("port has no mesh edges");
  const R = p.port.R;
  const edges: PortEdge[] = [];
  const dd = [ddx, ddy, ddz], dp = [dx, dy, dz];
  seriesIdx.forEach((s, si) => {
    for (const a of parLines[0]) for (const bb of parLines[1]) {
      const ijk = [0, 0, 0]; ijk[comp] = s; ijk[others[0]] = a; ijk[others[1]] = bb;
      edges.push({ idx: (ijk[2] * ny + ijk[1]) * nx + ijk[0], comp, len: dp[comp][s], area: dd[others[0]][a] * dd[others[1]][bb], series: si, par: 0 });
    }
  });
  // Port edges are never PEC (copper may touch them); lossless dielectric average.
  for (const e of edges) {
    const i = e.idx % nx, j = Math.floor(e.idx / nx) % ny, k = Math.floor(e.idx / (nx * ny));
    ca[comp][e.idx] = 1;
    cb[comp][e.idx] = dt / (EPS0 * edgeMat(comp, i, j, k)[0]);
  }
  const mur = (dd0: number) => (C0 * dt - dd0) / (C0 * dt + dd0);
  const w = (2 * Math.PI * fc) / 3;
  return {
    mesh, nx, ny, nz, dt, ca, cb,
    idx: inv(dx), idy: inv(dy), idz: inv(dz), iddx: inv(ddx), iddy: inv(ddy), iddz: inv(ddz),
    port: { comp, edges, R, nSeries, nPar, midSeries: Math.floor(nSeries / 2) },
    exc: { f0, fc, t0: 9 / (2 * Math.PI * fc), w },
    murK: { x0: mur(dx[0]), x1: mur(dx[nx - 2]), y0: mur(dy[0]), y1: mur(dy[ny - 2]), z0: mur(dz[0]), z1: mur(dz[nz - 2]) },
    fmin, fmax,
  };
}

/** Gaussian-modulated sine (openEMS style: 20 dB down at f0 ± fc). */
export const excite = (s: Setup, t: number) => {
  const u = t - s.exc.t0;
  return Math.cos(2 * Math.PI * s.exc.f0 * u) * Math.exp(-((u * s.exc.w) ** 2));
};
