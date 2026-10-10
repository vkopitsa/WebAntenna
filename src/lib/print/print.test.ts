import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "./manifold";
import { meshOf, toSTL } from "./stl";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

/** Minimal binary STL reader for the round-trip test. */
function readSTL(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(80, true);
  const tris: number[][] = [];
  for (let t = 0; t < n; t++) { const o = 84 + 50 * t + 12; tris.push(Array.from({ length: 9 }, (_, k) => v.getFloat32(o + 4 * k, true))); }
  return { n, tris };
}

describe("STL writer", () => {
  it("header, count and size are consistent, and the triangles read back", () => {
    const stl = toSTL(meshOf(M.Manifold.cube([10, 20, 30])), "cube");
    const { n, tris } = readSTL(stl);
    expect(n).toBe(12);
    expect(stl.length).toBe(84 + 50 * 12);
    expect(new TextDecoder().decode(stl.slice(0, 5))).not.toBe("solid");
    const xs = tris.flatMap((t) => [t[0], t[3], t[6]]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 5);
  });
});
