import { num, type Design, type Params, type Vec3 } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, FLANGE_PITCH, M3_HOLE, M3_NUT, WALL, mm } from "../rules";
import { add, bar, box, channel, flangeCut, rod, scale, sub, unit, zipSlot, type V3 } from "../shapes";

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

/** Mast block azimuth: between the first two radials. */
const mastAz = (paths: { h: V3 }[]) => Math.atan2(paths[0].h[1], paths[0].h[0]) + Math.PI / paths.length;

/** Where a mast strapped to the GP hub's side block runs (vertical, mm): the block face at radius 28 between radials. */
export function gpMastAxis(d: Design): V3 {
  const az = mastAz(hubGeometry(d).paths);
  return [Math.cos(az) * 28 + Math.cos(az) * 15, Math.sin(az) * 28 + Math.sin(az) * 15, 0];   // mast centre: block face + a 30 mm mast's radius
}

export function groundPlaneParts(d: Design): PartSpec[] {
  const g = hubGeometry(d);
  const { ch, w, rLug, paths } = g;
  const droop = (Math.asin(-paths[0].dir[2]) * 180) / Math.PI;
  const az = mastAz(paths);   // mast block between the first two radials
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

/** Discone: hub with the disc rods flat on top and the cone rods at the cone angle below. */
export const DISCONE_STRINGS = [
  "Discone hub",
  "Holds {0} disc rods flat and {1} cone rods at {2}° from the axis. The coax comes up the mast tube and the centre bore: its centre conductor goes to the disc rods in the top window, its braid to a wire ring round the cone rods in the side groove. The hub slips onto the top of a {3} mast tube.",
];

/** How-to steps, in order. */
export const DISCONE_HOWTO = [
  "Feed the coax up through the centre bore until its end shows in the top window; bring a braid pigtail out through the side hole into the groove.",
  "Push each cone rod into its bore from below until its end shows in the side groove; wind bare copper wire round all the rod ends in the groove and solder it to every rod and to the braid.",
  "Push each disc rod into its channel until its end lies in the top window; solder all disc rods to the coax centre conductor.",
  "Push the hub onto the top of the mast tube with the coax inside it and lock it with an M3 screw.",
  "Fill the window and the groove with hot glue or silicone against water.",
];

export const D_IN = 6;          // radius of the top window where the disc rods end
export const D_LUG = 35;        // disc rod support length
const CUP = 30;          // mast socket depth
const BORE = 5.5;        // coax bore radius (up to RG-213)
const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];

/** Discone geometry in mm from the model. The cone rods are cut short at radius rg, where they cross a groove round the
 *  neck (a real discone's cone also starts at a small top ring); the neck grows with the rod size. */
export function disconeGeometry(d: Design) {
  const live = d.wires.filter((x) => !x.drawOnly && !x.necOnly);
  const disc = live.filter((x) => x.group === "driven"), cone = live.filter((x) => x.group === "ground");
  const wireD = mm(2 * disc[0].r), ch = wireD + CLEAR, w = Math.max(ch + 2 * WALL, 8);
  const dir = (x: (typeof live)[number]) => unit(sub(mmv(x.b), mmv(x.a)));
  const discDirs = disc.map(dir), coneDirs = cone.map(dir);
  const half = Math.atan2(Math.hypot(coneDirs[0][0], coneDirs[0][1]), -coneDirs[0][2]);   // from the axis
  const rg = BORE + 2 * WALL + 1 + ch / 2, neck = rg + ch / 2 + 1;
  const grooveZ = -rg / Math.tan(half), grooveH = ch / Math.sin(half) + 4;
  const discZ = mm(disc[0].a[2]);
  return { wireD, ch, w, discZ, discDirs, coneDirs, half, rg, neck, sN: neck / Math.sin(half), grooveZ, grooveH, top: discZ + ch / 2 + WALL };
}

export function disconeParts(p: Params, d: Design): PartSpec[] {
  const g = disconeGeometry(d);
  const mast = num(p, "mast", 25e-3) * 1000;
  const rBore = (mast + CLEAR) / 2, rCup = rBore + WALL + 1;
  const az = Math.atan2(g.coneDirs[0][1], g.coneDirs[0][0]) + Math.PI / g.coneDirs.length;   // pigtail hole between two cone rods
  const azDeg = (az * 180) / Math.PI;
  const hub: PartSpec = {
    id: "discone-hub", title: DISCONE_STRINGS[0], use: "holder", qty: 1,
    purpose: msg(DISCONE_STRINGS[1], g.discDirs.length, g.coneDirs.length, Math.round((g.half * 180) / Math.PI), { len: mast / 1000 }),
    howTo: DISCONE_HOWTO.map((s) => msg(s)),
    build: (M) => {
      const zBot = Math.min(g.grooveZ - g.grooveH / 2, -(g.sN + D_LUG) * Math.cos(g.half)) - 10;
      const t = Math.max(0, rCup - g.neck), zc0 = zBot - t - CUP;   // 45° taper keeps the socket printable
      const zLow = g.discZ - g.ch / 2 - WALL;
      const body = M.Manifold.union([
        M.Manifold.cylinder(g.top - zBot, g.neck, g.neck, 64).translate([0, 0, zBot]),
        M.Manifold.cylinder(g.top - zLow, D_IN + D_LUG, D_IN + D_LUG, 96).translate([0, 0, zLow]),
        ...g.coneDirs.map((u) => bar(M, scale(u, g.sN), scale(u, g.sN + D_LUG), g.w)),
        M.Manifold.cylinder(CUP, rCup, rCup, 64).translate([0, 0, zc0]),
        ...(t > 0 ? [M.Manifold.cylinder(t, rCup, g.neck, 64).translate([0, 0, zBot - t])] : []),
      ]);
      const cuts = M.Manifold.union([
        M.Manifold.cylinder(g.discZ - zBot + t + 2, BORE, BORE, 32).translate([0, 0, zBot - t - 1]),               // coax, opens into the socket
        M.Manifold.cylinder(CUP + 1, rBore, rBore, 64).translate([0, 0, zc0 - 1]),                                // mast socket
        rod(M, [0, 0, zc0 + 12], [rCup + 1, 0, zc0 + 12], M3_HOLE),                                               // M3 lock screw
        M.Manifold.cylinder(g.top - zLow + 2, D_IN, D_IN, 32).translate([0, 0, g.discZ - g.ch / 2 - 0.5]),         // top window
        ...g.discDirs.map((u) => channel(M, [u[0] * (D_IN - 1), u[1] * (D_IN - 1), g.discZ], [u[0] * (D_IN + D_LUG + 2), u[1] * (D_IN + D_LUG + 2), g.discZ], g.wireD)),
        ...g.coneDirs.map((u) => channel(M, scale(u, g.rg / Math.sin(g.half)), scale(u, g.sN + D_LUG + g.w), g.wireD)),
        M.Manifold.cylinder(g.grooveH, g.neck + 1, g.neck + 1, 64).subtract(M.Manifold.cylinder(g.grooveH, g.rg - g.ch / 2 - 1, g.rg - g.ch / 2 - 1, 64))
          .translate([0, 0, g.grooveZ - g.grooveH / 2]),                                                          // braid ring groove
        rod(M, [0, 0, g.grooveZ], [-g.neck - 1, 0, g.grooveZ], 4).rotate([0, 0, azDeg]),                          // braid pigtail hole
      ]);
      return [body.subtract(cuts)];
    },
  };
  return [hub];
}
