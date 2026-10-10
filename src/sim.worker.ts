// Runs the MoM / analytic simulation off the main thread.
import { ANTENNA_BY_ID } from "./lib/antennas";
import { simulate } from "./lib/simulate";
import type { Params } from "./lib/types";
import { synthesize, type SynthOptions } from "./lib/synth";
import { solveField, type FieldPlane } from "./lib/nearfield";

export interface SimRequest { id: number; type: string; params: Params; patternF?: number; synth?: undefined; field?: undefined }
export interface SynthRequest { id: number; synth: SynthOptions; field?: undefined }
export interface FieldRequest { id: number; field: { type: string; params: Params; plane: FieldPlane }; synth?: undefined }

self.onmessage = (e: MessageEvent<SimRequest | SynthRequest | FieldRequest>) => {
  if (e.data.field) {
    const { id, field } = e.data;
    try {
      const d = ANTENNA_BY_ID[field.type].build(field.params);
      const data = solveField(field.type, d, field.plane);
      const transfer = data ? [data.grid.e.buffer, data.grid.r.buffer, data.grid.d.buffer, data.segs.buffer, data.ir.buffer, data.ii.buffer] : [];
      (self as unknown as Worker).postMessage({ id, field: data }, transfer);
    } catch (err) {
      postMessage({ id, error: String(err) });
    }
    return;
  }
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
