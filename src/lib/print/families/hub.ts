import type { Design } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, FLANGE_BODY, WALL, mm } from "../rules";
import { bar, box, channel, flangeCut, scale, unit, zipSlot, type V3 } from "../shapes";

/** Ground plane: radial hub that takes the panel jack and sets the radial droop. */
export const HUB_STRINGS = [
  "Ground-plane radial hub",
  "Sets {0} radials at {1}° droop (the droop sets the feed impedance). Takes an SO-239 or N 4-hole panel jack with M3 screws and nuts; the radial ends meet at the flange screws for soldering. Zip-tie the block to the mast.",
];

/** How-to steps, in order. */
export const HUB_HOWTO = [
  "Bolt the panel jack on top with four M3 screws; the nuts drop into the pockets underneath.",
  "Push each radial into its bore until the end reaches a flange screw; wrap the end round the screw or under a solder lug and solder it.",
  "Solder the radiator to the jack's centre pin so it stands vertical.",
  "Strap the side block to the mast with two zip ties or a hose clamp through the slots; the coax goes down through the centre.",
  "Seal the jack and the joints against water.",
];

const R0 = 14, LUG = 40, PLATE = 5;

/** Unit directions of the radials from the feed point, from the model. */
export function radialDirs(d: Design): V3[] {
  return d.wires.filter((w) => w.group === "ground" && !w.drawOnly).map((w) => unit([w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]]));
}

export function groundPlaneParts(d: Design): PartSpec[] {
  const dirs = radialDirs(d);
  const wireD = mm(2 * d.wires.find((w) => w.group === "ground")!.r);
  const ch = wireD + CLEAR;
  const w = Math.max(ch + 2 * WALL, 8);
  const droop = (Math.asin(-dirs[0][2]) * 180) / Math.PI;
  const az = Math.atan2(dirs[0][1], dirs[0][0]) + Math.PI / dirs.length;   // mast block between the first two radials
  const hub: PartSpec = {
    id: "gp-hub", title: "Ground-plane radial hub", use: "holder", qty: 1,
    purpose: msg(HUB_STRINGS[1], dirs.length, Math.round(droop)),
    howTo: HUB_HOWTO.map((s) => msg(s)),
    build: (M) => {
      const plate = M.Manifold.cylinder(PLATE, R0 + 4, R0 + 4, undefined, false).translate([0, 0, -PLATE]);
      const lugs = dirs.map((u) => bar(M, scale(u, 8), scale(u, R0 + LUG), w));
      const mast = box(M, [10, -6, -35], [26, 6, -PLATE + 0.01]).rotate([0, 0, (az * 180) / Math.PI]);
      const slots = [-12, -28].map((z) => zipSlot(M, [20, 0, z], 1, 2, 14).rotate([0, 0, (az * 180) / Math.PI]));
      const body = M.Manifold.union([plate, ...lugs, mast]);
      const cuts = M.Manifold.union([
        flangeCut(M, -PLATE, 0),
        M.Manifold.cylinder(41, (FLANGE_BODY + 1) / 2, (FLANGE_BODY + 1) / 2, undefined, false).translate([0, 0, -40]),  // jack body and coax
        ...dirs.map((u) => channel(M, [0, 0, 0], scale(u, R0 + LUG + w), wireD)),
        ...slots,
      ]);
      return [body.subtract(cuts)];
    },
  };
  return [hub];
}
