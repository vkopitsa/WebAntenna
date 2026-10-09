import type { ParamDef, Params, Sweep } from "../types";
import { str } from "../types";
import { bandSweep, centre, parseBands, type Band } from "../bands";

export const BANDS: ParamDef = { key: "bands", label: "Frequency bands", kind: "bands", min: 100e3, max: 100e9 };
export const DIAM: ParamDef = { key: "d", label: "Element diameter", kind: "length", min: 0.05e-3, max: 0.2 };

/** First band drives single-band designs: f = its centre. */
export function band(p: Params): { bands: Band[]; f1: number; f2: number; f: number; sweeps: Sweep[] } {
  let bands = parseBands(str(p, "bands", ""));
  if (!bands.length) bands = [[145e6, 145e6]];
  const [f1, f2] = bands[0];
  return { bands, f1, f2, f: centre(bands[0]), sweeps: bands.map(bandSweep) };
}
