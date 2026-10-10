# Radiation view in Preview: design

## Goal
An animated view of the antenna radiating, in the style of a glowing field plot: wavefronts leave the antenna and
the wires glow with their current. It must be **real physics** (MoM currents and their near field), not an
illustration, so a Yagi visibly beams forward, a reflector cancels behind it, and a dipole shows its standing wave.

## Scope
- Wire antennas that the MoM solver handles: the same eligibility as the `method: "mom"` path in `simulate()`
  (not patch / collinear / pcbloop, no `d.pcb`, `d.necSupported`).
- Other antennas: the toggle is disabled with the note "Wire antennas only (MoM)".
- Out of scope: FDTD plane fields for printed antennas (later: a single-frequency DFT recorder on a slice),
  magnetic field view, ground (free space only, like MoM).

## User-facing behaviour
- Preview gets a **Radiation** toggle (stored in the store, persisted with the other view settings).
- With it on, a field heatmap fills the plot area **behind** the wires; wires are drawn on top with a current glow.
- **Plane:** the screen plane through the feed point (or the wire-set centroid if there is no feed).
  Top / front / side views give those cuts; in free 3D rotation the field is recomputed when dragging stops
  (debounced), so the plane always faces the viewer. While dragging, the stale heatmap is hidden.
- **Frequency:** the design frequency `d.f` (centre of band 1).
- **Field drawn:** `|Re(E·e^{jωt})| · r`, r = distance from the feed point. The `× r` removes the 1/r far-field decay
  so wavefronts stay visible across the view; the legend says so: "Electric field (instantaneous, × distance)".
  Brightness uses a fixed normalisation per field solution (the 99th percentile of the peak envelope), a gamma
  ramp, and colours `--field-lo` (background) → `--field-mid` → `--field-hi`.
- **Wire glow:** each segment is stroked with brightness `|Re(I·e^{jωt})| / max|I|`; legend "Current on the wire".
- **Animation:** `requestAnimationFrame`, one RF cycle per 1.5 s, play/pause button. Stops when the toggle is off,
  the component unmounts or the document is hidden. With `prefers-reduced-motion` it starts paused and shows the
  peak envelope `|E|·r` instead of a moving phase.
- A busy indicator while the worker computes; errors show as a note in the legend area.
- The heatmap is a `<canvas>` under the SVG, so **SVG export is unchanged** (no field in exported files).

## Architecture

### Lib (no DOM)
- `src/lib/mom.ts`: `segCurrents(sol): { segs: Seg[]; ir: Float64Array; ii: Float64Array }`, the complex current at
  each segment midpoint. A segment's current is the sum of the unknowns whose path half-segments cover it
  (each unknown contributes on `h1` and `h2` with its path sign), averaged over the segment's two half-segments,
  following the same basis `gainFn` integrates.
- `src/lib/nearfield.ts` (new):
  ```ts
  interface FieldPlane { origin: Vec3; u: Vec3; v: Vec3; w: number; h: number; nx: number; ny: number }
  interface FieldGrid { nx: number; ny: number; ex: Float32Array; ey: …; ez: … (re/im interleaved); r: Float32Array }
  function nearField(segs, ir, ii, f, plane): FieldGrid
  ```
  Each segment is a short electric dipole I·L along its axis at its midpoint, with the full field
  (1/r, 1/r², 1/r³ terms, e^{−jkr}). Points closer than `max(segment radius, L/2)` to a segment midpoint are
  evaluated at that distance (no singularities). Grid about 200 × 135 (aspect from the view box).

### Worker and hook
- `src/sim.worker.ts`: new request `{ kind: "field", id, type, params, plane }`. It builds the design, meshes with the
  same `buildMesh(d, λ, 60, 450)` as `simulate()`, solves at `d.f`, then returns
  `{ id, field: { grid, segs: [p, q][], ir, ii, f } }` with transferable buffers.
- `src/useNearField.ts` (new): like `useSimulation`: 250 ms debounce, stale ids dropped, a running job terminated by a
  new request, state `idle | running | done | error`. Disabled when the toggle is off or the antenna is ineligible.

### Rendering (`src/components/Preview.tsx`, new `RadiationLayer.tsx`)
- Preview computes the plane from the current camera (screen-right `u`, screen-down `v`, the view box mapped to
  metres) and passes it to the hook; it already knows the projection and scale.
- `RadiationLayer` owns the canvas and the animation loop: per frame, for each pixel,
  `e(t) = |re·cos ωt − im·sin ωt|` over the three components, times `r`, normalised, through a 256-entry colour LUT
  built from the CSS tokens (re-read on theme change), into `ImageData` → `putImageData`, scaled to the plot by CSS.
- Wire glow is SVG strokes on the current segments (MoM segments projected with the same camera), updated per frame.
- New CSS tokens `--field-lo`, `--field-mid`, `--field-hi` in light and dark variants (dark: deep green → orange →
  pale gold, like the reference image; light: a pale background with the same ramp kept legible).

## Strings / i18n
"Radiation", "Wire antennas only (MoM)", "Electric field (instantaneous, × distance)", "Current on the wire",
"Play", "Pause", "Computing field…" in English keys with UK translations (`i18n.test.ts` coverage).

## Testing
- `segCurrents`: on a centre-fed dipole, the feed segment's current equals the source unknown's current; the current
  distribution is symmetric and goes to ≈ 0 at the wire ends.
- `nearField`: a single short segment vs the analytic Hertzian dipole E at r = 0.1 λ and 5 λ (θ = 90° and 45°),
  within 1 %.
- Half-wave dipole: field symmetric about the dipole's centre plane; far-field |E| on broadside matches the gain
  from `gainFn` (|E|·r ∝ √G) within 2 %.
- Yagi (3 elements): mean `|E|·r` over a far arc in front exceeds the arc behind, consistent with the F/B sign.
- i18n coverage test passes; typecheck and lint clean.
- Manual check in the browser: dipole, Yagi, quad, J-pole in top/front/side and 3D; theme switch; reduced motion.

## Performance
One MoM solve (same mesh as the pattern solve) + ≈ 27 k px × ≤ 700 segments of dipole sums in the worker,
≈ 0.1–0.3 s. Per frame on the main thread: 27 k px × 3 complex components, well under 2 ms.
