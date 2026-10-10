import type { Design, Params } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, INSULATE, M3_NUT_DEPTH, WALL, ZIP_T, mm } from "../rules";
import { box, m3, rod, zipSlot } from "../shapes";

/** Yagi: element clips, driven-element block, or a drilling guide for through-boom elements. */
export const BOOM_STRINGS = [
  "Yagi element clip",
  "Yagi driven element block",
  "Boom drilling guide",
  "Holds an element square to the boom, {0} above it and insulated. Two zip ties fix it to the boom; an M3 screw locks the element.",
  "Holds the folded dipole conductors {0} apart, {1} above the boom. The front window opens the feed point for the balun; the fed conductor is split by a 2 mm wall.",
  "Holds both halves of the split driven element {0} above the boom; they butt against a 2 mm wall, and the front window opens the feed point.",
  "Sits on the boom so each element hole is drilled straight through the centre. Use a {0} drill and zip-tie the guide at each mark from the boom strip.",
];

/** How-to steps, in order. "{0}" in the drill step is the element diameter. */
export const BOOM_HOWTO = {
  clip: [
    "Drop an M3 nut into the pocket on top and start the screw.",
    "Slide the clip onto the element and centre it: the element's middle goes under the screw.",
    "Set the clip on the boom at the element's mark from the boom strip, square to the boom, and fix it with two zip ties through the slots.",
    "Tighten the screw to lock the element.",
  ],
  folded: [
    "Slide the continuous conductor into the top channel and the two halves of the fed conductor into the lower channel from each side until they stop at the wall.",
    "Solder the balun or coax to the two ends in the front window.",
    "Fix the block on the boom at the driven-element mark with two zip ties, and lock the top conductor with the M3 screw.",
    "Seal the window with hot glue or silicone against water.",
  ],
  split: [
    "Slide the two halves in from each side until they stop at the wall.",
    "Solder the feed (coax, gamma or hairpin match) to the two ends in the front window.",
    "Fix the block on the boom at the driven-element mark with two zip ties, and lock the element with the M3 screw.",
    "Seal the window with hot glue or silicone against water.",
  ],
  drill: [
    "Mark the element positions on the boom with the boom strip from the build PDF.",
    "Zip-tie the guide on the boom with its hole over a mark.",
    "Drill a small pilot hole through the guide, then open it to {0}; the guide keeps the drill on the boom's centre line.",
    "Move the guide to the next mark and repeat.",
  ],
};

/** Element and boom diameters (mm) and the folded-dipole spacing (mm, 0 for split) from the model. */
export function yagiGeometry(d: Design): { elemD: number; boomD: number; fs: number } {
  const boom = d.wires.find((w) => w.drawOnly)!;
  const elems = d.wires.filter((w) => !w.drawOnly);
  const fs = Math.max(0, ...d.wires.filter((w) => w.group === "driven").flatMap((w) => [w.a[2], w.b[2]]));
  return { elemD: mm(2 * elems[0].r), boomD: mm(2 * boom.r), fs: mm(fs) };
}

export function yagiParts(p: Params, d: Design): PartSpec[] {
  const { elemD, boomD, fs } = yagiGeometry(d);
  const ch = elemD + CLEAR, bc = boomD + CLEAR;
  const Y = bc / 2 + 2 * WALL + ZIP_T;                       // half width across the boom, room for the zip-tie slots
  const zb = -(bc / 2 + INSULATE + ch / 2);                  // boom axis; the element axis is z = 0, along y
  const n = Number(p.n);
  const slots = (M: Parameters<PartSpec["build"]>[0], z0: number, z1: number) =>
    [-1, 1].map((s) => zipSlot(M, [0, s * (bc / 2 + WALL + ZIP_T / 2), (z0 + z1) / 2], 2, 0, z1 - z0 + 2));

  if (p.boom === "through") {
    const top = bc / 2 + 12;
    return [{
      id: "yagi-drill", title: "Boom drilling guide", use: "jig", qty: 1, purpose: msg(BOOM_STRINGS[6], { len: elemD / 1000 }),
      howTo: BOOM_HOWTO.drill.map((s) => msg(s, { len: elemD / 1000 })),
      build: (M) => {
        const body = box(M, [-12, -Y, 0], [12, Y, top]);
        const cuts = M.Manifold.union([rod(M, [-20, 0, 0], [20, 0, 0], bc), rod(M, [0, 0, -1], [0, 0, top + 1], ch), ...slots(M, 0, top)]);
        return [body.subtract(cuts)];
      },
    }];
  }

  const clipTop = ch / 2 + WALL + M3_NUT_DEPTH + 1;
  const clip: PartSpec = {
    id: "yagi-clip", title: "Yagi element clip", use: "holder", qty: n - 1, purpose: msg(BOOM_STRINGS[3], { len: INSULATE / 1000 }),
    howTo: BOOM_HOWTO.clip.map((s) => msg(s)),
    build: (M) => {
      const L = Math.max(ch + 2 * WALL, 16);
      const body = box(M, [-L / 2, -Y, zb], [L / 2, Y, clipTop]);
      const cuts = M.Manifold.union([
        rod(M, [-L, 0, zb], [L, 0, zb], bc),                          // boom saddle
        rod(M, [0, -Y - 1, 0], [0, Y + 1, 0], ch),                    // element
        m3(M, 0, 0, 0, clipTop, true),                                // set screw
        ...slots(M, zb, clipTop),
      ]);
      return [body.subtract(cuts)];
    },
  };

  const folded = fs > 0;
  const top = (folded ? fs : 0) + ch / 2 + WALL + M3_NUT_DEPTH + 1;
  const driven: PartSpec = {
    id: "yagi-driven", title: "Yagi driven element block", use: "holder", qty: 1,
    purpose: folded ? msg(BOOM_STRINGS[4], { len: fs / 1000 }, { len: INSULATE / 1000 }) : msg(BOOM_STRINGS[5], { len: INSULATE / 1000 }),
    howTo: (folded ? BOOM_HOWTO.folded : BOOM_HOWTO.split).map((s) => msg(s)),
    build: (M) => {
      const L = Math.max(ch + 2 * WALL, 24);
      const body = box(M, [-L / 2, -Y, zb], [L / 2, Y, top]);
      const cuts = M.Manifold.union([
        rod(M, [-L, 0, zb], [L, 0, zb], bc),
        rod(M, [0, -Y - 1, 0], [0, -1, 0], ch), rod(M, [0, 1, 0], [0, Y + 1, 0], ch),   // fed conductor, split by a 2 mm wall
        ...(folded ? [rod(M, [0, -Y - 1, fs], [0, Y + 1, fs], ch)] : []),
        box(M, [0, -8, -ch / 2 - 1], [L / 2 + 1, 8, ch / 2 + 2]),                        // feed window, front half
        m3(M, 0, Y - 6, folded ? fs : 0, top, true),                                     // locks the top conductor
        ...slots(M, zb, top),
      ]);
      return [body.subtract(cuts)];
    },
  };
  return [clip, driven];
}
