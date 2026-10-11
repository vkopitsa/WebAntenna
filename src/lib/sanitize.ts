// Untrusted parameter values (share links, old localStorage) → values the builders accept: numbers clamped
// to the param's range (a link with n=1e9 used to hang the app), bands kept inside the allowed frequencies.
import type { ParamDef } from "./types";
import { formatBands, parseBands } from "./bands";

/** Most bands a link or saved state may carry (each one is a design or an element set). */
export const MAX_BANDS = 12;

/** The value to store for `raw`, or undefined when it is unusable (keep the default). */
export function sanitizeParam(pd: ParamDef, raw: unknown): number | string | undefined {
  if (pd.kind === "select") return pd.options?.some(([v]) => v === raw) ? (raw as string) : undefined;
  if (pd.kind === "bands") {
    if (typeof raw !== "string") return undefined;
    const lo = pd.min ?? 0, hi = pd.max ?? Infinity;
    const b = parseBands(raw).filter(([a, c]) => a >= lo && c <= hi).slice(0, MAX_BANDS);
    return b.length ? formatBands(b) : undefined;
  }
  const n = typeof raw === "number" ? raw : parseFloat(String(raw));
  if (!Number.isFinite(n)) return undefined;
  const v = Math.min(pd.max ?? Infinity, Math.max(pd.min ?? -Infinity, n));
  return pd.kind === "int" ? Math.round(v) : v;
}
