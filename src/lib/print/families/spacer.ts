import type { CrossSection, ManifoldToplevel } from "manifold-3d";
import type { Design, Params } from "../../types";
import { num } from "../../types";
import { FAIL, msg, PartError, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";

/** J-pole stub spacers and feed-tap gauge; collinear radome spacers. */
export const SPACER_STRINGS = [
  "Stub spacer",
  "Feed-tap gauge",
  "Radome spacer",
  "Keeps the radiator and the stub {0} apart (centre to centre), which sets the matching section's impedance.",
  "Stands on the shorting bar and clips onto both legs; its top edge is the feed tap height, {0} above the bar.",
  "Centres the coax in a {0} radome; vents let condensation out.",
];

/** How-to steps, in order. */
export const SPACER_HOWTO = {
  spacer: [
    "Slide the spacers onto both tubes before soldering the shorting bar, and spread them evenly along the stub.",
    "Fix each with a drop of glue once the antenna is tuned.",
  ],
  tap: [
    "Clip the gauge onto both legs and push it down onto the shorting bar.",
    "Attach the coax to both legs at the gauge's top edge, then remove the gauge.",
  ],
  radome: [
    "Clip a spacer onto the middle of each section before sliding the antenna into the radome.",
  ],
};

const H = 10;   // spacer thickness

function pair(M: ManifoldToplevel, s: number, tubeD: number): CrossSection {
  const CS = M.CrossSection, rb = (tubeD + CLEAR) / 2, R = rb + WALL;
  if (s < 2 * rb + WALL) throw new PartError(msg(FAIL.thick));
  return CS.hull([CS.circle(R, 48), CS.circle(R, 48).translate([s, 0])]).subtract(CS.union([CS.circle(rb, 48), CS.circle(rb, 48).translate([s, 0])]));
}

export function jpoleGeometry(d: Design) {
  const live = d.wires.filter((w) => !w.drawOnly && !w.necOnly);
  const feed = live.find((w) => w.group === "feed")!;
  const rad = live.find((w) => w.group === "driven")!;
  const stub = live.find((w) => w.tag === "B")!;   // the stub leg above the tap
  return { tubeD: mm(2 * rad.r), s: Math.abs(mm(stub.a[0] - rad.a[0])), tap: mm(feed.a[2]), stubTop: mm(Math.max(stub.a[2], stub.b[2])) };
}

export function jpoleParts(d: Design): PartSpec[] {
  const g = jpoleGeometry(d);
  const out: PartSpec[] = [{
    id: "jpole-spacer", title: SPACER_STRINGS[0], use: "holder", qty: Math.max(2, Math.ceil((g.stubTop - g.tap) / 120)),
    purpose: msg(SPACER_STRINGS[3], { len: g.s / 1000 }), howTo: SPACER_HOWTO.spacer.map((s) => msg(s)),
    build: (M) => [pair(M, g.s, g.tubeD).extrude(H)],
  }];
  const h = g.tap - g.tubeD / 2;   // the gauge stands on top of the shorting bar
  if (h >= 4) out.push({
    id: "jpole-tap", title: SPACER_STRINGS[1], use: "jig", qty: 1,
    purpose: msg(SPACER_STRINGS[4], { len: h / 1000 }), howTo: SPACER_HOWTO.tap.map((s) => msg(s)),
    build: (M) => {
      const CS = M.CrossSection, m = 0.4 * g.tubeD, big = g.tubeD + 2 * WALL + 2;
      const mouths = CS.union([0, g.s].map((x) => CS.square([2 * m, big]).translate([x - m, -big])));   // open towards −y: clips on
      return [pair(M, g.s, g.tubeD).subtract(mouths).extrude(h)];
    },
  });
  return out;
}

export function collinearParts(p: Params, d: Design): PartSpec[] {
  const rid = mm(num(p, "rid", 20e-3)), od = mm(num(p, "od", 5e-3));
  const sections = new Set(d.wires.filter((w) => !w.drawOnly && w.tag && /^S\d+$/.test(w.tag)).map((w) => w.tag)).size;
  return [{
    id: "collinear-spacer", title: SPACER_STRINGS[2], use: "holder", qty: sections,
    purpose: msg(SPACER_STRINGS[5], { len: rid / 1000 }), howTo: SPACER_HOWTO.radome.map((s) => msg(s)),
    build: (M) => {
      const CS = M.CrossSection, ro = (rid - CLEAR) / 2, rb = (od + CLEAR) / 2;
      if (ro - rb < WALL + 1) throw new PartError(msg(FAIL.radome));
      const vent = Math.min(2, (ro - rb) / 4), rv = (ro + rb) / 2;
      const cuts = CS.union([
        CS.circle(rb, 48),
        CS.square([0.8 * od, ro + 1]).translate([-0.4 * od, 0]),                                     // clip-on slot
        ...[45, 135, 225, 315].map((a) => CS.circle(vent, 16).translate([rv * Math.cos((a * Math.PI) / 180), rv * Math.sin((a * Math.PI) / 180)])),
      ]);
      return [CS.circle(ro, 96).subtract(cuts).extrude(6)];
    },
  }];
}
