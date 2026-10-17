import { beforeAll, describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ANTENNAS } from "./lib/antennas";
import type { AntennaDef, Params } from "./lib/types";
import { UK } from "./i18n/uk";
import { BAND_PRESETS, WIDE_PRESETS } from "./lib/bands";
import { SIM_STRINGS } from "./lib/simulate";
import { BUILD_STRINGS } from "./lib/build";
import { PRINT_STRINGS } from "./lib/print";

/** Variants that reach conditional labels and notes. */
const VARIANTS: Record<string, Params[]> = {
  dipole: [{ droop: 30 }],
  yagi: [{ driven: "split", boom: "through" }, { bands: "2.4e9-2.5e9" }],
  jpole: [{ bands: "2.4e9-2.5e9", sp: 5e-3 }],
  printeddipole: [{ bands: "20e9-21e9", w: 8e-3 }],
  pcbmonopole: [{ w: 0.01, bw: 0.01 }],
  patch: [{ feed: "probe" }, { z0: 500 }, { bands: "2e9-3e9" }],
  moxon: [{ d: 0.5 }, { bands: "144e6-146e6;430e6-440e6" }],
  fandipole: [{ bands: "3.5e6-3.8e6;7e6-7.2e6;14e6-14.35e6;21e6-21.45e6;28e6-29.7e6" }, { bands: "3.5e6-3.8e6;7e6-7.2e6;10.1e6-10.15e6;14e6-14.35e6;18e6-18.2e6;21e6-21.45e6;28e6-29.7e6" }],
  discone: [{ bands: "100e6-2000e6" }],
  pcbloop: [{ a: 0.003, b: 0.003, qc: 1 }],
  meander: [{ W: 0.06 }, { P: 0.5e-3 }],
  ifa: [{ bw: 0.01 }, { bands: "6e9-6.1e9", H: 0.05 }],
  helix: [{ bands: "1e9-3e9" }, { d: 0.05 }],
  cloverleaf: [{ leaves: "4", hand: "lhcp" }],
  dualbanddipole: [{ bands: "2.4e9-2.5e9" }],
  pagoda: [{ bands: "2.4e9-2.5e9", version: "3B", hand: "lhcp" }],
  biquad: [{ bands: "2e9-3e9" }],
  spring: [{ bands: "1e6-1e6" }, { D: 0.05 }, { D: 1e-3, d: 0.8e-3, pitch: 5e-3 }, { pitch: 0.5e-3 }],
  skycone8: [{ bands: "800e6-8000e6" }, { coax: "bare1" }],
  skycone7: [{ coax: "bare2" }],
  skyconecage: [{ coax: "bare3" }],
  skyconecage44: [{ coax: "bare1" }],
};

/** Every English string the lib can show (labels, notes, word-only values). */
export function libStrings(): Set<string> {
  const out = new Set<string>();
  const add = (s: string | undefined) => { if (s && /[A-Za-z]/.test(s)) out.add(s); };
  for (const a of ANTENNAS as AntennaDef[]) {
    add(a.name); add(a.summary); add(a.category);
    [...BAND_PRESETS, ...WIDE_PRESETS].forEach(([n]) => add(n));
    SIM_STRINGS.forEach(add);
    BUILD_STRINGS.forEach(add);
    PRINT_STRINGS.forEach(add);
    add("Formula design (openEMS-calibrated); not simulated in the browser yet");
    for (const p of a.params) { add(p.label); add(p.hint); p.options?.forEach(([, l]) => add(l)); }
    for (const extra of [{}, ...(VARIANTS[a.id] ?? [])]) {
      const d = a.build({ ...a.defaults, ...extra });
      d.dims.forEach((x) => add(x.label));
      d.tables.forEach((t) => { add(t.title); t.columns.forEach((c) => add(c.label)); t.rows.forEach((row) => row.forEach((c) => { if (typeof c === "string" && /[A-Za-z]{4,}/.test(c)) add(c); })); });
      d.perf.forEach((x) => { add(x.label); if (/[A-Za-z]{4,}/.test(x.value)) add(x.value); });
      d.notes.forEach(add);
      d.plates.forEach((p) => add(p.label));
    }
  }
  return out;
}

function uiStrings(): Set<string> {
  const out = new Set<string>();
  const walk = (dir: string) => {
    for (const f of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, f.name);
      if (f.isDirectory()) { if (f.name !== "lib" && f.name !== "i18n") walk(p); continue; }
      if (!/\.tsx?$/.test(f.name) || f.name.endsWith(".test.ts")) continue;
      const src = readFileSync(p, "utf8");
      for (const m of src.matchAll(/\bt\("((?:[^"\\]|\\.)+)"/g)) out.add(m[1]);
      for (const m of src.matchAll(/\["[^"]*", "([^"]+)"\]/g)) if (/[A-Za-z]{3}/.test(m[1])) out.add(m[1]);
      for (const m of src.matchAll(/(?:title|ariaLabel)="([^"]+)"/g)) out.add(m[1]);
    }
  };
  walk(join(__dirname));
  return out;
}

describe("Ukrainian dictionary", () => {
  // built once: every antenna and its variants (the 6-band fan dipole tunes for ~2 s)
  let keys: string[] = [];
  beforeAll(() => { keys = [...libStrings(), ...uiStrings()]; }, 60_000);
  it("covers every lib and UI string", () => {
    const missing = keys.filter((k) => !(k in UK));
    expect(missing).toEqual([]);
  });
  it("placeholders match", () => {
    for (const [k, v] of Object.entries(UK)) {
      const ph = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join();
      expect(ph(v), k).toBe(ph(k));
    }
  });
  it("has no stale keys", () => {
    const all = new Set(keys);
    expect(Object.keys(UK).filter((k) => !all.has(k))).toEqual([]);
  });
});
