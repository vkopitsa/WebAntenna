// Printed (PCB) antennas: board + copper rectangles + lumped feed port. Board in the xy plane,
// bottom copper at z = 0, top copper at z = h. Rectangles keep the openEMS mesh exact (edge "thirds" rule);
// polygons (diagonal traces) are staircased by the FDTD mesh, like openEMS does.
import type { Plate, Vec3 } from "./types";
import { rect, v } from "./geom";

export interface PcbRect { layer: "top" | "bottom"; x0: number; y0: number; x1: number; y1: number; label: string }
/** Copper polygon (simple, either winding), for traces that are not axis-aligned. */
export interface PcbPoly {
  layer: "top" | "bottom"; pts: [number, number][]; label: string;
  /** Narrowest width of the shape when its shortest edge is not (curved outlines: rings, arcs, pads). */
  w?: number;
  /** Centre line of a curved track (for the wire stand-in). */
  path?: [number, number][];
}
export interface PcbPort {
  /** Box of the lumped port (metres). For an in-plane gap port z0 = z1 = h; for a probe z0 = 0, z1 = h. */
  start: Vec3; stop: Vec3;
  dir: "x" | "y" | "z";
  R: number;
}
export interface Pcb {
  board: { x0: number; y0: number; x1: number; y1: number };
  h: number; er: number; tanD: number; t: number;
  rects: PcbRect[];
  polys?: PcbPoly[];
  port: PcbPort;
  /** Board outline when it is not the `board` rectangle (a disc, for the pagoda). */
  outline?: [number, number][];
  /** Plated holes (centre, diameter). */
  drills?: { x: number; y: number; d: number }[];
  /** Stacked build: further boards of the same laminate, each with its bottom face at z0 (the main board is 0…h). */
  levels?: PcbLevel[];
  /** Solid conductors in the model, e.g. the coax shield running up to the boards (z0 may be −Infinity: out of the domain). */
  pec?: PcbBox[];
  /** Coax-fed through the boards (the port is the core inside the shield, not an SMA probe). */
  coaxFeed?: boolean;
}

/** One more board in a stack: its own outline, copper and holes, the same laminate as the main board. */
export interface PcbLevel {
  label: string;
  z0: number;
  board: Pcb["board"];
  outline?: [number, number][];
  rects: PcbRect[];
  polys?: PcbPoly[];
  drills?: Pcb["drills"];
}
export interface PcbBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; label: string }

/** Copper plane: height and the shapes printed there. */
export interface CopperPlane { z: number; rects: PcbRect[]; polys: PcbPoly[] }

/** Every copper plane of the model (main board bottom and top, then each stacked board's). */
export function copperPlanes(p: Pcb): CopperPlane[] {
  const out: CopperPlane[] = [];
  const add = (z0: number, rects: PcbRect[], polys: PcbPoly[] = []) => {
    for (const layer of ["bottom", "top"] as const) {
      const z = layer === "top" ? z0 + p.h : z0;
      const rs = rects.filter((q) => q.layer === layer), ps = polys.filter((q) => q.layer === layer);
      if (rs.length || ps.length) out.push({ z, rects: rs, polys: ps });
    }
  };
  add(0, p.rects, p.polys);
  for (const l of p.levels ?? []) add(l.z0, l.rects, l.polys);
  return out;
}

/** Substrate slabs: outline (counter-clockwise or not) and z range. */
export function slabs(p: Pcb): { pts: [number, number][]; z0: number; z1: number }[] {
  const box = (b: Pcb["board"]): [number, number][] => [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]];
  return [{ pts: p.outline ?? box(p.board), z0: 0, z1: p.h }, ...(p.levels ?? []).map((l) => ({ pts: l.outline ?? box(l.board), z0: l.z0, z1: l.z0 + p.h }))];
}

/** Each board of the build as its own Pcb (for Gerbers, templates): the main board first. */
export function boardsOf(p: Pcb): { label: string; pcb: Pcb }[] {
  const main: Pcb = { ...p, levels: undefined, pec: undefined };
  return [
    { label: p.levels?.length ? "Board 1" : "", pcb: main },
    ...(p.levels ?? []).map((l, i) => ({ label: l.label || `Board ${i + 2}`, pcb: { ...main, board: l.board, outline: l.outline, rects: l.rects, polys: l.polys, drills: l.drills } })),
  ];
}

/** Bounding box of every board in the stack. */
export function stackBox(p: Pcb): Pcb["board"] {
  const bs = [p.board, ...(p.levels ?? []).map((l) => l.board)];
  return { x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)), x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)) };
}

/** z range of the stack (copper faces). */
export const stackZ = (p: Pcb): [number, number] => [Math.min(0, ...(p.levels ?? []).map((l) => l.z0)), Math.max(p.h, ...(p.levels ?? []).map((l) => l.z0 + p.h))];

export const r = (layer: PcbRect["layer"], x0: number, y0: number, x1: number, y1: number, label: string): PcbRect =>
  ({ layer, x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1), label });

/** Bounding rectangle of a polygon (same layer and label). */
export const polyBox = (q: PcbPoly): PcbRect => {
  const xs = q.pts.map((p) => p[0]), ys = q.pts.map((p) => p[1]);
  return r(q.layer, Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), q.label);
};

/** Every copper shape as a rectangle (polygons by their bounding box): for extents, keep-outs and layer counts. Main board only. */
export const copperBoxes = (p: Pcb): PcbRect[] => [...p.rects, ...(p.polys ?? []).map(polyBox)];

/** Point in polygon (even–odd rule). */
export function inPoly(pts: [number, number][], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Narrowest copper feature: the short side of every rectangle and the shortest edge of every polygon. */
export function minCopperFeature(p: Pcb): number {
  let m = Infinity;
  for (const c of copperPlanes(p)) {
    for (const q of c.rects) m = Math.min(m, q.x1 - q.x0, q.y1 - q.y0);
    for (const q of c.polys) {
      if (q.w) { m = Math.min(m, q.w); continue; }
      q.pts.forEach((a, i) => { const b = q.pts[(i + 1) % q.pts.length]; m = Math.min(m, Math.hypot(b[0] - a[0], b[1] - a[1])); });
    }
  }
  return m;
}

/** Drawing / CAD plates for a PCB: substrate, then copper (merged visually per label). */
export function pcbPlates(p: Pcb): Plate[] {
  const { h, t } = p;
  const plates: Plate[] = slabs(p).map((sl, i) => ({ pts: sl.pts.map(([x, y]) => v(x, y, sl.z0)), thickness: h, material: "dielectric", label: i === 0 || !p.levels ? "Substrate" : p.levels[i - 1].label || "Substrate" }));
  // the copper sits on the face: the top layer above z0 + h, the bottom one below z0
  const zc = (z0: number, layer: PcbRect["layer"]) => (layer === "top" ? z0 + h : z0 - t);
  const copper = (z0: number, rects: PcbRect[], polys: PcbPoly[] = []) => {
    for (const q of rects) plates.push({ pts: rect(v((q.x0 + q.x1) / 2, (q.y0 + q.y1) / 2, zc(z0, q.layer)), v((q.x1 - q.x0) / 2, 0, 0), v(0, (q.y1 - q.y0) / 2, 0)), thickness: t, material: "metal", label: q.label });
    for (const q of polys) plates.push({ pts: q.pts.map(([x, y]) => v(x, y, zc(z0, q.layer))), thickness: t, material: "metal", label: q.label });
  };
  copper(0, p.rects, p.polys);
  for (const l of p.levels ?? []) copper(l.z0, l.rects, l.polys);
  for (const b of p.pec ?? []) {
    const z0 = Number.isFinite(b.z0) ? b.z0 : b.z1 - 3 * (b.x1 - b.x0);
    plates.push({ pts: rect(v((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, z0), v((b.x1 - b.x0) / 2, 0, 0), v(0, (b.y1 - b.y0) / 2, 0)), thickness: b.z1 - z0, material: "metal", label: b.label });
  }
  return plates;
}

/**
 * Effective permittivity seen by a trace printed on a substrate with no ground below it (air on top,
 * thin dielectric under): εeff = 1 + q (εr − 1), q fitted per antenna type with openEMS (docs/ANTENNAS.md).
 */
export const eeffPrinted = (er: number, q: number) => 1 + q * (er - 1);

/** Common PCB parameter definitions. */
export const PCB_PARAMS = {
  er: { key: "er", label: "Substrate εr", kind: "number", min: 1, max: 15, step: 0.05, hint: "FR-4 ≈ 4.3–4.6, RO4003C 3.38" },
  h: { key: "h", label: "Substrate thickness", kind: "length", min: 0.1e-3, max: 5e-3 },
  tanD: { key: "tanD", label: "Loss tangent tan δ", kind: "number", min: 0, max: 0.1, step: 0.001, hint: "FR-4 ≈ 0.02, RO4003C 0.0027" },
  w: { key: "w", label: "Trace width", kind: "length", min: 0.1e-3, max: 10e-3 },
  gl: { key: "gl", label: "Ground plane length", kind: "length", min: 5e-3, max: 0.5, hint: "PCB area with copper pour (your circuit)" },
  bw: { key: "bw", label: "Board width", kind: "length", min: 5e-3, max: 0.5 },
} as const;

/** Resonant-length trim for printed antennas (FDTD "Tune to band" sets it). */
export const PRINTED_TRIM = { key: "trim", label: "Length trim (%)", kind: "number", min: -25, max: 25, step: 0.5, hint: "Scales the resonant length; set by FDTD tuning" } as const;

/** Probe feed: a vertical port of zero cross-section inside the board (needs a drilled hole); otherwise an edge or gap port. */
export const isProbe = (p: Pcb) => !p.coaxFeed && p.port.dir === "z" && p.port.start[0] === p.port.stop[0] && p.port.start[1] === p.port.stop[1];
