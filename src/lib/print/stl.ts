import type { Manifold } from "manifold-3d";

/** Indexed triangle mesh in mm: xyz per vertex, three vertex indices per triangle. */
export interface TriMesh { pos: Float32Array; tri: Uint32Array }

export function meshOf(m: Manifold): TriMesh {
  const g = m.getMesh();
  const n = g.vertProperties.length / g.numProp;
  const pos = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] = g.vertProperties[i * g.numProp + k];
  return { pos, tri: new Uint32Array(g.triVerts) };   // copies: the WASM objects are freed after each build
}

/** Triangles as a flat array of 9 floats each (three xyz corners), for the preview. */
export function flatTris(m: TriMesh): Float32Array {
  const out = new Float32Array(3 * m.tri.length);
  m.tri.forEach((v, i) => { out[3 * i] = m.pos[3 * v]; out[3 * i + 1] = m.pos[3 * v + 1]; out[3 * i + 2] = m.pos[3 * v + 2]; });
  return out;
}

/** Binary STL (little-endian): 80-byte header, triangle count, then 50 bytes per triangle. Units are mm. */
export function toSTL(m: TriMesh, name: string): Uint8Array {
  const n = m.tri.length / 3;
  const out = new Uint8Array(84 + 50 * n), v = new DataView(out.buffer);
  const head = `antenna-generator ${name}`.slice(0, 80);   // must not start with "solid"
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i) & 0x7f;
  v.setUint32(80, n, true);
  let o = 84;
  const p = (i: number) => [m.pos[3 * i], m.pos[3 * i + 1], m.pos[3 * i + 2]];
  for (let t = 0; t < n; t++) {
    const a = p(m.tri[3 * t]), b = p(m.tri[3 * t + 1]), c = p(m.tri[3 * t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const x of [nx / l, ny / l, nz / l, ...a, ...b, ...c]) { v.setFloat32(o, x, true); o += 4; }
    o += 2;   // attribute byte count, 0
  }
  return out;
}
