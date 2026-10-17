const PREFIXES: [number, string][] = [
  [1e12, "T"], [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"],
];

/** Format with SI prefix, e.g. si(1.5e-9, "H") → "1.500 nH". */
export function si(v: number, unit = "", digits = 4): string {
  if (!isFinite(v)) return v > 0 ? "∞" : v < 0 ? "−∞" : "—";
  if (v === 0) return `0 ${unit}`.trim();
  const a = Math.abs(v);
  for (const [k, p] of PREFIXES) {
    if (a >= k * 0.9999995) {
      const x = v / k;
      const ax = Math.abs(x);
      const d = Math.max(0, digits - (ax >= 100 ? 3 : ax >= 10 ? 2 : 1));
      return `${x.toFixed(d)} ${p}${unit}`.trim();
    }
  }
  return `${v.toExponential(digits - 1)} ${unit}`.trim();
}

export function fmtHz(f: number, digits = 6): string {
  const a = Math.abs(f);
  if (a >= 1e9) return `${(f / 1e9).toFixed(Math.min(digits, 6))} GHz`;
  if (a >= 1e6) return `${(f / 1e6).toFixed(Math.min(digits, 6))} MHz`;
  if (a >= 1e3) return `${(f / 1e3).toFixed(Math.min(digits, 3))} kHz`;
  return `${f.toFixed(0)} Hz`;
}

/** Short axis label for a frequency. */
export function fmtHzShort(f: number): string {
  const a = Math.abs(f);
  const trim = (s: string) => s.replace(/\.?0+$/, "");
  if (a >= 1e9) return `${trim((f / 1e9).toFixed(3))}G`;
  if (a >= 1e6) return `${trim((f / 1e6).toFixed(3))}M`;
  if (a >= 1e3) return `${trim((f / 1e3).toFixed(2))}k`;
  return `${f.toFixed(0)}`;
}

/**
 * Parse "435M", "1.2 GHz", "500k", "433.92e6", "100" (Hz). A bare number without a prefix or exponent ("430") is read in
 * `units` order: the first multiplier that lands in [min, max] wins (a field showing "144 MHz" passes MHz first).
 */
export function parseHz(s: string, units: number[] = [1], min = 0, max = Infinity): number | null {
  const m = s.trim().replace(/,/g, ".").match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([kKmMgG]?)(?:hz|Hz|HZ)?$/);
  if (!m) return null;
  const x = parseFloat(m[1]);
  if (!m[2] && !/e/i.test(m[1]) && !/hz$/i.test(s.trim())) {
    for (const u of units) if (x * u >= min && x * u <= max) return x * u;
    return x * units[0];
  }
  const k = { "": 1, k: 1e3, K: 1e3, m: 1e6, M: 1e6, g: 1e9, G: 1e9 }[m[2]] ?? 1;
  return x * k;
}

/** Multiplier of the unit a frequency is shown in (fmtHz): GHz, MHz, kHz or Hz. */
export function hzUnit(f: number): number {
  const a = Math.abs(f);
  return a >= 1e9 ? 1e9 : a >= 1e6 ? 1e6 : a >= 1e3 ? 1e3 : 1;
}

/** Parse a value with optional SI prefix: "10p", "4.7n", "1.2u", "50". */
export function parseSI(s: string): number | null {
  const m = s.trim().replace(/,/g, ".").match(/^([-+]?\d*\.?\d+(?:e[-+]?\d+)?)\s*([fpnuµmkMG]?)/);
  if (!m) return null;
  const k: Record<string, number> = { "": 1, f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3, k: 1e3, M: 1e6, G: 1e9 };
  return parseFloat(m[1]) * (k[m[2]] ?? 1);
}

/** A "nice" step (1, 2, 5 × 10^n) ≥ raw. */
export function niceStep(raw: number): number {
  if (!(raw > 0) || !isFinite(raw)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}

export const SPEED_OF_LIGHT = 299792458;
