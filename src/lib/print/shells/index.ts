import type { ManifoldToplevel } from "manifold-3d";
import type { Design, Params } from "../../types";
import { num, str } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";
import { add, pieceBottoms, rod, scale, type V3 } from "../shapes";
import { helixGeometry } from "../families/former";
import { centreHubBox, dipoleArms } from "../families/centre";
import { yagiDrivenBox } from "../families/boom";
import { D_IN, D_LUG, PLATE, disconeGeometry, hubGeometry } from "../families/hub";
import { boxFits, domeFits, envelope, exits, feedPoint, grow, STYLE, styleOf, type Box3, type Exit, type Style } from "./geometry";
import { clamshell } from "./clamshell";
import { dome, domeHeight, domeOffset, type DomeOpts } from "./dome";
import { hood } from "./hood";

/** Shells: dome radome, clamshell box or feedpoint hood. */
export const SHELL_STRINGS = [
  "Radome shell",
  "Enclosure",
  "Feedpoint weather box",
  "Covers the antenna with a {0} wall, keeping {1} of air round the radiator.",
  "Covers the feedpoint and the connector from above: slots let the wires out, the open bottom lets water drain.",
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
    "Print it on its flat top.",
    "Solder and test the feedpoint first, then lower the hood over it so the wires slide into their slots.",
    "Seal the slots and the top hole with silicone.",
  ],
  /** Ground plane only, before the sealing step. */
  gpMast: ["The mast must end at the top of the hub's side block: the hood sits over the plate above it."],
  /** Dipole and fan dipole only, before the sealing step. */
  halyard: ["Pass the support rope through the hole in the top before tying it to the eye."],
};

const GLAND = 8;
const EYE_ROPE = 8;   // halyard hole above the dipole centre's hanging eye
const JACK_H = 25;
/** GP mast clearance: the hood's open bottom edge is the hub plate's underside, and the mast strapped to the hub's side
 *  block must end at or below it (its axis, gpMastAxis, runs under the hood's corner). */
export const GP_MAST_TOP = -PLATE;    // room above the GP hub plate for the panel jack and the solder joints

export type ShellPlan =
  | { kind: "dome"; style: Style; inner: Box3; opts: DomeOpts; toWorld: V3; pieceZ: (i: number, n: number) => number }
  | { kind: "box"; style: Style; inner: Box3; splitZ: number; gland: V3; toWorld?: undefined; pieceZ?: undefined }
  | { kind: "feed"; style: Style; inner: Box3; exits: Exit[]; toWorld?: undefined; pieceZ?: undefined };

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
    return { inner, exits: [...arms.map((a) => ({ at: leave(inner, a.start, a.dir), dir: a.dir, d: lugD(hb.w, a.dir), w: hb.w, from: a.start })), { at: [0, 0, inner.hi[2]], dir: [0, 0, 1], d: EYE_ROPE }] };
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
  if (dp && domeFits(dp.r, dp.z1 - dp.z0, wall)) {
    const H = domeHeight(dp);
    return { kind: "dome", style, inner: { lo: [-dp.r, -dp.r, dp.z0], hi: [dp.r, dp.r, dp.z1] }, opts: dp, toWorld: [0, 0, domeOffset(dp)], pieceZ: (i, n) => (n > 1 ? pieceBottoms(H)[i] : 0) };
  }
  const fp = feedPoint(d);
  if (!dp) {
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
  return { kind: "feed", style, ...feedHood(defId, p, d, gap) };
}

/** How-to steps: the hood gets the GP mast note or the dipole halyard step before its sealing step. */
function howTo(defId: string, kind: ShellPlan["kind"]): string[] {
  const st = SHELL_HOWTO[kind];
  if (kind !== "feed") return st;
  const extra = defId === "groundplane" ? SHELL_HOWTO.gpMast : defId === "dipole" || defId === "fandipole" ? SHELL_HOWTO.halyard : [];
  return [...st.slice(0, -1), ...extra, st[st.length - 1]];
}

export function shellFor(defId: string, p: Params, d: Design, category: string): PartSpec | null {
  if (category === "Printed") return null;                        // printed antennas: Task 5
  const style = styleOf(d), { wall, gap } = STYLE[style];
  const plan = shellPlan(defId, p, d);
  const L = (x: number) => ({ len: x / 1000 });
  const titles = { dome: SHELL_STRINGS[0], box: SHELL_STRINGS[1], feed: SHELL_STRINGS[2] };
  return {
    id: "shell", title: titles[plan.kind], use: "holder", qty: 1,
    purpose: plan.kind === "feed" ? msg(SHELL_STRINGS[4]) : msg(SHELL_STRINGS[3], L(wall), L(gap)),
    warn: plan.kind === "feed" ? undefined : msg(SHELL_STRINGS[5]),
    howTo: howTo(defId, plan.kind).map((s) => msg(s)),
    build: (M: ManifoldToplevel) => {
      if (plan.kind === "dome") return dome(M, plan.opts);
      if (plan.kind === "feed") return hood(M, { inner: plan.inner, wall, exits: plan.exits });   // buildPart reports "Too large"
      const g = plan.gland, cuts = [rod(M, [g[0], g[1], plan.inner.lo[2] - wall - 2], [g[0], g[1], plan.inner.lo[2] + 1], GLAND)];
      return clamshell(M, { inner: plan.inner, wall, splitZ: plan.splitZ, cuts, drain: style === "outdoor" });
    },
  };
}
