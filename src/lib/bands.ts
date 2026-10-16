// Frequency bands: parsing, presets and NEC sweeps. A "bands" param is stored as a string
// "144e6-146e6;430e6-440e6" so it fits in Params, localStorage and share links.
import type { Sweep } from "./types";

export type Band = [number, number];

export function parseBands(s: string): Band[] {
  const out: Band[] = [];
  for (const part of s.split(";")) {
    const [a, b] = part.split("-").map(Number);
    if (!(a > 0)) continue;
    const hi = b > 0 ? b : a;
    out.push(a <= hi ? [a, hi] : [hi, a]);
  }
  return out;
}

export const formatBands = (b: Band[]) => b.map(([a, c]) => `${+a.toPrecision(9)}-${+c.toPrecision(9)}`).join(";");

export const centre = ([a, b]: Band) => (a + b) / 2;
/** Highest / lowest frequency over all bands. */
export const spanRatio = (b: Band[]) => (b.length ? Math.max(...b.map((x) => x[1])) / Math.min(...b.map((x) => x[0])) : 1);
/** Relative width, % of the centre frequency. */
export const widthPct = ([a, b]: Band) => (200 * (b - a)) / (a + b);

/** NEC sweep over a band with a small margin on each side (±2 % of centre, start ≥ half the band edge, at least 11 points). */
export function bandSweep([a, b]: Band): Sweep {
  const m = 0.02 * centre([a, b]);
  // the margin is relative to the centre, so on a 100:1 band it would reach below 0 Hz
  const start = Math.max(a - m, a / 2), stop = b + m;
  return { start, stop, steps: Math.max(11, Math.min(41, Math.round((stop - start) / (0.005 * centre([a, b]))) + 1)) };
}

/** Common band plans (Hz). Labels are English source strings (translated in the UI). */
export const BAND_PRESETS: [string, Band][] = [
  ["HF 40 m", [7.0e6, 7.2e6]],
  ["HF 20 m", [14.0e6, 14.35e6]],
  ["HF 10 m", [28.0e6, 29.7e6]],
  ["6 m", [50e6, 54e6]],
  ["FM broadcast", [87.5e6, 108e6]],
  ["Airband", [118e6, 137e6]],
  ["2 m", [144e6, 146e6]],
  ["Marine VHF", [156e6, 162.025e6]],
  ["70 cm", [430e6, 440e6]],
  ["LPD 433", [433.05e6, 434.79e6]],
  ["PMR446", [446.0e6, 446.2e6]],
  ["ISM 868 (EU)", [863e6, 870e6]],
  ["ISM 915 (US)", [902e6, 928e6]],
  ["FPV 1.2 GHz", [1.08e9, 1.36e9]],
  ["ADS-B 1090", [1088e6, 1092e6]],
  ["GPS L1", [1574.42e6, 1576.42e6]],
  ["ELRS / FPV 2.4 GHz", [2.4e9, 2.48e9]],
  ["Wi-Fi 2.4 GHz", [2.4e9, 2.4835e9]],
  ["FPV 3.3 GHz", [3.17e9, 3.47e9]],
  ["LTE 3.5 GHz (n78)", [3.3e9, 3.8e9]],
  ["Wi-Fi 5 GHz", [5.15e9, 5.85e9]],
  ["FPV 5.8 GHz", [5.645e9, 5.945e9]],
];

/** Wide ranges for broadband antennas (discone, helix, LPDA). Same shape as BAND_PRESETS. */
export const WIDE_PRESETS: [string, Band][] = [
  ["HF", [3e6, 30e6]],
  ["VHF", [30e6, 300e6]],
  ["VHF + UHF ham", [144e6, 440e6]],
  ["UHF TV", [470e6, 790e6]],
  ["UHF", [300e6, 3e9]],
  ["SDR scanner", [25e6, 1.3e9]],
  ["Wideband SDR", [70e6, 6.4e9]],
  ["Cellular (LTE)", [700e6, 2.7e9]],
  ["UWB", [3.1e9, 10.6e9]],
];
