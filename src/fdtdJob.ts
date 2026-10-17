// FDTD job: build the PCB model, run the WebGPU engine (or the CPU reference), and turn the result into the
// same SimResult the charts use. Runs inside a Web Worker (WebGPU is available in workers).
import { ANTENNA_BY_ID } from "./lib/antennas";
import type { Params } from "./lib/types";
import { setup } from "./lib/fdtd/setup";
import { impedance, runCPU, type RunResult } from "./lib/fdtd/cpu";
import { acceptedPower, farField } from "./lib/fdtd/nf2ff";
import { samplePattern, type SimResult, type ZPoint } from "./lib/simulate";
import { runGPU, gpuAvailable } from "./gpu/fdtdGpu";

export type Engine = "auto" | "gpu" | "cpu";

// Stop when the port signals fall 40 dB below their peak (≈ openEMS EndCriteria 1e-4, which is on energy).
// A printed IFA (loaded Q ≈ 16) needs ≈ 25 k steps to settle its resonance and match depth at this level,
// while −60 dB takes > 80 k steps for no visible change in Z.
const END_CRITERIA = 1e-2, MAX_STEPS = 100000;
export interface FdtdOut { result: SimResult; engine: "gpu" | "cpu"; cells: number; steps: number; ms: number; fRes: number | null; params: Params }

export async function runFdtd(type: string, params: Params, patternF: number | undefined, engine: Engine, onProgress: (msg: { step: number; decay: number; phase: string }) => void): Promise<FdtdOut> {
  const def = ANTENNA_BY_ID[type];
  const d = def.build(params);
  if (!d.pcb) throw new Error("FDTD needs a printed (PCB) antenna");
  const fLo = Math.min(...d.sweeps.map((s) => s.start)), fHi = Math.max(...d.sweeps.map((s) => s.stop));
  const fmin = Math.min(fLo, 0.7 * d.f), fmax = Math.max(fHi, 1.3 * d.f);
  const fPat = patternF ?? d.f;
  const s = setup(d.pcb, fmin, fmax);
  const t0 = performance.now();
  let res: RunResult, used: "gpu" | "cpu" = "cpu";
  const useGpu = engine !== "cpu" && (await gpuAvailable());
  if (engine === "gpu" && !useGpu) throw new Error("WebGPU is not available in this browser");
  const prog = (step: number, decay: number) => onProgress({ step, decay, phase: "fdtd" });
  if (useGpu) { res = await runGPU(s, { nf2ffFreqs: [fPat], endCriteria: END_CRITERIA, maxSteps: MAX_STEPS, onProgress: prog }); used = "gpu"; }
  else res = runCPU(s, { nf2ffFreqs: [fPat], endCriteria: END_CRITERIA, maxSteps: MAX_STEPS, onProgress: prog });
  onProgress({ step: res.steps, decay: 0, phase: "post" });
  const freqs = Array.from({ length: 241 }, (_, i) => fmin + ((fmax - fmin) * i) / 240);
  const z: ZPoint[] = impedance(res, freqs);
  const ff = farField(res.nf!, 0);
  const pacc = acceptedPower(res, fPat);
  const g = (th: number, ph: number) => 10 * Math.log10(Math.max((4 * Math.PI * ff.U(th, ph)) / Math.max(pacc, 1e-30), 1e-6));
  const pattern = samplePattern(fPat, g);
  const eff = ff.prad / pacc;
  return {
    result: {
      method: "analytic", z, pattern,
      notes: [`FDTD (${used === "gpu" ? "WebGPU" : "CPU"}): ${s.nx}×${s.ny}×${s.nz} cells, ${res.steps} steps, radiation efficiency ${(100 * eff).toFixed(0)} %.`],
    },
    engine: used, cells: s.nx * s.ny * s.nz, steps: res.steps, ms: performance.now() - t0,
    fRes: resonance(z, d.f, d.feedZ0 ?? 50), params,
  };
}

/** Resonance nearest the design frequency: a reactance zero crossing, else the best match. */
export function resonance(z: ZPoint[], f0: number, z0: number): number | null {
  const cross: number[] = [];
  for (let i = 0; i < z.length - 1; i++) if (z[i].x * z[i + 1].x < 0 && Math.max(z[i].r, z[i + 1].r) > 5) cross.push(z[i].f - (z[i].x * (z[i + 1].f - z[i].f)) / (z[i + 1].x - z[i].x));
  if (cross.length) return cross.reduce((a, b) => (Math.abs(b - f0) < Math.abs(a - f0) ? b : a));
  let best = 0, bm = Infinity;
  z.forEach((p, i) => { const m = Math.hypot(p.r - z0, p.x) / Math.hypot(p.r + z0, p.x); if (m < bm) { bm = m; best = i; } });
  return z.length ? z[best].f : null;
}

/** Tune: run, rescale the resonant length so the resonance lands on the design frequency, run again. */
export async function tuneFdtd(type: string, params: Params, patternF: number | undefined, engine: Engine, onProgress: (msg: { step: number; decay: number; phase: string }) => void): Promise<FdtdOut> {
  const def = ANTENNA_BY_ID[type];
  let p = { ...params };
  let out: FdtdOut | null = null;
  for (let pass = 0; pass < 3; pass++) {
    out = await runFdtd(type, p, patternF, engine, (m) => onProgress({ ...m, phase: `pass ${pass + 1}` }));
    const f0 = def.build(p).f;
    // the last pass returns the trim it ran (a rescaled but unsimulated trim wouldn't match the result)
    if (out.fRes == null || Math.abs(out.fRes / f0 - 1) < 0.005 || pass === 2) break;
    const k = (1 + Number(p.trim ?? 0) / 100) * (out.fRes / f0); // longer element ↔ lower resonance
    p = { ...p, trim: +Math.max(-25, Math.min(25, (k - 1) * 100)).toFixed(2) };
  }
  return { ...out!, params: p };
}
