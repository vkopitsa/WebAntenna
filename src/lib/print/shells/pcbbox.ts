import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design } from "../../types";
import { isProbe, type PcbRect } from "../../pcb";
import { CLEAR, mm } from "../rules";
import { box, rod, type V3 } from "../shapes";
import { clamshell, DRAIN, drainAt } from "./clamshell";
import { envelope, grow, STYLE, styleOf, type Box3 } from "./geometry";

/** Enclosure for a printed antenna. The board rests on small posts (on copper-free board or on the ground pour, a gap
 *  away from the radiator) and is located by edge stops on all four sides: ribs from the side walls that touch only the
 *  board's edge, with a 1 mm ledge under and a 1 mm overhang over the rim where the rim is clear of the radiator. The
 *  coax enters on the board edge nearest the port, over the ground pour when there is one; a probe feed gets an SMA
 *  hole underneath. */
const POST = 3, STOP = 3, RIM = 1, PIGTAIL = 3.5, SMA = 6.5, PROBE_KEEP = 7;
const CHANNEL = PIGTAIL + CLEAR;

type Layer = "top" | "bottom";
type Rect = { x0: number; y0: number; x1: number; y1: number };
/** An edge stop: board side (axis i, sign s: −1 the low edge), its centre along the edge, and whether it has the
 *  ledge under the rim (bottom support) and the overhang over it (top clamp). */
export type Stop = { i: 0 | 1; s: 1 | -1; c: number; ledge: boolean; clamp: boolean };

const isGround = (r: PcbRect) => r.label.startsWith("Ground");
const rmm = (r: PcbRect): Rect => ({ x0: mm(r.x0), y0: mm(r.y0), x1: mm(r.x1), y1: mm(r.y1) });
/** Distance between two axis-aligned rectangles (0 when they overlap). */
const rdist = (a: Rect, b: Rect) => Math.hypot(Math.max(0, b.x0 - a.x1, a.x0 - b.x1), Math.max(0, b.y0 - a.y1, a.y0 - b.y1));
const sq = (x: number, y: number, k: number): Rect => ({ x0: x - k, y0: y - k, x1: x + k, y1: y + k });

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

/** Non-ground copper of a layer (both layers when omitted), in mm. */
const radiator = (d: Design, layer?: Layer) => d.pcb!.rects.filter((r) => !isGround(r) && (!layer || r.layer === layer)).map(rmm);

/** Edges of the ground pour that face the radiator: the sides of each ground rectangle that are not on the board outline. */
function groundEdges(d: Design): Rect[] {
  const b = d.pcb!.board, e = 1e-9, out: Rect[] = [];
  for (const g of d.pcb!.rects.filter(isGround)) {
    if (g.x0 > b.x0 + e) out.push({ x0: g.x0, x1: g.x0, y0: g.y0, y1: g.y1 });
    if (g.x1 < b.x1 - e) out.push({ x0: g.x1, x1: g.x1, y0: g.y0, y1: g.y1 });
    if (g.y0 > b.y0 + e) out.push({ x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y0 });
    if (g.y1 < b.y1 - e) out.push({ x0: g.x0, x1: g.x1, y0: g.y1, y1: g.y1 });
  }
  return out.map((r) => ({ x0: mm(r.x0), y0: mm(r.y0), x1: mm(r.x1), y1: mm(r.y1) }));
}

/** Plastic touching the board at this footprint is allowed: a gap from the layer's radiator copper and from the ground
 *  pour's radiator-facing edge, 7 mm from a probe port, and clear of the drain hole. */
function touchOk(d: Design, f: Rect, layer: Layer): boolean {
  const gap = STYLE[styleOf(d)].gap;
  if (radiator(d, layer).some((r) => rdist(f, r) < gap)) return false;
  if (groundEdges(d).some((r) => rdist(f, r) < gap)) return false;
  if (isProbe(d.pcb!)) { const c = portCentre(d); if (rdist(f, sq(c[0], c[1], 0)) < PROBE_KEEP) return false; }
  return !hitsDrain(d, f);
}

function hitsDrain(d: Design, f: Rect): boolean {
  if (styleOf(d) !== "outdoor") return false;
  const [x, y] = drainAt(pcbCavity(d));
  return rdist(f, sq(x, y, 0)) < DRAIN / 2 + 0.5;
}

const area2 = (a: V3, b: V3, c: V3) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]));
/** The points do not all lie on one line (twice the largest triangle area above 1 mm²). */
export function spread(pts: V3[]): boolean {
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) if (area2(pts[i], pts[j], pts[k]) > 1) return true;
  return false;
}

const lin = (a: number, b: number) => {
  if (a > b) return [(a + b) / 2];
  const n = Math.min(40, Math.max(2, Math.ceil((b - a) / 4) + 1));
  return Array.from({ length: n }, (_, k) => a + ((b - a) * k) / (n - 1));
};

/** Post centres under (bottom) or over (top) the board: the allowed spot furthest towards each corner, plus one off
 *  their line when they all lie on one; none when fewer than 2 spots are allowed. */
export function postSpots(d: Design, layer: Layer): V3[] {
  const pcb = d.pcb!, b = pcb.board, k = 2 + POST / 2;
  const e = pcbEntry(d), c = portCentre(d);
  const ok: V3[] = [];
  for (const x of lin(mm(b.x0) + k, mm(b.x1) - k)) for (const y of lin(mm(b.y0) + k, mm(b.y1) - k)) {
    const s: V3 = [x, y, 0];
    if (!touchOk(d, sq(x, y, POST / 2), layer)) continue;
    // the coax pigtail lies on the top face, straight from the entry to the port: no post on that path
    if (!e.probe && layer === "top" && segDist(s, e.at, c) < POST / 2 + CHANNEL / 2 + 0.2) continue;
    ok.push(s);
  }
  const out: V3[] = [];
  const put = (s: V3) => { if (!out.some((f) => Math.max(Math.abs(f[0] - s[0]), Math.abs(f[1] - s[1])) < POST)) out.push(s); };
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) if (ok.length) put(ok.reduce((m, s) => (sx * s[0] + sy * s[1] > sx * m[0] + sy * m[1] ? s : m)));
  if (out.length >= 2 && !spread(out)) {
    const far = ok.reduce((m, s) => (area2(out[0], out[out.length - 1], s) > area2(out[0], out[out.length - 1], m) ? s : m));
    if (area2(out[0], out[out.length - 1], far) > 1) put(far);
  }
  return out.length >= 2 ? out : [];
}

/** Edge stops: three spots along each side (ends and middle), skipped where the rib comes within the gap of radiator
 *  copper, where the coax enters or where the drain would cut it. Ledge/overhang only where that rim is clear. */
export function edgeStops(d: Design): Stop[] {
  const b = d.pcb!.board, inner = pcbCavity(d), gap = STYLE[styleOf(d)].gap, e = pcbEntry(d);
  const lo = [mm(b.x0), mm(b.y0)], hi = [mm(b.x1), mm(b.y1)], out: Stop[] = [];
  for (const i of [0, 1] as const) for (const s of [-1, 1] as const) {
    const j = 1 - i, E = s > 0 ? hi[i] : lo[i], F = s > 0 ? inner.hi[i] : inner.lo[i];
    const a = lo[j] + STOP / 2 + 1, z = hi[j] - STOP / 2 - 1;
    const cs = a > z ? [(lo[j] + hi[j]) / 2] : [a, (a + z) / 2, z];
    for (const c of cs) {
      const fp = (n0: number, n1: number): Rect => {
        const p = [Math.min(n0, n1), Math.max(n0, n1)], q = [c - STOP / 2, c + STOP / 2];
        return i === 0 ? { x0: p[0], x1: p[1], y0: q[0], y1: q[1] } : { x0: q[0], x1: q[1], y0: p[0], y1: p[1] };
      };
      const rib = fp(E, F), rim = fp(E - s * RIM, E);
      if (radiator(d).some((r) => rdist(rib, r) < gap) || hitsDrain(d, fp(E - s * RIM, F))) continue;
      if (!e.probe && e.dir[i] === s && Math.abs(e.at[j] - c) < PIGTAIL / 2 + STOP / 2 + 1) continue;   // the coax hole
      out.push({ i, s, c, ledge: touchOk(d, rim, "bottom"), clamp: touchOk(d, rim, "top") });
    }
  }
  return out;
}

/** Where the board is supported, per face: posts, and the ledges (bottom) or overhangs (top) of the edge stops. */
export function supports(d: Design): { bottom: V3[]; top: V3[] } {
  const b = d.pcb!.board, st = edgeStops(d);
  const rimPt = (t: Stop): V3 => { const E = mm(t.s > 0 ? (t.i === 0 ? b.x1 : b.y1) : t.i === 0 ? b.x0 : b.y0) - (t.s * RIM) / 2; return t.i === 0 ? [E, t.c, 0] : [t.c, E, 0]; };
  return {
    bottom: [...postSpots(d, "bottom"), ...st.filter((t) => t.ledge).map(rimPt)],
    top: [...postSpots(d, "top"), ...st.filter((t) => t.clamp).map(rimPt)],
  };
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
  // with a ground pour on top reaching this edge, the cable comes in over the pour: (gap + cable radius) inside its edge
  const i = e.dir[0] !== 0 ? 0 : 1, j = 1 - i, E = e.at[i], k = STYLE[styleOf(d)].gap + PIGTAIL / 2;
  let best: number | null = null;
  for (const g of pcb.rects.filter((r) => isGround(r) && r.layer === "top").map(rmm)) {
    const lo = [g.x0, g.y0], hi = [g.x1, g.y1];
    if (Math.abs((e.dir[i] > 0 ? hi[i] : lo[i]) - E) > 1e-6 || lo[j] + k > hi[j] - k) continue;
    const v = Math.min(Math.max(e.at[j], lo[j] + k), hi[j] - k);
    if (best === null || Math.abs(v - e.at[j]) < Math.abs(best - e.at[j])) best = v;
  }
  if (best !== null) e.at[j] = best;
  return { at: e.at, dir: e.dir, probe: false };
}

/** The cavity: the board and every copper rectangle (copper may overrun the board) grown by the gap in x/y, z −gap .. h + gap. */
export function pcbCavity(d: Design): Box3 {
  const { gap } = STYLE[styleOf(d)], e = grow(envelope(d), gap), h = mm(d.pcb!.h);
  return { lo: [e.lo[0], e.lo[1], -gap], hi: [e.hi[0], e.hi[1], h + gap] };
}

/** Plastic that holds the board, per half: posts, edge-stop ribs with their ledges, and the overhangs. */
export function holders(M: ManifoldToplevel, d: Design): { bottom: Manifold[]; top: Manifold[] } {
  const { gap } = STYLE[styleOf(d)], h = mm(d.pcb!.h), inner = pcbCavity(d), b = d.pcb!.board, zs = h / 2;
  const bottom = postSpots(d, "bottom").map((p) => box(M, [p[0] - POST / 2, p[1] - POST / 2, -gap - 0.5], [p[0] + POST / 2, p[1] + POST / 2, 0]));
  const top = postSpots(d, "top").map((p) => box(M, [p[0] - POST / 2, p[1] - POST / 2, h], [p[0] + POST / 2, p[1] + POST / 2, h + gap + 0.5]));
  const lo = [mm(b.x0), mm(b.y0)], hi = [mm(b.x1), mm(b.y1)];
  for (const t of edgeStops(d)) {
    const { i, s, c } = t, E = s > 0 ? hi[i] : lo[i], F = s > 0 ? inner.hi[i] : inner.lo[i];
    // a box spanning n0..n1 across the edge (normal), the stop's width along it, and z0..z1
    const part = (n0: number, n1: number, z0: number, z1: number) => {
      const a: V3 = [0, 0, z0], q: V3 = [0, 0, z1];
      a[i] = Math.min(n0, n1); q[i] = Math.max(n0, n1); a[1 - i] = c - STOP / 2; q[1 - i] = c + STOP / 2;
      return box(M, a, q);
    };
    // bottom half: the rib (into the wall below the split, a clearance off the top half's wall above it) and the ledge
    bottom.push(part(E + (s * CLEAR) / 2, F + s * 0.5, -gap - 0.5, zs));
    if (h - CLEAR > zs) bottom.push(part(E + (s * CLEAR) / 2, F - (s * CLEAR) / 2, zs - 0.01, h - CLEAR));
    if (t.ledge) bottom.push(part(E - s * RIM, E + (s * CLEAR) / 2 + 0.01, -gap - 0.5, 0));
    // top half: the overhang hangs from the roof, a clearance off the bottom half's rib
    if (t.clamp) top.push(part(E - s * RIM, F - (s * CLEAR) / 2, h, inner.hi[2] + 0.5));
  }
  return { bottom, top };
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
  const adds = holders(M, d), cuts = [entry];
  const path = cablePath(d);
  if (path) {
    // the cable lies on the board: a channel in the top half from the side wall's inner face to the port
    for (const [a, b] of [[path[0], path[1]], [path[1], path[2]]]) if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 1e-6) cuts.push(rod(M, a, b, CHANNEL));
    const chTop = path[1][2] + CHANNEL / 2, roof = inner.hi[2] + wall;
    if (chTop + wall > roof) {
      // the channel thins or opens the roof: a raised rib over it keeps a wall of plastic, within the box outline
      const W = PIGTAIL + 2 * wall, out = grow(inner, wall), z0 = inner.hi[2] + wall / 2, z1 = chTop + wall;
      const sqAt = (p: V3) => box(M, [p[0] - W / 2, p[1] - W / 2, z0], [p[0] + W / 2, p[1] + W / 2, z1]);
      const rib = M.Manifold.hull([sqAt(path[0]), sqAt(path[1]), sqAt(path[2])]).intersect(box(M, [out.lo[0], out.lo[1], z0 - 1], [out.hi[0], out.hi[1], z1 + 1]));
      adds.top.push(rib);
    }
  }
  return clamshell(M, { inner, wall, splitZ: h / 2, cuts, adds, drain: s === "outdoor" });
}

/** The cable's path over the board at z = h + PIGTAIL/2: from the side wall's inner face at the entry, to the board
 *  edge, to the port. Null for a probe feed (the SMA jack is underneath). */
export function cablePath(d: Design): [V3, V3, V3] | null {
  const e = pcbEntry(d);
  if (e.probe) return null;
  const inner = pcbCavity(d), z = mm(d.pcb!.h) + PIGTAIL / 2, c = portCentre(d), i = e.dir[0] !== 0 ? 0 : 1;
  const a: V3 = [e.at[0], e.at[1], z];
  a[i] = e.dir[i] > 0 ? inner.hi[i] : inner.lo[i];
  return [a, [e.at[0], e.at[1], z], [c[0], c[1], z]];
}
