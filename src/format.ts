import type { Unit } from "./store";

/** Length for display. Metres in, mm or inches out. */
export function fmtLen(m: number, unit: Unit): string {
  if (!Number.isFinite(m)) return "—";
  if (unit === "in") {
    const i = m / 0.0254;
    return Math.abs(i) >= 120 ? `${(i / 12).toFixed(2)} ft (${i.toFixed(1)} in)` : `${i.toFixed(Math.abs(i) < 1 ? 3 : 2)} in`;
  }
  const mm = m * 1000;
  if (Math.abs(mm) >= 10000) return `${(mm / 1000).toFixed(3)} m`;
  return `${mm.toFixed(Math.abs(mm) < 10 ? 2 : 1)} mm`;
}

/** Number in the input unit (mm or in) from metres, and back. */
export const toUnit = (m: number, unit: Unit) => (unit === "in" ? m / 0.0254 : m * 1000);
export const fromUnit = (x: number, unit: Unit) => (unit === "in" ? x * 0.0254 : x / 1000);
