// Sky-tilted capped bicone ("inverted discone"): a solid hot cone with a rim and lid on the coax centre pin, a shallow
// ground cone on the coax jacket. Found by the body-of-revolution MoM + differential-evolution study in
// docs/FPV-DETECTOR-ANTENNA.md (tools/wideband-antenna). The shape is fixed (it was optimised as a whole) and scales
// with the lowest frequency; the Simulation tab shows that study's tabulated sweep, since thin wires cannot model it.
import type { AntennaDef, Design, ParamDef, Params, Plate, Sheet, Table, Vec3, Wire } from "../types";
import { str } from "../types";
import type { CurrentElement } from "../mom";
import type { IdealCurrents } from "../idealcurrents";
import { fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS } from "./common";
import { SKYCONE_21, SKYCONE_7, SKYCONE_8, SKYCONE_A55, SKYCONE_B44, SKYCONE_W16, SKYCONE_W40, SKYCONE_W65 } from "./skycone.data";

export interface SkyconeTable {
  /** Design band (Hz) the profile and the table belong to. */
  fLo: number;
  fHi: number;
  /** Coax end to the washer under the hot cone (m). */
  gap: number;
  /** (ρ, z) polylines in metres: hot element (pin side, z > 0) and ground (jacket side, z ≤ 0). */
  upper: number[][][];
  lower: number[][][];
  /** Elevations (deg) of the gain columns. */
  els: number[];
  /** Frequencies as a ratio to fLo, with R, X (Ω) and gain rows (dBi per elevation). */
  f: number[];
  r: number[];
  x: number[];
  g: number[][];
  /** Surface currents for the Radiation view: segments (ρ0, z0, ρ1, z1) in metres and, per frequency (ratio to fLo),
   *  the total axial current at each segment's middle as re, im pairs (V = 1 at the port). */
  cur: { seg: number[][]; f: number[]; i: number[][] };
  /** Wire cage (NEC-2 table): n frames of wire radius r, hub rings of radius hub where the frames meet the axis (m).
   *  short: n straight shorting wires from a hot frame to the ground frame under it, rho from the axis, on frame
   *  `frame` (then every n-th of the frames); the last k segments of `cur` are on one of them (single wires, not rings).
   *  turns / coilDia (m): the shorting wires are wound into coils (A55); cap: a series capacitor (pF) in every second
   *  shorting wire; pinCap: a series capacitor (pF) in the centre pin (the double-tuned match of A55). */
  cage?: { n: number; r: number; hub: number; pinCap?: number; short?: { n: number; rho: number; zHot: number; zGnd: number; frame: number; k: number; turns?: number; coilDia?: number; cap?: number } };
  /** The same antenna with its coax jacket hanging bare down the axis (no ferrite, no choke tube), from
   *  tools/wideband-antenna/export_bare_table.py: cable lengths in wavelengths at fLo, frequencies as a ratio to fLo,
   *  R and X (Ω) at the coax end per length. */
  bare?: { lensLam: number[]; f: number[]; r: number[][]; x: number[][] };
}

/** "Coax below the antenna": as designed (ferrite or choke tubes) or a bare cable of three lengths. */
const BARE_ROWS: Record<string, number> = { bare1: 0, bare2: 1, bare3: 2 };
const BARE_OPTIONS: [string, string][] = [["bare1", "Bare coax, short cable (0.5 λ)"], ["bare2", "Bare coax, medium cable (0.8 λ)"], ["bare3", "Bare coax, long cable (1.1 λ)"]];
const COAX_HINT = "Without a ferrite or choke the outside of the cable carries current and becomes part of the antenna, so the SWR depends on its length (λ at the lowest frequency).";
const coaxParam = (asDesigned: [string, string]): ParamDef => ({ key: "coax", label: "Coax below the antenna", kind: "select", options: [asDesigned, ...BARE_OPTIONS], hint: COAX_HINT });
const COAX_FERRITE = coaxParam(["ferrite", "Ferrite on the coax (as designed)"]);
const COAX_TUBE = coaxParam(["choke", "Choke tube on the coax (as designed)"]);
const COAX_TUBES = coaxParam(["choke", "Choke tubes on the coax (as designed)"]);
const BARE_NOTE = "No ferrite or choke: the outside of the coax carries current and is part of the antenna, so the SWR depends on the cable length and on how the cable runs. The Simulation tab shows a straight bare cable of the listed length hanging down the axis (precomputed); the radiation pattern there is still the one without a cable.";

/** The bare-cable table row for the "coax" param, with that cable's length (m) for a design starting at fLow. */
function bareOf(t: SkyconeTable, p: Params, fLow: number): { row: number; len: number } | undefined {
  const row = BARE_ROWS[str(p, "coax", "")];
  if (row == null || !t.bare) return undefined;
  return { row, len: (t.bare.lensLam[row] * 3e8) / fLow }; // 3e8, not C0: the tools' export_bare_table.py simulated k·3e8/fLo
}

/** Facets round the axis for the drawing and CAD (each facet is a planar trapezoid). */
const FACETS = 32;
const SHEET_T = 0.4e-3;
/** UT-141 / RG-402 semi-rigid jacket radius (the coax is not scaled). */
const COAX_R = 1.79e-3;

/** Label of every segment of the profile, in order: the part it is cut from. */
function segments(t: SkyconeTable, s: number) {
  type Seg = { a: [number, number]; b: [number, number]; hot: boolean; kind: "sector" | "strip" | "disc"; label: string };
  const out: Seg[] = [];
  for (const [hot, lines] of [[true, t.upper], [false, t.lower]] as const) {
    const segs: Seg[] = [];
    for (const pl of lines) for (let i = 0; i + 1 < pl.length; i++) {
      const a: [number, number] = [pl[i][0] * s, pl[i][1] * s], b: [number, number] = [pl[i + 1][0] * s, pl[i + 1][1] * s];
      if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.2e-3 * s) continue;
      const kind = Math.abs(b[1] - a[1]) < 1e-9 * s ? "disc" : Math.abs(b[0] - a[0]) < 1e-9 * s ? "strip" : "sector";
      segs.push({ a, b, hot, kind, label: "" });
    }
    const cones = segs.filter((q) => q.kind === "sector");
    for (const q of segs) {
      if (q.kind === "disc") q.label = hot && q === segs[0] ? "Washer (on the centre pin)" : "Lid";
      else if (q.kind === "strip") q.label = hot ? "Rim" : "Ground skirt";
      else if (cones.length === 1) q.label = hot ? "Hot cone" : "Ground cone";
      else q.label = q === cones[0] ? (hot ? "Hot cone, feed section" : "Ground cone, inner section") : (hot ? "Hot cone, main section" : "Ground cone, outer section");
    }
    out.push(...segs);
  }
  return out;
}

/** Flat pattern of a profile segment revolved round the axis. */
function sheetOf(q: ReturnType<typeof segments>[number]): Sheet {
  const [ra, za] = q.a, [rb, zb] = q.b;
  if (q.kind === "disc") return { kind: "disc", label: q.label, d: 2 * Math.max(ra, rb), hole: 2 * Math.min(ra, rb) };
  if (q.kind === "strip") return { kind: "strip", label: q.label, w: 2 * Math.PI * ra, h: Math.abs(zb - za) };
  const sin = Math.abs(rb - ra) / Math.hypot(rb - ra, zb - za);
  return { kind: "sector", label: q.label, r0: Math.min(ra, rb) / sin, r1: Math.max(ra, rb) / sin, angle: 360 * sin };
}

const at = (r: number, z: number, ph: number): Vec3 => v(r * Math.cos(ph), r * Math.sin(ph), z);

/** Performance over the user's bands, from the table. */
function tablePerf(t: SkyconeTable, bands: [number, number][], fLow: number, swrLabel: string, bare?: number) {
  let worst = 0, gMin = Infinity, gSum = 0, gN = 0;
  for (const [a, b] of bands) {
    for (let i = 0; i <= 40; i++) {
      const f = a * (b / a) ** (i / 40);
      const z = skyconeZ(t, fLow, f, bare);
      if (!z) continue;
      const gm = Math.hypot(z.r - 50, z.x) / Math.hypot(z.r + 50, z.x);
      worst = Math.max(worst, (1 + gm) / (1 - gm));
      const gf = skyconeGain(t, fLow, f);
      for (let el = 15; el <= 50; el += 5) { const x = gf(((90 - el) * Math.PI) / 180); gMin = Math.min(gMin, x); gSum += 10 ** (x / 10); gN++; }
    }
  }
  const fTop = fLow * (t.fHi / t.fLo);
  return [
    { label: swrLabel, value: worst > 0 ? fmt(worst, 2) : "—" },
    { label: "Gain at 15–50° elevation (mean / lowest)", value: gN ? `${fmt(10 * Math.log10(gSum / gN), 1)} / ${fmt(gMin, 1)} dBi` : "—" },
    { label: "Design range (SWR ≤ 2 by the model)", value: `${fmt(fLow / 1e6, 0)}–${fmt(fTop / 1e6, 0)} MHz` },
    { label: "Pattern", value: "Omni, beam tilted up" },
    { label: "Polarisation", value: "Vertical" },
  ];
}

/** Linear interpolation in log f between the rows of fs (ratios to fLo); values outside are clamped to its ends. */
function bracketF(fs: number[], u: number): [number, number, number] {
  if (u <= fs[0]) return [0, 0, 0];
  const n = fs.length - 1;
  if (u >= fs[n]) return [n, n, 0];
  let i = 1;
  while (fs[i] < u) i++;
  return [i - 1, i, Math.log(u / fs[i - 1]) / Math.log(fs[i] / fs[i - 1])];
}
const bracket = (t: SkyconeTable, u: number) => bracketF(t.f, u);

/** Impedance at the coax end for a design whose band starts at fLow (Hz); null outside the table. `bare`: the
 *  bare-cable row (no ferrite) instead of the free-space one. */
export function skyconeZ(t: SkyconeTable, fLow: number, f: number, bare?: number): { r: number; x: number } | null {
  const u = f / fLow;
  const b = bare != null ? t.bare : undefined;
  const fs = b ? b.f : t.f, rs = b ? b.r[bare!] : t.r, xs = b ? b.x[bare!] : t.x;
  if (u < fs[0] * 0.999 || u > fs[fs.length - 1] * 1.001) return null;
  const [i, j, w] = bracketF(fs, u);
  return { r: rs[i] + (rs[j] - rs[i]) * w, x: xs[i] + (xs[j] - xs[i]) * w };
}

/** Gain (dBi) at θ from +z (rad); the pattern is omnidirectional in φ. */
export function skyconeGain(t: SkyconeTable, fLow: number, f: number): (th: number) => number {
  const [i, j, w] = bracket(t, f / fLow);
  const row = t.g[i].map((g, k) => g + (t.g[j][k] - g) * w);
  const e0 = t.els[0], de = t.els[1] - t.els[0], n = t.els.length - 1;
  return (th) => {
    const x = Math.min(Math.max((90 - (th * 180) / Math.PI - e0) / de, 0), n);
    const k = Math.min(Math.floor(x), n - 1);
    return row[k] + (row[k + 1] - row[k]) * (x - k);
  };
}

/** Rings of current per segment for the Radiation view. */
const RING = 12;

/**
 * The solved surface current of the nearest tabulated frequency, scaled to the design: each profile segment becomes
 * RING short elements round the axis, each carrying 1/RING of the total axial current. null for other types.
 */
export function skyconeCurrents(defId: string, d: Design): IdealCurrents | null {
  const t = SKYCONE_TABLES[defId];
  if (!t) return null;
  const fLow = d.sweeps[0].start, s = t.fLo / fLow, u = d.f / fLow;
  let k = 0;
  t.cur.f.forEach((x, i) => { if (Math.abs(Math.log(x / u)) < Math.abs(Math.log(t.cur.f[k] / u))) k = i; });
  const I = t.cur.i[k], els: CurrentElement[] = [], segs: number[] = [], ir: number[] = [], ii: number[] = [];
  const ring = t.cage?.n ?? RING;                     // a wire cage: on its frames
  const sh = t.cage?.short, single = t.cur.seg.length - (sh?.k ?? 0);
  t.cur.seg.forEach(([r0, z0, r1, z1], j) => {
    const one = j >= single;                         // a shorting wire: one wire at its own angle
    for (let m = 0; m < (one ? 1 : ring); m++) {
      const ph = (2 * Math.PI * (one ? sh!.frame : m)) / ring, c = Math.cos(ph), sn = Math.sin(ph);
      const p: Vec3 = [r0 * s * c, r0 * s * sn, z0 * s], q: Vec3 = [r1 * s * c, r1 * s * sn, z1 * s];
      const cr = I[2 * j] / (one ? 1 : ring), ci = I[2 * j + 1] / (one ? 1 : ring);
      els.push({ dl: [q[0] - p[0], q[1] - p[1], q[2] - p[2]], mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], cr, ci, r: (t.cage?.r ?? 0.5e-3) * s });
      segs.push(...p, ...q);
      ir.push(cr); ii.push(ci);
    }
  });
  return { els, segs: Float64Array.from(segs), ir: Float64Array.from(ir), ii: Float64Array.from(ii) };
}

/** Frequency range the table covers (Hz) for a design starting at fLow. */
export const skyconeRange = (t: SkyconeTable, fLow: number): [number, number] => [t.f[0] * fLow, t.f[t.f.length - 1] * fLow];

/** `sleeve`: the compact shape couples to the coax so strongly that one ferrite bead is not enough. */
function build(t: SkyconeTable, bandsP: Params, sleeve = false): Design {
  const { bands } = band(bandsP);
  const fLow = Math.min(...bands.map((b) => b[0])), fHigh = Math.max(...bands.map((b) => b[1]));
  const bare = bareOf(t, bandsP, fLow);
  const ratio = t.fHi / t.fLo, fTop = fLow * ratio;
  const s = t.fLo / fLow;
  const segs = segments(t, s);
  const sheets = segs.map(sheetOf);
  const plates: Plate[] = [];
  segs.forEach((q, k) => {
    for (let i = 0; i < FACETS; i++) {
      const p0 = (2 * Math.PI * i) / FACETS, p1 = (2 * Math.PI * (i + 1)) / FACETS;
      plates.push({ pts: [at(q.a[0], q.a[1], p0), at(q.a[0], q.a[1], p1), at(q.b[0], q.b[1], p1), at(q.b[0], q.b[1], p0)], thickness: SHEET_T, material: "metal", label: q.label, sheet: k });
    }
  });
  const pts = segs.flatMap((q) => [q.a, q.b]);
  const zTop = Math.max(...pts.map((p) => p[1])), zBot = Math.min(...pts.map((p) => p[1]));
  const hot = segs.filter((q) => q.hot), gnd = segs.filter((q) => !q.hot);
  const rHot = Math.max(...hot.flatMap((q) => [q.a[0], q.b[0]])), rGnd = Math.max(...gnd.flatMap((q) => [q.a[0], q.b[0]]));
  const g = t.gap * s;
  const zRim = Math.max(...hot.filter((q) => q.kind !== "disc").flatMap((q) => [q.a[1], q.b[1]]));
  const wires: Wire[] = [
    { a: v(0, 0, 0), b: v(0, 0, g), r: 0.46e-3, group: "feed" },
    { a: v(0, 0, 0), b: v(0, 0, zBot - 5e-3), r: COAX_R, group: "feed" },
  ];
  const rim = hot.find((q) => q.kind === "strip"), skirt = gnd.find((q) => q.kind === "strip");
  const halfAngle = (q: (typeof segs)[number]) => `${fmt((Math.atan2(Math.abs(q.b[0] - q.a[0]), Math.abs(q.b[1] - q.a[1])) * 180) / Math.PI, 1)}°`;
  const cones = segs.map((q, k) => ({ q, sh: sheets[k] })).filter((x) => x.sh.kind === "sector");
  const tables: Table[] = [
    {
      title: "Cone flat patterns (annular sectors: cut, roll, solder the seam)",
      columns: [{ label: "Part", kind: "text" }, { label: "Cone half-angle", kind: "text" }, { label: "Pattern inner radius", kind: "len" }, { label: "Pattern outer radius", kind: "len" }, { label: "Sector angle", kind: "text" }],
      rows: cones.map(({ q, sh }) => sh.kind === "sector" ? [q.label, halfAngle(q), sh.r0, sh.r1, `${fmt(sh.angle, 1)}°`] : []),
    },
  ];
  const strips = sheets.filter((x) => x.kind === "strip");
  if (strips.length) tables.push({ title: "Strips (roll into a cylinder)", columns: [{ label: "Part", kind: "text" }, { label: "Length (round)", kind: "len" }, { label: "Width", kind: "len" }], rows: strips.map((x) => x.kind === "strip" ? [x.label, x.w, x.h] : []) });
  const discs = sheets.filter((x) => x.kind === "disc");
  if (discs.length) tables.push({ title: "Discs and rings", columns: [{ label: "Part", kind: "text" }, { label: "Outer diameter", kind: "len" }, { label: "Hole diameter", kind: "len" }], rows: discs.map((x) => x.kind === "disc" ? [x.label, x.d, x.hole] : []) });
  const f = Math.sqrt(fLow * Math.min(fHigh, fTop));
  return {
    wires, plates, sheets,
    feed: { wire: 0, at: "center" },
    dims: [
      { label: "Wavelength at the lowest frequency", value: wavelength(fLow) },
      { key: "H", label: "Overall height", value: zTop - zBot, at: [v(-rGnd, 0, zBot), v(-rGnd, 0, zTop)] },
      { key: "D", label: "Hot element diameter", value: 2 * rHot, at: [v(-rHot, 0, zRim), v(rHot, 0, zRim)] },
      { key: "G", label: "Ground cone diameter", value: 2 * rGnd, at: [v(-rGnd, 0, zBot), v(rGnd, 0, zBot)] },
      { key: "g", label: "Gap: coax end to the washer", value: g, at: [v(0, 0, 0), v(0, 0, g)] },
      ...(rim ? [{ key: "R", label: "Rim height", value: Math.abs(rim.b[1] - rim.a[1]), at: [v(rim.a[0], 0, rim.a[1]), v(rim.b[0], 0, rim.b[1])] as [Vec3, Vec3] }] : []),
      ...(skirt ? [{ key: "S", label: "Ground skirt length", value: Math.abs(skirt.b[1] - skirt.a[1]), at: [v(skirt.a[0], 0, skirt.a[1]), v(skirt.b[0], 0, skirt.b[1])] as [Vec3, Vec3] }] : []),
      ...(bare ? [{ label: "Bare cable length (Simulation)", value: bare.len }] : []),
    ],
    tables,
    perf: tablePerf(t, bands, fLow, bare ? "Worst SWR in your bands (precomputed MoM, bare cable)" : "Worst SWR in your bands (precomputed MoM, no cable)", bare?.row),
    notes: [
      "Hot element (cones, rim, lid) on the coax centre pin, ground cone on the coax jacket. Hold it by the coax with the cones up: the beam is tilted toward the sky (15–50° elevation).",
      "The shape is fixed (it was optimised as a whole); all dimensions scale with your lowest frequency. The Simulation tab shows the precomputed body-of-revolution MoM sweep of this shape, scaled to your size.",
      "Feed through UT-141 (RG-402) semi-rigid coax: solder the jacket into the ground cone apex and the centre pin into the washer. Keep the pin gap as listed: it sets the top of the band.",
      bare ? BARE_NOTE : sleeve
        ? "Ferrite sleeve required: stack about 6 ferrite beads (material 43 or 61, about 150 Ω each) on the first 11 cm of coax below the ground cone. This small antenna couples strongly to the cable: with one bead a 15–35 cm cable still lifts the SWR to 2.7 at the bottom of the band, with the sleeve it stays below 1.9."
        : "Clip a ferrite (about 150 Ω) onto the coax just below the ground cone: at the bottom of the band the cable otherwise carries current and the SWR depends on its length.",
      ...(fHigh > fTop * 1.001 ? ["Warning: your highest band is above this shape's range; the SWR there is not computed. Lower the bands or use the 21:1 version."] : []),
      "Full study, build steps, tolerances and solver checks: docs/FPV-DETECTOR-ANTENNA.md in the project repository.",
    ],
    coax: bare ? { choke: "none", bare } : { choke: sleeve ? "sleeve" : "bead" },
    necSupported: false,
    f,
    sweeps: [{ start: fLow, stop: Math.max(fHigh, fLow * 1.5), steps: 101 }],
  };
}

// ---------------------------------------------------------------- wire cage

type P2 = [number, number];

/** Frame paths (ρ, z) of the cage, as tools/wideband-antenna/wirecage.py builds them: the hot frame from the axis at
 *  the washer height along the washer, cones, rim and lid; the ground frame from the axis at the coax end along the
 *  ground cone and skirt (points inside 2.5 mm are the coax). Then each end on the axis moves out to the hub ring. */
export function cageFrames(t: SkyconeTable, s: number): { hot: P2[]; ground: P2[]; hubs: [P2, P2][] } {
  const push = (out: P2[], q: P2) => { const l = out[out.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-5 * s) out.push(q); };
  const hot: P2[] = [[0, t.gap * s]];
  for (const pl of t.upper.length > 1 ? t.upper.slice(1) : t.upper) for (const q of pl) push(hot, [q[0] * s, q[1] * s]);
  if (hot[hot.length - 1][0] < 1.5e-3 * s) hot[hot.length - 1] = [0, hot[hot.length - 1][1]];     // a closed lid ends on the axis
  const ground: P2[] = [[0, 0]];
  for (const pl of t.lower) for (const q of pl) if (q[0] > 2.5e-3) push(ground, [q[0] * s, q[1] * s]);
  const R = t.cage!.hub * s, hubs: [P2, P2][] = [];
  const hubbed = (path: P2[]): P2[] => {
    let out = path.slice();
    for (const first of [true, false]) {
      const i = first ? 0 : out.length - 1, q = out[i];
      if (q[0] > 1e-12) continue;
      const nb = first ? out[1] : out[out.length - 2];
      let ring: P2;
      if (nb[0] > R) { ring = [R, q[1] + (R / nb[0]) * (nb[1] - q[1])]; out[i] = ring; }
      else { out = first ? out.slice(1) : out.slice(0, -1); ring = first ? out[0] : out[out.length - 1]; }
      hubs.push([[0, q[1]], ring]);
    }
    return out;
  };
  return { hot: hubbed(hot), ground: hubbed(ground), hubs };
}

/** Hoops: every frame point at ρ ≥ 4 mm (scaled) and the hub rings. */
const hoopsOf = (path: P2[], s: number) => path.filter((q) => q[0] >= 4e-3 * s);

/** Where each of those hoops really sits: against the frames on the outside of the cage (under the hot cones, over the
 *  ground cone, outside the rims, over the lid), its centre one wire diameter D off the frame's centre line. The NEC
 *  model keeps them at the bend points. side 1: hot, -1: ground. */
const hoopSeats = (path: P2[], s: number, D: number, side: 1 | -1): P2[] => path.flatMap((q, i): P2[] => {
  if (q[0] < 4e-3 * s) return [];
  const nrm = (a: P2, b: P2): P2 => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]); return [(side * (b[1] - a[1])) / l, (-side * (b[0] - a[0])) / l]; };
  const ns = [...(i > 0 ? [nrm(path[i - 1], q)] : []), ...(i + 1 < path.length ? [nrm(q, path[i + 1])] : [])];
  const [a, b] = ns.length === 2 ? ns : [ns[0], ns[0]];
  // a bend toward the hoop side: on the mitre, touching both legs; a bend away from it: touching the corner itself
  const inside = side * (a[0] * b[1] - a[1] * b[0]) < 0;
  const k = inside ? D / (1 + a[0] * b[0] + a[1] * b[1]) : D / Math.hypot(a[0] + b[0], a[1] + b[1]);
  return [[q[0] + k * (a[0] + b[0]), q[1] + k * (a[1] + b[1])]];
});

const pathLen = (p: P2[]) => p.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - p[i][0], q[1] - p[i][1]), 0);
const bendsOf = (p: P2[]) => p.slice(1, -1).filter((q, i) => {
  const a = p[i], b = p[i + 2];
  const u = [q[0] - a[0], q[1] - a[1]], w = [b[0] - q[0], b[1] - q[1]];
  return Math.abs(u[0] * w[1] - u[1] * w[0]) > 0.017 * Math.hypot(...u) * Math.hypot(...w);
}).length;

/** The frame path with a node at radius rho (where a shorting wire ends), and that node. */
function withNode(path: P2[], rho: number): { path: P2[]; q: P2 } {
  for (let i = 0; i + 1 < path.length; i++) {
    const a = path[i], b = path[i + 1];
    if (Math.abs(b[0] - rho) < 1e-9) return { path, q: b };
    if (a[0] < rho && b[0] > rho) {
      const q: P2 = [rho, a[1] + ((rho - a[0]) / (b[0] - a[0])) * (b[1] - a[1])];
      return { path: [...path.slice(0, i + 1), q, ...path.slice(i + 1)], q };
    }
  }
  throw new Error("shorting wire outside the frame");
}

/** The wire cage: the compact shape as n bent wire frames per side, hoops at the kinks, hub washers at the axis,
 *  and (cage.short) straight shorting wires from a hot frame down to the ground frame under it.
 *  mini: "w40", the Ø40 mm cage (W40), whose band starts at 1.4 GHz because the box is below the Chu limit for 960 MHz;
 *  "a55", the Ø51 × 54 mm low-band cage (A55, 960 MHz – 1.36 GHz) with coiled shorting wires and two capacitors;
 *  "b44", the Ø43 × 44 mm cage (B44f) for 1.36–7 GHz with a choke sleeve instead of ferrite. */
/** A shorting wire wound into a coil (tools/wideband-antenna/family12.py `_coil`): the straight line a → b with `turns`
 *  turns of radius rc round it, the radius ramped up over the first fifth and down over the last, straight leads of
 *  max(2.5 mm, 2 rc + 1.5 mm) at both ends, chords of at least 1.2 mm (all at scale s). The first normal is the
 *  azimuthal direction at angle ph, so the coil sits beside the frame. */
function coilPath(a: Vec3, b: Vec3, turns: number, rc: number, ph: number, s: number): Vec3[] {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const tv = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
  const ax = [-Math.sin(ph), Math.cos(ph), 0], dot = ax[0] * tv[0] + ax[1] * tv[1] + ax[2] * tv[2];
  const n1 = ax.map((q, i) => q - tv[i] * dot), m1 = Math.hypot(...n1);
  n1.forEach((_, i) => (n1[i] /= m1));
  const n2 = [tv[1] * n1[2] - tv[2] * n1[1], tv[2] * n1[0] - tv[0] * n1[2], tv[0] * n1[1] - tv[1] * n1[0]];
  const lead = Math.min(0.3, Math.max(2.5e-3 * s, 2 * rc + 1.5e-3 * s) / L);
  const per = Math.max(5, Math.min(12, Math.floor((2 * Math.PI * rc) / (1.4e-3 * s))));
  const m = Math.max(2, Math.ceil(turns * per)), chord = 1.2e-3 * s;
  const out: Vec3[] = [a];
  const dist = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  for (let i = 0; i <= m; i++) {
    const u = lead + (1 - 2 * lead) * (i / m), w = Math.min(1, Math.sin((Math.PI * i) / m) / Math.sin(Math.PI * 0.2)), th = 2 * Math.PI * turns * (i / m);
    const p = v(...([0, 1, 2].map((k) => a[k] + (b[k] - a[k]) * u + rc * w * (Math.cos(th) * n1[k] + Math.sin(th) * n2[k])) as [number, number, number]));
    if (dist(p, out[out.length - 1]) >= chord) out.push(p);
  }
  if (out.length > 1 && dist(out[out.length - 1], b) < chord) out.pop();
  out.push(b);
  return out;
}

function buildCage(t: SkyconeTable, bandsP: Params, mini: false | "w40" | "b44" | "a55" = false): Design {
  const { bands } = band(bandsP);
  const fLow = Math.min(...bands.map((b) => b[0])), fHigh = Math.max(...bands.map((b) => b[1]));
  const bare = bareOf(t, bandsP, fLow);
  const fTop = fLow * (t.fHi / t.fLo), s = t.fLo / fLow;
  const { n, r: r0, short: sh } = t.cage!, r = r0 * s, g = t.gap * s;
  const fr = cageFrames(t, s);
  const ang = Array.from({ length: n }, (_, k) => (2 * Math.PI * k) / n);
  const wires: Wire[] = [
    { a: v(0, 0, 0), b: v(0, 0, g), r: 0.46e-3, group: "feed" },                       // pin gap
  ];
  // a shorting wire's ends are nodes of every frame (as in the NEC model), without a hoop
  const hotN = sh ? withNode(fr.hot, sh.rho * s) : null, gndN = sh ? withNode(fr.ground, sh.rho * s) : null;
  const sides = [
    { path: fr.hot, wired: hotN?.path ?? fr.hot, group: "driven" as const, tag: "H" },
    { path: fr.ground, wired: gndN?.path ?? fr.ground, group: "ground" as const, tag: "G" },
  ];
  for (const { path, wired, group, tag } of sides) {
    ang.forEach((ph, k) => wired.slice(1).forEach((q, i) => wires.push({ a: at(wired[i][0], wired[i][1], ph), b: at(q[0], q[1], ph), r, group, tag: k === 0 && i === 0 ? tag : undefined })));
    const hub = fr.hubs.find((h) => path.some((q) => q === h[1]));
    for (const q of [...hoopsOf(path, s), ...(hub ? [hub[1]] : [])]) {
      const rr = Math.min(r, (2 * q[0] * Math.sin(Math.PI / n)) / 4);
      ang.forEach((ph, k) => wires.push({ a: at(q[0], q[1], ph), b: at(q[0], q[1], ang[(k + 1) % n]), r: rr, group }));
    }
  }
  for (const [axis, ring] of fr.hubs) {
    const group = axis[1] > 0 ? "driven" as const : "ground" as const;
    for (let k = 0; k < n; k += Math.max(1, Math.floor(n / 4))) wires.push({ a: v(0, 0, axis[1]), b: at(ring[0], ring[1], ang[k]), r: Math.min(r, 0.5e-3 * s), group });
  }
  if (fr.hot[fr.hot.length - 1][0] < 1e-12) wires.push({ a: v(0, 0, g), b: v(0, 0, fr.hot[fr.hot.length - 1][1]), r, group: "driven" });
  const turns = sh?.turns ? Math.round(sh.turns) : 0;
  let shortLen = hotN && gndN ? Math.hypot(hotN.q[0] - gndN.q[0], hotN.q[1] - gndN.q[1]) : 0;
  if (sh && hotN && gndN) for (let k = sh.frame; k < n; k += n / sh.n) {
    const a = at(hotN.q[0], hotN.q[1], ang[k]), b = at(gndN.q[0], gndN.q[1], ang[k]);
    const pts = turns ? coilPath(a, b, turns, (sh.coilDia! / 2) * s, ang[k], s) : [a, b];
    if (k === sh.frame && turns) shortLen = pts.slice(1).reduce((acc, q, i) => acc + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1], q[2] - pts[i][2]), 0);
    pts.slice(1).forEach((q, i) => wires.push({ a: pts[i], b: q, r, group: "driven", tag: k === sh.frame && i === 0 ? "S" : undefined }));
  }
  const all = [...fr.hot, ...fr.ground];
  const zTop = Math.max(...all.map((q) => q[1])), zBot = Math.min(...all.map((q) => q[1]));
  const rHot = Math.max(...fr.hot.map((q) => q[0])), rGnd = Math.max(...fr.ground.map((q) => q[0]));
  wires.push({ a: v(0, 0, 0), b: v(0, 0, zBot - 5e-3), r: COAX_R, group: "feed", drawOnly: true });   // coax jacket
  // physical frames start at the washer edge: drop a stub shorter than 0.5 mm next to the hub ring
  const trim = (p: P2[]) => (p.length > 2 && Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) < 0.5e-3 * s ? p.slice(1) : p);
  const hotF = trim(fr.hot), gndF = trim(fr.ground);
  const seats = { hot: hoopSeats(fr.hot, s, 2 * r, 1), ground: hoopSeats(fr.ground, s, 2 * r, -1) };
  const hoops = [...seats.hot.map((q) => ({ q, what: "Hoop, hot side" })), ...seats.ground.map((q) => ({ q, what: "Hoop, ground side" }))];
  const hubHot = fr.hubs.find((h) => h[0][1] > 0), hubGnd = fr.hubs.find((h) => h[0][1] <= 0);
  const washerD = 2 * Math.max(hubHot ? hubHot[1][0] : 0, hotF[0][0]);
  const SHORT = "Shorting wire (hot frame to the ground frame under it)";
  const cuts: NonNullable<Design["cuts"]> = [
    { what: "Hot frame (bend over the template)", qty: n, length: pathLen(hotF), dia: 2 * r, note: "Bends: see the template" },
    { what: "Ground frame (bend over the template)", qty: n, length: pathLen(gndF), dia: 2 * r, note: "Bends: see the template" },
    ...(sh ? [{ what: SHORT, qty: sh.n, length: shortLen, dia: 2 * r, note: turns ? "Wound into a coil (turns and diameter in the table), soldered on at the marks of the template" : "Straight: solder it on at the marks of the template" }] : []),
    ...hoops.map(({ q, what }) => ({ what, qty: 1, length: 2 * Math.PI * q[0], dia: 2 * r, note: "Bend into a ring and solder the ends" })),
  ];
  const tables: Table[] = [
    {
      title: "Wire frames (bend over the 1:1 template)",
      columns: [{ label: "Part", kind: "text" }, { label: "Quantity", kind: "num" }, { label: "Wire length", kind: "len" }, { label: "Bends", kind: "num" }, { label: "Wire diameter", kind: "len" }],
      rows: [["Hot frame (bend over the template)", n, pathLen(hotF), bendsOf(hotF), 2 * r], ["Ground frame (bend over the template)", n, pathLen(gndF), bendsOf(gndF), 2 * r]],
    },
    ...(sh && hotN && gndN ? [{
      title: turns ? "Shorting wires (wound into coils, between a hot frame and the ground frame under it)" : "Shorting wire (straight, between one hot frame and the ground frame under it)",
      columns: [{ label: "Part", kind: "text" as const }, { label: "Quantity", kind: "num" as const }, { label: "Distance from the axis", kind: "len" as const }, { label: "Hot end height above the coax end", kind: "len" as const }, { label: "Ground end height above the coax end", kind: "len" as const }, { label: "Wire length", kind: "len" as const }, ...(turns ? [{ label: "Turns", kind: "num" as const }, { label: "Coil diameter", kind: "len" as const }] : [])],
      rows: [[SHORT, sh.n, hotN.q[0], hotN.q[1], gndN.q[1], shortLen, ...(turns ? [turns, sh.coilDia! * s] : [])]],
    }] : []),
    ...(t.cage!.pinCap || sh?.cap ? [{
      title: "Capacitors (C0G ceramic, soldered in series)",
      columns: [{ label: "Part", kind: "text" as const }, { label: "Quantity", kind: "num" as const }, { label: "Capacitance (pF)", kind: "num" as const }],
      rows: [
        ...(t.cage!.pinCap ? [["In the centre pin, between the coax end and the hot washer", 1, t.cage!.pinCap]] : []),
        ...(sh?.cap ? [["In the second shorting wire, at its ground end", Math.floor(sh.n / 2), sh.cap]] : []),
      ],
    }] : []),
    {
      title: "Hoops (soldered round the frames at every bend)",
      columns: [{ label: "Part", kind: "text" }, { label: "Diameter", kind: "len" }, { label: "Height above the coax end", kind: "len" }, { label: "Wire length", kind: "len" }],
      rows: hoops.map(({ q, what }) => [what, 2 * q[0], q[1], 2 * Math.PI * q[0]]),
    },
    {
      title: "Hub washers (where the frames meet the axis)",
      columns: [{ label: "Part", kind: "text" }, { label: "Outer diameter", kind: "len" }, { label: "Hole diameter", kind: "len" }, { label: "Height above the coax end", kind: "len" }],
      rows: [
        ...(hubHot ? [["Hot washer (on the centre pin)", washerD, 1.0e-3, g]] : []),
        ...(hubGnd ? [["Ground collar (on the coax jacket)", 2 * hubGnd[1][0], 2 * COAX_R + 0.1e-3, hubGnd[1][1]]] : []),
      ],
    },
  ];
  const f = Math.sqrt(fLow * Math.min(fHigh, fTop));
  return {
    wires, plates: [], cuts,
    frames: {
      hot: hotF, ground: gndF, n, hoops: seats,
      ...(sh && hotN && gndN ? { short: Array.from({ length: sh.n }, (_, j) => ({ hot: hotN.q, ground: gndN.q, frame: sh.frame + (j * n) / sh.n, coil: turns > 0, ...(sh.cap && j % 2 === 1 ? { cap: sh.cap } : {}) })) } : {}),
      ...(t.cage!.pinCap ? { pinCap: t.cage!.pinCap } : {}),
    },
    feed: { wire: 0, at: "center" },
    dims: [
      { label: "Wavelength at the lowest frequency", value: wavelength(fLow) },
      { key: "H", label: "Overall height", value: zTop - zBot, at: [v(-rGnd, 0, zBot), v(-rGnd, 0, zTop)] },
      { key: "D", label: "Hot element diameter", value: 2 * rHot, at: [v(-rHot, 0, zTop), v(rHot, 0, zTop)] },
      { key: "G", label: "Ground cone diameter", value: 2 * rGnd, at: [v(-rGnd, 0, zBot), v(rGnd, 0, zBot)] },
      { key: "g", label: "Gap: coax end to the washer", value: g, at: [v(0, 0, 0), v(0, 0, g)] },
      ...(sh && hotN && gndN && !turns ? [{ key: "S", label: "Shorting wire length", value: shortLen, at: [at(hotN.q[0], hotN.q[1], ang[sh.frame]), at(gndN.q[0], gndN.q[1], ang[sh.frame])] as [Vec3, Vec3] }] : []),
      { label: "Wire diameter", value: 2 * r },
      ...(bare ? [{ label: "Bare cable length (Simulation)", value: bare.len }] : []),
    ],
    tables,
    perf: [
      ...tablePerf(t, bands, fLow, bare ? "Worst SWR in your bands (precomputed NEC-2, bare cable)" : "Worst SWR in your bands (precomputed NEC-2, no cable)", bare?.row),
      { label: "Wire frames (hot + ground)", value: `${n} + ${n}` },
    ],
    notes: [
      mini === "a55"
        ? "The low-band half of the two-antenna set: a Ø51 × 54 mm cage for 960 MHz – 1.36 GHz, 16 bent frames per side with a wire hoop at every bend, a lid, and two shorting wires from a hot frame down to the ground frame under it, each wound into a 2-turn coil. One shorting wire is a plain inductor across the feed; the other has a small capacitor in series, and the centre pin another: that gives the match two resonances (double tuning), which a box this size needs to cover a 34 %-wide band. SWR ≤ 1.9 over the band on its own (precomputed NEC-2). Hold it by the coax with the cones up: the beam is tilted toward the sky (15–50° elevation)."
        : mini === "b44"
        ? "The mini wire cage one size up, re-tuned for 1.36–7 GHz as the high-band half of a two-antenna set: Ø43 × 44 mm, 16 bent frames per side with a wire hoop at every bend and one straight shorting wire from a hot frame down to the ground frame under it. On its own it holds SWR ≤ 1.75 over the whole band (precomputed NEC-2). Hold it by the coax with the cones up: the beam is tilted toward the sky (15–50° elevation)."
        : mini
        ? "The smallest sky-tilted bicone that still works: the small wire cage shrunk to Ø39 × 40 mm, 16 bent frames per side with a wire hoop at every bend and one straight shorting wire from a hot frame down to the ground frame under it. A box this small fits a sphere of radius 28 mm, and below that the Chu limit rules out a match at 960 MHz whatever the wire shape (bent, twisted and coiled frames were all tried), so this cage starts at 1.4 GHz: SWR ≤ 2.1 up to 6.4 GHz. Hold it by the coax with the cones up: the beam is tilted toward the sky (15–50° elevation)."
        : sh
        ? "The small sky-tilted bicone built from wire: 16 bent frames per side with a wire hoop at every bend, plus one straight shorting wire from a hot frame down to the ground frame under it. That wire is what makes it small: at the bottom of the band it works as an inductor across the feed and lifts the low resistance of the small cage to about 50 Ω. Hold it by the coax with the cones up: the beam is tilted toward the sky (15–50° elevation)."
        : "The compact sky-tilted bicone built from wire: 16 bent frames per side follow the solid shape, with a wire hoop soldered round them at every bend. With 16 frames it matches the solid version (fewer frames lose the top of the band). Hold it by the coax with the cones up: the beam is tilted toward the sky (15–50° elevation).",
      mini === "b44"
        ? "The shape is fixed (it was optimised as a whole); all dimensions scale with your lowest frequency, the wire diameter too. The Simulation tab shows the precomputed NEC-2 sweep of this cage (Ø1 mm wire at 1.36 GHz), scaled to your size."
        : mini === "w40"
        ? "The shape is fixed (it was optimised as a whole); all dimensions scale with your lowest frequency, the wire diameter too. The Simulation tab shows the precomputed NEC-2 sweep of this cage (Ø1 mm wire at 1.4 GHz), scaled to your size."
        : "The shape is fixed (it was optimised as a whole); all dimensions scale with your lowest frequency, the wire diameter too. The Simulation tab shows the precomputed NEC-2 sweep of this cage (Ø1 mm wire at 960 MHz), scaled to your size.",
      "Feed through UT-141 (RG-402) semi-rigid coax: the hot frames are soldered round a washer on the centre pin (keep the listed gap above the coax end), the ground frames round a collar on the coax jacket.",
      ...(sh ? ["The shorting wire is a DC short across the coax. That is fine for a receiver, but switch off any antenna power (bias-tee) on the receiver input, or put a DC block in the line."] : []),
      ...(mini === "a55" ? ["Capacitors (C0G ceramic, 0402 or 0603, in series): 2.2 pF in the centre pin between the coax and the hot washer, ±5 % or better (±10 % puts the worst SWR at 2.06), and 3.6 pF at the ground end of the second shorting wire (±10 % is fine). Wind both coils to the count: a quarter turn more raises the worst SWR to 2.2, a quarter turn less changes nothing."] : []),
      bare ? BARE_NOTE : mini === "a55"
        ? "No ferrite needed, but a bare coax is half of this small antenna (SWR up to 10 with 15 cm of cable). Slide two metal tubes over the coax under the ground cone, Ø20 mm, 70 mm and then 50 mm long, each open towards the antenna and soldered to the coax jacket at its far end (scale them with the antenna). With them a 15–35 cm cable keeps the SWR at or below 1.8 over the band; a 6-bead ferrite sleeve would also do it (≤ 1.85)."
        : mini === "b44"
        ? "No ferrite needed: a quarter-wave choke sleeve does the job. Slide a Ø10 × 50 mm metal tube over the coax just below the ground cone, open towards the antenna and soldered to the coax jacket at its far end (scale the tube with the antenna). With it a 15–35 cm cable keeps the SWR at or below 2.0 over the band (bare cable: up to 3.2); a 6-bead ferrite sleeve would also do it (≤ 1.8)."
        : mini
        ? "Ferrite sleeve required: stack about 6 ferrite beads (material 43 or 61, about 150 Ω each) on the first 11 cm of coax below the ground cone. This small antenna couples strongly to the cable: 15–35 cm of bare cable lifts the SWR to 3.5 in the lower half of the band, one bead leaves 2.1, the sleeve keeps it below 1.8."
        : "Ferrite sleeve required: stack about 6 ferrite beads (material 43 or 61, about 150 Ω each) on the first 11 cm of coax below the ground cone. This small antenna couples strongly to the cable: with one bead a 15–35 cm cable still lifts the SWR to 2.7 at the bottom of the band, with the sleeve it stays below 1.9.",
      ...(fHigh > fTop * 1.001 ? ["Warning: your highest band is above this shape's range; the SWR there is not computed. Lower the bands or use the 21:1 version."] : []),
      "Full study, build steps, tolerances and solver checks: docs/FPV-DETECTOR-ANTENNA.md in the project repository.",
    ],
    // the choke tubes were sized at the study's scale (fLo); they scale with the antenna
    coax: bare ? { choke: "none", bare }
      : mini === "a55" ? { choke: "tube", tubes: [{ d: 20e-3 * s, len: 70e-3 * s }, { d: 20e-3 * s, len: 50e-3 * s }] }
      : mini === "b44" ? { choke: "tube", tubes: [{ d: 10e-3 * s, len: 50e-3 * s }] }
      : { choke: "sleeve" },
    necSupported: true,
    f,
    sweeps: [{ start: fLow, stop: Math.max(fHigh, fLow * 1.5), steps: 101 }],
  };
}

const BANDS_P = { ...BANDS, label: "Frequency bands (all must fit in the range)" };
const PARAMS = [BANDS_P, COAX_FERRITE];
const PARAMS_TUBE = [BANDS_P, COAX_TUBE];
const PARAMS_TUBES = [BANDS_P, COAX_TUBES];

export const skycone7: AntennaDef = {
  id: "skycone7",
  name: "Sky-tilted capped bicone, compact (6.7:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The 8:1 shape re-optimised smaller: 960 MHz–6.4 GHz at Ø73 × 71 mm, beam tilted up. Needs a ferrite sleeve (6 beads) on the coax.",
  multiband: "broadband",
  maxRatio: SKYCONE_7.fHi / SKYCONE_7.fLo,
  params: PARAMS,
  defaults: { bands: "960e6-6400e6", coax: "ferrite" },
  build: (p) => build(SKYCONE_7, p, true),
};

export const skycone8: AntennaDef = {
  id: "skycone8",
  name: "Sky-tilted capped bicone (8:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "Solid inverted discone with a capped top: 800 MHz–6.4 GHz at Ø113 × 110 mm, beam tilted up to 15–50°. For handheld FPV and drone detectors.",
  multiband: "broadband",
  maxRatio: SKYCONE_8.fHi / SKYCONE_8.fLo,
  params: PARAMS,
  defaults: { bands: "800e6-6400e6", coax: "ferrite" },
  build: (p) => build(SKYCONE_8, p),
};

export const skycone21: AntennaDef = {
  id: "skycone21",
  name: "Sky-tilted capped bicone (21:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The same idea with a ground skirt: 300 MHz–6.4 GHz at Ø275 × 294 mm, beam tilted up toward the sky.",
  multiband: "broadband",
  maxRatio: SKYCONE_21.fHi / SKYCONE_21.fLo,
  params: PARAMS,
  defaults: { bands: "300e6-6400e6", coax: "ferrite" },
  build: (p) => build(SKYCONE_21, p),
};

export const skyconecage: AntennaDef = {
  id: "skyconecage",
  name: "Sky-tilted capped bicone, wire cage (6.7:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The compact bicone bent from Ø1 mm wire instead of sheet: 16 frames per side and a few hoops, 960 MHz–6.4 GHz at Ø72 × 75 mm, beam tilted up. Needs a ferrite sleeve (6 beads) on the coax.",
  multiband: "broadband",
  maxRatio: SKYCONE_W16.fHi / SKYCONE_W16.fLo,
  params: PARAMS,
  defaults: { bands: "960e6-6400e6", coax: "ferrite" },
  build: (p) => buildCage(SKYCONE_W16, p),
};

export const skyconecagemini: AntennaDef = {
  id: "skyconecagemini",
  name: "Sky-tilted capped bicone, small wire cage (6.7:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The wire cage made smaller by one shorting wire from a hot frame to the ground frame: 960 MHz–6.4 GHz at Ø65 × 65 mm, beam tilted up. Needs a ferrite sleeve (6 beads) on the coax.",
  multiband: "broadband",
  maxRatio: SKYCONE_W65.fHi / SKYCONE_W65.fLo,
  params: PARAMS,
  defaults: { bands: "960e6-6400e6", coax: "ferrite" },
  build: (p) => buildCage(SKYCONE_W65, p),
};

export const skyconecage40: AntennaDef = {
  id: "skyconecage40",
  name: "Sky-tilted capped bicone, mini wire cage (4.6:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The small wire cage shrunk to Ø39 × 40 mm (16 frames per side, one shorting wire). A box this small fits a sphere of radius 28 mm, below the Chu limit for 960 MHz, so the band starts at 1.4 GHz: 1.4–6.4 GHz at SWR ≤ 2.1, beam tilted up. Needs a ferrite sleeve (6 beads) on the coax.",
  multiband: "broadband",
  maxRatio: SKYCONE_W40.fHi / SKYCONE_W40.fLo,
  params: PARAMS,
  defaults: { bands: "1400e6-6400e6", coax: "ferrite" },
  build: (p) => buildCage(SKYCONE_W40, p, "w40"),
};

export const skyconecage44: AntennaDef = {
  id: "skyconecage44",
  name: "Sky-tilted capped bicone, mini wire cage 7 GHz (5.1:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The mini wire cage one size up, re-tuned for 1.36–7 GHz: Ø43 × 44 mm, 16 frames per side, one shorting wire, SWR ≤ 1.75, beam tilted up. No ferrite: a Ø10 × 50 mm choke sleeve on the coax keeps the cable out of the match.",
  multiband: "broadband",
  maxRatio: SKYCONE_B44.fHi / SKYCONE_B44.fLo,
  params: PARAMS_TUBE,
  defaults: { bands: "1360e6-7000e6", coax: "choke" },
  build: (p) => buildCage(SKYCONE_B44, p, "b44"),
};

export const skyconecage55: AntennaDef = {
  id: "skyconecage55",
  name: "Sky-tilted capped bicone, low-band wire cage (1.4:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The low-band half of the two-antenna set: Ø51 × 54 mm for 960 MHz–1.36 GHz, 16 frames per side, two coiled shorting wires, two small capacitors (double-tuned match), SWR ≤ 1.9, beam tilted up. No ferrite: two choke-sleeve tubes on the coax.",
  multiband: "broadband",
  maxRatio: SKYCONE_A55.fHi / SKYCONE_A55.fLo,
  params: PARAMS_TUBES,
  defaults: { bands: "960e6-1360e6", coax: "choke" },
  build: (p) => buildCage(SKYCONE_A55, p, "a55"),
};

/** Tabulated results per type id (simulate.ts). */
export const SKYCONE_TABLES: Record<string, SkyconeTable> = { skycone7: SKYCONE_7, skycone8: SKYCONE_8, skycone21: SKYCONE_21, skyconecage: SKYCONE_W16, skyconecagemini: SKYCONE_W65, skyconecage40: SKYCONE_W40, skyconecage44: SKYCONE_B44, skyconecage55: SKYCONE_A55 };
