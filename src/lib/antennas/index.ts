import type { AntennaDef, Design, ParamDef, Vec3 } from "../types";
import { num } from "../types";
import { dipole } from "./dipole";
import { groundplane } from "./groundplane";
import { jpole } from "./jpole";
import { collinear } from "./collinear";
import { yagi } from "./yagi";
import { moxon } from "./moxon";
import { quad } from "./quad";
import { biquad } from "./biquad";
import { helix } from "./helix";
import { cloverleaf } from "./cloverleaf";
import { spring } from "./spring";
import { pagoda } from "./pagoda";
import { patch } from "./patch";
import { discone } from "./discone";
import { fandipole } from "./fandipole";
import { pcbmonopole } from "./pcbmonopole";
import { ifa } from "./ifa";
import { meander } from "./meander";
import { printeddipole } from "./printeddipole";
import { printedvdipole } from "./printedvdipole";
import { pcbloop } from "./pcbloop";
import { dualbanddipole } from "./dualbanddipole";
import { sleevedipole } from "./sleevedipole";
import { skycone7, skycone8, skycone21, skyconecage, skyconecagemini, skyconecage40, skyconecage44 } from "./skycone";
import { centre, widthPct } from "../bands";
import { band } from "./common";

/**
 * Adds the band table to every design and, for single-band types given several bands,
 * a note that only the first band is designed for (the NEC deck still sweeps them all).
 */
export const TRIM: ParamDef = { key: "trim", label: "Length trim (%)", kind: "number", min: -15, max: 15, step: 0.5, hint: "Scales the whole antenna; set by Synthesize to centre the match" };

/** Uniform geometry scale (wire radii, PCB data and wavelength rows excluded). */
function applyTrim(d: Design, k: number): Design {
  if (k === 1) return d;
  const sv = (v: Vec3): Vec3 => [v[0] * k, v[1] * k, v[2] * k];
  d.wires = d.wires.map((w) => ({ ...w, a: sv(w.a), b: sv(w.b) }));
  d.plates = d.plates.map((pl) => ({ ...pl, pts: pl.pts.map(sv) }));
  d.dims = d.dims.map((x) => (/wavelength|довжина хвилі/i.test(x.label) ? x : { ...x, value: x.value * k, at: x.at && [sv(x.at[0]), sv(x.at[1])] }));
  d.tables = d.tables.map((t) => ({ ...t, rows: t.rows.map((r) => r.map((c, i) => (t.columns[i]?.kind === "len" && typeof c === "number" ? c * k : c))) }));
  return d;
}

/** Wire antennas get the trim knob (printed ones are tuned through their own formulas / FDTD; the pagoda by its spacings;
 *  the sky-tilted bicones are a fixed shape scaled by the band, with tabulated results). */
const trimmable = (def: AntennaDef) => def.category !== "Printed" && def.id !== "pagoda" && !def.id.startsWith("skycone");

function withBands(def: AntennaDef): AntennaDef {
  return {
    ...def,
    params: trimmable(def) ? [...def.params, TRIM] : def.params,
    defaults: trimmable(def) ? { ...def.defaults, trim: 0 } : def.defaults,
    build(p) {
      const d0 = def.build(p);
      const d = trimmable(def) ? applyTrim(d0, 1 + num(p, "trim", 0) / 100) : d0;
      const { bands } = band(p);
      const rows = bands.map((b, i) => [`${i + 1}`, b[0], b[1], centre(b), `${widthPct(b).toFixed(2)} %`]);
      d.tables.unshift({
        title: "Bands",
        columns: [{ label: "#", kind: "text" }, { label: "Start", kind: "freq" }, { label: "Stop", kind: "freq" }, { label: "Centre", kind: "freq" }, { label: "Width", kind: "text" }],
        rows,
      });
      if (bands.length > 1 && !def.multiband) {
        d.notes.unshift("Single-band antenna: dimensions are for band 1. The other bands are only checked in the NEC sweep; for real multi-band use the Fan dipole or the Discone.");
      }
      return d;
    },
  };
}

export const ANTENNAS: AntennaDef[] = [dipole, fandipole, groundplane, spring, jpole, collinear, yagi, moxon, quad, biquad, helix, cloverleaf, pagoda, patch, pcbmonopole, meander, ifa, printeddipole, printedvdipole, dualbanddipole, sleevedipole, pcbloop, discone, skycone7, skyconecage, skyconecagemini, skyconecage40, skyconecage44, skycone8, skycone21].map(withBands);
export const ANTENNA_BY_ID: Record<string, AntennaDef> = Object.fromEntries(ANTENNAS.map((a) => [a.id, a]));
