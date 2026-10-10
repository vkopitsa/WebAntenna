import type { Design, Vec3 } from "../../types";
import { FAIL, PartError, msg, type PartSpec } from "../parts";
import { CLEAR, mm } from "../rules";
import { add, box, channel, flangeCut, scale, sub, unit, type V3 } from "../shapes";

/** Biquad: a slim standoff that holds the element at its height over the reflector, only near the feed. */
export const STANDOFF_STRINGS = [
  "Biquad feed standoff",
  "Holds the element {0} above the reflector by the four wires next to the feed; the tips stay free of plastic, which would detune them. The base is the drilling template for the N or SO-239 panel jack.",
];

/** How-to steps, in order. */
export const STANDOFF_HOWTO = [
  "Drill the reflector through the base: the centre hole for the jack and the four M3 holes.",
  "Bolt the panel jack behind the reflector and the standoff in front with the same M3 screws.",
  "Run the copper tube or the coax up the centre bore to the top.",
  "Press the four wires next to the feed into the grooves on top and solder them to the feed.",
];

const RP = 10, TUBE = 6.4, PLATE_T = 5, SQ = 28;
/** World (x up from the reflector) → local print frame (z up from the reflector). */
const local = (p: Vec3): V3 => [mm(p[1]), mm(p[2]), mm(p[0])];
const near = (a: V3, b: V3) => Math.hypot(...sub(a, b)) < 1e-3;

export function biquadGeometry(d: Design) {
  const live = d.wires.filter((w) => !w.drawOnly && !w.necOnly);
  const feed = live.find((w) => w.group === "feed")!;
  const ends = [local(feed.a), local(feed.b)];
  const legs = live.filter((w) => w.group === "driven").flatMap((w) => {
    const a = local(w.a), b = local(w.b);
    return ends.flatMap((e) => (near(a, e) ? [{ at: e, dir: unit(sub(b, a)) }] : near(b, e) ? [{ at: e, dir: unit(sub(a, b)) }] : []));
  });
  return { X: ends[0][2], wireD: mm(2 * feed.r), ends, gap: Math.hypot(...sub(ends[0], ends[1])), legs };
}

export function biquadParts(d: Design): PartSpec[] {
  const g = biquadGeometry(d);
  return [{
    id: "biquad-standoff", title: STANDOFF_STRINGS[0], use: "holder", qty: 1,
    purpose: msg(STANDOFF_STRINGS[1], { len: g.X / 1000 }), howTo: STANDOFF_HOWTO.map((s) => msg(s)),
    build: (M) => {
      const ch = g.wireD + CLEAR;
      if (g.gap / 2 + ch / 2 > RP - 1) throw new PartError(msg(FAIL.thick));
      const ys = g.ends.map((e) => e[1]), yLo = Math.min(...ys) - ch / 2, yHi = Math.max(...ys) + ch / 2;
      const body = M.Manifold.union([box(M, [-SQ / 2, -SQ / 2, 0], [SQ / 2, SQ / 2, PLATE_T]).rotate([0, 0, 45]), M.Manifold.cylinder(g.X, RP, RP, 64)]);
      const cuts = M.Manifold.union([
        flangeCut(M, 0, PLATE_T).rotate([0, 0, 45]),   // screws on the axes, clear of the legs on the diagonals
        M.Manifold.cylinder(g.X + 2, TUBE / 2, TUBE / 2, 32).translate([0, 0, -1]),
        box(M, [-ch / 2, yLo, g.X - ch / 2], [ch / 2, yHi, g.X + 20]),                 // feed gap, always free of plastic
        ...g.legs.map((l) => { const c = channel(M, l.at, add(l.at, scale(l.dir, SQ / Math.SQRT2 + 3)), g.wireD); return M.Manifold.hull([c, c.translate([0, 0, 10])]); }),
      ]);
      return [body.subtract(cuts)];
    },
  }];
}
