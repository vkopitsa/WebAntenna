import wasmUrl from "manifold-3d/manifold.wasm?url";
import type { Design, Params } from "./lib/types";
import { loadManifold } from "./lib/print/manifold";
import { buildParts } from "./lib/print";

/** Builds the printable parts of a design with manifold-3d (WASM, loaded on first use). */
self.onmessage = async (e: MessageEvent<{ id: number; defId: string; params: Params; design: Design }>) => {
  const { id, defId, params, design } = e.data;
  try {
    const M = await loadManifold(wasmUrl);
    const parts = buildParts(M, defId, params, design);
    const transfer = parts.flatMap((p) => (p.ok ? p.segments.flatMap((g) => [g.stl.buffer, g.tris.buffer]) : []));
    postMessage({ id, parts }, { transfer });
  } catch (err) {
    postMessage({ id, error: String(err) });
  }
};
