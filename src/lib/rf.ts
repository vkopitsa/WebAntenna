// Electromagnetics helpers shared by the antenna builders.
import { SPEED_OF_LIGHT } from "./units";

export const C0 = SPEED_OF_LIGHT;
export const wavelength = (f: number) => C0 / f;
export const deg = (d: number) => (d * Math.PI) / 180;
export const dB = (x: number) => 10 * Math.log10(x);

/**
 * Resonant-length (end-effect) factor of a straight thin element, as a function of the
 * half-wave to diameter ratio: K = 1 − 0.225 / ln(λ / 2d).
 * Fits the ARRL Antenna Book curve: ratio 10 → 0.90, 100 → 0.95, 1000 → 0.967, 10⁴ → 0.976.
 */
export function endEffect(lambda: number, d: number): number {
  const ratio = lambda / (2 * d);
  if (!(ratio > 5)) return 0.88;
  return 1 - 0.225 / Math.log(ratio);
}

/** Composite Simpson integration of f over [a, b] with n (even) intervals. */
export function simpson(f: (x: number) => number, a: number, b: number, n = 400): number {
  const h = (b - a) / n;
  let s = f(a) + f(b);
  for (let i = 1; i < n; i++) s += f(a + i * h) * (i % 2 ? 4 : 2);
  return (s * h) / 3;
}

/** Bessel J0 (Abramowitz & Stegun 9.4.1 / 9.4.3 polynomial approximations, |ε| < 5e-8). */
export function besselJ0(x: number): number {
  const ax = Math.abs(x);
  if (ax <= 3) {
    const y = (x / 3) ** 2;
    return 1 + y * (-2.2499997 + y * (1.2656208 + y * (-0.3163866 + y * (0.0444479 + y * (-0.0039444 + y * 0.00021)))));
  }
  const y = 3 / ax;
  const f0 = 0.79788456 + y * (-0.00000077 + y * (-0.0055274 + y * (-0.00009512 + y * (0.00137237 + y * (-0.00072805 + y * 0.00014476)))));
  const t0 = ax - 0.78539816 + y * (-0.04166397 + y * (-0.00003954 + y * (0.00262573 + y * (-0.00054125 + y * (-0.00029333 + y * 0.00013558)))));
  return (f0 * Math.cos(t0)) / Math.sqrt(ax);
}

/** Microstrip effective permittivity (Hammerstad), w/h ratio u. */
export function microstripEeff(er: number, u: number): number {
  const base = (er + 1) / 2 + ((er - 1) / 2) * Math.pow(1 + 12 / u, -0.5);
  return u < 1 ? base + ((er - 1) / 2) * 0.04 * (1 - u) ** 2 : base;
}

/** Microstrip width for impedance z0 on substrate (er, h) — Wheeler/Hammerstad synthesis. Returns metres. */
export function microstripWidth(z0: number, er: number, h: number): number {
  const A = (z0 / 60) * Math.sqrt((er + 1) / 2) + ((er - 1) / (er + 1)) * (0.23 + 0.11 / er);
  let u = (8 * Math.exp(A)) / (Math.exp(2 * A) - 2);
  if (u > 2) {
    const B = (377 * Math.PI) / (2 * z0 * Math.sqrt(er));
    u = (2 / Math.PI) * (B - 1 - Math.log(2 * B - 1) + ((er - 1) / (2 * er)) * (Math.log(B - 1) + 0.39 - 0.61 / er));
  }
  return u * h;
}

/** Microstrip characteristic impedance (Hammerstad) for width w on (er, h). Used to check the synthesis. */
export function microstripZ0(w: number, er: number, h: number): number {
  const u = w / h;
  const e = microstripEeff(er, u);
  return u <= 1
    ? (60 / Math.sqrt(e)) * Math.log(8 / u + u / 4)
    : (120 * Math.PI) / (Math.sqrt(e) * (u + 1.393 + 0.667 * Math.log(u + 1.444)));
}

/** Piecewise-linear interpolation through sorted (x, y) points, clamped at the ends. */
export function interp(pts: [number, number][], x: number): number {
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
    }
  }
  return pts[pts.length - 1][1];
}

export const fmt = (x: number, digits = 1) => (Number.isFinite(x) ? x.toFixed(digits) : "—");
