import { useEffect, useRef, useState } from "react";
import type { Params } from "./lib/types";
import type { Engine, FdtdOut } from "./fdtdJob";

export interface FdtdState { status: "idle" | "running" | "done" | "error"; step: number; decay: number; phase: string; out: FdtdOut | null; key: string; error?: string }

/** One FDTD job at a time in a dedicated worker (WebGPU when available). */
export function useFdtd() {
  const [st, setSt] = useState<FdtdState>({ status: "idle", step: 0, decay: 1, phase: "", out: null, key: "" });
  const w = useRef<Worker | null>(null);
  // the running job's reject: a stopped job settles (as an error) instead of leaving its caller waiting forever
  const pending = useRef<((e: Error) => void) | null>(null);
  const stop = () => { w.current?.terminate(); w.current = null; const r = pending.current; pending.current = null; r?.(new Error("Stopped")); };
  useEffect(() => stop, []);
  const start = (job: "run" | "tune", type: string, params: Params, patternF: number | undefined, engine: Engine): Promise<FdtdOut> => {
    stop();
    const worker = new Worker(new URL("./fdtd.worker.ts", import.meta.url), { type: "module" });
    w.current = worker;
    const key = JSON.stringify([type, params]);
    setSt({ status: "running", step: 0, decay: 1, phase: job, out: null, key });
    return new Promise((resolve, reject) => {
      pending.current = reject;
      const fail = (msg: string) => { pending.current = null; setSt((s) => ({ ...s, status: "error", error: msg })); stop(); reject(new Error(msg)); };
      worker.onerror = (e) => { e.preventDefault(); fail(e.message || "FDTD worker failed"); };
      worker.onmessage = (e: MessageEvent<{ progress?: { step: number; decay: number; phase: string }; out?: FdtdOut; error?: string }>) => {
        if (e.data.out) { pending.current = null; setSt({ status: "done", step: e.data.out.steps, decay: 0, phase: "", out: e.data.out, key: JSON.stringify([type, e.data.out.params]) }); stop(); resolve(e.data.out); }
        else if (e.data.error) fail(e.data.error);
        else if (e.data.progress) setSt((s) => ({ ...s, step: e.data.progress!.step, decay: e.data.progress!.decay, phase: e.data.progress!.phase }));
      };
      worker.postMessage({ id: 1, job, type, params, patternF, engine });
    });
  };
  const cancel = () => { stop(); setSt((s) => ({ ...s, status: s.out ? "done" : "idle" })); };
  return { st, start, cancel };
}
