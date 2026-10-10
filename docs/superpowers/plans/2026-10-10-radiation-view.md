# Radiation View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Radiation" toggle in Preview that animates the real MoM near field (E × distance) in the screen plane through the feed, with the wires glowing by their current.

**Architecture:** `src/lib/mom.ts` exposes the solved currents as elements; new `src/lib/nearfield.ts` sums short-dipole fields on a plane and holds the pure per-frame shading. The sim worker computes a field on request (`useNearField`), and a new `RadiationLayer` canvas under the Preview SVG animates the phase with `requestAnimationFrame`.

**Tech Stack:** TypeScript 6, React 19, Vite 8 workers, vitest, Canvas 2D.

**Spec:** `docs/superpowers/specs/2026-10-10-radiation-view-design.md`

## Global Constraints
- `src/lib` has no DOM, no React, no i18n (runs in Node tests and in the worker).
- SI units everywhere (metres, Hz). Complex values as re/im pairs.
- `erasableSyntaxOnly`: no enums, no parameter properties.
- Every new UI string goes through `t("…")` with a UK entry in `src/i18n/uk.ts` (`src/i18n.test.ts` enforces it).
- Colours come from CSS tokens with light and dark variants (both the `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` block and `:root[data-theme="dark"]`).
- Frequency of the field view: the design frequency `d.f`. Mesh: `buildMesh(d, wavelength(d.f), 60, 450)` (same as `simulate()`'s pattern solve).
- Field drawn: `|Re(E·e^{jωt})| · r`, r = distance from the feed point; normalised by the 99th percentile of the peak envelope × r; one RF cycle per 1.5 s.
- SVG export must not change because of the radiation layer.
- Spec deviations decided while planning (record them in the spec in Task 5): the toggle is local Preview state like the view
  (not persisted); the wire glow is drawn on the same canvas (under the SVG wires) instead of per-frame SVG strokes, to avoid
  60 fps React renders; `nearField` takes current elements (the MoM half-segments, as `gainFn` uses) rather than segment currents.

## Review Focus
1. A pixel exactly on a wire or on the feed point must not produce NaN/Infinity (the whole frame would go black): every grid value finite. Test in Task 2.
2. Ineligible antennas (patch, collinear, pcbloop, any `d.pcb`, `necSupported` false, no feed) must return `null` from `solveField`, not throw; the toggle is disabled with "Wire antennas only (MoM)". Test in Task 2.
3. A field that is all zero (or a degenerate plane) must not divide by zero in normalisation: `fieldScale` returns 1 then. Test in Task 2.
4. Rapid view changes / dragging: a result for an old plane must never be drawn on the new view (wavefronts misaligned with wires). The hook returns the request key; the layer hides on mismatch. Test the pure `planeKey` in Task 4; manual drag check in Task 5.
5. SVG export while Radiation is on must keep its background (the bg rect is made transparent on screen). Handled in Task 4 `svgText`; manual check in Task 5.

---

### Task 1: Current elements and segment currents from the MoM solution

**Files:**
- Modify: `src/lib/mom.ts` (export `Seg`; add `CurrentElement`, `currentElements`, `segCurrents`; `gainFn` uses `currentElements`)
- Test: `src/lib/nearfield.test.ts` (new; Task 2 extends it)

**Interfaces:**
- Produces:
  ```ts
  export interface Seg { p: Vec3; q: Vec3; mid: Vec3; L: number; r: number }   // now exported
  export interface CurrentElement { dl: Vec3; mid: Vec3; cr: number; ci: number; r: number }
  export function currentElements(sol: Solution): CurrentElement[]
  /** Complex current at each segment midpoint, positive along p → q. */
  export function segCurrents(sol: Solution): { ir: Float64Array; ii: Float64Array }
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/nearfield.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { buildMesh, currentElements, gainFn, segCurrents, solve } from "./mom";
import { wavelength } from "./rf";

const solved = (id: string, extra = {}) => {
  const def = ANTENNA_BY_ID[id];
  const d = def.build({ ...def.defaults, ...extra });
  const m = buildMesh(d, wavelength(d.f), 60, 450)!;
  return { d, s: solve(m, d.f)! };
};

describe("MoM currents", () => {
  it("segment currents of a centre-fed dipole: peak at the feed = 1/Z, symmetric, small at the ends", () => {
    const { s } = solved("dipole");
    const { ir, ii } = segCurrents(s);
    const n = s.mesh.segs.length;
    const mag = Array.from(ir, (r, i) => Math.hypot(r, ii[i]));
    const iin = 1 / Math.hypot(s.z[0], s.z[1]);
    // the two segments next to the centre node carry the feed current (pulse basis: half of each)
    expect(Math.max(mag[n / 2 - 1], mag[n / 2])).toBeGreaterThan(0.85 * iin);
    for (let i = 0; i < n / 2; i++) expect(mag[i]).toBeCloseTo(mag[n - 1 - i], 6);
    expect(mag[0]).toBeLessThan(0.3 * iin);
  });
  it("currentElements: two per unknown, and gainFn still gives the dipole 2.15 dBi", () => {
    const { s } = solved("dipole");
    expect(currentElements(s).length).toBe(2 * s.mesh.unknowns.length);
    expect(gainFn(s)(Math.PI / 2, 0)).toBeCloseTo(2.15, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/nearfield.test.ts`
Expected: FAIL, `currentElements` / `segCurrents` not exported.

- [ ] **Step 3: Implement**

In `src/lib/mom.ts`: change `interface Seg` to `export interface Seg`. Add after `solve()` and use in `gainFn`:
```ts
/** A current element: one half-segment of a path unknown (direction and length dl, midpoint, current, wire radius). */
export interface CurrentElement { dl: Vec3; mid: Vec3; cr: number; ci: number; r: number }

/** The solved currents as short elements, exactly the basis `gainFn` integrates. */
export function currentElements(sol: Solution): CurrentElement[] {
  const { mesh, ir, ii } = sol;
  const el: CurrentElement[] = [];
  mesh.unknowns.forEach((u, i) => {
    for (const h of [u.h1, u.h2]) el.push({ dl: sub(h.to, h.from), mid: scale(add(h.from, h.to), 0.5), cr: ir[i], ci: ii[i], r: mesh.segs[h.seg].r });
  });
  return el;
}

/** Complex current at each segment midpoint, positive along p → q: the mean of its two half-segments' currents. */
export function segCurrents(sol: Solution): { ir: Float64Array; ii: Float64Array } {
  const { mesh, ir, ii } = sol;
  const n = mesh.segs.length;
  const or = new Float64Array(n), oi = new Float64Array(n);
  mesh.unknowns.forEach((u, i) => {
    for (const h of [u.h1, u.h2]) {
      const s = mesh.segs[h.seg];
      const d = sub(h.to, h.from), a = sub(s.q, s.p);
      const sign = d[0] * a[0] + d[1] * a[1] + d[2] * a[2] >= 0 ? 1 : -1;
      or[h.seg] += (sign * ir[i]) / 2;
      oi[h.seg] += (sign * ii[i]) / 2;
    }
  });
  return { ir: or, ii: oi };
}
```
In `gainFn`, replace the local `el` construction (the `mesh.unknowns.forEach` block and its `const el` declaration) with `const el = currentElements(sol);` and drop `mesh, ir, ii` from its destructuring if unused (keep `f`).

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/nearfield.test.ts src/lib/simulate.test.ts`
Expected: PASS (simulate tests prove `gainFn` is unchanged).

- [ ] **Step 5: Commit**
```bash
git add src/lib/mom.ts src/lib/nearfield.test.ts
git commit -m "MoM: expose current elements and segment currents"
```

---

### Task 2: Near field on a plane, eligibility, and pure frame shading

**Files:**
- Create: `src/lib/nearfield.ts`
- Modify: `src/lib/simulate.ts` (add `momEligible`)
- Test: `src/lib/nearfield.test.ts`

**Interfaces:**
- Consumes: `currentElements`, `segCurrents`, `Seg`, `buildMesh`, `solve` (Task 1).
- Produces:
  ```ts
  // simulate.ts
  export function momEligible(defId: string, d: Design): boolean
  // nearfield.ts
  export interface FieldPlane { origin: Vec3; u: Vec3; v: Vec3; w: number; h: number; nx: number; ny: number; ref: Vec3 }
  export interface FieldGrid { nx: number; ny: number; e: Float32Array /* 6 per pixel: ExR ExI EyR EyI EzR EzI */; r: Float32Array }
  export interface RadiationField { f: number; grid: FieldGrid; segs: Float64Array /* 6 per seg: p, q */; ir: Float64Array; ii: Float64Array }
  export function fieldAt(els: CurrentElement[], k: number, pt: Vec3, out: Float64Array /* length 6 */): void
  export function nearField(els: CurrentElement[], f: number, plane: FieldPlane): FieldGrid
  export function solveField(defId: string, d: Design, plane: FieldPlane): RadiationField | null
  export function envelope(e: Float32Array, p: number): number          // peak |Re(E e^{jφ})| over φ at pixel p
  export function fieldScale(grid: FieldGrid): number                   // 99th pct of envelope·r, 1 if 0
  export function rampLUT(lo: RGB, mid: RGB, hi: RGB): Uint8ClampedArray // 256 × RGBA
  export type RGB = [number, number, number]
  export function shade(grid: FieldGrid, phase: number | null, scale: number, lut: Uint8ClampedArray, out: Uint8ClampedArray): void
  ```
  `FieldPlane`: pixel (i, j) centre is `origin + u·(i+0.5)·w/nx + v·(j+0.5)·h/ny` (u, v unit vectors; j grows downward on screen); `ref` is the point r is measured from (the feed). `phase: null` draws the envelope (reduced motion).

- [ ] **Step 1: Write the failing tests** (append to `src/lib/nearfield.test.ts`)

```ts
import { envelope, fieldAt, fieldScale, nearField, rampLUT, shade, solveField, type FieldPlane } from "./nearfield";
import { momEligible } from "./simulate";
import type { CurrentElement } from "./mom";

const C0 = 299792458, ETA = 376.730313668;

/** Analytic Hertzian dipole I·dl along z at the origin (e^{−jkr}): [Er, Eθ] complex. */
function hertz(Idl: number, k: number, r: number, th: number) {
  const C = (ETA * Idl) / (4 * Math.PI);
  const kr = k * r, c = Math.cos(-kr), s = Math.sin(-kr);
  const mul = (a: number, b: number): [number, number] => [a * c - b * s, a * s + b * c];
  // Er = C·2cosθ/r²·(1 + 1/(jkr)) = C·2cosθ/r²·(1 − j/kr)
  const er = mul((C * 2 * Math.cos(th)) / (r * r), (-C * 2 * Math.cos(th)) / (r * r * kr));
  // Eθ = C·jk sinθ/r·(1 + 1/(jkr) − 1/(kr)²) = C sinθ/r²·(1) + j·C sinθ·(k/r − 1/(k r³))
  const et = mul((C * Math.sin(th)) / (r * r), C * Math.sin(th) * (k / r - 1 / (k * r * r * r)));
  return { er, et };
}

describe("near field", () => {
  const f = 100e6, k = (2 * Math.PI * f) / C0, lam = C0 / f;
  const el: CurrentElement[] = [{ dl: [0, 0, 1e-3], mid: [0, 0, 0], cr: 1, ci: 0, r: 1e-5 }];
  for (const [r, th] of [[0.1 * lam, Math.PI / 2], [0.1 * lam, Math.PI / 4], [5 * lam, Math.PI / 2], [5 * lam, Math.PI / 4]]) {
    it(`short element matches the Hertzian dipole at r = ${(r / lam).toFixed(1)} λ, θ = ${Math.round((th * 180) / Math.PI)}°`, () => {
      const pt: [number, number, number] = [r * Math.sin(th), 0, r * Math.cos(th)];
      const out = new Float64Array(6);
      fieldAt(el, k, pt, out);
      const { er, et } = hertz(1e-3, k, r, th);
      // x̂ = r̂ sinθ + θ̂ cosθ, ẑ = r̂ cosθ − θ̂ sinθ (φ = 0)
      const ex = [er[0] * Math.sin(th) + et[0] * Math.cos(th), er[1] * Math.sin(th) + et[1] * Math.cos(th)];
      const ez = [er[0] * Math.cos(th) - et[0] * Math.sin(th), er[1] * Math.cos(th) - et[1] * Math.sin(th)];
      const scaleE = Math.hypot(ex[0], ex[1], ez[0], ez[1]);
      for (const [got, want] of [[out[0], ex[0]], [out[1], ex[1]], [out[4], ez[0]], [out[5], ez[1]]])
        expect(Math.abs(got - want)).toBeLessThan(0.01 * scaleE);
      expect(Math.abs(out[2]) + Math.abs(out[3])).toBeLessThan(1e-9 * scaleE);
    });
  }

  it("never returns NaN/Infinity, even on the element itself", () => {
    const out = new Float64Array(6);
    fieldAt(el, k, [0, 0, 0], out);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
  });

  const planeXY = (d: { f: number }, half: number, n = 41): FieldPlane => ({
    origin: [-half, half, 0], u: [1, 0, 0], v: [0, -1, 0], w: 2 * half, h: 2 * half, nx: n, ny: n, ref: [0, 0, 0],
  });

  it("half-wave dipole: field symmetric about the dipole's centre plane; far |E|·r matches gainFn", () => {
    const { d, s } = solved("dipole");
    const lam0 = C0 / d.f;
    const g = nearField(currentElements(s), d.f, planeXY(d, lam0, 41));
    expect(Array.from(g.e).every(Number.isFinite)).toBe(true);
    // dipole along y: mirror y → −y is row j ↔ ny−1−j
    const at = (i: number, j: number) => envelope(g.e, j * g.nx + i);
    for (const [i, j] of [[5, 3], [30, 10], [20, 15]]) expect(at(i, j)).toBeCloseTo(at(i, g.ny - 1 - j), 3);
    // far field, broadside (+x), r = 30 λ: G = 4π r²|E|² / (2η Pin), Pin = ½ R/|Z|²
    const out = new Float64Array(6), r = 30 * lam0;
    fieldAt(currentElements(s), (2 * Math.PI * d.f) / C0, [r, 0, 0], out);
    const e2 = out.reduce((a, x) => a + x * x, 0);
    const pin = (0.5 * s.z[0]) / (s.z[0] ** 2 + s.z[1] ** 2);
    const gdb = 10 * Math.log10((4 * Math.PI * r * r * e2) / (2 * ETA * pin));
    expect(Math.abs(gdb - gainFn(s)(Math.PI / 2, 0))).toBeLessThan(0.1);
  });

  it("Yagi: |E|·r on a far arc in front exceeds the arc behind", () => {
    const { d, s } = solved("yagi");
    const kk = (2 * Math.PI * d.f) / C0, R = 20 * (C0 / d.f), out = new Float64Array(6);
    const arc = (phi0: number) => {
      let sum = 0;
      for (let a = -20; a <= 20; a += 5) { const p = phi0 + (a * Math.PI) / 180; fieldAt(currentElements(s), kk, [R * Math.cos(p), R * Math.sin(p), 0], out); sum += Math.hypot(...out) * R; }
      return sum;
    };
    expect(arc(0)).toBeGreaterThan(3 * arc(Math.PI)); // gainFn: forward is +x
  });

  it("solveField: wire antennas solve; printed / analytic types return null", () => {
    const def = ANTENNA_BY_ID.dipole, d = def.build(def.defaults);
    const res = solveField("dipole", d, planeXY(d, C0 / d.f, 20))!;
    expect(res.grid.nx).toBe(20);
    expect(res.segs.length).toBe(6 * res.ir.length);
    for (const id of ["patch", "collinear", "pcbloop", "ifa"]) {
      const dd = ANTENNA_BY_ID[id].build(ANTENNA_BY_ID[id].defaults);
      expect(momEligible(id, dd)).toBe(false);
      expect(solveField(id, dd, planeXY(dd, 0.1, 4))).toBeNull();
    }
  });

  it("fieldScale handles an all-zero field; shade writes opaque pixels from the LUT", () => {
    const grid = { nx: 2, ny: 1, e: new Float32Array(12), r: new Float32Array(2) };
    expect(fieldScale(grid)).toBe(1);
    const lut = rampLUT([0, 0, 0], [128, 64, 0], [255, 255, 200]);
    expect(lut.length).toBe(1024);
    const out = new Uint8ClampedArray(8);
    grid.e[0] = 1; grid.r[0] = 1;
    shade(grid, 0, 1, lut, out);
    expect(Array.from(out.slice(0, 4))).toEqual([255, 255, 200, 255]);
    expect(Array.from(out.slice(4, 8))).toEqual([0, 0, 0, 255]);
    shade(grid, Math.PI / 2, 1, lut, out); // Re(1·e^{jπ/2}) = 0 → background
    expect(out[0]).toBe(0);
    shade(grid, null, 1, lut, out); // envelope ignores phase
    expect(out[0]).toBe(255);
  });
});
```
(The `hertz` helper derives from Er = ηI dl cosθ/(2πr²)·(1 + 1/(jkr))·e^{−jkr} and Eθ = jηk I dl sinθ/(4πr)·(1 + 1/(jkr) − 1/(kr)²)·e^{−jkr}.)

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/nearfield.test.ts`
Expected: FAIL, module `./nearfield` not found.

- [ ] **Step 3: Implement**

In `src/lib/simulate.ts`, add above `simulate()` (keep `simulate()` itself unchanged):
```ts
/** True when the wire MoM solver models this design (the `method: "mom"` path of simulate()). */
export function momEligible(defId: string, d: Design): boolean {
  return defId !== "patch" && defId !== "collinear" && defId !== "pcbloop" && !d.pcb && !!d.necSupported && !!d.feed;
}
```
(`Design` is already imported in simulate.ts; if not, add it to the `./types` import.)

Create `src/lib/nearfield.ts`:
```ts
// Near field of the MoM currents on a plane, for the Preview's radiation view. Each current element
// (a half-segment, the same basis gainFn integrates) is a short electric dipole I·dl with its full field:
//   E = η I dl e^{−jkr}/(4π) · [ r̂(r̂·p̂)(a + b) − p̂ b ],  a = 2/r² − 2j/(k r³),  b = jk/r + 1/r² − j/(k r³)
// (from Er = η I dl cosθ/(2πr²)(1 + 1/(jkr)) and Eθ = jηk I dl sinθ/(4πr)(1 + 1/(jkr) − 1/(kr)²), θ̂ sinθ = r̂(r̂·p̂) − p̂).
// Also the pure per-frame shading, so the UI only blits pixels.
import type { Design, Vec3 } from "./types";
import { buildMesh, currentElements, segCurrents, solve, type CurrentElement } from "./mom";
import { momEligible } from "./simulate";
import { wavelength } from "./rf";

const C0 = 299792458;
const ETA0 = 4e-7 * Math.PI * C0;

/** Pixel (i, j) centre = origin + u·(i+½)·w/nx + v·(j+½)·h/ny; u, v unit vectors (v points down the screen). r is measured from ref. */
export interface FieldPlane { origin: Vec3; u: Vec3; v: Vec3; w: number; h: number; nx: number; ny: number; ref: Vec3 }
/** e: 6 floats per pixel (ExR ExI EyR EyI EzR EzI, V/m for a 1 V source); r: distance from the plane's ref. */
export interface FieldGrid { nx: number; ny: number; e: Float32Array; r: Float32Array }
/** segs: 6 floats per MoM segment (p, q); ir/ii: segment midpoint currents along p → q. */
export interface RadiationField { f: number; grid: FieldGrid; segs: Float64Array; ir: Float64Array; ii: Float64Array }
export type RGB = [number, number, number];

/** Total E (complex, 3 components) at pt into out = [ExR, ExI, EyR, EyI, EzR, EzI]. */
export function fieldAt(els: CurrentElement[], k: number, pt: Vec3, out: Float64Array): void {
  out.fill(0);
  for (const el of els) {
    const L = Math.hypot(el.dl[0], el.dl[1], el.dl[2]);
    if (L === 0) continue;
    const px = el.dl[0] / L, py = el.dl[1] / L, pz = el.dl[2] / L;
    let dx = pt[0] - el.mid[0], dy = pt[1] - el.mid[1], dz = pt[2] - el.mid[2];
    let r = Math.hypot(dx, dy, dz);
    const rmin = Math.max(el.r, L);
    if (r < rmin) {
      // Inside the element's own reach: evaluate at rmin, broadside if exactly on it (no singularity).
      if (r < 1e-12 * rmin) { const t = Math.abs(px) < 0.9 ? [1, 0, 0] : [0, 1, 0]; dx = t[1] * pz - t[2] * py; dy = t[2] * px - t[0] * pz; dz = t[0] * py - t[1] * px; r = Math.hypot(dx, dy, dz); }
      const s = rmin / r; dx *= s; dy *= s; dz *= s; r = rmin;
    }
    const rx = dx / r, ry = dy / r, rz = dz / r, rp = rx * px + ry * py + rz * pz;
    const kr = k * r, r2 = r * r, r3 = r2 * r;
    const ar = 2 / r2, ai = -2 / (k * r3);
    const br = 1 / r2, bi = k / r - 1 / (k * r3);
    // C = η I L e^{−jkr} / 4π
    const m = (ETA0 * L) / (4 * Math.PI), c = Math.cos(kr), s = -Math.sin(kr);
    const Cr = m * (el.cr * c - el.ci * s), Ci = m * (el.cr * s + el.ci * c);
    // radial coefficient (a + b)·rp, axial coefficient −b; each times C
    const sr = (ar + br) * rp, si = (ai + bi) * rp;
    const Rr = Cr * sr - Ci * si, Ri = Cr * si + Ci * sr;
    const Pr = -(Cr * br - Ci * bi), Pi = -(Cr * bi + Ci * br);
    out[0] += Rr * rx + Pr * px; out[1] += Ri * rx + Pi * px;
    out[2] += Rr * ry + Pr * py; out[3] += Ri * ry + Pi * py;
    out[4] += Rr * rz + Pr * pz; out[5] += Ri * rz + Pi * pz;
  }
}

export function nearField(els: CurrentElement[], f: number, plane: FieldPlane): FieldGrid {
  const { origin: o, u, v, w, h, nx, ny, ref } = plane;
  const k = (2 * Math.PI * f) / C0;
  const e = new Float32Array(6 * nx * ny), rr = new Float32Array(nx * ny), out = new Float64Array(6);
  for (let j = 0; j < ny; j++)
    for (let i = 0; i < nx; i++) {
      const a = ((i + 0.5) * w) / nx, b = ((j + 0.5) * h) / ny;
      const pt: Vec3 = [o[0] + u[0] * a + v[0] * b, o[1] + u[1] * a + v[1] * b, o[2] + u[2] * a + v[2] * b];
      fieldAt(els, k, pt, out);
      const p = j * nx + i;
      e.set(out, 6 * p);
      rr[p] = Math.hypot(pt[0] - ref[0], pt[1] - ref[1], pt[2] - ref[2]);
    }
  return { nx, ny, e, r: rr };
}

/** Solve the design at d.f and sample its near field on the plane; null when the wire solver can't model it. */
export function solveField(defId: string, d: Design, plane: FieldPlane): RadiationField | null {
  if (!momEligible(defId, d)) return null;
  const m = buildMesh(d, wavelength(d.f), 60, 450);
  const s = m && solve(m, d.f);
  if (!s) return null;
  const segs = new Float64Array(6 * s.mesh.segs.length);
  s.mesh.segs.forEach((g, i) => segs.set([...g.p, ...g.q], 6 * i));
  const { ir, ii } = segCurrents(s);
  return { f: d.f, grid: nearField(currentElements(s), d.f, plane), segs, ir, ii };
}

/** Peak over φ of |Re(E e^{jφ})| at pixel p (handles elliptical polarisation). */
export function envelope(e: Float32Array, p: number): number {
  let a = 0, b = 0, c = 0;
  for (let q = 0; q < 3; q++) { const re = e[6 * p + 2 * q], im = e[6 * p + 2 * q + 1]; a += re * re; b += im * im; c += re * im; }
  return Math.sqrt((a + b) / 2 + Math.sqrt(((a - b) / 2) ** 2 + c * c));
}

/** 99th percentile of envelope·r over the grid; 1 for an all-zero field. */
export function fieldScale(grid: FieldGrid): number {
  const n = grid.nx * grid.ny, v = new Float32Array(n);
  for (let p = 0; p < n; p++) v[p] = envelope(grid.e, p) * grid.r[p];
  v.sort();
  const s = v[Math.min(n - 1, Math.floor(0.99 * n))];
  return s > 0 && Number.isFinite(s) ? s : 1;
}

/** 256-entry RGBA ramp lo → mid → hi. */
export function rampLUT(lo: RGB, mid: RGB, hi: RGB): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(1024);
  for (let i = 0; i < 256; i++) {
    const t = i / 255, [x, y, s] = t < 0.5 ? [lo, mid, t * 2] : [mid, hi, t * 2 - 1];
    for (let c = 0; c < 3; c++) lut[4 * i + c] = Math.round(x[c] + (y[c] - x[c]) * s);
    lut[4 * i + 3] = 255;
  }
  return lut;
}

const GAMMA = 0.6;

/** RGBA pixels for |Re(E e^{jφ})|·r / scale (phase null: the envelope), through the LUT. */
export function shade(grid: FieldGrid, phase: number | null, scale: number, lut: Uint8ClampedArray, out: Uint8ClampedArray): void {
  const { e, r } = grid, n = grid.nx * grid.ny;
  const c = phase == null ? 0 : Math.cos(phase), s = phase == null ? 0 : Math.sin(phase);
  for (let p = 0; p < n; p++) {
    let m: number;
    if (phase == null) m = envelope(e, p);
    else {
      const x = e[6 * p] * c - e[6 * p + 1] * s, y = e[6 * p + 2] * c - e[6 * p + 3] * s, z = e[6 * p + 4] * c - e[6 * p + 5] * s;
      m = Math.sqrt(x * x + y * y + z * z);
    }
    const t = Math.min(1, (m * r[p]) / scale);
    const i = 4 * Math.round(255 * t ** GAMMA);
    out[4 * p] = lut[i]; out[4 * p + 1] = lut[i + 1]; out[4 * p + 2] = lut[i + 2]; out[4 * p + 3] = 255;
  }
}
```

Note the circular-import risk: `nearfield.ts` imports `simulate.ts`, which must not import `nearfield.ts`. Keep it one-way.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/nearfield.test.ts`
Expected: PASS. If the Hertzian test fails on sign only (all values negated), recheck `s = -Math.sin(kr)` (e^{−jkr}); if far |E| vs gainFn is off by exactly 2× in power, recheck the `m` prefactor against `kU` in `gainFn` before touching the test.

- [ ] **Step 5: Run the whole suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**
```bash
git add src/lib/nearfield.ts src/lib/nearfield.test.ts src/lib/simulate.ts
git commit -m "Near field of the MoM currents on a plane, with frame shading"
```

---

### Task 3: Worker request and `useNearField` hook

**Files:**
- Modify: `src/sim.worker.ts`
- Create: `src/useNearField.ts`

**Interfaces:**
- Consumes: `solveField`, `FieldPlane`, `RadiationField` (Task 2).
- Produces:
  ```ts
  // sim.worker.ts
  export interface FieldRequest { id: number; field: { type: string; params: Params; plane: FieldPlane }; synth?: undefined }
  // useNearField.ts
  export type FieldState =
    | { status: "idle" | "running"; key: string | null; data: RadiationField | null; error?: undefined }
    | { status: "done"; key: string; data: RadiationField | null; error?: undefined }   // data null = not modelled
    | { status: "error"; key: string | null; data: null; error: string };
  export function useNearField(type: string, params: Params, plane: FieldPlane | null, enabled: boolean): FieldState
  ```
  `key` is `JSON.stringify([type, params, plane])` of the request the data belongs to; Preview compares it with the current key.

- [ ] **Step 1: Extend the worker**

In `src/sim.worker.ts` add the import `import { solveField, type FieldPlane } from "./lib/nearfield";`, the `FieldRequest` interface above, widen the handler type to `MessageEvent<SimRequest | SynthRequest | FieldRequest>`, and add at the top of `onmessage`:
```ts
  if ("field" in e.data && e.data.field) {
    const { id, field } = e.data;
    try {
      const d = ANTENNA_BY_ID[field.type].build(field.params);
      const data = solveField(field.type, d, field.plane);
      const transfer = data ? [data.grid.e.buffer, data.grid.r.buffer, data.segs.buffer, data.ir.buffer, data.ii.buffer] : [];
      (self as unknown as Worker).postMessage({ id, field: data }, transfer);
    } catch (err) {
      postMessage({ id, error: String(err) });
    }
    return;
  }
```
Add `field?: undefined` to `SimRequest` and `SynthRequest` so the union narrows.

- [ ] **Step 2: Create the hook** `src/useNearField.ts`:
```ts
import { useEffect, useRef, useState } from "react";
import type { Params } from "./lib/types";
import type { FieldPlane, RadiationField } from "./lib/nearfield";

export type FieldState =
  | { status: "idle" | "running"; key: string | null; data: RadiationField | null; error?: undefined }
  | { status: "done"; key: string; data: RadiationField | null; error?: undefined }
  | { status: "error"; key: string | null; data: null; error: string };

/** Debounced near-field solve in its own worker; a new request terminates a running one; stale replies are dropped. */
export function useNearField(type: string, params: Params, plane: FieldPlane | null, enabled: boolean): FieldState {
  const [state, setState] = useState<FieldState>({ status: "idle", key: null, data: null });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const key = JSON.stringify([type, params, plane]);

  useEffect(() => {
    if (!enabled || !plane) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      if (busy.current && worker.current) { worker.current.terminate(); worker.current = null; }
      if (!worker.current) worker.current = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
      const w = worker.current;
      busy.current = true;
      setState((s) => ({ status: "running", key: s.key, data: s.data }));
      w.onmessage = (e: MessageEvent<{ id: number; field?: RadiationField | null; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        busy.current = false;
        if (e.data.error) setState({ status: "error", key, data: null, error: e.data.error });
        else setState({ status: "done", key, data: e.data.field ?? null });
      };
      w.postMessage({ id, field: { type, params, plane } });
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => () => worker.current?.terminate(), []);
  return state;
}
```

- [ ] **Step 3: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**
```bash
git add src/sim.worker.ts src/useNearField.ts
git commit -m "Near-field requests in the sim worker; useNearField hook"
```

---

### Task 4: Radiation toggle, plane from the camera, animated canvas layer

**Files:**
- Modify: `src/components/Preview.tsx`, `src/App.tsx:69`, `src/components/Exports.tsx` (`svgText`), `src/index.css`, `src/i18n/uk.ts`
- Create: `src/components/RadiationLayer.tsx`, `src/components/plane.ts`
- Test: `src/components/plane.test.ts`

**Interfaces:**
- Consumes: `useNearField`, `FieldState` (Task 3); `fieldScale`, `rampLUT`, `shade`, `RGB`, `RadiationField`, `FieldPlane` (Task 2); `momEligible` (Task 2).
- Produces:
  ```ts
  // plane.ts (pure, no React)
  export function cameraBasis(yawDeg: number, pitchDeg: number): { right: Vec3; down: Vec3; depth: Vec3 }
  export function screenPlane(yawDeg: number, pitchDeg: number, view: { ox: number; oy: number; k: number; W: number; H: number }, ref: Vec3, nx: number): FieldPlane
  // RadiationLayer.tsx
  export function RadiationLayer(props: { data: RadiationField; toScreen: (q: Vec3) => [number, number]; W: number; H: number; theme: string; playing: boolean }): JSX.Element
  ```

- [ ] **Step 1: Write the failing test** `src/components/plane.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { cameraBasis, screenPlane } from "./plane";

describe("screen plane", () => {
  it("basis is orthonormal and matches Preview's camera for the top view (x right, y up)", () => {
    const { right, down, depth } = cameraBasis(90, 90);
    expect(right[0]).toBeCloseTo(1); expect(down[1]).toBeCloseTo(-1); expect(depth[2]).toBeCloseTo(-1);
    for (const [yaw, pitch] of [[120, 25], [180, 0], [37, -60]]) {
      const b = cameraBasis(yaw, pitch);
      const dot = (a: number[], c: number[]) => a[0] * c[0] + a[1] * c[1] + a[2] * c[2];
      expect(dot(b.right, b.down)).toBeCloseTo(0); expect(dot(b.right, b.depth)).toBeCloseTo(0); expect(dot(b.down, b.depth)).toBeCloseTo(0);
      expect(dot(b.right, b.right)).toBeCloseTo(1); expect(dot(b.down, b.down)).toBeCloseTo(1);
    }
  });
  it("plane covers the view box and passes through the reference point's depth", () => {
    const ref: [number, number, number] = [0.1, 0.2, 0.3];
    const p = screenPlane(120, 25, { ox: 400, oy: 270, k: 1000, W: 800, H: 540 }, ref, 200);
    expect(p.w).toBeCloseTo(0.8); expect(p.h).toBeCloseTo(0.54);
    expect(p.nx).toBe(200); expect(p.ny).toBe(135);
    const { depth } = cameraBasis(120, 25);
    const dd = (q: number[]) => q[0] * depth[0] + q[1] * depth[1] + q[2] * depth[2];
    expect(dd(p.origin)).toBeCloseTo(dd(ref));
    // the SVG centre (400, 270) maps to screen coords (0, 0): origin + u·0.4 + v·0.27 has zero right/down components
    const c = [0, 1, 2].map((i) => p.origin[i] + p.u[i] * 0.4 + p.v[i] * 0.27);
    const { right } = cameraBasis(120, 25);
    expect(c[0] * right[0] + c[1] * right[1] + c[2] * right[2]).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/plane.test.ts` → FAIL (no module).

- [ ] **Step 3: Implement `src/components/plane.ts`**
```ts
// The Preview's orthographic camera as a world basis, and the field plane that fills its view box.
import type { Vec3 } from "../lib/types";
import type { FieldPlane } from "../lib/nearfield";

/** Rows of Preview's camera(): screen x = q·right, screen y (down) = q·down, depth = q·depth. */
export function cameraBasis(yawDeg: number, pitchDeg: number): { right: Vec3; down: Vec3; depth: Vec3 } {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  return { right: [sy, -cy, 0], down: [-sp * cy, -sp * sy, -cp], depth: [cp * cy, cp * sy, -sp] };
}

/** The plane through ref's depth covering the SVG box: SVG (x, y) = (ox + sx·k, oy + sy·k), sx/sy in metres. */
export function screenPlane(yawDeg: number, pitchDeg: number, view: { ox: number; oy: number; k: number; W: number; H: number }, ref: Vec3, nx: number): FieldPlane {
  const { right, down, depth } = cameraBasis(yawDeg, pitchDeg);
  const { ox, oy, k, W, H } = view;
  const sx = -ox / k, sy = -oy / k;
  const dz = ref[0] * depth[0] + ref[1] * depth[1] + ref[2] * depth[2];
  const origin: Vec3 = [0, 1, 2].map((i) => right[i] * sx + down[i] * sy + depth[i] * dz) as Vec3;
  return { origin, u: right, v: down, w: W / k, h: H / k, nx, ny: Math.round((nx * H) / W), ref };
}
```
Then make `camera()` in Preview.tsx use it (same numbers, one source of truth):
```ts
function camera(yawDeg: number, pitchDeg: number) {
  const { right, down, depth } = cameraBasis(yawDeg, pitchDeg);
  const dot = (a: Vec3, q: Vec3) => a[0] * q[0] + a[1] * q[1] + a[2] * q[2];
  return (q: Vec3): [number, number, number] => [dot(right, q), dot(down, q), dot(depth, q)];
}
```

- [ ] **Step 4: Run plane tests and the suite**

Run: `npx vitest run src/components/plane.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Create `src/components/RadiationLayer.tsx`**
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec3 } from "../lib/types";
import { fieldScale, rampLUT, shade, type RadiationField, type RGB } from "../lib/nearfield";

const PERIOD = 1500; // ms per RF cycle

function token(name: string): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Animated near field (canvas, under the SVG) with the wires' current glow. */
export function RadiationLayer({ data, toScreen, W, H, theme, playing }: { data: RadiationField; toScreen: (q: Vec3) => [number, number]; W: number; H: number; theme: string; playing: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scheme, setScheme] = useState(0);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setScheme((n) => n + 1);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colours = useMemo(() => ({ lut: rampLUT(token("--field-lo"), token("--field-mid"), token("--field-hi")), glow: token("--field-hi") }), [theme, scheme]);
  const scale = useMemo(() => fieldScale(data.grid), [data]);
  const segs = useMemo(() => {
    const n = data.ir.length, out: { a: [number, number]; b: [number, number] }[] = [];
    for (let i = 0; i < n; i++) out.push({ a: toScreen([data.segs[6 * i], data.segs[6 * i + 1], data.segs[6 * i + 2]]), b: toScreen([data.segs[6 * i + 3], data.segs[6 * i + 4], data.segs[6 * i + 5]]) });
    const imax = Math.max(1e-30, ...Array.from(data.ir, (r, i) => Math.hypot(r, data.ii[i])));
    return { pts: out, imax };
  }, [data, toScreen]);

  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const { nx, ny } = data.grid;
    const off = document.createElement("canvas"); off.width = nx; off.height = ny;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(nx, ny);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const phase = playing && !reduced ? (2 * Math.PI * (now - t0)) / PERIOD : null;
      shade(data.grid, phase, scale, colours.lut, img.data);
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
      const c = phase == null ? 0 : Math.cos(phase), s = phase == null ? 0 : Math.sin(phase);
      const [r, g, b] = colours.glow;
      ctx.lineCap = "round"; ctx.shadowColor = `rgb(${r},${g},${b})`; ctx.shadowBlur = 14; ctx.strokeStyle = `rgb(${r},${g},${b})`;
      segs.pts.forEach(({ a, b: q }, i) => {
        const ir = data.ir[i], ii = data.ii[i];
        const m = phase == null ? Math.hypot(ir, ii) : Math.abs(ir * c - ii * s);
        ctx.globalAlpha = Math.min(1, m / segs.imax);
        ctx.lineWidth = 8;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      });
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (phase != null && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const onVis = () => { if (!document.hidden && playing && !reduced) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); };
  }, [data, scale, colours, segs, playing, W, H]);

  return <canvas ref={canvas} width={W} height={H} className="radiation-canvas" aria-hidden="true" />;
}
```
With the e^{−jkr} convention, `phase = +ωt` makes the wavefronts move outward; Task 5 checks it in the browser (if they move inward, the sign is wrong in `fieldAt`, not here: recheck the Hertzian test).

- [ ] **Step 6: Wire it into Preview**

`src/App.tsx:69`: `<Preview design={design} svgRef={svgRef} type={type} params={params} />`.

`src/components/Preview.tsx`:
- Props: `{ design, svgRef, type, params }: { design: Design; svgRef: …; type: string; params: Params }` (import `Params` from `../lib/types`).
- Imports: `useState`, `cameraBasis`, `screenPlane` from `./plane`, `RadiationLayer` from `./RadiationLayer`, `useNearField` from `../useNearField`, `momEligible` from `../lib/simulate`.
- Return `ox, oy` from the scene memo too: `return { pw, pp, S, k, P, ox, oy, fp: … , fpw: fp }` where `fpw` is the world feed point (fallback: centroid of the drawn wire ends).
- State and plane:
```tsx
  const [radiation, setRadiation] = useState(false);
  const [playing, setPlaying] = useState(true);
  const dragging = useRef(false);
  const theme = useStore((s) => s.theme);
  const eligible = momEligible(type, design);
  const on = radiation && eligible;
  const plane = useMemo(() => (on ? screenPlane(cy, cp, { ox, oy, k, W, H }, fpw, 200) : null), [on, cy, cp, ox, oy, k, fpw]);
  const field = useNearField(type, params, plane, on);
  const fieldKey = JSON.stringify([type, params, plane]);
  const fresh = field.status === "done" && field.key === fieldKey && field.data;
  const toScreen = useCallback((q: Vec3) => { const p = P(q); return S(p[0], p[1]); }, [P, S]);
```
- Tools bar: after the `Select`, add
```tsx
        <button className={on ? "on" : ""} aria-pressed={on} disabled={!eligible} title={eligible ? undefined : t("Wire antennas only (MoM)")} onClick={() => setRadiation((r) => !r)}>{t("Radiation")}</button>
        {on && <button onClick={() => setPlaying((p) => !p)}>{playing ? t("Pause") : t("Play")}</button>}
```
- Before `<svg>`: `{on && fresh && <RadiationLayer data={field.data!} toScreen={toScreen} W={W} H={H} theme={theme} playing={playing} />}`
- bg rect: `className={on && fresh ? "svg-bg clear" : "svg-bg"}`.
- After `</svg>`, the legend:
```tsx
      {on && (
        <div className="radiation-legend">
          {field.status === "running" || (field.status === "done" && field.key !== fieldKey) ? <span>{t("Computing field…")}</span>
            : field.status === "error" ? <span>{field.error}</span>
            : field.status === "done" && !field.data ? <span>{t("Wire antennas only (MoM)")}</span>
            : <><span className="ramp" /> {t("Electric field (instantaneous, × distance)")} <span className="glow" /> {t("Current on the wire")}</>}
        </div>
      )}
```
(`dragging` is not needed: the plane key changes on every drag move, so `fresh` is false and the layer hides until the debounced result for the final view arrives. Remove the `dragging` line.)

- [ ] **Step 7: CSS** (`src/index.css`)

Light tokens in `:root` (next to `--series-1`): `--field-lo: #eef3ef; --field-mid: #e08a1e; --field-hi: #7a2e0b;`
Dark, in both the media-query block and `:root[data-theme="dark"]`: `--field-lo: #0b3a2b; --field-mid: #d97706; --field-hi: #fde7a8;`
Rules near `.preview`:
```css
.radiation-canvas { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.preview svg { position: relative; }
.svg-bg.clear { fill: transparent; }
.radiation-legend { position: absolute; left: 8px; top: 8px; display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-2, inherit); background: color-mix(in srgb, var(--chart-bg) 75%, transparent); padding: 2px 6px; border-radius: 4px; }
.radiation-legend .ramp { width: 48px; height: 8px; border-radius: 2px; background: linear-gradient(90deg, var(--field-lo), var(--field-mid), var(--field-hi)); }
.radiation-legend .glow { width: 18px; height: 3px; background: var(--field-hi); box-shadow: 0 0 6px var(--field-hi); }
.preview-tools button.on { outline: 2px solid var(--series-1); }
```
Check the canvas height matches the SVG (`max-height: 62vh` can letterbox the SVG; the SVG keeps aspect via `preserveAspectRatio` default xMidYMid meet). If letterboxing occurs, wrap canvas and svg in `<div className="preview-stage">` with `position: relative; aspect-ratio: 800 / 540; max-height: 62vh; margin: 0 auto;` and size both children to 100%.

- [ ] **Step 8: SVG export keeps its background** (`src/components/Exports.tsx`, `svgText`, after the forEach):
```ts
  const bg = clone.querySelector(".svg-bg") as SVGElement | null;
  if (bg) bg.style.setProperty("fill", getComputedStyle(document.documentElement).getPropertyValue("--chart-bg").trim());
```

- [ ] **Step 9: i18n** (`src/i18n/uk.ts`, near "Antenna drawing"):
```ts
  "Radiation": "Випромінювання",
  "Wire antennas only (MoM)": "Лише дротові антени (MoM)",
  "Electric field (instantaneous, × distance)": "Електричне поле (миттєве, × відстань)",
  "Current on the wire": "Струм у дроті",
  "Play": "Відтворити",
  "Pause": "Пауза",
  "Computing field…": "Обчислення поля…",
```
(If "Play"/"Pause" already exist, don't duplicate them.)

- [ ] **Step 10: Verify**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all PASS / clean (i18n test covers the new keys).

- [ ] **Step 11: Commit**
```bash
git add src/components/plane.ts src/components/plane.test.ts src/components/RadiationLayer.tsx src/components/Preview.tsx src/components/Exports.tsx src/App.tsx src/index.css src/i18n/uk.ts
git commit -m "Preview: Radiation view (animated MoM near field and current glow)"
```

---

### Task 5: Browser check, docs

**Files:**
- Modify: `CLAUDE.md` (Layout), `docs/superpowers/specs/2026-10-10-radiation-view-design.md` (deviations), `docs/ANTENNAS.md` (short "Radiation view" note: formula and test numbers)

- [ ] **Step 1: Run the app and check by eye** (use the `run` skill or `npm run dev`, headless Chromium screenshots)
  - Dipole, top view: standing-wave glow peaked at the feed, wavefronts moving **outward** both sides, nothing along the wire axis far out. If inward, flip the phase sign in `RadiationLayer` (see Task 4 Step 5).
  - Yagi top view: wavefronts strong toward +x (director side), weak behind.
  - Quad, J-pole, Moxon in front/side and 3D; drag-rotate: the field disappears while dragging and returns aligned with the wires.
  - Patch / IFA: button disabled with the tooltip.
  - Theme light/dark/auto: colours follow; Pause freezes; with emulated `prefers-reduced-motion: reduce` the envelope is static.
  - With Radiation on, export the SVG: it has the normal background and no field.
  - Timing: the field arrives within ≈ 1 s for the Yagi; if > 2 s, lower the grid to 160 columns in Preview (`screenPlane(..., 160)`).
- [ ] **Step 2: Docs**
  - `CLAUDE.md` Layout: add `nearfield.ts           near field of the MoM currents on a plane (short-dipole sum), frame shading for the Preview's Radiation view` under `src/lib/`, and `RadiationLayer.tsx / plane.ts` under components.
  - Spec: add a "Deviations" section listing the three from Global Constraints.
  - `docs/ANTENNAS.md`: the field formula and the test checks (Hertzian within 1 %, dipole far field vs gainFn within 0.1 dB).
- [ ] **Step 3: Final verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 4: Commit**
```bash
git add CLAUDE.md docs
git commit -m "Radiation view: docs"
```
