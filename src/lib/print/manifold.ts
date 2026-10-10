import Module from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";

let ready: Promise<ManifoldToplevel> | null = null;

/** Load manifold-3d once. The browser passes the URL of manifold.wasm; Node finds it next to manifold.js. */
export function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  ready ??= Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((M) => {
    M.setup();
    M.setCircularSegments(48);
    return M;
  });
  return ready;
}
