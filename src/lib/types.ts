// Shared model. Everything is SI: metres, hertz, degrees for angles. No DOM, no React, no i18n here.
// Labels are English source strings; the UI translates them at display time with t(label).

export type Vec3 = [number, number, number];

/** A straight conductor (NEC "GW" card). `r` is the wire radius in metres. */
export interface Wire {
  a: Vec3;
  b: Vec3;
  r: number;
  /** Short element name drawn next to the wire ("R", "DE", "D1"). */
  tag?: string;
  /** Only for the NEC model (wire-grid stand-ins for plates); not drawn, not exported to CAD. */
  necOnly?: boolean;
  /** Mechanical part (boom, mast): drawn and exported to CAD, left out of the NEC model. */
  drawOnly?: boolean;
  /** Drawing group, picks the colour. */
  group?: "driven" | "parasitic" | "reflector" | "ground" | "feed" | "line";
}

/** Planar polygon extruded along its normal by `thickness` (copper, reflector plate, substrate). */
export interface Plate {
  pts: Vec3[];
  thickness: number;
  material: "metal" | "dielectric";
  label: string;
  /** Facet of a formed sheet-metal part: index into `Design.sheets` (the BOM lists the part once, not every facet). */
  sheet?: number;
}

/**
 * A sheet-metal part cut flat and then formed (metres, degrees): a cone (frustum) is cut as an annular sector
 * of radii r0..r1 and `angle`, a cylinder as a strip w × h, a flat ring as a disc of diameter d with a hole.
 */
export type Sheet =
  | { kind: "sector"; label: string; r0: number; r1: number; angle: number }
  | { kind: "strip"; label: string; w: number; h: number }
  | { kind: "disc"; label: string; d: number; hole: number };

export interface Feed {
  wire: number;
  at: "start" | "center" | "end";
}

export interface Sweep { start: number; stop: number; steps: number }

export type Cell = number | string;
export interface Column {
  label: string;
  kind: "len" | "text" | "num" | "freq";
}
export interface Table {
  title: string;
  columns: Column[];
  rows: Cell[][];
}

export interface Dim {
  label: string;
  /** Metres. */
  value: number;
  /** Optional letter shown in the drawing legend ("A", "B", …). Wires with the same tag light up when the row is hovered. */
  key?: string;
  /** The span this value measures, in model coordinates: drawn as a dimension line when the row is hovered. */
  at?: [Vec3, Vec3];
  /** Wire tags to light up on hover, when they differ from `key`. */
  tags?: string[];
}

export interface Perf {
  label: string;
  value: string;
}

export interface Design {
  wires: Wire[];
  plates: Plate[];
  dims: Dim[];
  tables: Table[];
  perf: Perf[];
  /** English source strings (translated in the UI). */
  notes: string[];
  feed?: Feed;
  /** Printed antennas: board, copper and feed port (drawing plates are derived from it; openEMS export). */
  pcb?: import("./pcb").Pcb;
  /** Sheet-metal parts with their flat patterns (solid cones); the 1:1 template draws them. */
  sheets?: Sheet[];
  /** Ready-made cut list for a wire cage, whose frames and hoops share every node so pieces() cannot chain them;
   *  `what` and `note` are English strings that also appear in the design's tables. */
  cuts?: { what: string; qty: number; length: number; dia: number; note?: string }[];
  /** Wire cage: one frame of each side as a (ρ, z) polyline in metres, for the bending template and the printed jigs. */
  frames?: { hot: [number, number][]; ground: [number, number][]; n: number; hoops: { hot: [number, number][]; ground: [number, number][] } };
  /** false when a wire model would be meaningless (patch, coaxial collinear). */
  necSupported: boolean;
  /** Natural feed impedance the design is meant for (balun / transformer to 50 Ω assumed), default 50 Ω. */
  feedZ0?: number;
  /** Design (centre) frequency, Hz. */
  f: number;
  /** Frequency sweeps for the NEC deck, one per band. */
  sweeps: Sweep[];
}

export type ParamValue = number | string;
export type Params = Record<string, ParamValue>;

export interface ParamDef {
  key: string;
  label: string;
  kind: "bands" | "freq" | "length" | "number" | "int" | "angle" | "select";
  /** For select. */
  options?: [string, string][];
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
}

export interface AntennaDef {
  id: string;
  name: string;
  category: "Wire" | "Directional" | "Circular polarisation" | "Printed" | "Broadband" | "Vertical";
  summary: string;
  /** Polarisation and pattern class, for synthesis filters. "linear" = depends on how it is mounted. */
  traits?: { pol: "vertical" | "horizontal" | "circular" | "linear"; pattern: "omni" | "bi" | "beam" };
  /** How the antenna treats several bands: one element set per band, or one broadband structure. Absent: single band. */
  multiband?: "per-band" | "broadband";
  params: ParamDef[];
  defaults: Params;
  build: (p: Params) => Design;
}

/** Read a numeric param with a fallback (keeps builders total when old saved params lack a key). */
export function num(p: Params, k: string, dflt = 0): number {
  const v = p[k];
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : dflt;
}
export function str(p: Params, k: string, dflt: string): string {
  const v = p[k];
  return typeof v === "string" ? v : dflt;
}
