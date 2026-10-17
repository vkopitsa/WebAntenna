import { useEffect, useRef, useState } from "react";
import type { Candidate, SynthOptions } from "./lib/synth";

export interface SynthState { status: "idle" | "running" | "done" | "error"; progress: number; current: string; result: Candidate[] | null; error?: string }

/** Runs synthesis in its own Web Worker on demand; cancel terminates it. */
export function useSynthesis() {
  const [state, setState] = useState<SynthState>({ status: "idle", progress: 0, current: "", result: null });
  const w = useRef<Worker | null>(null);
  const stop = () => { w.current?.terminate(); w.current = null; };
  useEffect(() => stop, []);
  const run = (opts: SynthOptions) => {
    stop();
    const worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    w.current = worker;
    setState({ status: "running", progress: 0, current: "", result: null });
    worker.onmessage = (e: MessageEvent<{ progress?: number; current?: string; result?: Candidate[]; error?: string }>) => {
      if (e.data.result) { setState({ status: "done", progress: 1, current: "", result: e.data.result }); stop(); }
      else if (e.data.error) { setState({ status: "error", progress: 0, current: "", result: null, error: e.data.error }); stop(); }
      else setState((s) => ({ ...s, progress: e.data.progress ?? s.progress, current: e.data.current ?? s.current }));
    };
    worker.onerror = (e) => { e.preventDefault(); setState({ status: "error", progress: 0, current: "", result: null, error: e.message || "Synthesis worker failed" }); stop(); };
    worker.postMessage({ id: 1, synth: opts });
  };
  const cancel = () => { stop(); setState((s) => ({ ...s, status: s.result ? "done" : "idle" })); };
  return { state, run, cancel };
}
