import { useEffect, useRef, useState } from "react";
import type { Design, Params } from "./lib/types";
import type { BuiltPart } from "./lib/print";

export type PrintState =
  | { status: "idle" | "running"; parts: BuiltPart[] | null; error?: undefined }
  | { status: "done"; parts: BuiltPart[]; error?: undefined }
  | { status: "error"; parts: BuiltPart[] | null; error: string };

/** Debounced part build in a Web Worker (manifold-3d); a new request terminates a running one. */
export function usePrintParts(defId: string, params: Params, design: Design, enabled: boolean): PrintState {
  const [state, setState] = useState<PrintState>({ status: "idle", parts: null });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const key = JSON.stringify([defId, params]);   // the design follows from these

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      if (busy.current && worker.current) { worker.current.terminate(); worker.current = null; }
      if (!worker.current) worker.current = new Worker(new URL("./print.worker.ts", import.meta.url), { type: "module" });
      const w = worker.current;
      busy.current = true;
      setState((s) => ({ status: "running", parts: s.parts }));
      w.onmessage = (e: MessageEvent<{ id: number; parts?: BuiltPart[]; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        busy.current = false;
        if (e.data.parts) setState({ status: "done", parts: e.data.parts });
        else setState((s) => ({ status: "error", parts: s.parts, error: e.data.error ?? "" }));
      };
      w.postMessage({ id, defId, params, design });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => () => worker.current?.terminate(), []);
  return state;
}
