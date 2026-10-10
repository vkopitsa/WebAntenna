import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Vec3 } from "../../types";
import { FAIL, msg, PartError, type PartSpec } from "../parts";
import { CLEAR, M3_HOLE, MAX_SIZE, WALL, mm } from "../rules";
import { box, dShape, stack, twistGroove, type V3 } from "../shapes";

/** Axial-mode helix: a grooved tube or a rib frame that holds the wire at the designed diameter, pitch and hand. */
export const FORMER_STRINGS = [
  "Helix former: grooved tube",
  "Helix former: rib frame",
  "Holds the wire in a helical groove along its whole length: {0} diameter, {1} per turn, {2} turns. The base flange screws to the reflector and is its drilling template.",
  "{0} ribs hold the wire in notches: {1} diameter, {2} per turn, {3} turns. Least plastic near the wire. The base flange screws to the reflector and is its drilling template.",
  "Plastic touching the wire lowers the resonance by a few %: retune with Trim, or slide the tube out after winding.",
];

/** How-to steps, in order. */
export const FORMER_HOWTO = [
  "Print only one former, the tube or the frame, standing upright; it needs no supports.",
  "If it comes in several pieces, glue each spigot into the piece above; the flat on the spigot lines up the groove.",
  "Bend the wire end into an L: the short leg (the feed height) goes down the slot in the base to the connector pin, the bend sits at the start of the groove.",
  "Wind the wire into the groove to the top, keeping it tight, and fix the end with a drop of glue.",
  "Drill the reflector through the flange holes and the centre hole, mount the SMA panel jack from behind, screw the former on and solder the wire to the pin.",
];

const FLANGE_T = 2;   // base flange on the reflector
const KEY_H = 8;      // spigot height between stacked pieces
const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];
/** Polygon sides for a circle of radius r with a chord sag under 0.05 mm. */
const sides = (r: number) => Math.max(32, Math.ceil((2 * Math.PI) / Math.sqrt(0.4 / r)));

/** Helix geometry in mm from the model: feed wire up the axis to h0, a radial stub to R, then the coil. */
export function helixGeometry(d: Design) {
  const live = d.wires.filter((w) => !w.drawOnly && !w.necOnly);
  const feed = live.find((w) => w.group === "feed")!;
  const [stub, ...coil] = live.filter((w) => w.group === "driven");
  const h0 = mm(feed.b[2]), R = mm(Math.hypot(stub.b[0], stub.b[1])), wireD = mm(2 * stub.r);
  let turn = 0;
  for (const w of coil) {
    const da = Math.atan2(w.b[1], w.b[0]) - Math.atan2(w.a[1], w.a[0]);
    turn += da - 2 * Math.PI * Math.round(da / (2 * Math.PI));
  }
  const n = Math.abs(turn) / (2 * Math.PI), hand = (turn > 0 ? 1 : -1) as 1 | -1;
  const top = mm(coil[coil.length - 1].b[2]), S = (top - h0) / n;
  return { R, wireD, h0, S, n, hand, top, H: top + S / 2, pts: coil.map((w) => mmv(w.b)) };
}
export type HelixGeometry = ReturnType<typeof helixGeometry>;

export const ribs = (g: HelixGeometry) => (2 * Math.PI * g.R > 160 ? 6 : 4);

export function formerBody(M: ManifoldToplevel, style: "tube" | "frame", g: HelixGeometry): Manifold[] {
  const CS = M.CrossSection, c = g.wireD + CLEAR, inner = g.R - c / 2;     // groove bottom radius
  const fr = g.R + g.wireD / 2 + 8, hr = g.R + g.wireD / 2 + 4.5;
  if (2 * fr > MAX_SIZE) throw new PartError(msg("Too large to print in one piece: {0}", { len: 2 * fr / 1000 }));
  const bore = inner - WALL, hubR = Math.min(15, Math.max(4.5, 0.3 * g.R));
  if (style === "tube" ? bore < 2.5 : inner < hubR + 1) throw new PartError(msg(FAIL.thick));
  const n = ribs(g), aw = Math.max(4, g.wireD + 2);
  const prof = style === "tube"
    ? CS.circle(g.R, sides(g.R)).subtract(CS.circle(bore, sides(bore)))
    : CS.union([CS.circle(hubR, 48), ...Array.from({ length: n }, (_, k) => CS.square([g.R, aw]).translate([0, -aw / 2]).rotate((360 * k) / n))]);
  const body = M.Manifold.union([M.Manifold.extrude(prof, g.H), M.Manifold.cylinder(FLANGE_T, fr, fr, sides(fr))]);
  const cuts = M.Manifold.union([
    // start one wire diameter low so the lower half of the wire at the first turn is in the groove, then turn it
    // back so the groove is at angle 0 at h0 again
    twistGroove(M, g.R, g.wireD, g.h0 - c, g.H + 1, g.S, g.hand).rotate([0, 0, (-g.hand * 360 * c) / g.S]),
    box(M, [-c / 2, -c / 2, -1], [g.R + g.wireD, c / 2, g.h0 + c / 2]),               // feed slot: the wire's L slides in from below
    M.Manifold.cylinder(FLANGE_T + 2, 2.1, 2.1, 24).translate([0, 0, -1]),               // SMA pin and PTFE
    ...[60, 180, 300].map((a) => M.Manifold.cylinder(FLANGE_T + 2, M3_HOLE / 2, M3_HOLE / 2, 16)
      .translate([hr * Math.cos((a * Math.PI) / 180), hr * Math.sin((a * Math.PI) / 180), -1])),
  ]);
  const part = body.subtract(cuts);
  if (style === "tube") {
    const r = bore - CLEAR / 2, f = 0.4 * r;
    return stack(part, g.H, (zc) => ({
      // C-shaped spigot in the bore, fused to the wall by a short collar below the cut
      below: M.Manifold.union([
        M.Manifold.extrude(dShape(M, r, f).subtract(CS.circle(r - WALL, 48)), KEY_H).translate([0, 0, zc]),
        M.Manifold.extrude(CS.circle(bore + 0.5, 64).subtract(CS.circle(r - WALL, 48)), 2).translate([0, 0, zc - 2]),
      ]),
      // the flat side of the bore above is filled, so the spigot only fits one way round
      aboveAdd: M.Manifold.extrude(CS.circle(bore + 0.5, 64).subtract(dShape(M, bore + 1, f + CLEAR)), KEY_H + 0.5).translate([0, 0, zc]),
    }));
  }
  const rk = hubR - WALL, f = 0.4 * rk;
  return stack(part, g.H, (zc) => ({
    below: M.Manifold.extrude(dShape(M, rk, f), KEY_H + 2).translate([0, 0, zc - 2]),
    aboveCut: M.Manifold.extrude(dShape(M, rk + CLEAR / 2, f + CLEAR / 2), KEY_H + 1.5).translate([0, 0, zc - 1]),
  }));
}

export function helixParts(d: Design): PartSpec[] {
  const g = helixGeometry(d);
  const howTo = FORMER_HOWTO.map((s) => msg(s));
  const D = { len: (2 * g.R) / 1000 }, S = { len: g.S / 1000 }, n = Math.round(g.n * 10) / 10;
  return [
    { id: "helix-tube", title: FORMER_STRINGS[0], use: "former", qty: 1, purpose: msg(FORMER_STRINGS[2], D, S, n), warn: msg(FORMER_STRINGS[4]), howTo, build: (M) => formerBody(M, "tube", g) },
    { id: "helix-frame", title: FORMER_STRINGS[1], use: "former", qty: 1, purpose: msg(FORMER_STRINGS[3], ribs(g), D, S, n), howTo, build: (M) => formerBody(M, "frame", g) },
  ];
}
