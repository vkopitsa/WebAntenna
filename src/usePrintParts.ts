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
  const seq = useRef(0);
  const key = JSON.stringify([defId, params]);   // the design follows from these

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    setState((s) => ({ status: "running", parts: s.parts }));   // at once: downloads wait for the new build
    const timer = setTimeout(() => {
      // A fresh worker per build: terminating it releases the whole WASM heap (manifold leaks inside its bindings).
      worker.current?.terminate();
      const w = new Worker(new URL("./print.worker.ts", import.meta.url), { type: "module" });
      worker.current = w;
      const done = () => { w.terminate(); if (worker.current === w) worker.current = null; };
      w.onmessage = (e: MessageEvent<{ id: number; parts?: BuiltPart[]; error?: string }>) => {
        done();
        if (e.data.id !== seq.current) return;
        if (e.data.parts) setState({ status: "done", parts: e.data.parts });
        else setState((s) => ({ status: "error", parts: s.parts, error: e.data.error ?? "" }));
      };
      w.onerror = (e) => {
        e.preventDefault();
        done();
        if (id === seq.current) setState((s) => ({ status: "error", parts: s.parts, error: e.message || "worker failed to load" }));
      };
      w.postMessage({ id, defId, params, design });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => () => worker.current?.terminate(), []);
  return state;
}
