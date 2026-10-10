import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Params, Vec3 } from "../../types";
import { num } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, mm } from "../rules";
import { add, pieceBottoms, rod, scale, type V3 } from "../shapes";
import { helixGeometry } from "../families/former";
import { disconeGeometry, gpMastAxis } from "../families/hub";
import { boxFits, domeFits, envelope, exits, feedPoint, grow, STYLE, styleOf, type Box3, type Exit, type Style } from "./geometry";
import { clamshell, EAR_R, earCentres } from "./clamshell";
import { dome, domeHeight, domeOffset, type DomeOpts } from "./dome";

/** Shells: dome radome, clamshell box or feedpoint weather box. */
export const SHELL_STRINGS = [
  "Radome shell",
  "Enclosure",
  "Feedpoint weather box",
  "Covers the antenna with a {0} wall, keeping {1} of air round the radiator.",
  "Seals the feedpoint and the connector: one hole per wire, a coax gland underneath and a drain hole.",
  "A plastic shell lowers the resonance by about 1–3 %: retune with Trim (printed antennas: check with the FDTD simulation).",
];

/** How-to steps, in order. */
export const SHELL_HOWTO = {
  dome: [
    "Print the pieces standing on their wide end; glue each skirt over the piece below.",
    "Build and tune the antenna first, then lower the radome over it.",
    "Screw the flange to the reflector with three M3 screws (or push the mast through the bottom plate), keeping the drain hole at the bottom.",
  ],
  box: [
    "Print each half on its flat outer face.",
    "Lay the antenna into the bottom half with the wires through their holes and the coax through the gland.",
    "Run a bead of silicone along the lip outdoors, close the top half and fit four M3 screws and nuts.",
  ],
  feed: [
    "Print each half on its flat outer face.",
    "Thread the wires through their holes before soldering the feedpoint; the coax goes in through the gland underneath.",
    "Fill the wire holes with silicone, close the box on its lip and fit four M3 screws and nuts; keep the drain hole at the bottom.",
  ],
};

const GLAND = 8;
/** The family part that sits at the feed point (sizes the feed box); `world` parts are built in world coordinates. */
const FEED_PART: Record<string, { ids: string[]; world: boolean }> = {
  dipole: { ids: ["dipole-centre"], world: true }, fandipole: { ids: ["fan-centre"], world: true },
  groundplane: { ids: ["gp-hub"], world: true }, discone: { ids: ["discone-hub"], world: true }, helix: { ids: ["helix-tube"], world: true },
  yagi: { ids: ["yagi-driven", "yagi-drill"], world: false }, biquad: { ids: ["biquad-standoff"], world: false },
};

export type ShellPlan =
  | { kind: "dome"; style: Style; inner: Box3; opts: DomeOpts; toWorld: V3; pieceZ: (i: number, n: number) => number }
  | { kind: "box" | "feed"; style: Style; inner: Box3; splitZ: number; extra: Exit[]; gland: V3; turn: number; frame: Design; toWorld?: undefined; pieceZ?: undefined };

/** Turn a point (mm) by `deg` about the vertical axis through `c`. */
const turnPt = (p: V3, deg: number, c: V3): V3 => {
  const a = (deg * Math.PI) / 180, x = p[0] - c[0], y = p[1] - c[1];
  return [c[0] + Math.cos(a) * x - Math.sin(a) * y, c[1] + Math.sin(a) * x + Math.cos(a) * y, p[2]];
};
/** The design's wires turned by `deg` about the vertical axis through `c` (mm). */
export function turnDesign(d: Design, deg: number, c: V3): Design {
  if (!deg) return d;
  const t = (p: Vec3): Vec3 => turnPt([p[0] * 1000, p[1] * 1000, p[2] * 1000], deg, c).map((v) => v / 1000) as Vec3;
  return { ...d, wires: d.wires.map((w) => ({ ...w, a: t(w.a), b: t(w.b) })) };
}

function domePlan(defId: string, p: Params, d: Design, s: Style): DomeOpts | null {
  const { wall, gap } = STYLE[s];
  if (defId === "helix") {
    const g = helixGeometry(d), fr = g.R + g.wireD / 2 + 8;
    return { r: g.R + g.wireD / 2 + gap, z0: 0, z1: Math.max(g.H, g.top + g.wireD / 2) + gap, wall, base: { kind: "flange", pocketR: fr + CLEAR, pocketH: 2 + CLEAR, ringR: fr + 10, holeR: fr + 5 }, drain: s === "outdoor" };
  }
  if (defId === "discone") {
    const g = disconeGeometry(d), e = envelope(d);
    const r = Math.max(...[e.lo[0], e.lo[1], e.hi[0], e.hi[1]].map(Math.abs)) + gap;
    return { r, z0: e.lo[2] - gap, z1: Math.max(g.top, e.hi[2]) + gap, wall, base: { kind: "mast", mastD: mm(num(p, "mast", 25e-3)) }, drain: s === "outdoor" };
  }
  return null;
}

/** Vertices (mm) of the family's feed part, built once; null when the antenna has none. */
function feedPartPoints(M: ManifoldToplevel, defId: string, family: PartSpec[]): V3[] | null {
  const fpart = FEED_PART[defId] && family.find((x) => FEED_PART[defId].ids.includes(x.id));
  if (!fpart) return null;
  const m = fpart.build(M)[0].getMesh(), v = m.vertProperties, k = m.numProp, out: V3[] = [];
  for (let i = 0; i < v.length; i += k) out.push([v[i], v[i + 1], v[i + 2]]);
  return out;
}

/** Feed box cavity: a cube centred at the feed point, big enough for the family's feed part (`pts`, in the box frame).
 *  A world-frame part far off centre (the discone hub hangs ~100 mm below its feed point) can double that cube past the
 *  bed; then the cavity is the part's own bounding box joined with the 30 mm cube round the feed point (which keeps the
 *  split inside). */
function feedInner(defId: string, fp: V3, pts: V3[] | null, gap: number, wall: number): Box3 {
  const cube = (s: number): Box3 => grow({ lo: [fp[0] - s / 2, fp[1] - s / 2, fp[2] - s / 2], hi: [fp[0] + s / 2, fp[1] + s / 2, fp[2] + s / 2] }, gap);
  if (!pts?.length) return cube(30);
  const b = { min: [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i]))), max: [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i]))) };
  if (!FEED_PART[defId].world) return cube(Math.max(30, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2])));
  const c = cube(Math.max(30, 2 * Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(b.min[i] - fp[i]), Math.abs(b.max[i] - fp[i])]))));
  if (boxFits(c, wall)) return c;
  return grow({ lo: [0, 1, 2].map((i) => Math.min(b.min[i], fp[i] - 15)) as V3, hi: [0, 1, 2].map((i) => Math.max(b.max[i], fp[i] + 15)) as V3 }, gap);
}

/** Distance between two segments in the xy plane. */
function segDist(p: V3, q: V3, a: V3, b: V3): number {
  const ptSeg = (x: V3, u: V3, v: V3) => {
    const dx = v[0] - u[0], dy = v[1] - u[1], L = dx * dx + dy * dy;
    const t = L < 1e-12 ? 0 : Math.max(0, Math.min(1, ((x[0] - u[0]) * dx + (x[1] - u[1]) * dy) / L));
    return Math.hypot(x[0] - u[0] - t * dx, x[1] - u[1] - t * dy);
  };
  const cr = (o: V3, u: V3, v: V3) => (u[0] - o[0]) * (v[1] - o[1]) - (u[1] - o[1]) * (v[0] - o[0]);
  if (cr(p, q, a) * cr(p, q, b) < 0 && cr(a, b, p) * cr(a, b, q) < 0) return 0;
  return Math.min(ptSeg(p, a, b), ptSeg(q, a, b), ptSeg(a, p, q), ptSeg(b, p, q));
}

/** Smallest clearance (mm) between any wire hole and a screw ear (ear circle and its bridge to the box corner). */
function earClearance(xs: Exit[], inner: Box3, wall: number): number {
  const out = grow(inner, wall);
  let min = Infinity;
  for (const c of earCentres(inner, wall)) {
    const corner: V3 = [c[0] > out.lo[0] ? out.hi[0] : out.lo[0], c[1] > out.lo[1] ? out.hi[1] : out.lo[1], 0];
    for (const x of xs) min = Math.min(min, segDist(x.at, add(x.at, scale(x.dir, wall + 8)), c, corner) - EAR_R - (x.d + CLEAR + 1) / 2);
  }
  return min;
}

/** Pure choice of the shell (no building): the feed box's inner size from the feed part is only known at build time,
 *  so without `M` the plan uses the 30 mm default there; `shellFor` refines it. */
export function shellPlan(defId: string, p: Params, d: Design, M: ManifoldToplevel | null = null, family: PartSpec[] = []): ShellPlan {
  const style = styleOf(d), { wall, gap } = STYLE[style];
  const dp = domePlan(defId, p, d, style);
  if (dp && domeFits(dp.r, dp.z1 - dp.z0, wall)) {
    const H = domeHeight(dp);
    return { kind: "dome", style, inner: { lo: [-dp.r, -dp.r, dp.z0], hi: [dp.r, dp.r, dp.z1] }, opts: dp, toWorld: [0, 0, domeOffset(dp)], pieceZ: (i, n) => (n > 1 ? pieceBottoms(H)[i] : 0) };
  }
  const fp = feedPoint(d);
  const full = grow(envelope(d), gap);
  if (!dp && boxFits(full, wall)) return { kind: "box", style, inner: full, splitZ: fp[2], extra: [], gland: fp, turn: 0, frame: d };
  // feed box: radial wires (discone rods) can run through a corner screw ear; then turn the box about the vertical axis
  // through the feed point (1 degree steps) to the angle that keeps every wire hole furthest from the ears
  const pts = M ? feedPartPoints(M, defId, family) : null;
  const at = (turn: number) => {
    const frame = turnDesign(d, -turn, fp), inner = feedInner(defId, fp, pts && turn ? pts.map((q) => turnPt(q, -turn, fp)) : pts, gap, wall);
    const extra: Exit[] = [];
    if (defId === "discone") { const m = turnPt([0, 0, 0], -turn, fp); extra.push({ at: [m[0], m[1], inner.lo[2]], dir: [0, 0, -1], d: mm(num(p, "mast", 25e-3)) }); }
    if (defId === "groundplane") { const m = turnPt(gpMastAxis(d), -turn, fp); extra.push({ at: [m[0], m[1], inner.lo[2]], dir: [0, 0, -1], d: 30 }, { at: [m[0], m[1], inner.hi[2]], dir: [0, 0, 1], d: 30 }); }
    return { turn, frame, inner, extra, clear: earClearance(exits(frame, inner), inner, wall) };
  };
  let best = at(0);
  for (let t = 1; t < 90 && best.clear < 0.5; t++) { const c = at(t); if (c.clear > best.clear) best = c; }
  return { kind: "feed", style, inner: best.inner, splitZ: fp[2], extra: best.extra, gland: fp, turn: best.turn, frame: best.frame };
}

function holes(M: ManifoldToplevel, xs: Exit[], wall: number): Manifold[] {
  return xs.map((x) => rod(M, add(x.at, scale(x.dir, -wall - 2)), add(x.at, scale(x.dir, wall + 8)), x.d + CLEAR + 1));
}

export function shellFor(defId: string, p: Params, d: Design, family: PartSpec[], category: string): PartSpec | null {
  if (category === "Printed") return null;                        // printed antennas: Task 5
  const style = styleOf(d), { wall, gap } = STYLE[style];
  const first = shellPlan(defId, p, d);
  const L = (x: number) => ({ len: x / 1000 });
  const titles = { dome: SHELL_STRINGS[0], box: SHELL_STRINGS[1], feed: SHELL_STRINGS[2] };
  return {
    id: "shell", title: titles[first.kind], use: "holder", qty: 1,
    purpose: first.kind === "feed" ? msg(SHELL_STRINGS[4]) : msg(SHELL_STRINGS[3], L(wall), L(gap)),
    warn: first.kind === "feed" ? undefined : msg(SHELL_STRINGS[5]),
    howTo: SHELL_HOWTO[first.kind].map((s) => msg(s)),
    build: (M) => {
      const plan = first.kind === "feed" ? shellPlan(defId, p, d, M, family) : first;
      if (plan.kind === "dome") return dome(M, plan.opts);
      const xs = [...exits(plan.frame, plan.inner), ...plan.extra];
      const cuts = [...holes(M, xs, wall), rod(M, [plan.gland[0], plan.gland[1], plan.inner.lo[2] - wall - 2], [plan.gland[0], plan.gland[1], plan.inner.lo[2] + 1], GLAND)];
      const halves = clamshell(M, { inner: plan.inner, wall, splitZ: plan.splitZ, cuts, drain: style === "outdoor" });
      const g = plan.gland;   // back from the box frame to the world (the gland axis is the turn axis)
      return plan.turn ? halves.map((h) => h.translate([-g[0], -g[1], 0]).rotate([0, 0, plan.turn]).translate([g[0], g[1], 0])) : halves;
    },
  };
}
