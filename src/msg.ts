// Formats a lib message (English key + typed arguments) for the UI: translated, lengths in mm/in.
import type { Arg, Msg } from "./lib/build";
import type { Unit } from "./store";
import { fmtLen } from "./format";
import { fmtHz } from "./lib/units";

export function fmtMsg(t: (s: string, ...a: (string | number)[]) => string, unit: Unit, m: Msg): string {
  const f = (a: Arg): string | number => {
    if (typeof a === "number") return +a.toPrecision(4);
    if (typeof a === "string") return t(a);
    if ("len" in a) return fmtLen(a.len, unit);
    if ("hz" in a) return fmtHz(a.hz, 3);
    return `${a.pct.toFixed(2)} %`;
  };
  return t(m.s, ...(m.a ?? []).map(f));
}
