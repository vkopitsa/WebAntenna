import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Params } from "../../types";
import { num, str } from "../../types";
import { FAIL, msg, PartError, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";
import { add, box, pieceBottoms, rod, scale, type V3 } from "../shapes";
import { helixGeometry } from "../families/former";
import { centreHubBox, dipoleArms } from "../families/centre";
import { yagiDrivenBox } from "../families/boom";
import { D_IN, D_LUG, PLATE, disconeGeometry, hubGeometry } from "../families/hub";
import { moxonParts, quadGeometry, quadParts } from "../families/spreader";
import { boxFits, domeFits, envelope, exits, feedPoint, grow, STYLE, styleOf, type Box3, type Exit, type Style } from "./geometry";
import { clamshell } from "./clamshell";
import { dome, domeHeight, domeOffset, type DomeOpts } from "./dome";
import { hood } from "./hood";
import { pcbShell } from "./pcbbox";

/** Shells: dome radome, clamshell box or feedpoint hood. */
export const SHELL_STRINGS = [
  "Radome shell",
  "Enclosure",
  "Feedpoint weather box",
  "Covers the antenna with a {0} wall, keeping {1} of air round the radiator.",
  "Covers the feedpoint and the connector from above: slots let the wires out, the open bottom lets water drain.",
  "A plastic shell lowers the resonance by about 1–3 %: retune with Trim (printed antennas: check with the FDTD simulation).",
  "Connector cover",
  "Covers the connector under the reflector, against its underside: the coax leaves through the hole in the floor.",
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
    "Print it on its flat top.",
    "Solder and test the feedpoint first, then lower the hood over it so the wires slide into their slots.",
    "Seal the slots and the top hole with silicone.",
  ],
  /** Helix too large for a radome: the cover over the panel jack under the reflector. */
  jack: [
    "Print it on its flat floor.",
    "Thread the coax through the floor hole first, then mount the panel jack, connect the coax and press the open top against the underside of the reflector.",
    "Seal the rim to the reflector and the coax hole with silicone.",
  ],
  pcb: [
    "Print each half on its flat outer face.",
    "Solder the coax pigtail (or the SMA jack under a probe feed) to the board, then lay the board in the bottom half between its edge stops, with the coax through its hole.",
    "Close the top half and fit four M3 screws and nuts; where there are no posts, fix the board with a drop of hot glue next to the coax.",
  ],
  /** Ground plane only, before the sealing step. */
  gpMast: ["The mast must end at the top of the hub's side block: the hood sits over the plate above it."],
  /** Cloverleaf radome, before the last step. */
  clover: ["Cloverleaf: push the connector down through the hole in the bottom piece before gluing the pieces above, and fix it there with a drop of glue."],
  /** Dipole and fan dipole only, before the sealing step. */
  halyard: ["Pass the support rope through the hole in the top before tying it to the eye."],
};

const GLAND = 8;
const EYE_ROPE = 8;   // halyard hole above the dipole centre's hanging eye
const JACK_H = 25;
/** GP mast clearance: the hood's open bottom edge is the hub plate's underside, and the mast strapped to the hub's side
 *  block must end at or below it (its axis, gpMastAxis, runs under the hood's corner). */
export const GP_MAST_TOP = -PLATE;    // the hub plate's underside: the hood's bottom edge and the highest the mast may reach
/** Coax hole in the floor of the helix connector cover. */
export const JACK_HOLE = 8;
/** Hole in the cloverleaf radome's bottom plate: an SMA plug's coupling nut (8 mm hex) passes through. */
const CLOVER_JACK = 9.5;
const JACK = 30;                      // the cover's cavity: a 30 mm cube under the reflector (plus the gap)
/** Families whose feed part is built in the antenna's own frame, at the feed: a full box would cut through it, so they
 *  always get the feed hood. */
const FEED_HOLDER = new Set(["dipole", "fandipole", "groundplane", "yagi"]);
/** Families whose spreader hub fills the middle of the antenna: no full box either; the hood at the feed shrinks
 *  (HUB_CUBE, from 30 mm down to 12 mm) until it keeps the gap from the hub. */
const SPREADER = new Set(["moxon", "quad"]);
const HUB_CUBE = { max: 30, min: 12, step: 1 };

export type ShellPlan =
  | { kind: "dome"; style: Style; inner: Box3; opts: DomeOpts; toWorld: V3; pieceZ: (i: number, n: number) => number }
  | { kind: "box"; style: Style; inner: Box3; splitZ: number; gland: V3; toWorld?: undefined; pieceZ?: undefined }
  | { kind: "feed"; style: Style; inner: Box3; exits: Exit[]; hub?: boolean; toWorld?: undefined; pieceZ?: undefined }
  | { kind: "jack"; style: Style; inner: Box3; toWorld?: undefined; pieceZ?: undefined };

function domePlan(defId: string, p: Params, d: Design, s: Style): DomeOpts | null {
  const { wall, gap } = STYLE[s];
  if (defId === "helix") {
    const g = helixGeometry(d), fr = g.R + g.wireD / 2 + 8;
    return { r: g.R + g.wireD / 2 + gap, z0: 0, z1: Math.max(g.H, g.top + g.wireD / 2) + gap, wall, base: { kind: "flange", pocketR: fr + CLEAR, pocketH: 2 + CLEAR, ringR: fr + 10, holeR: fr + 5 }, drain: s === "outdoor" };
  }
  if (defId === "cloverleaf" || defId === "pagoda" || defId.startsWith("skycone")) {
    // the "mushroom": a round radome over the leaves (or the pagoda's boards, or the cones), the connector through the bottom plate
    const e = envelope(d), r = Math.max(...[e.lo[0], e.lo[1], e.hi[0], e.hi[1]].map(Math.abs)) + gap;
    return { r, z0: e.lo[2] - gap, z1: e.hi[2] + gap, wall, base: { kind: "mast", mastD: CLOVER_JACK }, drain: s === "outdoor" };
  }
  if (defId === "discone") {
    const g = disconeGeometry(d), e = envelope(d);
    const r = Math.max(...[e.lo[0], e.lo[1], e.hi[0], e.hi[1]].map(Math.abs)) + gap;
    return { r, z0: e.lo[2] - gap, z1: Math.max(g.top, e.hi[2]) + gap, wall, base: { kind: "mast", mastD: mm(num(p, "mast", 25e-3)) }, drain: s === "outdoor" };
  }
  return null;
}

/** Where a ray from p (inside b) along u leaves the box. */
function leave(b: Box3, p: V3, u: V3): V3 {
  let t = Infinity;
  for (let i = 0; i < 3; i++) if (Math.abs(u[i]) > 1e-12) t = Math.min(t, ((u[i] > 0 ? b.hi[i] : b.lo[i]) - p[i]) / u[i]);
  return add(p, scale(u, t));
}

/** Diameter of the circle round a `bar()` lug of width w along u (a hull of axis-aligned cubes): the widest cube
 *  corner across the axis; w·√2 for a lug along an axis, up to w·√3 when tilted. */
function lugD(w: number, u: V3): number {
  let m = Infinity;
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) m = Math.min(m, (sx * u[0] + sy * u[1] + sz * u[2]) ** 2);
  return w * Math.sqrt(3 - m);
}

const cubeAt = (c: V3, s: number): Box3 => ({ lo: [c[0] - s / 2, c[1] - s / 2, c[2] - s / 2], hi: [c[0] + s / 2, c[1] + s / 2, c[2] + s / 2] });

/** Feed hood: the cavity round the core of the family's feed part (plus the gap) and the exits through its walls. */
function feedHood(defId: string, p: Params, d: Design, gap: number): { inner: Box3; exits: Exit[] } {
  const fp = feedPoint(d);
  if (defId === "dipole" || defId === "fandipole") {
    // centre insulator hub; the arm lugs (square, w wide) leave through slots, the halyard through the roof
    const { wireD, gap: g, arms } = dipoleArms(d, defId === "dipole" ? ["driven"] : ["driven", "parasitic"]);
    const hb = centreHubBox(g, wireD), inner = grow({ lo: hb.lo, hi: hb.hi }, gap);
    return { inner, exits: [...arms.map((a) => ({ at: leave(inner, a.start, a.dir), dir: a.dir, d: lugD(hb.w, a.dir), w: hb.w, from: a.start })), { at: [0, 0, inner.hi[2]], dir: [0, 0, 1], d: EYE_ROPE, free: true }] };
  }
  if (defId === "groundplane") {
    // hub plate and the jack above it; the hood ends at the plate's underside, so the mast block and the coax plug stay out
    const g = hubGeometry(d), R = g.rLug + 2;
    const inner = grow({ lo: [-R, -R, -PLATE], hi: [R, R, JACK_H] }, gap);
    inner.lo[2] = GP_MAST_TOP;
    return { inner, exits: [...exits(d, inner).filter((x) => Math.abs(x.at[2] - inner.hi[2]) < 1e-6), ...g.paths.map((r) => ({ at: leave(inner, r.start, r.dir), dir: r.dir, d: lugD(g.w, r.dir), w: g.w, from: add(r.start, scale(r.dir, r.lugFrom)) }))] };
  }
  if (defId === "discone") {
    // the top disc ring; the cone, neck and mast stay below, out of the open bottom
    const g = disconeGeometry(d), R = D_IN + D_LUG;
    const inner = grow({ lo: [-R, -R, g.discZ - g.ch / 2 - WALL], hi: [R, R, g.top] }, gap);
    return { inner, exits: exits(d, inner) };
  }
  if (defId === "yagi" && str(p, "boom", "insulated") !== "through") {
    // the driven element block, at the driven element (its frame: element along y at z = 0, boom along x)
    const b = yagiDrivenBox(d), inner = grow({ lo: add(b.lo, fp), hi: add(b.hi, fp) }, gap);
    return { inner, exits: exits(d, inner) };
  }
  const inner = grow(cubeAt(fp, 30), gap);
  return { inner, exits: exits(d, inner) };
}

/** Pure choice of the shell (no building). */
export function shellPlan(defId: string, p: Params, d: Design): ShellPlan {
  const style = styleOf(d), { wall, gap } = STYLE[style];
  const dp = domePlan(defId, p, d, style);
  // the sky-tilted bicones bring their own cover (families/skycone.ts): the plan only describes it as a dome
  if (dp && (domeFits(dp.r, domeHeight(dp), wall) || defId.startsWith("skycone"))) {
    const H = domeHeight(dp);
    return { kind: "dome", style, inner: { lo: [-dp.r, -dp.r, dp.z0], hi: [dp.r, dp.r, dp.z1] }, opts: dp, toWorld: [0, 0, domeOffset(dp)], pieceZ: (i, n) => (n > 1 ? pieceBottoms(H)[i] : 0) };
  }
  if (defId === "helix") {
    // too large for a radome: a cover over the panel jack, mirrored under the reflector (open face up against it)
    const inner = grow(cubeAt([0, 0, -JACK / 2], JACK), gap);
    inner.hi[2] = 0;
    return { kind: "jack", style, inner };
  }
  const fp = feedPoint(d);
  if (!dp && !FEED_HOLDER.has(defId) && !SPREADER.has(defId)) {
    // full box: the coax gland goes down through the floor, at least a wall clear of the side walls (the cavity grows
    // in x or y if it is too narrow for that)
    const full = grow(envelope(d), gap), need = GLAND + 2 * wall, gland: V3 = [...fp];
    for (const i of [0, 1]) {
      const short = need - (full.hi[i] - full.lo[i]);
      if (short > 0) { full.lo[i] -= short / 2; full.hi[i] += short / 2; }
      gland[i] = Math.min(Math.max(fp[i], full.lo[i] + need / 2), full.hi[i] - need / 2);
    }
    if (boxFits(full, wall)) return { kind: "box", style, inner: full, splitZ: fp[2], gland };
  }
  // next to a spreader hub, inner/exits are the largest cube's; the hood actually built comes from hubHood()
  return { kind: "feed", style, ...feedHood(defId, p, d, gap), ...(SPREADER.has(defId) ? { hub: true } : {}) };
}

/** Spreader hubs in world frame: the Moxon hub at the origin, one quad hub at each loop's x. */
function spreaderHubs(M: ManifoldToplevel, defId: string, p: Params, d: Design): Manifold[] {
  if (defId === "moxon") return moxonParts(p, d)[0].build(M);
  if (defId === "quad") { const [hub] = quadParts(p, d)[0].build(M); return quadGeometry(d).loops.map((l) => hub.translate([l.x, 0, 0])); }
  return [];
}

/** The Moxon / quad feed hood: the largest cube at the feed point (30 mm down to 12 mm) whose hood, grown by the gap,
 *  stays clear of the hubs' built meshes; null when even the smallest does not. */
export function hubHood(M: ManifoldToplevel, defId: string, p: Params, d: Design): { inner: Box3; exits: Exit[] } | null {
  const { wall, gap } = STYLE[styleOf(d)], fp = feedPoint(d), hubs = spreaderHubs(M, defId, p, d);
  for (let s = HUB_CUBE.max; s >= HUB_CUBE.min; s -= HUB_CUBE.step) {
    const inner = grow(cubeAt(fp, s), gap), keep = grow(inner, wall + gap), k = box(M, keep.lo, keep.hi);
    if (hubs.every((h) => h.intersect(k).volume() < 1e-2)) return { inner, exits: exits(d, inner) };
  }
  return null;
}

/** How-to steps: the hood gets the GP mast note or the dipole halyard step before its sealing step. */
function howTo(defId: string, kind: Exclude<ShellPlan["kind"], "jack">): string[] {
  const st = SHELL_HOWTO[kind];
  if (kind === "dome" && defId === "cloverleaf") return [...st.slice(0, -1), ...SHELL_HOWTO.clover, st[st.length - 1]];
  if (kind !== "feed") return st;
  const extra = defId === "groundplane" ? SHELL_HOWTO.gpMast : defId === "dipole" || defId === "fandipole" ? SHELL_HOWTO.halyard : [];
  return [...st.slice(0, -1), ...extra, st[st.length - 1]];
}

export function shellFor(defId: string, p: Params, d: Design, printed: boolean): PartSpec | null {
  const style = styleOf(d), { wall, gap } = STYLE[style];
  const L = (x: number) => ({ len: x / 1000 });
  if (printed) return {
    id: "shell", title: SHELL_STRINGS[1], use: "holder", qty: 1,
    purpose: msg(SHELL_STRINGS[3], L(wall), L(gap)), warn: msg(SHELL_STRINGS[5]),
    howTo: (d.pcb ? SHELL_HOWTO.pcb : SHELL_HOWTO.box).map((s) => msg(s)),   // the PCB loop has no board model: a plain box
    build: (M: ManifoldToplevel) => pcbShell(M, d),
  };
  const plan = shellPlan(defId, p, d);
  if (plan.kind === "jack") {
    const i = plan.inner, h = i.hi[2] - i.lo[2];
    return {
      id: "shell", title: SHELL_STRINGS[6], use: "holder", qty: 1,
      purpose: msg(SHELL_STRINGS[7]), howTo: SHELL_HOWTO.jack.map((s) => msg(s)),
      // a hood built upside down (open face at z = 0, floor on top) and mirrored under the reflector; the hood's round
      // roof hole is d + CLEAR + 1 across
      build: (M: ManifoldToplevel) => [hood(M, {
        inner: { lo: [i.lo[0], i.lo[1], 0], hi: [i.hi[0], i.hi[1], h] }, wall,
        exits: [{ at: [0, 0, h], dir: [0, 0, 1], d: JACK_HOLE - CLEAR - 1, free: true }],
      })[0].mirror([0, 0, 1])],
    };
  }
  const titles = { dome: SHELL_STRINGS[0], box: SHELL_STRINGS[1], feed: SHELL_STRINGS[2] };
  return {
    id: "shell", title: titles[plan.kind], use: "holder", qty: 1,
    purpose: plan.kind === "feed" ? msg(SHELL_STRINGS[4]) : msg(SHELL_STRINGS[3], L(wall), L(gap)),
    warn: plan.kind === "feed" ? undefined : msg(SHELL_STRINGS[5]),
    howTo: howTo(defId, plan.kind).map((s) => msg(s)),
    build: (M: ManifoldToplevel) => {
      if (plan.kind === "dome") return dome(M, plan.opts);
      if (plan.kind === "feed" && plan.hub) {
        const h = hubHood(M, defId, p, d);
        if (!h) throw new PartError(msg(FAIL.room));
        return hood(M, { inner: h.inner, wall, exits: h.exits });
      }
      if (plan.kind === "feed") return hood(M, { inner: plan.inner, wall, exits: plan.exits });   // buildPart reports "Too large"
      const g = plan.gland, cuts = [rod(M, [g[0], g[1], plan.inner.lo[2] - wall - 2], [g[0], g[1], plan.inner.lo[2] + 1], GLAND)];
      return clamshell(M, { inner: plan.inner, wall, splitZ: plan.splitZ, cuts, drain: style === "outdoor" });
    },
  };
}
