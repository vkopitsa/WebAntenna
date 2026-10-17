import { useEffect, useRef, useState } from "react";
import type { Params } from "./lib/types";
import type { FieldPlane, RadiationField } from "./lib/nearfield";

export type FieldState =
  | { status: "idle" | "running"; key: string | null; data: RadiationField | null; error?: undefined }
  | { status: "done"; key: string; data: RadiationField | null; error?: undefined }
  | { status: "error"; key: string | null; data: null; error: string };

/** Debounced near-field solve in its own worker; a new request terminates a running one; stale replies are dropped. */
export function useNearField(type: string, params: Params, plane: FieldPlane | null, enabled: boolean): FieldState {
  const [state, setState] = useState<FieldState>({ status: "idle", key: null, data: null });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const key = JSON.stringify([type, params, plane]);

  useEffect(() => {
    if (!enabled || !plane) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      if (busy.current && worker.current) { worker.current.terminate(); worker.current = null; }
      if (!worker.current) worker.current = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
      const w = worker.current;
      busy.current = true;
      setState((s) => ({ status: "running", key: s.key, data: s.data }));
      w.onmessage = (e: MessageEvent<{ id: number; field?: RadiationField | null; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        busy.current = false;
        if (e.data.error) setState({ status: "error", key, data: null, error: e.data.error });
        else setState({ status: "done", key, data: e.data.field ?? null });
      };
      w.onerror = (e) => { e.preventDefault(); if (worker.current === w) { w.terminate(); worker.current = null; } busy.current = false; if (id === seq.current) setState({ status: "error", key, data: null, error: e.message || "Field worker failed" }); };
      w.postMessage({ id, field: { type, params, plane } });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => () => worker.current?.terminate(), []);
  return state;
}
