import { runFdtd, tuneFdtd, type Engine } from "./fdtdJob";
import type { Params } from "./lib/types";

self.onmessage = async (e: MessageEvent<{ id: number; job: "run" | "tune"; type: string; params: Params; patternF?: number; engine: Engine }>) => {
  const { id, job, type, params, patternF, engine } = e.data;
  try {
    const fn = job === "tune" ? tuneFdtd : runFdtd;
    const out = await fn(type, params, patternF, engine, (m) => postMessage({ id, progress: m }));
    postMessage({ id, out });
  } catch (err) {
    postMessage({ id, error: String(err instanceof Error ? err.message : err) });
  }
};
