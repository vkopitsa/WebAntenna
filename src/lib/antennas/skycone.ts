// Sky-tilted capped bicone ("inverted discone"): a solid hot cone with a rim and lid on the coax centre pin, a shallow
// ground cone on the coax jacket. Found by the body-of-revolution MoM + differential-evolution study in
// docs/FPV-DETECTOR-ANTENNA.md (tools/wideband-antenna). The shape is fixed (it was optimised as a whole) and scales
// with the lowest frequency; the Simulation tab shows that study's tabulated sweep, since thin wires cannot model it.
import type { AntennaDef, Design, Plate, Sheet, Table, Vec3, Wire } from "../types";
import { fmt, wavelength } from "../rf";
import { v } from "../geom";
import { band, BANDS } from "./common";
import { SKYCONE_21, SKYCONE_8 } from "./skycone.data";

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

/** Linear interpolation in log f between the table rows; values outside the table are clamped to its ends. */
function bracket(t: SkyconeTable, u: number): [number, number, number] {
  if (u <= t.f[0]) return [0, 0, 0];
  const n = t.f.length - 1;
  if (u >= t.f[n]) return [n, n, 0];
  let i = 1;
  while (t.f[i] < u) i++;
  return [i - 1, i, Math.log(u / t.f[i - 1]) / Math.log(t.f[i] / t.f[i - 1])];
}

/** Impedance at the coax end for a design whose band starts at fLow (Hz); null outside the table. */
export function skyconeZ(t: SkyconeTable, fLow: number, f: number): { r: number; x: number } | null {
  const u = f / fLow;
  if (u < t.f[0] * 0.999 || u > t.f[t.f.length - 1] * 1.001) return null;
  const [i, j, w] = bracket(t, u);
  return { r: t.r[i] + (t.r[j] - t.r[i]) * w, x: t.x[i] + (t.x[j] - t.x[i]) * w };
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

/** Frequency range the table covers (Hz) for a design starting at fLow. */
export const skyconeRange = (t: SkyconeTable, fLow: number): [number, number] => [t.f[0] * fLow, t.f[t.f.length - 1] * fLow];

function build(t: SkyconeTable, bandsP: Parameters<typeof band>[0]): Design {
  const { bands } = band(bandsP);
  const fLow = Math.min(...bands.map((b) => b[0])), fHigh = Math.max(...bands.map((b) => b[1]));
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
  // performance over the user's bands, from the table
  let worst = 0, gMin = Infinity, gSum = 0, gN = 0;
  for (const [a, b] of bands) {
    for (let i = 0; i <= 40; i++) {
      const f = a * (b / a) ** (i / 40);
      const z = skyconeZ(t, fLow, f);
      if (!z) continue;
      const gm = Math.hypot(z.r - 50, z.x) / Math.hypot(z.r + 50, z.x);
      worst = Math.max(worst, (1 + gm) / (1 - gm));
      const gf = skyconeGain(t, fLow, f);
      for (let el = 15; el <= 50; el += 5) { const x = gf(((90 - el) * Math.PI) / 180); gMin = Math.min(gMin, x); gSum += 10 ** (x / 10); gN++; }
    }
  }
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
    ],
    tables,
    perf: [
      { label: "Worst SWR in your bands (precomputed MoM, no cable)", value: worst > 0 ? fmt(worst, 2) : "—" },
      { label: "Gain at 15–50° elevation (mean / lowest)", value: gN ? `${fmt(10 * Math.log10(gSum / gN), 1)} / ${fmt(gMin, 1)} dBi` : "—" },
      { label: "Design range (SWR ≤ 2 by the model)", value: `${fmt(fLow / 1e6, 0)}–${fmt(fTop / 1e6, 0)} MHz` },
      { label: "Pattern", value: "Omni, beam tilted up" },
      { label: "Polarisation", value: "Vertical" },
    ],
    notes: [
      "Hot element (cones, rim, lid) on the coax centre pin, ground cone on the coax jacket. Hold it by the coax with the cones up: the beam is tilted toward the sky (15–50° elevation).",
      "The shape is fixed (it was optimised as a whole); all dimensions scale with your lowest frequency. The Simulation tab shows the precomputed body-of-revolution MoM sweep of this shape, scaled to your size.",
      "Feed through UT-141 (RG-402) semi-rigid coax: solder the jacket into the ground cone apex and the centre pin into the washer. Keep the pin gap as listed: it sets the top of the band.",
      "Clip a ferrite (about 150 Ω) onto the coax just below the ground cone: at the bottom of the band the cable otherwise carries current and the SWR depends on its length.",
      ...(fHigh > fTop * 1.001 ? ["Warning: your highest band is above this shape's range; the SWR there is not computed. Lower the bands or use the 21:1 version."] : []),
      "Full study, build steps, tolerances and solver checks: docs/FPV-DETECTOR-ANTENNA.md in the project repository.",
    ],
    necSupported: false,
    f,
    sweeps: [{ start: fLow, stop: Math.max(fHigh, fLow * 1.5), steps: 101 }],
  };
}

const PARAMS = [{ ...BANDS, label: "Frequency bands (all must fit in the range)" }];

export const skycone8: AntennaDef = {
  id: "skycone8",
  name: "Sky-tilted capped bicone (8:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "Solid inverted discone with a capped top: 800 MHz–6.4 GHz at Ø113 × 110 mm, beam tilted up to 15–50°. For handheld FPV and drone detectors.",
  multiband: "broadband",
  params: PARAMS,
  defaults: { bands: "800e6-6400e6" },
  build: (p) => build(SKYCONE_8, p),
};

export const skycone21: AntennaDef = {
  id: "skycone21",
  name: "Sky-tilted capped bicone (21:1)",
  category: "Broadband",
  traits: { pol: "vertical", pattern: "omni" },
  summary: "The same idea with a ground skirt: 300 MHz–6.4 GHz at Ø275 × 294 mm, beam tilted up toward the sky.",
  multiband: "broadband",
  params: PARAMS,
  defaults: { bands: "300e6-6400e6" },
  build: (p) => build(SKYCONE_21, p),
};

/** Tabulated results per type id (simulate.ts). */
export const SKYCONE_TABLES: Record<string, SkyconeTable> = { skycone8: SKYCONE_8, skycone21: SKYCONE_21 };
