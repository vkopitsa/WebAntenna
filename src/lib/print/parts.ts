import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Arg, Msg } from "../build";
import { MAX_SIZE } from "./rules";
import { flatTris, meshOf, toSTL } from "./stl";
import type { V3 } from "./shapes";

/** One printable part for the current design. `build` returns one manifold per printed segment, in mm. */
export interface PartSpec {
  id: string;
  title: string;                       // English, translated in the UI
  use: "jig" | "holder" | "former";
  qty: number;
  purpose: Msg;
  howTo: Msg[];                        // numbered instructions: how to use the part
  warn?: Msg;                          // built anyway, but the user must know (e.g. wires closer than the insulating wall)
  build(M: ManifoldToplevel): Manifold[];
}

export interface Segment { stl: Uint8Array; tris: Float32Array; size: V3 }
export type BuiltPart = { id: string; ok: true; segments: Segment[] } | { id: string; ok: false; error: Msg };

export const msg = (s: string, ...a: Arg[]): Msg => ({ s, a });

/** Failures a family reports itself (thrown from `build`): shown to the user like "Too large". */
export const FAIL = { thick: "Wire too thick for this part", radome: "Radome too narrow for the coax" };

/** Thrown from `PartSpec.build` when the design cannot be printed this way. */
export class PartError extends Error {
  m: Msg;
  constructor(m: Msg) { super(m.s); this.m = m; }
}

export const USE_LABELS: Record<PartSpec["use"], string> = { jig: "Jig", holder: "Holder", former: "Former" };

export const PART_STRINGS = ["Too large to print in one piece: {0}", "Could not build this part: {0}", "Wires closer than {0} apart: add sleeving.", ...Object.values(FAIL), ...Object.values(USE_LABELS)];

/** Build a part and check it: watertight, non-empty, every segment within MAX_SIZE. */
export function buildPart(M: ManifoldToplevel, spec: PartSpec, name: string): BuiltPart {
  let segs: Manifold[];
  try { segs = spec.build(M); } catch (e) { return { id: spec.id, ok: false, error: e instanceof PartError ? e.m : msg("Could not build this part: {0}", String(e)) }; }
  const out: Segment[] = [];
  for (const [k, s] of segs.entries()) {
    if (s.status() !== "NoError" || s.isEmpty()) return { id: spec.id, ok: false, error: msg("Could not build this part: {0}", s.status()) };
    const b = s.boundingBox();
    const size: V3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const big = Math.max(...size);
    if (big > MAX_SIZE + 1e-6) return { id: spec.id, ok: false, error: msg("Too large to print in one piece: {0}", { len: big / 1000 }) };
    const mesh = meshOf(s);
    out.push({ stl: toSTL(mesh, segs.length > 1 ? `${name}-${k + 1}` : name), tris: flatTris(mesh), size });
  }
  return { id: spec.id, ok: true, segments: out };
}
