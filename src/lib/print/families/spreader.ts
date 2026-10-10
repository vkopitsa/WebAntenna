import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Params, Vec3 } from "../../types";
import { num } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";
import { add, bar, box, channel, m3, rod, scale, sub, toZ, unit, zipSlot, type V3 } from "../shapes";

/** Moxon and quad: spreader hubs, corner caps and the Moxon tip-gap insulator. */
export const SPREADER_STRINGS = [
  "Moxon spreader hub",
  "Corner cap, front (driver)",
  "Corner cap, back (reflector)",
  "Tip-gap insulator",
  "Quad spreader hub",
  "Corner cap",
  "Holds 4 spreader rods of {0} pointing at the corners of the {1} × {2} wire rectangle. Zip-tie the block to the mast.",
  "Fits on the spreader rod end and holds the wire corner in an outward-open groove.",
  "Joins a driver tip to a reflector tip with the holes exactly {0} apart, the gap that sets the Moxon's pattern.",
  "Fits on a {0} boom and holds 4 spreader rods of {1} at 45°; one per loop.",
];

/** How-to steps, in order. */
export const SPREADER_HOWTO = {
  hub: [
    "Push the spreader rods into the sockets and lock each with an M3 screw; the nut drops into the pocket on top.",
    "Mark each rod at the corner distance from the cut list and fit a corner cap there.",
    "Strap the block under the hub to the mast with two zip ties.",
  ],
  cap: [
    "Push the cap onto the rod end; trim the rod so the corner lands at the designed position.",
    "Press the wire corner into the groove from outside; a drop of glue or a short zip tie keeps it there.",
  ],
  gap: [
    "Pass each wire tip through its hole, fold it back and twist it round itself, so the hole centres set the gap.",
    "Use one insulator on each side of the antenna.",
  ],
  quadHub: [
    "Slide the hub onto the boom at the loop position and lock it with an M3 screw.",
    "Push the spreader rods into the sockets and glue them.",
    "Fit a corner cap on each rod end and press the wire corners into the grooves.",
  ],
};

const SOCK = 40;      // socket depth
const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];
const live = (d: Design) => d.wires.filter((w) => !w.drawOnly && !w.necOnly);
const ends = (d: Design, group: string) => live(d).filter((w) => w.group === group).flatMap((w) => [mmv(w.a), mmv(w.b)]);

/** Moxon rectangle in mm: driver side at x = xE, reflector side at x = xR, long sides at y = ±yA, tips at x = tipD / tipR. */
export function moxonGeometry(d: Design) {
  const all = live(d).flatMap((w) => [mmv(w.a), mmv(w.b)]);
  const drv = ends(d, "driven"), ref = ends(d, "reflector");
  const xE = Math.max(...all.map((p) => p[0])), xR = Math.min(...all.map((p) => p[0])), yA = Math.max(...all.map((p) => Math.abs(p[1])));
  const tipD = Math.min(...drv.map((p) => p[0])), tipR = Math.max(...ref.map((p) => p[0]));
  return { wireD: mm(2 * live(d)[0].r), xE, xR, yA, C: tipD - tipR, tipD, tipR };
}

/** Quad loops in mm: plane x and half side h of each loop. */
export function quadGeometry(d: Design) {
  const pts = live(d).flatMap((w) => [mmv(w.a), mmv(w.b)]);
  const xs = [...new Set(pts.map((p) => Math.round(p[0] * 1000) / 1000))];
  return { wireD: mm(2 * live(d)[0].r), loops: xs.map((x) => ({ x, h: Math.max(...pts.filter((p) => Math.abs(p[0] - x) < 1e-3).map((p) => Math.abs(p[1]))) })) };
}

/** Cap on a spreader rod end whose wire corner is at `at`; `dir` points along the rod outwards, `legs` along the two wire
 *  sides away from the corner. The groove is open towards the outside of the corner, so wire tension pulls the wire in. */
export function cornerCap(M: ManifoldToplevel, at: V3, dir: V3, legs: [V3, V3], rodD: number, wireD: number): Manifold {
  const rb = rodD + CLEAR, ch = wireD + CLEAR, so = rb / 2 + WALL;
  const tip = sub(at, scale(dir, ch / 2 + WALL + 1));               // rod end
  const body = rod(M, sub(tip, scale(dir, 30)), add(at, scale(dir, ch / 2 + WALL)), 2 * so);
  const out = unit(scale(add(legs[0], legs[1]), -1));
  const grooves = legs.map((l) => {
    const c = channel(M, at, add(at, scale(l, 2 * so)), wireD);
    return M.Manifold.hull([c, c.translate(scale(out, 2 * so))]);
  });
  return body.subtract(M.Manifold.union([rod(M, sub(tip, scale(dir, 31)), tip, rb), ...grooves]));
}

/** Rod socket hub at the origin: a core and one socket per direction, each with an M3 lock screw from +z. */
function socketHub(M: ManifoldToplevel, dirs: V3[], rodD: number, core: number): { body: Manifold; cuts: Manifold[] } {
  const rb = rodD + CLEAR, w = Math.max(rb + 2 * WALL, 12);
  const body = M.Manifold.union(dirs.map((u) => bar(M, scale(u, core - 2), scale(u, core + SOCK), w)));
  const cuts = dirs.flatMap((u) => {
    const s = scale(u, core + SOCK / 2);
    return [channel(M, scale(u, core), scale(u, core + SOCK + w), rodD), m3(M, s[0], s[1], s[2], s[2] + w / 2 + 1, true)];
  });
  return { body, cuts };
}

export function moxonParts(p: Params, d: Design): PartSpec[] {
  const g = moxonGeometry(d), rodD = mm(num(p, "rod", 8.5e-3));
  const corners: V3[] = [[g.xE, g.yA, 0], [g.xE, -g.yA, 0], [g.xR, g.yA, 0], [g.xR, -g.yA, 0]];
  const core = rodD + 6, w = Math.max(rodD + CLEAR + 2 * WALL, 12);
  const capPart = (M: ManifoldToplevel, at: V3, legX: number) => {
    const dir = unit(at);
    return [toZ(cornerCap(M, at, dir, [[legX, 0, 0], [0, -1, 0]], rodD, g.wireD), at, dir)];
  };
  const L = (x: number) => ({ len: x / 1000 });
  return [
    {
      id: "moxon-hub", title: SPREADER_STRINGS[0], use: "holder", qty: 1,
      purpose: msg(SPREADER_STRINGS[6], L(rodD), L(2 * g.yA), L(g.xE - g.xR)), howTo: SPREADER_HOWTO.hub.map((s) => msg(s)),
      build: (M) => {
        const h = socketHub(M, corners.map(unit), rodD, core);
        const body = M.Manifold.union([h.body, M.Manifold.cylinder(w, core, core, 48).translate([0, 0, -w / 2]), box(M, [-8, -6, -w / 2 - 30], [8, 6, -w / 2 + 0.01])]);
        return [body.subtract(M.Manifold.union([...h.cuts, ...[-w / 2 - 10, -w / 2 - 22].map((z) => zipSlot(M, [0, 0, z], 1, 2, 14))]))];
      },
    },
    { id: "moxon-cap-front", title: SPREADER_STRINGS[1], use: "holder", qty: 2, purpose: msg(SPREADER_STRINGS[7]), howTo: SPREADER_HOWTO.cap.map((s) => msg(s)), build: (M) => capPart(M, corners[0], -1) },
    { id: "moxon-cap-rear", title: SPREADER_STRINGS[2], use: "holder", qty: 2, purpose: msg(SPREADER_STRINGS[7]), howTo: SPREADER_HOWTO.cap.map((s) => msg(s)), build: (M) => capPart(M, corners[2], 1) },
    {
      id: "moxon-gap", title: SPREADER_STRINGS[3], use: "holder", qty: 2, purpose: msg(SPREADER_STRINGS[8], L(g.C)), howTo: SPREADER_HOWTO.gap.map((s) => msg(s)),
      build: (M) => {
        const CS = M.CrossSection, ch = g.wireD + CLEAR, R = ch / 2 + WALL + 1;
        const outline = CS.hull([CS.circle(R, 32).translate([-g.C / 2, 0]), CS.circle(R, 32).translate([g.C / 2, 0])]);
        return [outline.subtract(CS.union([CS.circle(ch / 2, 24).translate([-g.C / 2, 0]), CS.circle(ch / 2, 24).translate([g.C / 2, 0])])).extrude(4)];
      },
    },
  ];
}

export function quadParts(p: Params, d: Design): PartSpec[] {
  const g = quadGeometry(d), rodD = mm(num(p, "rod", 8.5e-3)), bd = mm(num(p, "bd", 25e-3));
  const dirs: V3[] = [[0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1]].map((v) => unit(v as V3));
  const core = (bd + CLEAR) / 2 + WALL + 1, w = Math.max(rodD + CLEAR + 2 * WALL, 12);
  const L = (x: number) => ({ len: x / 1000 });
  return [
    {
      id: "quad-hub", title: SPREADER_STRINGS[4], use: "holder", qty: g.loops.length,
      purpose: msg(SPREADER_STRINGS[9], L(bd), L(rodD)), howTo: SPREADER_HOWTO.quadHub.map((s) => msg(s)),
      build: (M) => {
        const h = socketHub(M, dirs, rodD, core);
        const body = M.Manifold.union([h.body, rod(M, [-w / 2, 0, 0], [w / 2, 0, 0], 2 * core + 2)]);
        return [body.subtract(M.Manifold.union([...h.cuts.filter((_, i) => i % 2 === 0), channel(M, [-w, 0, 0], [w, 0, 0], bd), m3(M, 0, 0, 0, core + 1, true)]))];
      },
    },
    {
      id: "quad-cap", title: SPREADER_STRINGS[5], use: "holder", qty: 4 * g.loops.length, purpose: msg(SPREADER_STRINGS[7]), howTo: SPREADER_HOWTO.cap.map((s) => msg(s)),
      build: (M) => { const at: V3 = [0, 100, 100], dir = unit(at); return [toZ(cornerCap(M, at, dir, [[0, -1, 0], [0, 0, -1]], rodD, g.wireD), at, dir)]; },
    },
  ];
}
