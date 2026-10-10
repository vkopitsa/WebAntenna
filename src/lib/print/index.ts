import type { Design, Params } from "../types";
import type { PartSpec } from "./parts";
import { PART_STRINGS } from "./parts";
import { CENTRE_HOWTO, CENTRE_STRINGS, dipoleParts } from "./families/centre";
import { HUB_HOWTO, HUB_STRINGS, groundPlaneParts } from "./families/hub";
import { BOOM_HOWTO, BOOM_STRINGS, yagiParts } from "./families/boom";
import { en } from "../build";

export { buildPart, USE_LABELS, type BuiltPart, type PartSpec, type Segment } from "./parts";

const FAMILIES: Record<string, (p: Params, d: Design) => PartSpec[]> = {
  dipole: (_p, d) => dipoleParts(d),
  groundplane: (_p, d) => groundPlaneParts(d),
  yagi: yagiParts,
};

/** Printable parts for an antenna design; empty when the type has none (yet). Cheap: nothing is built here. */
export const partsFor = (defId: string, p: Params, d: Design): PartSpec[] => FAMILIES[defId]?.(p, d) ?? [];

/** Every English string the print parts can show, for the i18n coverage test. */
export const PRINT_STRINGS = [
  ...PART_STRINGS, ...CENTRE_STRINGS, ...HUB_STRINGS, ...BOOM_STRINGS,
  ...Object.values(CENTRE_HOWTO).flat(), ...HUB_HOWTO, ...Object.values(BOOM_HOWTO).flat(),
];

/** README.txt for the parts zip: every part with its quantity, purpose and how-to steps, in English with lengths in mm. */
export function partsReadme(title: string, specs: PartSpec[]): string {
  const out = [`3D-printed parts: ${title}`, "", "STL files are in millimetres. Use PETG or ASA for parts that stay outdoors; PLA is fine for jigs.", ""];
  for (const s of specs) {
    out.push(`${s.title} (${s.qty} pc)`, en(s.purpose), "How to use:", ...s.howTo.map((h, i) => `  ${i + 1}. ${en(h)}`), "");
  }
  return out.join("\n");
}
