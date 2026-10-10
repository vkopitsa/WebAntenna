// Thin-wire stand-in for a printed antenna's copper, for the Radiation view only: traces become centre-line wires
// (radius w/4), wide pours a wire grid, touching shapes are joined, and the lumped port becomes the feed wire.
// The substrate is folded into a frequency scale: in a uniform medium εeff the currents at f are the free-space
// currents at f·√εeff, so the wires are solved there and radiate at f. A picture of the current paths, not a
// substitute for the FDTD.
import type { Design, Vec3, Wire } from "./types";
import { copperPlanes, inPoly, type Pcb, type PcbPoly, type PcbRect } from "./pcb";
import { add, dist, scale, sub } from "./geom";
import { microstripEeff, wavelength } from "./rf";
import { printedEeff } from "./antennas/pcbmonopole";
import { traceRadius } from "./antennas/pcbcommon";

interface Shape { z: number; box: { x0: number; y0: number; x1: number; y1: number }; wires: Wire[]; poly?: [number, number][] }

const TOL = 1e-9;
/**
 * Extra frequency scale so the stand-ins resonate at the design frequency: the εeff fit is for a monopole off a
 * ground pour; the printed, V and sleeve dipole stand-ins all came out resonant at 1.1·f√εeff.
 */
const STANDIN_K = 1.1;

/** Closest point to p on segment ab, and its parameter. */
function closest(a: Vec3, b: Vec3, p: Vec3): { q: Vec3; t: number } {
  const ab = sub(b, a), l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2)) : 0;
  return { q: add(a, scale(ab, t)), t };
}

/** Narrowest side over every trace (rectangle short side, polygon short edge): sets εeff. */
function narrowest(p: Pcb): number {
  let m = Infinity;
  for (const q of p.rects) m = Math.min(m, q.x1 - q.x0, q.y1 - q.y0);
  for (const q of p.polys ?? []) m = Math.min(m, q.w ?? polyLine(q)?.w ?? Infinity);
  return Number.isFinite(m) ? m : 1e-3;
}

/** Centre line of a four-corner strip (between the midpoints of its two short edges) and its width. */
function polyLine(q: PcbPoly): { a: [number, number]; b: [number, number]; w: number } | null {
  if (q.pts.length !== 4) return null;
  const P = q.pts, e = (i: number) => Math.hypot(P[(i + 1) % 4][0] - P[i][0], P[(i + 1) % 4][1] - P[i][1]);
  const mid = (i: number): [number, number] => [(P[i][0] + P[(i + 1) % 4][0]) / 2, (P[i][1] + P[(i + 1) % 4][1]) / 2];
  return e(0) + e(2) <= e(1) + e(3) ? { a: mid(0), b: mid(2), w: (e(0) + e(2)) / 2 } : { a: mid(1), b: mid(3), w: (e(1) + e(3)) / 2 };
}

/** Effective permittivity for the frequency scale: microstrip when top copper sits over bottom copper, else a bare-substrate trace. */
export function standInEeff(p: Pcb): number {
  if (p.levels?.length) return printedEeff(p.er, p.h, narrowest(p)); // stacked boards: traces on bare laminate
  const tops = p.rects.filter((q) => q.layer === "top"), bots = p.rects.filter((q) => q.layer === "bottom");
  const over = tops.find((t) => bots.some((b) => !same(t, b) && t.x0 >= b.x0 - TOL && t.x1 <= b.x1 + TOL && t.y0 >= b.y0 - TOL && t.y1 <= b.y1 + TOL));
  if (over) return microstripEeff(p.er, Math.max(over.x1 - over.x0, over.y1 - over.y0) / p.h);
  return printedEeff(p.er, p.h, narrowest(p));
}

const same = (a: PcbRect, b: PcbRect) => Math.abs(a.x0 - b.x0) < 1e-7 && Math.abs(a.x1 - b.x1) < 1e-7 && Math.abs(a.y0 - b.y0) < 1e-7 && Math.abs(a.y1 - b.y1) < 1e-7;

/**
 * The stand-in design (wires, centre feed) and the frequency to solve it at. Null when the port cannot be joined to
 * copper on both sides.
 */
export function pcbStandIn(d: Design): { design: Design; fs: number } | null {
  const p = d.pcb;
  if (!p) return null;
  const fs = d.f * Math.sqrt(standInEeff(p)) * STANDIN_K;
  const smax = wavelength(fs) / 12;
  const shapes: Shape[] = [];
  for (const plane of copperPlanes(p)) {
    const z = plane.z;
    // a pour repeated on both faces of the main board (stitched) is one conductor: keep the top one
    const dup = (q: PcbRect) => z === 0 && p.rects.some((t) => t.layer === "top" && same(t, q));
    for (const q of plane.rects) {
      if (q.layer === "bottom" && dup(q)) continue;
      const wx = q.x1 - q.x0, wy = q.y1 - q.y0, short = Math.min(wx, wy);
      const box = { x0: q.x0, y0: q.y0, x1: q.x1, y1: q.y1 };
      if (short <= smax / 2 || Math.max(wx, wy) >= 3 * short) {
        const ym = (q.y0 + q.y1) / 2, xm = (q.x0 + q.x1) / 2;
        const w: Wire = wx >= wy ? { a: [q.x0, ym, z], b: [q.x1, ym, z], r: traceRadius(wy) } : { a: [xm, q.y0, z], b: [xm, q.y1, z], r: traceRadius(wx) };
        shapes.push({ z, box, wires: [{ ...w, group: "driven" }] });
      } else {
        const m = Math.max(1, Math.ceil(wx / smax)), n = Math.max(1, Math.ceil(wy / smax)), rr = Math.min(wx / m, wy / n) / (2 * Math.PI);
        const node = (i: number, j: number): Vec3 => [q.x0 + (wx * i) / m, q.y0 + (wy * j) / n, z];
        const ws: Wire[] = [];
        for (let i = 0; i <= m; i++)
          for (let j = 0; j <= n; j++) {
            if (i < m) ws.push({ a: node(i, j), b: node(i + 1, j), r: rr, group: "driven" });
            if (j < n) ws.push({ a: node(i, j), b: node(i, j + 1), r: rr, group: "driven" });
          }
        shapes.push({ z, box, wires: ws });
      }
    }
    for (const q of plane.polys) {
      const xs = q.pts.map((t) => t[0]), ys = q.pts.map((t) => t[1]);
      const box = { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
      const c = polyLine(q), r0 = traceRadius(q.w ?? narrowest(p));
      const ws: Wire[] = q.path
        ? q.path.slice(1).map((t, i) => ({ a: [q.path![i][0], q.path![i][1], z] as Vec3, b: [t[0], t[1], z] as Vec3, r: r0, group: "driven" as const }))
        : c
          ? [{ a: [c.a[0], c.a[1], z], b: [c.b[0], c.b[1], z], r: traceRadius(c.w), group: "driven" }]
          : q.pts.map((t, i) => { const u = q.pts[(i + 1) % q.pts.length]; return { a: [t[0], t[1], z] as Vec3, b: [u[0], u[1], z] as Vec3, r: r0, group: "driven" as const }; });
      shapes.push({ z, box, wires: ws.filter((w) => dist(w.a, w.b) > TOL), poly: q.pts });
    }
  }
  // solid conductors (the coax shield): a wire up their axis, λs/2 long when they run out of the model
  const columns = (p.pec ?? []).map((b) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, z0 = Math.max(b.z0, b.z1 - wavelength(fs) / 2);
    return { b, wire: { a: [cx, cy, z0] as Vec3, b: [cx, cy, b.z1] as Vec3, r: Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2, group: "feed" as const } };
  });

  const cuts = new Map<Wire, number[]>();
  const links: Wire[] = [];
  /** Nearest point on any of the wires to pt; registers the split. */
  const attach = (ws: Wire[], pt: Vec3): { q: Vec3; d: number; r: number } | null => {
    let best: { w: Wire; q: Vec3; t: number; d: number } | null = null;
    for (const w of ws) { const c = closest(w.a, w.b, pt), dd = dist(c.q, pt); if (!best || dd < best.d) best = { w, ...c, d: dd }; }
    if (!best) return null;
    if (best.t > 1e-6 && best.t < 1 - 1e-6) cuts.set(best.w, [...(cuts.get(best.w) ?? []), best.t]);
    return { q: best.t <= 1e-6 ? best.w.a : best.t >= 1 - 1e-6 ? best.w.b : best.q, d: best.d, r: best.w.r };
  };
  const link = (a: Vec3, b: Vec3, r: number) => { if (dist(a, b) > TOL) links.push({ a, b, r, group: "driven" }); };
  const onShape = (s: Shape, x: number, y: number) => !s.poly || inPolyLoose(s.poly, x, y, 1e-4);

  // join every pair of touching or overlapping shapes on a plane at the centre of their common area
  const eps = 1e-7;
  for (let i = 0; i < shapes.length; i++)
    for (let j = i + 1; j < shapes.length; j++) {
      const A = shapes[i], B = shapes[j];
      if (A.z !== B.z) continue;
      const x0 = Math.max(A.box.x0, B.box.x0), x1 = Math.min(A.box.x1, B.box.x1), y0 = Math.max(A.box.y0, B.box.y0), y1 = Math.min(A.box.y1, B.box.y1);
      if (x0 > x1 + eps || y0 > y1 + eps) continue;
      const P: Vec3 = [(x0 + x1) / 2, (y0 + y1) / 2, A.z];
      // polygons: only when the meeting point is really on both (bounding boxes of diagonal strips overlap loosely)
      if (!onShape(A, P[0], P[1]) || !onShape(B, P[0], P[1])) continue;
      const qa = attach(A.wires, P), qb = attach(B.wires, P);
      if (qa && qb) link(qa.q, qb.q, Math.min(qa.r, qb.r));
    }
  // copper the shield column passes through or ends on
  for (const c of columns)
    for (const s of shapes) {
      if (s.z < c.wire.a[2] - eps || s.z > c.wire.b[2] + eps) continue;
      const P: Vec3 = [c.wire.a[0], c.wire.a[1], s.z];
      if (P[0] < s.box.x0 - eps || P[0] > s.box.x1 + eps || P[1] < s.box.y0 - eps || P[1] > s.box.y1 + eps || !onShape(s, P[0], P[1])) continue;
      const qc = attach([c.wire], P), qs = attach(s.wires, P);
      if (qc && qs && qs.d <= Math.max(c.b.x1 - c.b.x0, c.b.y1 - c.b.y0) * 2) link(qc.q, qs.q, Math.min(qc.r, qs.r));
    }

  // feed wire across the port, each end joined to the nearest copper (or shield) at its height
  const { start: s0, stop: s1, dir } = p.port;
  const ax = dir === "x" ? 0 : dir === "y" ? 1 : 2;
  const c = scale(add(s0, s1), 0.5);
  const fa: Vec3 = [...c] as Vec3, fb: Vec3 = [...c] as Vec3;
  fa[ax] = Math.min(s0[ax], s1[ax]); fb[ax] = Math.max(s0[ax], s1[ax]);
  if (dist(fa, fb) < TOL) return null;
  const portW = Math.max(Math.abs(s1[0] - s0[0]), Math.abs(s1[1] - s0[1]), 1e-4);
  const planes = [...new Set(shapes.map((s) => s.z))];
  const ends: Vec3[] = [];
  for (const e of [fa, fb]) {
    const zp = planes.reduce((a, b) => (Math.abs(b - e[2]) < Math.abs(a - e[2]) ? b : a), planes[0]);
    const ws = [...shapes.filter((s) => s.z === zp).flatMap((s) => s.wires), ...columns.filter((cl) => Math.abs(cl.wire.b[2] - e[2]) < 1e-9).map((cl) => cl.wire)];
    const q = attach(ws, e);
    if (!q || q.d > 2 * Math.max(portW, dist(fa, fb))) return null;
    ends.push(q.q);
  }
  const feed: Wire = { a: ends[0], b: ends[1], r: traceRadius(portW), group: "feed" };

  const wires: Wire[] = [feed];
  // the same span twice (a keyhole's slit, its closing edge) would make the MoM matrix singular
  const seen = new Set<string>();
  const k = (a: Vec3, b: Vec3) => [a, b].map((v) => v.map((c) => c.toExponential(6)).join(",")).sort().join("|");
  const put = (w: Wire) => { const key = k(w.a, w.b); if (!seen.has(key)) { seen.add(key); wires.push(w); } };
  put(feed); wires.length = 1;
  for (const w of [...shapes.flatMap((s) => s.wires), ...columns.map((c) => c.wire), ...links]) {
    const ts = [...new Set(cuts.get(w) ?? [])].sort((a, b) => a - b);
    let prev = w.a;
    for (const t of ts) { const q = add(w.a, scale(sub(w.b, w.a), t)); if (dist(prev, q) > TOL) put({ ...w, a: prev, b: q }); prev = q; }
    if (dist(prev, w.b) > TOL) put({ ...w, a: prev, b: w.b });
  }
  return {
    fs,
    design: { wires, plates: [], feed: { wire: 0, at: "center" }, dims: [], tables: [], perf: [], notes: [], necSupported: true, f: fs, sweeps: [] },
  };
}

/** Inside the polygon or within tol of its outline. */
function inPolyLoose(pts: [number, number][], x: number, y: number, tol: number): boolean {
  if (inPoly(pts, x, y)) return true;
  return pts.some((a, i) => { const b = pts[(i + 1) % pts.length]; return dist(closest([a[0], a[1], 0], [b[0], b[1], 0], [x, y, 0]).q, [x, y, 0]) <= tol; });
}
