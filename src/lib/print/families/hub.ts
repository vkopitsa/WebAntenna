import type { Design } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, FLANGE_PITCH, M3_NUT, WALL, mm } from "../rules";
import { add, bar, box, channel, flangeCut, scale, unit, zipSlot, type V3 } from "../shapes";

/** Ground plane: radial hub that takes the panel jack and sets the radial droop. */
export const HUB_STRINGS = [
  "Ground-plane radial hub",
  "Sets {0} radials at {1}° droop (the droop sets the feed impedance). Takes an SO-239 or N 4-hole panel jack with M3 screws and nuts; each radial ends in an open groove at the edge of the jack flange for soldering. Zip-tie the block to the mast.",
];

/** How-to steps, in order. */
export const HUB_HOWTO = [
  "Bolt the panel jack on top with four M3 screws; the nuts drop into the pockets underneath.",
  "Push each radial in from the outside until its end lies in the open groove next to the jack flange; bend the end up against the flange and solder it.",
  "Solder the radiator to the jack's centre pin so it stands vertical.",
  "Strap the side block to the mast with two zip ties or a hose clamp through the slots; the coax goes down through the centre.",
  "Seal the jack and the joints against water.",
];

export const PLATE = 5;           // plate thickness; its top face (z = 0) is the flange seat
const R_IN = 15;                  // radial ends: just outside the flange screws, at the flange edge
const LUG = 40;                   // length of each radial socket
const FLANGE_CORNER = 25.4 / Math.SQRT2;   // 25.4 mm square flange: nothing may stand above z = 0 inside this
const COAX = 23;                  // room under the plate for a PL-259 / N plug coupling nut

/** Unit directions of the radials from the feed point, from the model. */
export function radialDirs(d: Design): V3[] {
  return d.wires.filter((w) => w.group === "ground" && !w.drawOnly).map((w) => unit([w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]]));
}

/** Radial paths in mm: each wire starts in the open groove at radius R_IN (just below the top face) and runs along the
 *  model's radial direction; the socket (lug) starts `lugFrom` mm along it, outside the flange footprint. */
export function hubGeometry(d: Design) {
  const wireD = mm(2 * d.wires.find((w) => w.group === "ground")!.r);
  const ch = wireD + CLEAR, w = Math.max(ch + 2 * WALL, 8);
  const rLug = FLANGE_CORNER + w / Math.SQRT2 + 1;
  const paths = radialDirs(d).map((dir) => {
    const c = Math.hypot(dir[0], dir[1]), h: V3 = [dir[0] / c, dir[1] / c, 0];
    return { dir, h, start: [R_IN * h[0], R_IN * h[1], -ch / 2 + 0.3] as V3, lugFrom: (rLug - R_IN) / c };
  });
  return { wireD, ch, w, rLug, paths };
}

export function groundPlaneParts(d: Design): PartSpec[] {
  const g = hubGeometry(d);
  const { ch, w, rLug, paths } = g;
  const droop = (Math.asin(-paths[0].dir[2]) * 180) / Math.PI;
  const az = Math.atan2(paths[0].h[1], paths[0].h[0]) + Math.PI / paths.length;   // mast block between the first two radials
  const azDeg = (az * 180) / Math.PI;
  const hub: PartSpec = {
    id: "gp-hub", title: "Ground-plane radial hub", use: "holder", qty: 1,
    purpose: msg(HUB_STRINGS[1], paths.length, Math.round(droop)),
    howTo: HUB_HOWTO.map((s) => msg(s)),
    build: (M) => {
      const plate = M.Manifold.cylinder(PLATE, rLug + 2, rLug + 2, undefined, false).translate([0, 0, -PLATE]);
      const lugs = paths.flatMap((r) => {
        const a = add(r.start, scale(r.dir, r.lugFrom));
        return [
          bar(M, a, add(a, scale(r.dir, LUG)), w),
          M.Manifold.hull([M.Manifold.cube(w, true).translate([rLug * r.h[0], rLug * r.h[1], -PLATE / 2]), M.Manifold.cube(w, true).translate(a)]),   // web to the plate
        ];
      });
      const mast = box(M, [12, -6, -35], [28, 6, -PLATE + 0.01]).rotate([0, 0, azDeg]);
      const body = M.Manifold.union([plate, ...lugs, mast]);
      const h = FLANGE_PITCH / 2;
      const cuts = M.Manifold.union([
        flangeCut(M, -PLATE, 0),
        M.Manifold.cylinder(60, COAX / 2, COAX / 2, undefined, false).translate([0, 0, -60 - PLATE]),                  // coax plug, below the plate
        ...[[h, h], [-h, h], [-h, -h], [h, -h]].map(([x, y]) => M.Manifold.cylinder(60, M3_NUT / 2, M3_NUT / 2, 6, false).translate([x, y, -60 - PLATE + 1])),   // nut access from below
        ...paths.map((r) => channel(M, r.start, add(r.start, scale(r.dir, r.lugFrom + LUG + w)), g.wireD)),
        ...paths.map((r) => M.Manifold.hull([M.Manifold.cube(ch, true).translate(add(r.start, [0, 0, ch / 2])), M.Manifold.cube(ch, true).translate(add(r.start, [5 * r.h[0], 5 * r.h[1], ch / 2]))])),   // open solder groove
        ...[-12, -28].map((z) => zipSlot(M, [20, 0, z], 1, 2, 14).rotate([0, 0, azDeg])),
      ]);
      return [body.subtract(cuts)];
    },
  };
  return [hub];
}
