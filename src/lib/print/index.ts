import type { ManifoldToplevel } from "manifold-3d";
import { cleanup } from "manifold-3d/lib/garbage-collector.js";
import type { Design, Params } from "../types";
import type { BuiltPart, PartSpec } from "./parts";
import { buildPart, PART_STRINGS } from "./parts";
import { CENTRE_HOWTO, CENTRE_STRINGS, FAN_HOWTO, FAN_STRINGS, dipoleParts, fanParts } from "./families/centre";
import { DISCONE_HOWTO, DISCONE_STRINGS, disconeParts, HUB_HOWTO, HUB_STRINGS, groundPlaneParts } from "./families/hub";
import { BOOM_HOWTO, BOOM_STRINGS, yagiParts } from "./families/boom";
import { FORMER_HOWTO, FORMER_STRINGS, helixParts } from "./families/former";
import { SPREADER_HOWTO, SPREADER_STRINGS, moxonParts, quadParts } from "./families/spreader";
import { STANDOFF_HOWTO, STANDOFF_STRINGS, biquadParts } from "./families/standoff";
import { SPACER_HOWTO, SPACER_STRINGS, collinearParts, jpoleParts } from "./families/spacer";
import { SKYCONE_HOWTO, SKYCONE_STRINGS, SKYCONE_TPL, skyconeParts } from "./families/skycone";
import { SHELL_HOWTO, SHELL_STRINGS, shellFor } from "./shells";
import { en } from "../build";

export { buildPart, USE_LABELS, type BuiltPart, type PartSpec, type Segment } from "./parts";

const FAMILIES: Record<string, (p: Params, d: Design) => PartSpec[]> = {
  dipole: (_p, d) => dipoleParts(d),
  fandipole: (_p, d) => fanParts(d),
  groundplane: (_p, d) => groundPlaneParts(d),
  yagi: yagiParts,
  helix: (_p, d) => helixParts(d),
  discone: disconeParts,
  moxon: moxonParts,
  quad: quadParts,
  biquad: (_p, d) => biquadParts(d),
  jpole: (_p, d) => jpoleParts(d),
  collinear: collinearParts,
  skycone7: (_p, d) => skyconeParts(d, 0.3, true),
  skyconecage: (_p, d) => skyconeParts(d, 0, true),
  skyconecagemini: (_p, d) => skyconeParts(d, 0, true),
  skyconecage40: (_p, d) => skyconeParts(d, 0, true),
  skyconecage44: (_p, d) => skyconeParts(d, 0, true),
  skycone8: (_p, d) => skyconeParts(d),
  skycone21: (_p, d) => skyconeParts(d),
};

/** Printable parts for an antenna design (the family's parts plus its shell); empty when the type has none (yet).
 *  Cheap: nothing is built here. */
export const partsFor = (defId: string, p: Params, d: Design): PartSpec[] => {
  const family = FAMILIES[defId]?.(p, d) ?? [];
  // printed antennas get the PCB enclosure: every one has a board model except the PCB loop (drawn as plates only);
  // a stacked build (pagoda) is round and gets a radome like the cloverleaf
  if (family.some((s) => s.id === "shell")) return family;          // the family brings its own (simulated) cover
  const shell = shellFor(defId, p, d, (!!d.pcb && !d.pcb.levels?.length) || defId === "pcbloop");
  return shell ? [...family, shell] : family;
};

/** Build and check every part of a design, then free all WASM geometry (the results are plain arrays). */
export function buildParts(M: ManifoldToplevel, defId: string, p: Params, d: Design): BuiltPart[] {
  try { return partsFor(defId, p, d).map((s) => buildPart(M, s, `${defId}-${s.id}`)); } finally { cleanup(); }
}

/** Every English string the print parts can show, for the i18n coverage test. */
export const PRINT_STRINGS = [
  ...PART_STRINGS, ...CENTRE_STRINGS, ...HUB_STRINGS, ...BOOM_STRINGS, ...FORMER_STRINGS, ...DISCONE_STRINGS, ...SPREADER_STRINGS, ...STANDOFF_STRINGS, ...SPACER_STRINGS, ...FAN_STRINGS,
  ...Object.values(CENTRE_HOWTO).flat(), ...HUB_HOWTO, ...Object.values(BOOM_HOWTO).flat(), ...FORMER_HOWTO, ...DISCONE_HOWTO, ...Object.values(SPREADER_HOWTO).flat(), ...STANDOFF_HOWTO, ...Object.values(SPACER_HOWTO).flat(), ...Object.values(FAN_HOWTO).flat(),
  ...SHELL_STRINGS, ...Object.values(SHELL_HOWTO).flat(),
  ...SKYCONE_STRINGS, ...Object.values(SKYCONE_TPL), ...Object.values(SKYCONE_HOWTO).flat(),
];

/** README.txt for the parts zip: every part with its quantity, purpose and how-to steps, in English with lengths in mm. */
export function partsReadme(title: string, specs: PartSpec[]): string {
  const out = [`3D-printed parts: ${title}`, "", "STL files are in millimetres. Use PETG or ASA for parts that stay outdoors; PLA is fine for jigs.", ""];
  for (const s of specs) {
    out.push(`${s.title} (${s.qty} pc)`, en(s.purpose), ...(s.warn ? [`Warning: ${en(s.warn)}`] : []), "How to use:", ...s.howTo.map((h, i) => `  ${i + 1}. ${en(h)}`), "");
  }
  return out.join("\n");
}
