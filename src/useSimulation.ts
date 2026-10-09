import { useEffect, useRef, useState } from "react";
import type { Params } from "./lib/types";
import type { SimResult } from "./lib/simulate";

export type SimState =
  | { status: "idle" | "running"; progress: number; result: SimResult | null; error?: undefined }
  | { status: "done"; progress: 1; result: SimResult; error?: undefined }
  | { status: "error"; progress: number; result: SimResult | null; error: string };

/** Debounced simulation in a Web Worker; a new request terminates a running one. */
export function useSimulation(type: string, params: Params, patternF: number | undefined, enabled: boolean): SimState {
  const [state, setState] = useState<SimState>({ status: "idle", progress: 0, result: null });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const key = JSON.stringify([type, params, patternF]);

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      if (busy.current && worker.current) { worker.current.terminate(); worker.current = null; }
      if (!worker.current) worker.current = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
      const w = worker.current;
      busy.current = true;
      setState((s) => ({ status: "running", progress: 0, result: s.result }));
      w.onmessage = (e: MessageEvent<{ id: number; progress?: number; result?: SimResult; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        if (e.data.result) { busy.current = false; setState({ status: "done", progress: 1, result: e.data.result }); }
        else if (e.data.error) { busy.current = false; setState((s) => ({ status: "error", progress: 0, result: s.result, error: e.data.error! })); }
        else if (e.data.progress != null) setState((s) => ({ status: "running", progress: e.data.progress!, result: s.result }));
      };
      w.postMessage({ id, type, params, patternF });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => () => worker.current?.terminate(), []);
  return state;
}
