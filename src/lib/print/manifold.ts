import Module from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";
import { garbageCollectManifold } from "manifold-3d/lib/garbage-collector.js";

let ready: Promise<ManifoldToplevel> | null = null;

/** Load manifold-3d once. The browser passes the URL of manifold.wasm; Node finds it next to manifold.js.
 *  Every object it creates is tracked, so `cleanup()` (garbage-collector.js) frees a whole build at once.
 *  A failed load is not cached, so a later call can retry. */
export function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  ready ??= Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((M) => {
    M.setup();
    M.setCircularSegments(48);
    return garbageCollectManifold(M);
  }, (err) => {
    ready = null;
    throw err;
  });
  return ready;
}
