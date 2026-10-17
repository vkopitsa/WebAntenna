// WebGPU FDTD engine: the same algorithm and data layout as lib/fdtd/cpu.ts, in WGSL compute shaders.
import type { Setup } from "../lib/fdtd/setup";
import { excite } from "../lib/fdtd/setup";
import { makeNf, finishNf, murSetup, type RunOptions, type RunResult } from "../lib/fdtd/cpu";

const WG = 64;
const MAXG = 65535; // maxComputeWorkgroupsPerDimension default; larger counts fold into y

const SHADER = /* wgsl */ `
// 7 storage buffers (fits the WebGPU default of 8 per stage). Small arrays are packed:
//   ints:   portI (2/edge: E index, series) | murI (2/entry: idx, inner) | nfI (12/point)
//   floats: spacings (idx|idy|idz|iddx|iddy|iddz) | portF (3/edge: len, area, eps) | murK
//   work:   [0] step | V,I (2·maxSteps) | portOld | murPrev (2/entry) | nfD (8/point)
struct P { nx: u32, ny: u32, nz: u32, n: u32, hk: f32, dt: f32, f0: f32, t0: f32, w: f32, nSeries: f32, nPar: f32, R: f32,
  nPort: u32, mid: u32, nMur: u32, nNf: u32, wNf: f32, maxSteps: u32,
  oMurI: u32, oNfI: u32, oPortF: u32, oMurK: u32, oPortOld: u32, oMurPrev: u32, oNfD: u32, oExc: u32, oNfT: u32, pad2: u32 };
struct R { start: u32, count: u32 };
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var<storage, read_write> E: array<f32>;
@group(0) @binding(2) var<storage, read_write> H: array<f32>;
@group(0) @binding(3) var<storage, read> ca: array<f32>;
@group(0) @binding(4) var<storage, read> cb: array<f32>;
@group(0) @binding(5) var<storage, read> fl: array<f32>;
@group(0) @binding(6) var<storage, read> it: array<u32>;
@group(0) @binding(7) var<storage, read_write> wk: array<f32>;
@group(1) @binding(0) var<uniform> r: R; // mur only: index range of one plane

// 2D-folded dispatch (x capped at 65535 workgroups): linear thread index
fn lin(g: vec3u) -> u32 { return g.x + g.y * ${MAXG}u * ${WG}u; }

fn ox() -> u32 { return 0u; }
fn oy() -> u32 { return p.nx - 1u; }
fn oz() -> u32 { return p.nx - 1u + p.ny - 1u; }
fn odx() -> u32 { return p.nx - 1u + p.ny - 1u + p.nz - 1u; }
fn ody() -> u32 { return odx() + p.nx; }
fn odz() -> u32 { return ody() + p.ny; }

fn sp(o: u32) -> f32 { return fl[o]; }

@compute @workgroup_size(${WG})
fn updateH(@builtin(global_invocation_id) g: vec3u) {
  let m = lin(g); if (m >= p.n) { return; }
  let i = m % p.nx; let j = (m / p.nx) % p.ny; let k = m / (p.nx * p.ny);
  let sy = p.nx; let sz = p.nx * p.ny; let N = p.n;
  if (j < p.ny - 1u && k < p.nz - 1u) {
    H[m] -= p.hk * ((E[2u * N + m + sy] - E[2u * N + m]) * sp(oy() + j) - (E[N + m + sz] - E[N + m]) * sp(oz() + k));
  }
  if (i < p.nx - 1u && k < p.nz - 1u) {
    H[N + m] -= p.hk * ((E[m + sz] - E[m]) * sp(oz() + k) - (E[2u * N + m + 1u] - E[2u * N + m]) * sp(ox() + i));
  }
  if (i < p.nx - 1u && j < p.ny - 1u) {
    H[2u * N + m] -= p.hk * ((E[N + m + 1u] - E[N + m]) * sp(ox() + i) - (E[m + sy] - E[m]) * sp(oy() + j));
  }
}

@compute @workgroup_size(${WG})
fn saveOld(@builtin(global_invocation_id) g: vec3u) {
  let t = lin(g);
  if (t < p.nMur) { wk[p.oMurPrev + 2u * t] = E[it[p.oMurI + 2u * t + 1u]]; wk[p.oMurPrev + 2u * t + 1u] = E[it[p.oMurI + 2u * t]]; }
  if (t < p.nPort) { wk[p.oPortOld + t] = E[it[2u * t]]; }
}

@compute @workgroup_size(${WG})
fn updateE(@builtin(global_invocation_id) g: vec3u) {
  let m = lin(g); if (m >= p.n) { return; }
  let i = m % p.nx; let j = (m / p.nx) % p.ny; let k = m / (p.nx * p.ny);
  let sy = p.nx; let sz = p.nx * p.ny; let N = p.n;
  let jIn = j >= 1u && j <= p.ny - 2u; let kIn = k >= 1u && k <= p.nz - 2u; let iIn = i >= 1u && i <= p.nx - 2u;
  if (i <= p.nx - 2u && jIn && kIn) {
    E[m] = ca[m] * E[m] + cb[m] * ((H[2u * N + m] - H[2u * N + m - sy]) * sp(ody() + j) - (H[N + m] - H[N + m - sz]) * sp(odz() + k));
  }
  if (j <= p.ny - 2u && iIn && kIn) {
    E[N + m] = ca[N + m] * E[N + m] + cb[N + m] * ((H[m] - H[m - sz]) * sp(odz() + k) - (H[2u * N + m] - H[2u * N + m - 1u]) * sp(odx() + i));
  }
  if (k <= p.nz - 2u && iIn && jIn) {
    E[2u * N + m] = ca[2u * N + m] * E[2u * N + m] + cb[2u * N + m] * ((H[N + m] - H[N + m - 1u]) * sp(odx() + i) - (H[m] - H[m - sy]) * sp(ody() + j));
  }
}

// excitation per step is tabulated on the host in f64 (fl[oExc + n], already divided by nSeries)

// Single thread: resistive voltage source on every port edge, then record V and I.
@compute @workgroup_size(1)
fn port() {
  let n = u32(wk[0]);
  let vs = fl[p.oExc + min(n, p.maxSteps - 1u)];
  let Re = p.R * p.nPar / p.nSeries;
  var vSum = 0.0; var iSum = 0.0;
  for (var t = 0u; t < p.nPort; t++) {
    let idx = it[2u * t]; let ser = it[2u * t + 1u];
    let len = fl[p.oPortF + 3u * t]; let area = fl[p.oPortF + 3u * t + 1u]; let eps = fl[p.oPortF + 3u * t + 2u];
    let e0 = wk[p.oPortOld + t];
    let cbv = cb[idx];
    let curl = (E[idx] - e0) / cbv;
    let beta = p.dt * len / (2.0 * Re * eps * area);
    let e1 = ((1.0 - beta) * e0 + (p.dt / eps) * curl - (p.dt / (Re * eps * area)) * vs) / (1.0 + beta);
    E[idx] = e1;
    vSum += -e1 * len;
    if (ser == p.mid) { iSum += (len * (e1 + e0) * 0.5 + vs) / Re; }
  }
  if (n < p.maxSteps) { wk[8u + 2u * n] = vSum / p.nPar; wk[9u + 2u * n] = iSum; }
  wk[0] = f32(n + 1u);
}

@compute @workgroup_size(${WG})
fn mur(@builtin(global_invocation_id) g: vec3u) {
  let l = lin(g); if (l >= r.count) { return; }
  let t = r.start + l;
  let idx = it[p.oMurI + 2u * t]; let inner = it[p.oMurI + 2u * t + 1u];
  E[idx] = wk[p.oMurPrev + 2u * t] + fl[p.oMurK + t] * (E[inner] - wk[p.oMurPrev + 2u * t + 1u]);
}

@compute @workgroup_size(${WG})
fn nf(@builtin(global_invocation_id) g: vec3u) {
  let q = lin(g); if (q >= p.nNf) { return; }
  // phasors (cos/sin of w·t, times dt) tabulated on the host in f64: f32 sin/cos of ~1e3 rad loses ~1e-4 rad
  let tb = p.oNfT + 4u * min(u32(wk[0]) - 1u, p.maxSteps - 1u);
  let ceR = fl[tb]; let ceI = fl[tb + 1u]; let chR = fl[tb + 2u]; let chI = fl[tb + 3u];
  let b = p.oNfI + 12u * q;
  let eu = 0.5 * (E[it[b]] + E[it[b + 1u]]);
  let ev = 0.5 * (E[it[b + 2u]] + E[it[b + 3u]]);
  let hu = 0.25 * (H[it[b + 4u]] + H[it[b + 5u]] + H[it[b + 6u]] + H[it[b + 7u]]);
  let hv = 0.25 * (H[it[b + 8u]] + H[it[b + 9u]] + H[it[b + 10u]] + H[it[b + 11u]]);
  let o = p.oNfD + 8u * q;
  wk[o] += eu * ceR; wk[o + 1u] += eu * ceI; wk[o + 2u] += ev * ceR; wk[o + 3u] += ev * ceI;
  wk[o + 4u] += hu * chR; wk[o + 5u] += hu * chI; wk[o + 6u] += hv * chR; wk[o + 7u] += hv * chI;
}
`;

export async function gpuAvailable(): Promise<GPUAdapter | null> {
  if (typeof navigator === "undefined" || !("gpu" in navigator)) return null;
  try { return await navigator.gpu.requestAdapter({ powerPreference: "high-performance" }); } catch { return null; }
}

export async function runGPU(s: Setup, o: RunOptions & { batch?: number } = {}): Promise<RunResult> {
  const adapter = await gpuAvailable();
  if (!adapter) throw new Error("WebGPU is not available in this browser");
  const N = s.nx * s.ny * s.nz;
  const maxSteps = o.maxSteps ?? 200000;
  const cat = (a: Float32Array[]) => { const out = new Float32Array(a.reduce((n, x) => n + x.length, 0)); let o2 = 0; for (const x of a) { out.set(x, o2); o2 += x.length; } return out; };
  const pe = s.port.edges, pc = s.port.comp;
  const portI = new Uint32Array(pe.flatMap((e) => [pc * N + e.idx, e.series]));
  const portF = new Float32Array(pe.flatMap((e) => [e.len, e.area, s.dt / s.cb[pc][e.idx]]));
  const planes = murSetup(s);
  const murI: number[] = [], murK: number[] = [], planeRange: { start: number; count: number }[] = [];
  for (const pl of planes) {
    planeRange.push({ start: murK.length, count: pl.idx.length });
    for (let t = 0; t < pl.idx.length; t++) { murI.push(pl.comp * N + pl.idx[t], pl.comp * N + pl.inner[t]); murK.push(pl.k); }
  }
  const nfw = o.nf2ffFreqs?.length ? makeNf(s, [o.nf2ffFreqs[0]]) : null;
  const nfIdx: number[] = [];
  if (nfw) for (const fc of nfw.faces) {
    const [u, v] = [0, 1, 2].filter((a) => a !== fc.axis);
    for (let q = 0; q < fc.pu.length; q++) {
      nfIdx.push(u * N + fc.sE[0][2 * q], u * N + fc.sE[0][2 * q + 1], v * N + fc.sE[1][2 * q], v * N + fc.sE[1][2 * q + 1]);
      for (let a = 0; a < 4; a++) nfIdx.push(u * N + fc.sH[0][4 * q + a]);
      for (let a = 0; a < 4; a++) nfIdx.push(v * N + fc.sH[1][4 * q + a]);
    }
  }
  const nNf = nfIdx.length / 12;
  // Per-step tables computed in f64 on the host (f32 sin/cos of arguments up to ~1e3 rad would be off by ~1e-4 rad)
  const spacing = cat([s.idx, s.idy, s.idz, s.iddx, s.iddy, s.iddz]);
  const oPortF = spacing.length, oMurK = oPortF + portF.length, oExc = oMurK + murK.length, oNfT = oExc + maxSteps;
  const floats = new Float32Array(oNfT + (nfw ? 4 * maxSteps : 0));
  floats.set(spacing, 0); floats.set(portF, oPortF); floats.set(murK, oMurK);
  for (let n = 0; n < maxSteps; n++) floats[oExc + n] = excite(s, (n + 0.5) * s.dt) / s.port.nSeries;
  if (nfw) {
    const w = 2 * Math.PI * nfw.freqs[0];
    for (let n = 0; n < maxSteps; n++) {
      const tE = (n + 1) * s.dt, tH = (n + 0.5) * s.dt, b = oNfT + 4 * n;
      floats[b] = Math.cos(w * tE) * s.dt; floats[b + 1] = -Math.sin(w * tE) * s.dt;
      floats[b + 2] = Math.cos(w * tH) * s.dt; floats[b + 3] = -Math.sin(w * tH) * s.dt;
    }
  }
  const oMurI = portI.length, oNfI = oMurI + murI.length;
  const ints = new Uint32Array(oNfI + nfIdx.length + 1);
  ints.set(portI, 0); ints.set(murI, oMurI); ints.set(nfIdx, oNfI);
  const oPortOld = 8 + 2 * maxSteps, oMurPrev = oPortOld + pe.length, oNfD = oMurPrev + 2 * murK.length;
  const workLen = oNfD + 8 * nNf + 4;
  // Check every buffer against the adapter limits before asking for a device
  const al = adapter.limits;
  const biggest = Math.max(3 * N * 4, floats.byteLength, ints.byteLength, workLen * 4);
  if (biggest > al.maxStorageBufferBindingSize || biggest > al.maxBufferSize)
    throw new Error(`Grid too large for this GPU (${(biggest / 2 ** 20).toFixed(0)} MB buffer, limit ${(Math.min(al.maxStorageBufferBindingSize, al.maxBufferSize) / 2 ** 20).toFixed(0)} MB)`);
  if (al.maxStorageBuffersPerShaderStage < 7) throw new Error("This GPU allows too few storage buffers per shader stage");
  if (al.maxBindGroups < 2) throw new Error("This GPU allows too few bind groups");
  const dev = await adapter.requestDevice({ requiredLimits: { maxStorageBufferBindingSize: Math.min(al.maxStorageBufferBindingSize, Math.max(biggest, 128 << 20)), maxBufferSize: Math.min(al.maxBufferSize, Math.max(biggest, 256 << 20)) } });
  // Device loss rejects every await below (otherwise the UI would wait forever)
  const lostP = dev.lost.then((i) => { throw new Error(`GPU device lost: ${i.message || i.reason}`); });
  lostP.catch(() => {});
  const guard = <T>(p: Promise<T>) => Promise.race([p, lostP]);
  const readbacks = new Set<GPUBuffer>();
  try {
    const S = GPUBufferUsage.STORAGE, CD = GPUBufferUsage.COPY_DST, CS = GPUBufferUsage.COPY_SRC;
    const buf = (data: ArrayBufferView | number, usage = S | CD) => {
      const size = typeof data === "number" ? data : data.byteLength;
      const b = dev.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });
      if (typeof data !== "number") dev.queue.writeBuffer(b, 0, data.buffer, data.byteOffset, data.byteLength);
      return b;
    };
    const params = new ArrayBuffer(112), pu = new Uint32Array(params), pf = new Float32Array(params);
    pu[0] = s.nx; pu[1] = s.ny; pu[2] = s.nz; pu[3] = N;
    pf[4] = s.dt / (4e-7 * Math.PI); pf[5] = s.dt; pf[6] = s.exc.f0; pf[7] = s.exc.t0; pf[8] = s.exc.w;
    pf[9] = s.port.nSeries; pf[10] = s.port.nPar; pf[11] = s.port.R; pu[12] = pe.length; pu[13] = s.port.midSeries;
    pu[14] = murK.length; pu[15] = nNf; pf[16] = nfw ? 2 * Math.PI * nfw.freqs[0] : 0; pu[17] = maxSteps;
    pu[18] = oMurI; pu[19] = oNfI; pu[20] = oPortF; pu[21] = oMurK; pu[22] = oPortOld; pu[23] = oMurPrev; pu[24] = oNfD;
    pu[25] = oExc; pu[26] = oNfT;
    const uni = dev.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | CD });
    dev.queue.writeBuffer(uni, 0, params);
    // one {start, count} per Mur plane, at dynamic offsets
    const align = Math.max(256, dev.limits.minUniformBufferOffsetAlignment);
    const rData = new Uint32Array((align / 4) * planeRange.length);
    planeRange.forEach((r, i) => { rData[(align / 4) * i] = r.start; rData[(align / 4) * i + 1] = r.count; });
    const bR = buf(rData, GPUBufferUsage.UNIFORM | CD);
    const bE = buf(3 * N * 4), bH = buf(3 * N * 4);
    const bCa = buf(cat(s.ca)), bCb = buf(cat(s.cb));
    const bFl = buf(floats), bIt = buf(ints);
    const bWk = buf(workLen * 4, S | CD | CS);
    const mod = dev.createShaderModule({ code: SHADER });
    const info = await guard(mod.getCompilationInfo());
    const errs = info.messages.filter((m) => m.type === "error");
    if (errs.length) throw new Error("WGSL: " + errs.map((m) => `${m.lineNum}:${m.message}`).join("; "));
    const layout = dev.createBindGroupLayout({
      entries: Array.from({ length: 8 }, (_, b) => ({
        binding: b, visibility: GPUShaderStage.COMPUTE,
        buffer: { type: b === 0 ? "uniform" : [3, 4, 5, 6].includes(b) ? "read-only-storage" : "storage" } as GPUBufferBindingLayout,
      })),
    });
    const layoutR = dev.createBindGroupLayout({ entries: [{ binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform", hasDynamicOffset: true, minBindingSize: 8 } }] });
    const pl = dev.createPipelineLayout({ bindGroupLayouts: [layout] });
    const plMur = dev.createPipelineLayout({ bindGroupLayouts: [layout, layoutR] });
    const pipe = (entryPoint: string) => dev.createComputePipeline({ layout: entryPoint === "mur" ? plMur : pl, compute: { module: mod, entryPoint } });
    const [pH, pSave, pE, pPort, pMur, pNf] = ["updateH", "saveOld", "updateE", "port", "mur", "nf"].map(pipe);
    const bg = dev.createBindGroup({ layout, entries: [uni, bE, bH, bCa, bCb, bFl, bIt, bWk].map((b, i) => ({ binding: i, resource: { buffer: b } })) });
    const bgR = dev.createBindGroup({ layout: layoutR, entries: [{ binding: 0, resource: { buffer: bR, size: 8 } }] });
    // dispatch over n threads; more than 65535 workgroups fold into y (kernels index with lin())
    const disp = (pass: GPUComputePassEncoder, n: number) => {
      const g = Math.ceil(n / WG);
      pass.dispatchWorkgroups(Math.min(g, MAXG), Math.max(1, Math.ceil(g / MAXG)));
    };
    const batch = o.batch ?? 100;
    const excLen = 2 * s.exc.t0;
    const endC = o.endCriteria ?? 1e-3;
    const read = async (from: number, count: number) => {
      const rb = dev.createBuffer({ size: count * 4, usage: GPUBufferUsage.MAP_READ | CD });
      readbacks.add(rb);
      try {
        const enc = dev.createCommandEncoder(); enc.copyBufferToBuffer(bWk, from * 4, rb, 0, count * 4); dev.queue.submit([enc.finish()]);
        await guard(rb.mapAsync(GPUMapMode.READ));
        return new Float32Array(rb.getMappedRange().slice(0));
      } finally { readbacks.delete(rb); rb.destroy(); }
    };
    let n = 0, peak = 0, decay = 1;
    const checkEvery = Math.max(batch, 1000);
    while (n < maxSteps) {
      const k = Math.min(batch, maxSteps - n);
      const enc = dev.createCommandEncoder();
      for (let q = 0; q < k; q++) {
        const pass = enc.beginComputePass();
        pass.setBindGroup(0, bg);
        pass.setPipeline(pH); disp(pass, N);
        pass.setPipeline(pSave); disp(pass, Math.max(murK.length, pe.length));
        pass.setPipeline(pE); disp(pass, N);
        pass.setPipeline(pPort); pass.dispatchWorkgroups(1);
        // Mur: one dispatch per plane in the CPU's order (later planes read what earlier ones wrote; corners: last wins)
        pass.setPipeline(pMur);
        planeRange.forEach((r, i) => { pass.setBindGroup(1, bgR, [i * align]); disp(pass, r.count); });
        if (nNf) { pass.setPipeline(pNf); disp(pass, nNf); }
        pass.end();
      }
      dev.queue.submit([enc.finish()]);
      n += k;
      // wait for the batch: keeps the queue short (Stop stays responsive) and lets the UI show the step count
      await guard(dev.queue.onSubmittedWorkDone());
      if (n % checkEvery !== 0 && n < maxSteps) o.onProgress?.(n, decay);
      if (n % checkEvery === 0 || n >= maxSteps) {
        const from = Math.max(0, n - checkEvery);
        const vi = await read(8 + 2 * from, 2 * (n - from));
        let recent = 0;
        for (let q = 0; q < vi.length; q += 2) recent = Math.max(recent, Math.abs(vi[q]) + Math.abs(vi[q + 1]) * s.port.R);
        peak = Math.max(peak, recent);
        decay = recent / (peak || 1);
        o.onProgress?.(n, decay);
        if (n * s.dt > excLen && recent < endC * peak) break;
      }
    }
    const all = await read(8, 2 * n);
    const v = new Float64Array(n), i = new Float64Array(n);
    for (let q = 0; q < n; q++) { v[q] = all[2 * q]; i[q] = all[2 * q + 1]; }
    let nf: RunResult["nf"];
    if (nfw && nNf) {
      const D = await read(oNfD, 8 * nNf);
      let off = 0;
      for (const fc of nfw.faces) { const m = fc.pu.length; fc.data[0] = Float64Array.from(D.subarray(8 * off, 8 * (off + m))); off += m; }
      nf = finishNf(nfw);
    }
    return { v, i, steps: n, dt: s.dt, nf };
  } finally {
    for (const rb of readbacks) rb.destroy();
    dev.destroy();
  }
}
