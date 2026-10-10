import type { AntennaDef, Design } from "../types";
import { num, str } from "../types";
import { fmt, wavelength } from "../rf";
import { pcbPlates, type Pcb, type PcbBox, type PcbLevel, type PcbPoly } from "../pcb";
import { band, BANDS } from "./common";

// Pagoda-3 / 3B by Maarten Baert (https://maartenbaert.be/quadcopters/antennas/pagoda-antenna), CC BY-SA 4.0.
// Dimensions follow his pcb_pagoda_3.py generator: HFSS-optimised at 5.8 and 5.5 GHz and interpolated linearly in
// frequency (published for 5.3–6.0 GHz). Three 1.0 mm FR-4 discs on a 3.6 mm semi-rigid coax (RG402): the top board
// is fed by the coax core, the middle one by the shield, the small bottom one is a sleeve choke on the shield.

/** Published range; outside it the whole geometry (board thickness and coax too) is scaled. */
export const PAGODA_RANGE: [number, number] = [5.3e9, 6.0e9];

/** Linear in frequency through (5.8 GHz, a) and (5.5 GHz, b) (mm or degrees). */
const par = (a: number, b: number, fGHz: number) => a + ((b - a) * (fGHz - 5.8)) / (5.5 - 5.8);

/** The generator's dimensions in mm and degrees at fGHz (5.3–6.0). */
export function pagodaDims(fGHz: number, v: "3" | "3B") {
  const disk_r1 = v === "3" ? par(5.1539, 5.222, fGHz) : par(5.5849, 5.9331, fGHz);
  const disk_r2 = v === "3" ? par(7.5056, 7.8335, fGHz) : par(7.6025, 7.6993, fGHz);
  const track_r1 = par(10.2313, 10.8369, fGHz);
  const track_w = 1.0;
  return {
    coax_r1: 0.46, coax_r2: 1.5, coax_r3: 1.8, solder_w: 0.6, hole_sp: 0.05, hole_sp2: 0.1,
    disk_r1, disk_r2, disk_r3: par(5.6459, 5.8238, fGHz),
    disk_d1: par(3.6526, 4.0952, fGHz), // board 1 bottom → board 2 top
    disk_d2: par(12.4514, 13.161, fGHz), // board 2 top → board 3 bottom
    pcb_th: 1.0, track_w,
    track_a1: v === "3" ? par(71.7938, 71.0801, fGHz) : par(69.1855, 66.9806, fGHz),
    track_c1: v === "3" ? par(17.49, 16.7242, fGHz) : par(19.1231, 16.3271, fGHz),
    track_r1,
    track_r2: v === "3" ? par(8.6079, 9.0174, fGHz) : (track_r1 + disk_r2 - track_w / 2) / 2,
    hole_r1: v === "3" ? par(2.3863, 2.5204, fGHz) : par(2.4297, 2.1754, fGHz),
    hole_r2: v === "3" ? par(5.2364, 5.5135, fGHz) : par(4.7274, 5.044, fGHz),
  };
}

type P2 = [number, number];
/** Copper outline and, for tracks, its centre line. */
interface Shape { pts: P2[]; path?: P2[]; label?: string }
const rad = (a: number) => (a * Math.PI) / 180;

/** Disc (counter-clockwise), radius r. */
function disc(r: number, n = 32): P2[] {
  return Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n)] as P2);
}
/** Annulus r0…r1 as two half-rings (simple polygons: no keyhole slit in the drawings). */
function ring(r0: number, r1: number, n = 16): P2[][] {
  const half = (a0: number): P2[] => {
    const at = (r: number, k: number): P2 => { const a = a0 + (Math.PI * k) / n; return [r * Math.cos(a), r * Math.sin(a)]; };
    return [...Array.from({ length: n + 1 }, (_, k) => at(r1, k)), ...Array.from({ length: n + 1 }, (_, k) => at(r0, n - k))];
  };
  return [half(0), half(Math.PI)];
}
/** Track of width w along an arc of radius r from a1 to a2 (degrees), ends extended by w/2 (the round caps). */
function arcTrack(r: number, a1: number, a2: number, w: number): Shape {
  const ext = (w / 2 / r) * (180 / Math.PI), s = Math.sign(a2 - a1) || 1;
  const b1 = a1 - s * ext, b2 = a2 + s * ext;
  const n = Math.max(2, Math.ceil((Math.abs(b2 - b1) * Math.PI * r) / 180 / w) + 1);
  const at = (rr: number, k: number): P2 => { const a = rad(b1 + ((b2 - b1) * k) / (n - 1)); return [rr * Math.cos(a), rr * Math.sin(a)]; };
  const out: P2[] = [];
  for (let k = 0; k < n; k++) out.push(at(r + w / 2, k));
  for (let k = n - 1; k >= 0; k--) out.push(at(r - w / 2, k));
  return { pts: out, path: Array.from({ length: n }, (_, k) => at(r, k)) };
}
/** Straight track of width w from p to q, ends extended by w/2. */
function lineTrack(p: P2, q: P2, w: number): Shape {
  const L = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ux = (q[0] - p[0]) / L, uy = (q[1] - p[1]) / L, nx = -uy * (w / 2), ny = ux * (w / 2);
  const a: P2 = [p[0] - (ux * w) / 2, p[1] - (uy * w) / 2], b: P2 = [q[0] + (ux * w) / 2, q[1] + (uy * w) / 2];
  return { pts: [[a[0] - nx, a[1] - ny], [b[0] - nx, b[1] - ny], [b[0] + nx, b[1] + ny], [a[0] + nx, a[1] + ny]], path: [p, q] };
}

/**
 * Copper of board 1 or 2 (mm): centre pad, a spoke to the ring, the ring, and three legs. Each leg: from the ring's
 * outer edge out to radius r2, an arc of c1 at r2, out to r1, then the long arc of a1 at r1. `mirror` = the other board.
 */
function legs(d: ReturnType<typeof pagodaDims>, ringIn: number, ringOut: number, pad: number, lhcp: boolean, board2: boolean): Shape[] {
  const w = d.track_w, b1 = -d.track_c1 / 2, out: Shape[] = [{ pts: disc(pad), label: "Feed ring" }, ...ring(ringIn, ringOut).map((pts) => ({ pts, label: "Feed ring" }))];
  const pt = (r: number, a: number): P2 => [r * Math.cos(rad(a)), r * Math.sin(rad(a))];
  // board 2 is the mirror image of board 1 (the generator swaps the two branches)
  const plus = lhcp !== board2;
  for (const angle of [90, 210, 330]) {
    let a1: number, a2: number, a3: number, a4: number;
    if (plus) { a1 = angle + b1; a2 = a1 + d.track_a1; a3 = angle + b1; a4 = angle + b1 + d.track_c1; }
    else { a1 = angle - b1; a2 = a1 - d.track_a1; a3 = angle - b1; a4 = angle - b1 - d.track_c1; }
    // track_w1 = track_w2 here, so the generator's (w2 − w1)/2/r1 correction of a1 is zero
    out.push(arcTrack(d.track_r1, a1, a2, w), arcTrack(d.track_r2, a3, a4, w),
      lineTrack(pt(d.track_r1, a3), pt(d.track_r2, a3), w), lineTrack(pt(ringOut, a4), pt(d.track_r2, a4), w),
      lineTrack([0, 0], pt(ringIn, angle + 60), w));
  }
  return out;
}

export const pagoda: AntennaDef = {
  id: "pagoda",
  name: "Pagoda (FPV)",
  category: "Circular polarisation",
  traits: { pol: "circular", pattern: "omni" },
  summary: "Maarten Baert's Pagoda-3: three stacked FR-4 discs on a semi-rigid coax, omnidirectional circular polarisation with a 500 MHz bandwidth at 5.8 GHz.",
  params: [
    BANDS,
    { key: "version", label: "Version", kind: "select", options: [["3", "Pagoda-3 (bare)"], ["3B", "Pagoda-3B (inside a 1 mm ABS shell)"]] },
    { key: "hand", label: "Polarisation", kind: "select", options: [["rhcp", "RHCP (right hand)"], ["lhcp", "LHCP (left hand)"]] },
    { key: "er", label: "Substrate εr", kind: "number", min: 3, max: 5, step: 0.05, hint: "The design assumes FR-4 ≈ 4.4; the resonance shifts with it" },
    { key: "tanD", label: "Loss tangent tan δ", kind: "number", min: 0, max: 0.05, step: 0.001, hint: "FR-4 ≈ 0.02" },
  ],
  defaults: { bands: "5.65e9-5.95e9", version: "3", hand: "rhcp", er: 4.4, tanD: 0.02 },
  build(p): Design {
    const { f, sweeps } = band(p);
    const v = str(p, "version", "3") === "3B" ? "3B" : "3", lhcp = str(p, "hand", "rhcp") === "lhcp";
    const fr = Math.min(PAGODA_RANGE[1], Math.max(PAGODA_RANGE[0], f)), k = fr / f; // geometry scale outside the range
    const d = pagodaDims(fr / 1e9, v);
    const mm = (x: number) => x * 1e-3 * k;
    const sc = (pts: P2[]): P2[] => pts.map(([x, y]) => [mm(x), mm(y)]);
    const poly = (layer: "top" | "bottom", q: Shape, label: string, w: number): PcbPoly => ({ layer, pts: sc(q.pts), label, w: mm(w), ...(q.path ? { path: sc(q.path) } : {}) });
    const h = mm(d.pcb_th), pcbR = d.track_r1 + d.track_w / 2 + 0.5, pcbR3 = d.disk_r3 + 0.5;
    const shieldPad = d.coax_r3 + d.solder_w;
    const box = (r: number) => ({ x0: -mm(r), y0: -mm(r), x1: mm(r), y1: mm(r) });
    // board 1: core-fed copper on top, the shield soldered to an annulus underneath
    const top1 = legs(d, d.hole_r1, d.disk_r1, d.coax_r1 + d.solder_w, lhcp, false).map((q) => poly("top", q, q.label ?? "Arm", d.track_w));
    const bot1 = ring(d.coax_r2, shieldPad).map((pts) => poly("bottom", { pts }, "Shield pad", d.track_w));
    // board 2: shield-fed copper on top (mirror image), pads both sides; its top face is d1 below board 1's bottom
    const z2 = -mm(d.disk_d1) - h;
    const top2 = legs(d, d.hole_r2, d.disk_r2, shieldPad, lhcp, true).map((q) => poly("top", q, q.label ?? "Arm", d.track_w));
    // board 3: a choke disc on its underside, d2 below board 2's top face
    const z3 = -mm(d.disk_d1) - mm(d.disk_d2);
    const lv2: PcbLevel = { label: "Board 2 (middle, shield)", z0: z2, board: box(pcbR), outline: sc(disc(pcbR)), rects: [], polys: [...top2, poly("bottom", { pts: disc(shieldPad) }, "Shield pad", d.track_w)], drills: [{ x: 0, y: 0, d: mm(2 * (d.coax_r3 + d.hole_sp2)) }] };
    const lv3: PcbLevel = { label: "Board 3 (bottom, choke)", z0: z3, board: box(pcbR3), outline: sc(disc(pcbR3)), rects: [], polys: [poly("top", { pts: disc(shieldPad) }, "Shield pad", d.track_w), poly("bottom", { pts: disc(d.disk_r3) }, "Choke disc", d.track_w)], drills: [{ x: 0, y: 0, d: mm(2 * (d.coax_r3 + d.hole_sp2)) }] };
    // the shield: a solid column of the same cross-section area as the Ø3.6 mm coax, up to board 1's underside
    const sq = mm(d.coax_r3) * Math.sqrt(Math.PI) / 2;
    const shield: PcbBox = { x0: -sq, y0: -sq, z0: -Infinity, x1: sq, y1: sq, z1: 0, label: "Coax shield" };
    const er = num(p, "er", 4.4), tanD = num(p, "tanD", 0.02);
    const pcb: Pcb = {
      board: box(pcbR), outline: sc(disc(pcbR)), h, er, tanD, t: 35e-6,
      rects: [], polys: [...top1, ...bot1],
      drills: [{ x: 0, y: 0, d: mm(2 * (d.coax_r1 + d.hole_sp)) }],
      // the core crosses board 1 from the shield's end to the top copper
      port: { start: [0, 0, 0], stop: [0, 0, h], dir: "z", R: 50 },
      levels: [lv2, lv3], pec: [shield], coaxFeed: true,
    };
    const lam = wavelength(f);
    const scaled = Math.abs(k - 1) > 1e-9;
    return {
      wires: [], plates: pcbPlates(pcb), pcb, feedZ0: 50,
      dims: [
        { label: "Wavelength λ", value: lam },
        { key: "D1", label: "D1: board 1 underside to board 2 top", value: mm(d.disk_d1) },
        { key: "D2", label: "D2: board 2 underside to board 3 top", value: mm(d.disk_d2) - 2 * h },
        { label: "Board thickness (FR-4)", value: h },
        { label: "Board 1 and 2 diameter", value: 2 * mm(pcbR) },
        { label: "Board 3 diameter", value: 2 * mm(pcbR3) },
        { label: "Leg arc radius (outer)", value: mm(d.track_r1) },
        { label: "Leg arc radius (inner)", value: mm(d.track_r2) },
        { label: "Ring, board 1 (outer radius)", value: mm(d.disk_r1) },
        { label: "Ring, board 2 (outer radius)", value: mm(d.disk_r2) },
        { label: "Choke disc diameter (board 3)", value: 2 * mm(d.disk_r3) },
        { label: "Track width", value: mm(d.track_w) },
        { label: "Coax (semi-rigid RG402) outer diameter", value: mm(2 * d.coax_r3) },
      ],
      tables: [{
        title: "Leg angles",
        columns: [{ label: "Outer arc", kind: "text" }, { label: "Inner arc", kind: "text" }],
        rows: [[`${fmt(d.track_a1, 2)}°`, `${fmt(d.track_c1, 2)}°`]],
      }],
      perf: [
        { label: "Polarisation", value: lhcp ? "LHCP (left hand)" : "RHCP (right hand)" },
        { label: "Gain", value: "≈ 1.2 dBic (Baert, simulated)" },
        { label: "Axial ratio", value: "< 1.3 across the band (Baert, simulated)" },
        { label: "Bandwidth", value: "≈ 500 MHz (5.55–6.05 GHz for the 5.8 GHz version)" },
        { label: "Feed impedance", value: "≈ 50 Ω, direct 50 Ω coax" },
      ],
      notes: [
        ...(scaled ? ["Outside 5.3–6.0 GHz: the published design is scaled as a whole, including the board thickness and the coax. Re-check it in the FDTD before building."] : []),
        "Design by Maarten Baert (maartenbaert.be), CC BY-SA 4.0: share modified versions under the same licence and credit him.",
        "The board spacing must hold to ±0.1 mm: a small error shifts the centre frequency and spoils the axial ratio. Use a printed jig.",
        "Slide the coax through boards 3 and 2 and solder its shield to both; strip it to end flush with board 1's underside, solder the shield to the pad there and the core to the top pad.",
        "Align the leg markers of boards 1 and 2: the two boards are mirror images, and twisting one against the other ruins the circular polarisation.",
        "The FR-4 thickness (1.0 mm) and εr matter: a different laminate moves the resonance. The in-browser FDTD shows the shift.",
        "Inside a radome (such as the printed one) build the Pagoda-3B version: it is tuned for a 1 mm plastic shell.",
      ],
      necSupported: false,
      f, sweeps,
    };
  },
};
