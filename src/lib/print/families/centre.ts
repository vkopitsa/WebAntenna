import type { Design, Vec3, Wire } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";
import { add, bar, box, channel, rod, scale, sub, unit, zipSlot, type V3 } from "../shapes";

/** Dipole / inverted V: centre insulator and end insulators. */
export const CENTRE_STRINGS = [
  "Dipole centre insulator",
  "End insulator",
  "Holds both arms at {0}° droop with a {1} feed gap. The front window leaves the arm ends open for soldering the coax; two zip ties hold the coax.",
  "One per arm end: the wire through the small hole, the support rope through the large one.",
];

/** How-to steps, in order. */
export const CENTRE_HOWTO = {
  centre: [
    "Push each arm into its channel from the outside until its end shows in the front window.",
    "Pass each arm through the tie-off hole beside its channel and twist it back on itself, so the plastic takes the pull, not the solder joint.",
    "Solder the coax centre conductor to one arm and the braid to the other in the front window.",
    "Strap the coax to the hub with two zip ties through the slots, and hang the antenna from the eye on top.",
    "Seal the window with hot glue or silicone against water.",
  ],
  end: [
    "Pass the arm end through the small hole, fold it back and twist it round itself.",
    "Tie the support rope through the large hole.",
  ],
};

const LUG = 35;   // length of each arm socket

const mmv = (p: Vec3): V3 => scale(p, 1000);

/** Arm geometry in mm from the model: start point at the feed gap and unit direction outwards. */
export function dipoleArms(d: Design): { wireD: number; gap: number; arms: { start: V3; dir: V3 }[] } {
  const driven = d.wires.filter((w) => w.group === "driven" && !w.drawOnly && !w.necOnly);
  const feed = d.wires.find((w) => w.group === "feed") as Wire;
  const arms = driven.map((w) => ({ start: mmv(w.a), dir: unit(sub(mmv(w.b), mmv(w.a))) }));
  return { wireD: mm(2 * driven[0].r), gap: Math.hypot(...sub(mmv(feed.b), mmv(feed.a))), arms };
}

export function dipoleParts(d: Design): PartSpec[] {
  const { wireD, gap, arms } = dipoleArms(d);
  const ch = wireD + CLEAR;
  const w = Math.max(3 * ch + 4 * WALL, 12);                 // lug and hub thickness
  const droop = (Math.asin(-arms[0].dir[2]) * 180) / Math.PI;
  const zEye = ch / 2 + 4 + WALL + 3, top = zEye + 3 + WALL;
  const centre: PartSpec = {
    id: "dipole-centre", title: "Dipole centre insulator", use: "holder", qty: 1,
    purpose: msg(CENTRE_STRINGS[2], Math.round(droop), { len: gap / 1000 }),
    howTo: CENTRE_HOWTO.centre.map((s) => msg(s)),
    build: (M) => {
      const hub = box(M, [-w / 2, -(gap / 2 + 6), -30], [w / 2, gap / 2 + 6, top]);
      const lugs = arms.map((a) => bar(M, a.start, add(a.start, scale(a.dir, LUG)), w));
      let part = M.Manifold.union([hub, ...lugs]);
      const cuts = [
        ...arms.map((a) => channel(M, a.start, add(a.start, scale(a.dir, LUG + w / 2)), wireD)),
        // tie-off hole through each lug, beside the wire channel: the wire end loops through it
        ...arms.map((a) => {
          const n = unit([0, -a.dir[2], a.dir[1]]);                 // perpendicular to the arm in the y-z plane
          const p = add(add(a.start, scale(a.dir, LUG - 6)), scale(n, ch + WALL));
          return rod(M, [-w, p[1], p[2]], [w, p[1], p[2]], ch);
        }),
        box(M, [0, -(gap / 2 + 5), -ch / 2 - 1], [w / 2 + 1, gap / 2 + 5, ch / 2 + 4]),   // solder window, front half
        rod(M, [-w, 0, zEye], [w, 0, zEye], 6),                                          // hanging eye
        ...[-14, -24].flatMap((z) => [-7, 7].map((y) => zipSlot(M, [0, y, z], 0, 2, w + 2))),   // coax zip ties
      ];
      part = part.subtract(M.Manifold.union(cuts));
      return [part];
    },
  };
  const R = Math.max(ch, 6) / 2 + 3;
  const end: PartSpec = {
    id: "dipole-end", title: "End insulator", use: "holder", qty: 2, purpose: msg(CENTRE_STRINGS[3]), howTo: CENTRE_HOWTO.end.map((s) => msg(s)),
    build: (M) => {
      const outline = M.CrossSection.hull([M.CrossSection.circle(R).translate([0, -14]), M.CrossSection.circle(R).translate([0, 14])]);
      const holes = M.CrossSection.union([M.CrossSection.circle(ch / 2).translate([0, -14]), M.CrossSection.circle(3).translate([0, 14])]);
      return [outline.subtract(holes).extrude(Math.max(6, ch + 2 * WALL))];
    },
  };
  return [centre, end];
}
