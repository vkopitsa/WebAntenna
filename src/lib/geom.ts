import type { Plate, Vec3, Wire } from "./types";

export const v = (x: number, y: number, z: number): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3) => len(sub(a, b));
export const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a: Vec3): Vec3 => scale(a, 1 / (len(a) || 1));

/** Chain of wires through the given points. */
export function polyline(pts: Vec3[], r: number, extra: Partial<Wire> = {}): Wire[] {
  const out: Wire[] = [];
  for (let i = 1; i < pts.length; i++) out.push({ a: pts[i - 1], b: pts[i], r, ...extra });
  return out;
}

/** Unit normal of a planar polygon (Newell's method). */
export function plateNormal(p: Plate): Vec3 {
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < p.pts.length; i++) {
    const a = p.pts[i], b = p.pts[(i + 1) % p.pts.length];
    n = add(n, [(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])]);
  }
  return norm(n);
}

/** Rectangle centred at c spanned by half-vectors u and w (counter-clockwise seen from u×w). */
export function rect(c: Vec3, u: Vec3, w: Vec3): Vec3[] {
  return [sub(sub(c, u), w), sub(add(c, u), w), add(add(c, u), w), add(sub(c, u), w)];
}

/** Disc polygon in the plane z = z0 (normal +z). */
export function disc(cx: number, cy: number, z0: number, radius: number, n = 48): Vec3[] {
  return Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n;
    return v(cx + radius * Math.cos(t), cy + radius * Math.sin(t), z0);
  });
}

/**
 * Wire grid over the rectangle origin + s·U + t·W, s,t ∈ [0,1], with m×n cells (NEC stand-in for a solid plate).
 * Wires run node to node so every crossing is a proper junction.
 */
export function wireGrid(origin: Vec3, U: Vec3, W: Vec3, m: number, n: number, r: number): Wire[] {
  const node = (i: number, j: number) => add(origin, add(scale(U, i / m), scale(W, j / n)));
  const out: Wire[] = [];
  for (let i = 0; i <= m; i++)
    for (let j = 0; j <= n; j++) {
      if (i < m) out.push({ a: node(i, j), b: node(i + 1, j), r, necOnly: true, group: "ground" });
      if (j < n) out.push({ a: node(i, j), b: node(i, j + 1), r, necOnly: true, group: "ground" });
    }
  return out;
}
