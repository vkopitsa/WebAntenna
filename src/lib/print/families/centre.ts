import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Vec3, Wire } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, INSULATE, WALL, mm } from "../rules";
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
export function dipoleArms(d: Design, groups: string[] = ["driven"]): { wireD: number; gap: number; arms: { start: V3; dir: V3 }[] } {
  const driven = d.wires.filter((w) => groups.includes(w.group ?? "") && !w.drawOnly && !w.necOnly);
  const feed = d.wires.find((w) => w.group === "feed") as Wire;
  const arms = driven.map((w) => ({ start: mmv(w.a), dir: unit(sub(mmv(w.b), mmv(w.a))) }));
  return { wireD: mm(2 * driven[0].r), gap: Math.hypot(...sub(mmv(feed.b), mmv(feed.a))), arms };
}

/** Centre insulator body for arms leaving a feed gap along y: hub, one socket per arm, solder window, hanging eye, coax
 *  zip-tie slots, and (dipole only) a tie-off hole beside each arm. */
export function centreBlock(M: ManifoldToplevel, arms: { start: V3; dir: V3 }[], gap: number, wireD: number, tieOff: boolean): Manifold {
  const ch = wireD + CLEAR;
  const w = Math.max(3 * ch + 4 * WALL, 12);                 // lug and hub thickness
  const zEye = ch / 2 + 4 + WALL + 3, top = zEye + 3 + WALL;
  const hub = box(M, [-w / 2, -(gap / 2 + 6), -30], [w / 2, gap / 2 + 6, top]);
  const lugs = arms.map((a) => bar(M, a.start, add(a.start, scale(a.dir, LUG)), w));
  const channels = arms.map((a) => channel(M, a.start, add(a.start, scale(a.dir, LUG + w / 2)), wireD));
  const cuts = [
    // tie-off hole through each lug, beside the wire channel: the wire end loops through it
    ...(tieOff ? arms.map((a) => {
      const n = unit([0, -a.dir[2], a.dir[1]]);                 // perpendicular to the arm in the y-z plane
      const p = add(add(a.start, scale(a.dir, LUG - 6)), scale(n, ch + WALL));
      return rod(M, [-w, p[1], p[2]], [w, p[1], p[2]], ch);
    }) : []),
    box(M, [0, -(gap / 2 + 5), -ch / 2 - 1], [w / 2 + 1, gap / 2 + 5, ch / 2 + 4]),   // solder window, front half
    rod(M, [-w, 0, zEye], [w, 0, zEye], 6),                                          // hanging eye
    ...[-14, -24].flatMap((z) => [-7, 7].map((y) => zipSlot(M, [0, y, z], 0, 2, w + 2))),   // coax zip ties
  ];
  // Subtract one cut at a time: manifold's batch union dropped volume (a wire channel was partly refilled) when a
  // disjoint solid was included in it (fan 20°, 5 bands: 1.9 mm³ of plastic inside a channel).
  let body = M.Manifold.union([hub, ...lugs]);
  for (const c of [...channels, ...cuts]) body = body.subtract(c);
  return body;
}

export function dipoleParts(d: Design): PartSpec[] {
  const { wireD, gap, arms } = dipoleArms(d);
  const ch = wireD + CLEAR;
  const droop = (Math.asin(-arms[0].dir[2]) * 180) / Math.PI;
  const centre: PartSpec = {
    id: "dipole-centre", title: "Dipole centre insulator", use: "holder", qty: 1,
    purpose: msg(CENTRE_STRINGS[2], Math.round(droop), { len: gap / 1000 }),
    howTo: CENTRE_HOWTO.centre.map((s) => msg(s)),
    warn: gap - ch < INSULATE ? msg("Wires closer than {0} apart: add sleeving.", { len: INSULATE / 1000 }) : undefined,
    build: (M) => [centreBlock(M, arms, gap, wireD, true)],
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

/** Fan dipole: centre block with a channel pair per band, and spreaders along the legs. */
export const FAN_STRINGS = [
  "Fan dipole centre insulator",
  "Leg spreader",
  "Holds {0} band elements fanned out from a {1} feed gap; all of them are soldered to the coax in the front window.",
  "Keeps the band wires at their designed spacing {0} out from the centre; one on each leg.",
];

/** How-to steps, in order. */
export const FAN_HOWTO = {
  centre: [
    "Push each element's arms into their channels from the outside until the ends show in the front window.",
    "Solder all elements on one side to the coax centre conductor and all on the other side to the braid.",
    "Strap the coax to the hub with two zip ties through the slots, and hang the antenna from the eye on top.",
    "Seal the window with hot glue or silicone against water.",
  ],
  spreader: [
    "Thread the wires through the spreader in order, the longest element in the middle hole row as in the model.",
    "Slide it out to the given distance from the centre and fix each wire with a drop of glue.",
  ],
};

/** Spreader positions along the +y leg: Y in mm, and where each wire that reaches past Y crosses the plane y = Y.
 *  Only wires running mostly along y (|u_y| >= 0.5) are held; the spread is measured from the feed ends. Positions lie
 *  between Ymin (clear of the centre block) and Ymax = min(2/3 of the longest reach, where the spread reaches 150 mm). */
export function fanSpreaders(d: Design): { Y: number; holes: { p: V3; u: V3 }[] }[] {
  const wires = d.wires.filter((w) => (w.group === "driven" || w.group === "parasitic") && !w.drawOnly && !w.necOnly && w.b[1] > 0)
    .map((w) => ({ a: mmv(w.a), b: mmv(w.b) })).filter((w) => unit(sub(w.b, w.a))[1] >= 0.5);
  if (wires.length < 2) return [];
  const half = Math.min(...wires.map((w) => w.a[1]));
  const tans = wires.map((w) => (w.b[2] - w.a[2]) / (w.b[1] - w.a[1]));
  const spread = Math.max(...tans) - Math.min(...tans);
  if (spread < 1e-9) return [];
  const Ymin = half + LUG + 15;
  const Ymax = Math.min((2 / 3) * Math.max(...wires.map((w) => w.b[1])), half + 150 / spread);
  if (Ymax < Ymin) return [];
  const ys = Ymax - (Ymin + Ymax) / 2 < 20 ? [Ymax] : [(Ymin + Ymax) / 2, Ymax];
  return ys.map((Y) => ({
    Y,
    holes: wires.filter((w) => w.b[1] > Y + 10).map((w) => {
      const t = (Y - w.a[1]) / (w.b[1] - w.a[1]);
      return { p: add(w.a, scale(sub(w.b, w.a), t)), u: unit(sub(w.b, w.a)) };
    }),
  })).filter((s) => s.holes.length >= 2);
}

export function fanParts(d: Design): PartSpec[] {
  const { wireD, gap, arms } = dipoleArms(d, ["driven", "parasitic"]);
  const r = (wireD + CLEAR) / 2, m0 = r + WALL + 2;
  const centre: PartSpec = {
    id: "fan-centre", title: FAN_STRINGS[0], use: "holder", qty: 1,
    purpose: msg(FAN_STRINGS[2], arms.length / 2, { len: gap / 1000 }), howTo: FAN_HOWTO.centre.map((s) => msg(s)),
    build: (M) => [centreBlock(M, arms, gap, wireD, false)],
  };
  return [centre, ...fanSpreaders(d).map((s, i): PartSpec => ({
    id: `fan-spreader-${i + 1}`, title: FAN_STRINGS[1], use: "holder", qty: 2,
    purpose: msg(FAN_STRINGS[3], { len: s.Y / 1000 }), howTo: FAN_HOWTO.spreader.map((x) => msg(x)),
    build: (M) => {
      const zs = s.holes.map((h) => h.p[2]);
      // z extent of a hole inside the 4 mm slab: ellipse semi-axis r/|u_y| plus the drift of the axis over ±2 mm
      const ext = Math.max(...s.holes.map((h) => (r + 2 * Math.abs(h.u[2])) / h.u[1]));
      const m = Math.max(m0, ext + WALL);
      const plate = box(M, [-m0, s.Y - 2, Math.min(...zs) - m], [m0, s.Y + 2, Math.max(...zs) + m]);
      const cuts = s.holes.map((h) => {
        const hl = (2 + r * Math.abs(h.u[2])) / h.u[1] + 1;
        return channel(M, sub(h.p, scale(h.u, hl)), add(h.p, scale(h.u, hl)), wireD);
      });
      let part = plate;
      for (const c of cuts) part = part.subtract(c);
      return [part];
    },
  }))];
}
