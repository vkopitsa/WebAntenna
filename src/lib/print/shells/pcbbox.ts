import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design } from "../../types";
import { isProbe } from "../../pcb";
import { mm } from "../rules";
import { box, rod, type V3 } from "../shapes";
import { clamshell } from "./clamshell";
import { envelope, grow, STYLE, styleOf, type Box3 } from "./geometry";

/** Enclosure for a printed antenna: the board floats on small posts that touch it only where there is no copper,
 *  with air above and below the copper, and the coax enters on the board edge nearest the port. */
const POST = 3, PIGTAIL = 3.5, SMA = 6.5;

export function postSpots(d: Design, layer: "top" | "bottom"): V3[] {
  const pcb = d.pcb!, b = pcb.board, k = POST / 2 + 0.5;
  let x0 = mm(b.x0) + 2 + POST / 2, x1 = mm(b.x1) - 2 - POST / 2, y0 = mm(b.y0) + 2 + POST / 2, y1 = mm(b.y1) - 2 - POST / 2;
  if (x0 > x1) x0 = x1 = mm(b.x0 + b.x1) / 2;                       // board narrower than two posts: one row on the centre line
  if (y0 > y1) y0 = y1 = mm(b.y0 + b.y1) / 2;
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  const cand: V3[] = [[x0, y0, 0], [x1, y0, 0], [x0, y1, 0], [x1, y1, 0], [xm, y0, 0], [xm, y1, 0], [x0, ym, 0], [x1, ym, 0]];
  // the coax pigtail lies on the port's side of the board, straight from the port to its entry: no post on that path
  const e = pcbEntry(d), c = portCentre(d), side = c[2] > mm(pcb.h) / 2 ? "top" : "bottom";
  const onPigtail = (s: V3) => !e.probe && side === layer && segDist(s, c, e.at) < POST / 2 + PIGTAIL / 2;
  const free: V3[] = [];
  for (const s of cand) {
    if (free.some((f) => Math.max(Math.abs(f[0] - s[0]), Math.abs(f[1] - s[1])) < POST)) continue;   // overlapping post
    if (onPigtail(s)) continue;
    if (pcb.rects.filter((r) => r.layer === layer).every((r) => s[0] + k < mm(r.x0) || s[0] - k > mm(r.x1) || s[1] + k < mm(r.y0) || s[1] - k > mm(r.y1))) free.push(s);
  }
  return free.length >= 2 ? free : [];
}

const portCentre = (d: Design): V3 => {
  const q = d.pcb!.port;
  return [mm((q.start[0] + q.stop[0]) / 2), mm((q.start[1] + q.stop[1]) / 2), mm((q.start[2] + q.stop[2]) / 2)];
};

/** Distance in xy from p to the segment a–b. */
function segDist(p: V3, a: V3, b: V3): number {
  const ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy;
  const t = L2 > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ux + (p[1] - a[1]) * uy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - t * ux, p[1] - a[1] - t * uy);
}

export function pcbEntry(d: Design): { at: V3; dir: V3; probe: boolean } {
  const pcb = d.pcb!, h = mm(pcb.h), b = pcb.board, c = portCentre(d);
  if (isProbe(pcb)) return { at: [c[0], c[1], 0], dir: [0, 0, -1], probe: true };
  const edges: { dist: number; at: V3; dir: V3 }[] = [
    { dist: c[0] - mm(b.x0), at: [mm(b.x0), c[1], h / 2], dir: [-1, 0, 0] },
    { dist: mm(b.x1) - c[0], at: [mm(b.x1), c[1], h / 2], dir: [1, 0, 0] },
    { dist: c[1] - mm(b.y0), at: [c[0], mm(b.y0), h / 2], dir: [0, -1, 0] },
    { dist: mm(b.y1) - c[1], at: [c[0], mm(b.y1), h / 2], dir: [0, 1, 0] },
  ];
  const e = edges.reduce((m, x) => (x.dist < m.dist ? x : m));
  return { at: e.at, dir: e.dir, probe: false };
}

/** The cavity: the board and every copper rectangle (copper may overrun the board) grown by the gap in x/y, z −gap .. h + gap. */
export function pcbCavity(d: Design): Box3 {
  const { gap } = STYLE[styleOf(d)], e = grow(envelope(d), gap), h = mm(d.pcb!.h);
  return { lo: [e.lo[0], e.lo[1], -gap], hi: [e.hi[0], e.hi[1], h + gap] };
}

export function pcbShell(M: ManifoldToplevel, d: Design): Manifold[] {
  const s = styleOf(d), { wall, gap } = STYLE[s];
  if (!d.pcb) {                                                     // PCB loop: no board model, plain enclosure
    const inner = grow(envelope(d), gap), zm = (inner.lo[2] + inner.hi[2]) / 2;
    const at: V3 = [(inner.lo[0] + inner.hi[0]) / 2, inner.lo[1], zm];
    return clamshell(M, { inner, wall, splitZ: zm, cuts: [rod(M, [at[0], at[1] + 1, zm], [at[0], at[1] - wall - 3, zm], PIGTAIL)], drain: s === "outdoor" });
  }
  const h = mm(d.pcb.h), inner = pcbCavity(d), e = pcbEntry(d);
  let entry: Manifold;
  if (e.probe) entry = rod(M, [e.at[0], e.at[1], 0.01], [e.at[0], e.at[1], -gap - wall - 2], SMA);
  else {
    // from the board edge through the cavity wall (copper overrunning the board on that side moves the wall out)
    const i = e.dir[0] !== 0 ? 0 : 1, sg = e.dir[i], L = (sg > 0 ? inner.hi[i] - e.at[i] : e.at[i] - inner.lo[i]) + wall + 3;
    entry = rod(M, e.at, [e.at[0] + e.dir[0] * L, e.at[1] + e.dir[1] * L, e.at[2]], PIGTAIL);
  }
  const bottom = postSpots(d, "bottom").map((p) => box(M, [p[0] - POST / 2, p[1] - POST / 2, -gap - 0.5], [p[0] + POST / 2, p[1] + POST / 2, 0]));
  const top = postSpots(d, "top").map((p) => box(M, [p[0] - POST / 2, p[1] - POST / 2, h], [p[0] + POST / 2, p[1] + POST / 2, h + gap + 0.5]));
  return clamshell(M, { inner, wall, splitZ: h / 2, cuts: [entry], adds: { bottom, top }, drain: s === "outdoor" });
}
