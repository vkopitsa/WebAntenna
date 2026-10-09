// Runs the MoM / analytic simulation off the main thread.
import { ANTENNA_BY_ID } from "./lib/antennas";
import { simulate } from "./lib/simulate";
import type { Params } from "./lib/types";
import { synthesize, type SynthOptions } from "./lib/synth";

export interface SimRequest { id: number; type: string; params: Params; patternF?: number; synth?: undefined }
export interface SynthRequest { id: number; synth: SynthOptions }

self.onmessage = (e: MessageEvent<SimRequest | SynthRequest>) => {
  if (e.data.synth) {
    const { id, synth } = e.data;
    try {
      const result = synthesize(synth, (done, total, current) => postMessage({ id, progress: done / total, current }));
      postMessage({ id, result });
    } catch (err) {
      postMessage({ id, error: String(err) });
    }
    return;
  }
  const { id, type, params, patternF } = e.data as SimRequest;
  try {
    const def = ANTENNA_BY_ID[type];
    const d = def.build(params);
    let last = 0;
    const result = simulate(def, params, d, {
      patternF,
      onProgress: (a, b) => { const now = Date.now(); if (now - last > 80) { last = now; postMessage({ id, progress: a / b }); } },
    });
    postMessage({ id, result });
  } catch (err) {
    postMessage({ id, error: String(err) });
  }
};
