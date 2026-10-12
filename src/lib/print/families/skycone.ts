import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design } from "../../types";
import { FAIL, msg, PartError, type PartSpec } from "../parts";
import { MAX_SIZE, mm } from "../rules";

// Sky-tilted capped bicone: the home-build kit of docs/FPV-DETECTOR-BUILD.md (the same parts as
// tools/wideband-antenna/print_parts.py). Geometry comes from the design's sheet facets, so the parts follow the band.

export const SKYCONE_STRINGS = [
  "Cover (radome)",
  "Covers the antenna: a 1.2 mm tube from the ground rim to the lid, closed on top. Its top is glued to the lid and its lower edge slides over the cup, so the cover and cup carry the hot element. This exact cover was checked with FDTD (PETG, εr 2.6): it changes the SWR by about 0.1.",
  "Cup (ground-cone die and base)",
  "Its conical top is the shape of the ground cone's underside: press the rolled ground cone into it to check the angle, then glue it in. The cover slides over its wall; the handle plugs into its socket.",
  "Handle",
  "Tube for the coax under the cup, with a pocket inside for the ferrite bead(s) (up to Ø11 mm).",
  "Bench stand",
  "Holds the handle upright on the bench while you solder; the cable leaves through the slot.",
  "Hot-element former",
  "Mandrel with the inside shape of the hot element: roll the feed cone on its tip, the main cone on its body and the rim on its base. The groove along one side keeps the soldered seam off the plastic.",
  "Support wedge",
  "Holds the main cone at its height above the ground cone while you solder it to the feed cone. Remove all three before fitting the cover.",
  "Pin-gap fork",
  "Sets the gap between the coax end and the washer ({0}): the washer rests on it while you solder it to the centre pin.",
  "Cutting template",
  "Flat pattern of one sheet part at 1:1, 1.2 mm thick: scribe round it on the sheet. The strip beyond the groove is the lap for the seam.",
  "Flat pattern of one sheet part at 1:1, in {0} pieces that butt together (too long for one piece): tape them edge to edge, then scribe round them.",
  "Covers the antenna: a 1.2 mm tube from the ground rim to the lid, closed on top, printed in {0} pieces that glue together on their laps (too large for one piece). Its top is glued to the lid and its lower edge to the cup or the ground rim.",
  "Tube for the coax under the cup, with a 12 cm pocket inside for the ferrite sleeve (6 beads up to Ø11 mm).",
];

/** Cutting-template titles by sheet label (the labels come from antennas/skycone.ts). */
export const SKYCONE_TPL: Record<string, string> = {
  "Hot cone": "Template: hot cone", "Hot cone, feed section": "Template: hot cone, feed section", "Hot cone, main section": "Template: hot cone, main section",
  "Ground cone": "Template: ground cone", "Ground cone, inner section": "Template: ground cone, inner section", "Ground cone, outer section": "Template: ground cone, outer section",
  "Lid": "Template: lid",
};

/** How-to steps per part, in order. */
export const SKYCONE_HOWTO = {
  cover: [
    "Print it in PETG (or ASA), top down, with 3 walls (1.2 mm) and no infill. Keep the wall at 1.2 mm: that is what was simulated.",
    "When the antenna is finished and measured, pull out the support wedges, put 4–5 dots of silicone on the lid and lower the cover until its top rests on the lid.",
    "Glue or tape its lower edge to the cup wall and let it cure upright on the stand.",
  ],
  cup: [
    "Print it on its flat bottom, cradle up, 3 walls and 15–20 % infill.",
    "Press the rolled ground cone into the cradle: it must sit flat all round. Solder its seam off the cup.",
    "After the coax jacket is soldered into the ground cone apex, glue the cone into the cradle with a few dots of silicone and glue the handle into the socket.",
  ],
  handle: [
    "Print it standing, narrow bore up.",
    "Slide the ferrite bead(s) onto the coax, thread the cut end up through the handle from below and on through the cup.",
    "Push the handle into the cup's socket; fix the bead in its pocket with a drop of silicone at the end.",
  ],
  handleSleeve: [
    "Print it standing, narrow bore up.",
    "Slide the 6 ferrite beads onto the coax, thread the cut end up through the handle from below and on through the cup.",
    "Push the handle into the cup's socket; the beads fill the pocket from the top. Fix the lowest one with a drop of silicone at the end.",
  ],
  stand: [
    "Print it flat side down.",
    "Stand the handle in it with the cable out through the slot; it keeps the antenna upright for every soldering step.",
  ],
  former: [
    "Print it on its flat end, tip up, with 2 walls and 10 % infill.",
    "Wrap each cut sector round its section (the feed cone on the tip, the main cone on the body, the rim strip round the base) with the seam over the groove, and hold it with rubber bands.",
    "Tack the seam over the groove, take the part off and solder the full seam. Solder the rim to the main cone while both are on the former.",
  ],
  wedge: [
    "Print three, lying flat.",
    "Stand them on the ground cone at 120°, thick end outward, and rest the main cone on them; slide them in or out to centre it on the feed cone.",
    "Solder the joint from inside, then the lid, measure, and pull the wedges out sideways before the cover goes on.",
  ],
  fork: [
    "Print it flat with 0.1 mm layers and measure its thickness: sand it or shim it with tape to the listed gap (±0.05 mm).",
    "Slide it onto the coax end with the centre pin in its slot, rest the washer (with the feed cone) on it and solder the pin to the washer from above.",
    "Let it cool and slide the fork out sideways.",
  ],
  template: [
    "Print it flat (1.2 mm, 100 % infill).",
    "Hold it on the sheet and scribe round it, including the lap strip; mark the groove line on the lap.",
    "Cut just outside the line with snips and file to the line.",
  ],
};

const SEG = 128;
const WALL_C = 1.2;          // cover wall (as simulated)
const SLIDE = 0.2;           // sliding fit
const JACKET = 3.58;         // UT-141 jacket
const HANDLE_D = 16;
const FERRITE_D = 11.2;
const LAP = 5;

type Pt = [number, number];
interface Seg { a: Pt; b: Pt; label: string; hot: boolean; kind: "sector" | "strip" | "disc" }

/** The profile back from the design: each sheet's first facet runs from (ρa, za) to (ρb, zb) at φ = 0 (mm). */
export function skyconeProfile(d: Design) {
  const segs: Seg[] = [];
  (d.sheets ?? []).forEach((sh, k) => {
    const pl = d.plates.find((q) => q.sheet === k);
    if (!pl) return;
    const a: Pt = [mm(Math.hypot(pl.pts[0][0], pl.pts[0][1])), mm(pl.pts[0][2])], b: Pt = [mm(Math.hypot(pl.pts[3][0], pl.pts[3][1])), mm(pl.pts[3][2])];
    segs.push({ a, b, label: sh.label, hot: Math.min(a[1], b[1]) > 1e-9, kind: sh.kind });
  });
  const hot = segs.filter((s) => s.hot), gnd = segs.filter((s) => !s.hot);
  // the hot element's inside: from the washer edge along the cones, up the rim, across the lid
  const walk: Pt[] = [];
  const zWasher = Math.min(...hot.map((q) => Math.min(q.a[1], q.b[1])));
  for (const s of hot.filter((q) => !(q.kind === "disc" && Math.abs(q.a[1] - zWasher) < 1e-6))) {     // all but the washer
    for (const p of [s.a, s.b]) if (!walk.length || Math.hypot(p[0] - walk[walk.length - 1][0], p[1] - walk[walk.length - 1][1]) > 1e-6) walk.push(p);
  }
  const ground: Pt[] = [];
  for (const s of gnd) for (const p of [s.a, s.b]) if (!ground.length || Math.hypot(p[0] - ground[ground.length - 1][0], p[1] - ground[ground.length - 1][1]) > 1e-6) ground.push(p);
  const Ru = Math.max(...walk.map((p) => p[0])), zLid = Math.max(...walk.map((p) => p[1]));
  const Rg = Math.max(...ground.map((p) => p[0])), zGrim = Math.min(...ground.map((p) => p[1]));
  const kRu = walk.findIndex((p) => p[0] >= Ru - 1e-6);
  const cones = walk.slice(0, kRu + 1);
  const pin = d.wires[0];
  return { segs, walk, cones, ground, Ru, zLid, Rg, zGrim, gap: mm(Math.abs(pin.b[2] - pin.a[2])) };
}

const interp = (pts: Pt[], r: number): number => {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [r0, z0] = pts[i], [r1, z1] = pts[i + 1];
    if (r1 > r0 + 1e-9 && r >= r0 - 1e-9 && r <= r1 + 1e-9) return z0 + ((z1 - z0) * (r - r0)) / (r1 - r0);
  }
  return r <= pts[0][0] ? pts[0][1] : pts[pts.length - 1][1];
};

const centre = (m: Manifold): Manifold => {
  const b = m.boundingBox();
  return m.translate([-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2]]);
};

/** Piece i of n of an annular sector (r0..r1, A degrees) as a polygon; piece 0 of a cone carries the seam lap below 0°. */
function sectorOutline(r0: number, r1: number, A: number, n: number, i: number, lap: boolean): Pt[] {
  const a0 = (A * i) / n, a1 = (A * (i + 1)) / n, k = Math.max(8, Math.ceil((a1 - a0) / 1.5));
  const arc = (r: number): Pt[] => Array.from({ length: k + 1 }, (_, j) => { const t = ((a0 + ((a1 - a0) * j) / k) * Math.PI) / 180; return [r * Math.cos(t), r * Math.sin(t)]; });
  const out = [...arc(r1), ...arc(r0).reverse()];
  return lap && i === 0 ? [...out, [r0, -LAP], [r1, -LAP]] : out;
}

/** Fewest pieces (≤ 12) whose bounding boxes, each turned to its middle angle, fit the bed; 0 when none do. */
function sectorSplit(r0: number, r1: number, A: number, lap: boolean): number {
  for (let n = 1; n <= 12; n++) {
    const ok = Array.from({ length: n }, (_, i) => {
      const t = (-(A * (i + 0.5)) / n) * Math.PI / 180, c = Math.cos(t), s = Math.sin(t);
      const q = sectorOutline(r0, r1, A, n, i, lap).map(([x, y]) => [x * c - y * s, x * s + y * c]);
      const w = Math.max(...q.map((p) => p[0])) - Math.min(...q.map((p) => p[0])), h = Math.max(...q.map((p) => p[1])) - Math.min(...q.map((p) => p[1]));
      return w <= MAX_SIZE - 1 && h <= MAX_SIZE - 1;
    }).every(Boolean);
    if (ok) return n;
  }
  return 0;
}

const COVER_LAP = 8;          // glue laps of a cover printed in pieces
const RING_H = 165;           // tallest ring of a cover printed in pieces

/** How a cover of inside radius rin and height H is split: n sectors round, k rings up. */
function coverSplit(rin: number, H = 0): { n: number; k: number } {
  const ro = rin + WALL_C;
  if (2 * ro <= MAX_SIZE - 1 && H <= MAX_SIZE - 1) return { n: 1, k: 1 };
  let n = 2;
  while (n < 24 && 2 * ro * Math.sin(Math.PI / Math.max(n, 2)) + COVER_LAP > MAX_SIZE - 10) n++;
  return { n: Math.max(n, 3), k: Math.max(1, Math.ceil(H / RING_H)) };
}

/**
 * The cover: one piece printed top down when it fits the bed, otherwise n sectors × k rings. Each wall piece has a
 * lap strip on the inside past its end angle and, below the top ring, a lap band on the inside above its top edge;
 * the top-disc slices butt together (the lid they are glued to holds them).
 */
function coverPieces(M: ManifoldToplevel, rin: number, z0: number, zInTop: number): Manifold[] {
  const ro = rin + WALL_C, zt = zInTop + WALL_C;
  const rev = (pts: Pt[]) => M.Manifold.revolve(new M.CrossSection([pts]), SEG);
  const full = rev([[rin, z0], [ro, z0], [ro, zt], [0, zt], [0, zInTop], [rin, zInTop]]);
  const { n, k } = coverSplit(rin, zt - z0);
  if (n === 1 && k === 1) return [centre(full.mirror([0, 0, 1]))];
  const R = 2 * ro + 10;
  const wedge = (a0: number, a1: number, za: number, zb: number) => {
    const m = Math.max(2, Math.ceil((a1 - a0) / 5));
    const pts: Pt[] = [[0, 0], ...Array.from({ length: m + 1 }, (_, j): Pt => { const t = ((a0 + ((a1 - a0) * j) / m) * Math.PI) / 180; return [R * Math.cos(t), R * Math.sin(t)]; })];
    return M.Manifold.extrude(new M.CrossSection([pts]), zb - za).translate([0, 0, za]);
  };
  const band = (za: number, zb: number) => rev([[rin - WALL_C, za], [rin + 0.01, za], [rin + 0.01, zb], [rin - WALL_C, zb]]);
  const lapAng = (COVER_LAP / rin) * (180 / Math.PI);
  const out: Manifold[] = [];
  for (let j = 0; j < k; j++) {
    const za = z0 + ((zt - z0) * j) / k, zb = j === k - 1 ? zt + 1 : z0 + ((zt - z0) * (j + 1)) / k;
    const top = j === k - 1;
    for (let i = 0; i < n; i++) {
      const a0 = (360 * i) / n, a1 = (360 * (i + 1)) / n;
      let piece = full.intersect(wedge(a0, a1, za - 1, zb));
      const zLapTop = Math.min(zb, zInTop);
      piece = piece.add(band(za, zLapTop).intersect(wedge(a1, a1 + lapAng, za, zLapTop)));            // side lap
      if (!top) piece = piece.add(band(zb, zb + COVER_LAP).intersect(wedge(a0, a1, zb, zb + COVER_LAP)));   // ring lap
      piece = piece.rotate([0, 0, -(a0 + a1) / 2]);
      out.push(centre(top ? piece.mirror([0, 0, 1]) : piece));
    }
  }
  return out;
}

/** Every printed part of the kit; `sheetT` is the sheet thickness (mm); `sleeve`: a long handle for a 6-bead ferrite sleeve. */
export function skyconeParts(d: Design, sheetT = 0.3, sleeve = false): PartSpec[] {
  const g = skyconeProfile(d);
  const L = (x: number) => ({ len: x / 1000 });
  const rin = Math.max(g.Ru, g.Rg) + 2 + sheetT;           // cover inside radius: 2 mm outside the widest rim
  const zInTop = g.zLid + sheetT + 0.1, zCov0 = g.zGrim - 8;
  const rBore = JACKET / 2 + 0.15, rSock = HANDLE_D / 2 + SLIDE, zCup0 = zCov0 - 2;
  const rWallI = g.Rg + sheetT + 0.4, rWallO = rin - SLIDE;
  const tooSmall = () => { if (rWallI < rSock + 3 || g.Ru < rSock + 3) throw new PartError(msg(FAIL.radome)); };
  const revolve = (M: ManifoldToplevel, pts: Pt[]) => M.Manifold.revolve(new M.CrossSection([pts]), SEG);
  const parts: PartSpec[] = [];
  const split = coverSplit(rin, zInTop + WALL_C - zCov0);

  parts.push({
    id: "shell", title: SKYCONE_STRINGS[0], use: "holder", qty: 1, howTo: SKYCONE_HOWTO.cover.map((s) => msg(s)),
    purpose: split.n * split.k > 1 ? msg(SKYCONE_STRINGS[17], split.n * split.k) : msg(SKYCONE_STRINGS[1]),
    build: (M) => coverPieces(M, rin, zCov0, zInTop),
  });
  if (2 * rWallO <= MAX_SIZE) parts.push({
    id: "skycone-cup", title: SKYCONE_STRINGS[2], use: "holder", qty: 1, purpose: msg(SKYCONE_STRINGS[3]), howTo: SKYCONE_HOWTO.cup.map((s) => msg(s)),
    build: (M) => {
      tooSmall();
      const slope = Math.atan2(g.ground[0][1] - g.ground[1][1], g.ground[1][0] - g.ground[0][0]);
      const dz = sheetT / Math.cos(slope) + 0.1;
      const rs = [...new Set([rBore, rWallI, ...g.ground.map((p) => p[0]).filter((r) => r > rBore && r < rWallI)])].sort((a, b) => a - b);
      const cradle = rs.map((r): Pt => [r, interp(g.ground, r) - dz]);
      return [centre(revolve(M, [[rBore, zCup0 + 12], [rSock, zCup0 + 12], [rSock, zCup0], [rWallO, zCup0], [rWallO, g.zGrim + 0.8], [rWallI, g.zGrim + 0.8], ...cradle.reverse()]))];
    },
  });
  parts.push({
    id: "skycone-handle", title: SKYCONE_STRINGS[4], use: "holder", qty: 1, purpose: msg(SKYCONE_STRINGS[sleeve ? 18 : 5]),
    howTo: (sleeve ? SKYCONE_HOWTO.handleSleeve : SKYCONE_HOWTO.handle).map((s) => msg(s)),
    build: (M) => {
      tooSmall();
      const h = sleeve ? 130 : 90;                                      // the sleeve: 6 beads over the first 11 cm of coax
      return [revolve(M, [[FERRITE_D / 2, 0], [HANDLE_D / 2, 0], [HANDLE_D / 2, h], [rBore, h], [rBore, h - 6], [FERRITE_D / 2, h - 6]])];
    },
  });
  parts.push({
    id: "skycone-stand", title: SKYCONE_STRINGS[6], use: "jig", qty: 1, purpose: msg(SKYCONE_STRINGS[7]), howTo: SKYCONE_HOWTO.stand.map((s) => msg(s)),
    build: (M) => {
      const s = HANDLE_D / 2 + SLIDE;
      return [revolve(M, [[0, 0], [55, 0], [55, 4], [s + 3, 4], [s + 3, 34], [s, 34], [s, 4], [0, 4]])
        .subtract(M.Manifold.cylinder(6, 4, 4, 32).translate([0, 0, -1]))
        .subtract(M.Manifold.cube([30, 6, 40]).translate([0, -3, 4]))];
    },
  });
  if (2 * g.Ru <= MAX_SIZE && g.zLid - g.walk[0][1] <= MAX_SIZE) parts.push({
    id: "skycone-former", title: SKYCONE_STRINGS[8], use: "former", qty: 1, purpose: msg(SKYCONE_STRINGS[9]), howTo: SKYCONE_HOWTO.former.map((s) => msg(s)),
    build: (M) => {
      const pts: Pt[] = [[0, g.walk[0][1]], ...g.walk, [0, g.zLid]];
      const cs = new M.CrossSection([pts]);
      const body = M.Manifold.revolve(cs, SEG);
      const depth = Math.min(2, g.Ru / 10);
      const inner = M.Manifold.revolve(cs.offset(-depth), SEG);
      const groove = body.subtract(inner).intersect(M.Manifold.cube([g.Ru + 5, 8, g.zLid + 5]).translate([Math.max(4, g.walk[0][0] + 1), -4, -1]));
      return [centre(body.subtract(groove).mirror([0, 0, 1]))];
    },
  });
  parts.push({
    id: "skycone-wedge", title: SKYCONE_STRINGS[10], use: "jig", qty: 3, purpose: msg(SKYCONE_STRINGS[11]), howTo: SKYCONE_HOWTO.wedge.map((s) => msg(s)),
    build: (M) => {
      const c = g.cones, n = c.length, r0 = c[n - 2][0], ra = r0 + 0.15 * (g.Ru - r0), rb = r0 + 0.6 * (g.Ru - r0);
      const sinH = Math.sin(Math.atan2(c[n - 1][0] - c[n - 2][0], c[n - 1][1] - c[n - 2][1]));
      const rr = [...new Set([ra, rb, ...[...c, ...g.ground].map((p) => p[0]).filter((r) => r > ra && r < rb)])].sort((a, b) => a - b);
      const top = rr.map((r): Pt => [r, interp(c, r) - (sheetT + 0.1) / Math.max(sinH, 0.2)]);
      const bot = rr.map((r): Pt => [r, interp(g.ground, r) + 0.1]);
      return [centre(M.Manifold.extrude(new M.CrossSection([[...bot, ...top.reverse()]]), 10))];
    },
  });
  parts.push({
    id: "skycone-fork", title: SKYCONE_STRINGS[12], use: "jig", qty: 1, purpose: msg(SKYCONE_STRINGS[13], L(g.gap)), howTo: SKYCONE_HOWTO.fork.map((s) => msg(s)),
    build: (M) => [M.Manifold.cube([40, 14, g.gap])
      .subtract(M.Manifold.cube([10, 1.4, g.gap + 2]).translate([-0.01, 6.3, -1]))
      .subtract(M.Manifold.cylinder(g.gap + 2, 0.9, 0.9, 24).translate([10, 7, -1]))
      .add(M.Manifold.cube([20, 14, 4]).translate([20, 0, 0]))],
  });
  // cutting templates: every cone (annular sector) and the lid; a pattern larger than the bed comes in butting pieces,
  // and one that cannot be split to fit (a radial extent past the bed) is left to the paper template
  let nT = 0;
  for (const sh of d.sheets ?? []) {
    if (sh.kind === "strip") continue;                                   // a plain strip: measured with a ruler
    if (sh.kind === "disc" && mm(sh.d) < 10) continue;                   // the washer: drilled and filed
    nT++;
    const cone = sh.kind === "sector";
    const r0 = cone ? mm(sh.r0) : Math.max(mm(sh.hole) / 2, 0.5), r1 = cone ? mm(sh.r1) : mm(sh.d) / 2, A = cone ? sh.angle : 360;
    const n = sectorSplit(r0, r1, A, cone);
    if (!n) continue;
    parts.push({
      id: `skycone-tpl-${nT}`, title: SKYCONE_TPL[sh.label] ?? SKYCONE_STRINGS[14], use: "jig", qty: 1,
      purpose: n > 1 ? msg(SKYCONE_STRINGS[16], n) : msg(SKYCONE_STRINGS[15]), howTo: SKYCONE_HOWTO.template.map((s) => msg(s)),
      build: (M) => Array.from({ length: n }, (_, i) => {
        let plate = M.Manifold.extrude(new M.CrossSection([sectorOutline(r0, r1, A, n, i, cone)]), 1.2);
        if (cone && i === 0) plate = plate.subtract(M.Manifold.cube([r1 - r0 + 2, 0.6, 0.6]).translate([r0 - 1, -0.3, 0.9]));   // seam line
        return centre(plate.rotate([0, 0, -(A * (i + 0.5)) / n]));         // middle along +x: the smallest box
      }),
    });
  }
  return parts;
}
