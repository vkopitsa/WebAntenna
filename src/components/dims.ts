// Pure helpers for the Preview: dimension-line layout (with collision avoidance), view zoom/pan, plate size.
import type { Vec3 } from "../lib/types";

export type P2 = [number, number];
/** Zoom z about the view centre plus a pan (px) applied after it. */
export interface ViewXf { z: number; x: number; y: number }
export const FIT: ViewXf = { z: 1, x: 0, y: 0 };
export const ZOOM_MIN = 0.5, ZOOM_MAX = 40;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Scale by `f` keeping the point q (view-box px) fixed; (W/2, H/2) is the zoom centre. */
export function zoomAt(v: ViewXf, q: P2, f: number, W: number, H: number): ViewXf {
  const z = clamp(v.z * f, ZOOM_MIN, ZOOM_MAX), r = z / v.z;
  return { z, x: q[0] - W / 2 - (q[0] - W / 2 - v.x) * r, y: q[1] - H / 2 - (q[1] - H / 2 - v.y) * r };
}

export interface DimGeom {
  ext: number[][];
  arrow: number[] | null;
  label: P2;
  /** Label box [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  text: string;
}

const OFF = 18, STEP = 16, TH = 18;

/**
 * Dimension line for a span seen on screen: extension lines out to an arrowed line offset by OFF + STEP·level px on the
 * side away from the drawing centre (or towards it when `flip`), and the label on the line (beside it when the line is too short for it).
 * A span seen end-on (shorter than 6 px) gets only the label.
 */
export function layoutDim([a, b]: [P2, P2], text: string, level: number, W: number, H: number, flip = false): DimGeom {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  const tw = text.length * 7.4 + 10;
  const place = (x: number, y: number): P2 => [clamp(x, tw / 2 + 2, W - tw / 2 - 2), clamp(y, TH / 2 + 2, H - TH / 2 - 2)];
  const box = ([x, y]: P2): DimGeom["box"] => [x - tw / 2, y - TH / 2, x + tw / 2, y + TH / 2];
  if (len < 6) { const label = place(a[0] + tw / 2 + 8, a[1] - 14 - level * TH); return { ext: [], arrow: null, label, box: box(label), text }; }
  const off = OFF + STEP * level;
  let nx = -dy / len, ny = dx / len;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  if (((mx - W / 2) * nx + (my - H / 2) * ny < 0) !== flip) { nx = -nx; ny = -ny; }
  const o = (p: P2, d: number) => [p[0] + nx * d, p[1] + ny * d];
  // a label on the line reads well unless the line is steep, where the wide text would cover the drawing
  const inline = len >= tw + 30 && Math.abs(dy) / len < 0.8;
  const label = inline ? place(mx + nx * off, my + ny * off) : place(mx + nx * (off + 6 + Math.abs(nx) * tw / 2 + Math.abs(ny) * TH / 2), my + ny * (off + 6 + Math.abs(nx) * tw / 2 + Math.abs(ny) * TH / 2));
  return { ext: [[...o(a, 4), ...o(a, off + 5)], [...o(b, 4), ...o(b, off + 5)]], arrow: [...o(a, off), ...o(b, off)], label, box: box(label), text };
}

export type Box = DimGeom["box"];
const overlap = (p: DimGeom["box"], q: DimGeom["box"], m = 2) => p[0] < q[2] + m && q[0] < p[2] + m && p[1] < q[3] + m && q[1] < p[3] + m;
const inside = (x: number, y: number, bx: DimGeom["box"]) => x > bx[0] && x < bx[2] && y > bx[1] && y < bx[3];
const crossesBox = (ar: number[] | null, bx: DimGeom["box"]) => {
  if (!ar) return false;
  for (let i = 0; i <= 10; i++) if (inside(ar[0] + ((ar[2] - ar[0]) * i) / 10, ar[1] + ((ar[3] - ar[1]) * i) / 10, bx)) return true;
  return false;
};

function clash(g: DimGeom, o: DimGeom): boolean {
  if (overlap(g.box, o.box) || crossesBox(g.arrow, o.box) || crossesBox(o.arrow, g.box)) return true;
  if (!g.arrow || !o.arrow) return false;
  const [x1, y1, x2, y2] = g.arrow, [u1, v1, u2, v2] = o.arrow;
  const l1 = Math.hypot(x2 - x1, y2 - y1), l2 = Math.hypot(u2 - u1, v2 - v1);
  const d1 = [(x2 - x1) / l1, (y2 - y1) / l1];
  if (Math.abs(d1[0] * (v2 - v1) / l2 - d1[1] * (u2 - u1) / l2) > 0.17) return false; // not parallel
  const perp = Math.abs((u1 - x1) * -d1[1] + (v1 - y1) * d1[0]);
  const t = (x: number, y: number) => (x - x1) * d1[0] + (y - y1) * d1[1];
  const lo = Math.max(0, Math.min(t(u1, v1), t(u2, v2))), hi = Math.min(l1, Math.max(t(u1, v1), t(u2, v2)));
  return perp < 12 && hi - lo > 4;
}

/** Every point of the geometry is inside the view box. */
function fits(g: DimGeom, W: number, H: number): boolean {
  const pts = [...g.ext.flatMap((e) => [[e[0], e[1]], [e[2], e[3]]]), ...(g.arrow ? [[g.arrow[0], g.arrow[1]], [g.arrow[2], g.arrow[3]]] : []), [g.box[0], g.box[1]], [g.box[2], g.box[3]]];
  return pts.every(([x, y]) => x >= 4 && x <= W - 4 && y >= 4 && y <= H - 4);
}

/**
 * Lay out spans: shorter spans sit closest to the drawing, and a span that collides with an already placed one (or with an
 * `avoid` box: toolbar, scale bar, feed dot) or leaves the view moves out by one STEP until it fits; if no level fits on
 * the outer side it is tried on the inner side. Spans seen end-on, or that never fit, come back null.
 */
export function placeDims(items: { span: [P2, P2]; text: string }[], W: number, H: number, avoid: Box[] = []): (DimGeom | null)[] {
  const out: (DimGeom | null)[] = items.map(() => null);
  const order = items.map((_, i) => i).sort((i, j) => len2(items[i].span) - len2(items[j].span));
  const placed: DimGeom[] = avoid.map((box) => ({ ext: [], arrow: null, label: [0, 0], box, text: "" }));
  for (const i of order) {
    const { span, text } = items[i];
    if (len2(span) < 6) continue;
    search: for (const flip of [false, true]) for (let level = 0; level < 8; level++) {
      const g = layoutDim(span, text, level, W, H, flip);
      if (!fits(g, W, H) || placed.some((o) => clash(g, o))) continue;
      placed.push(g); out[i] = g;
      break search;
    }
  }
  return out;
}
const len2 = ([a, b]: [P2, P2]) => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Side lengths of a plate: the two edges of a quad, else the two largest bounding-box extents. */
export function plateSize(pts: Vec3[]): [number, number] {
  const d = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (pts.length === 4) return [d(pts[0], pts[1]), d(pts[1], pts[2])];
  const ext = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i])) - Math.min(...pts.map((p) => p[i]))).sort((a, b) => b - a);
  return [ext[0], ext[1]];
}
