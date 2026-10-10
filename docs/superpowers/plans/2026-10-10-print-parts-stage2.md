# Printed parts stage 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every wire antenna gets printable STL parts: helix grooved tube and rib frame, discone hub, Moxon and quad
spreader hubs/corner caps/gap insulators, biquad feed standoff, J-pole spacers and tap gauge, fan-dipole centre and
spreaders, collinear radome spacers.

**Architecture:** New family files under `src/lib/print/families/` produce `PartSpec[]` from `Design.wires` (plus a few
print-only params from `p`), registered in `src/lib/print/index.ts` `FAMILIES`. Helix grooves are a 2D "bean" section
extruded with a twist (manifold `extrude(…, twistDegrees)`); tall formers are cut into D-keyed stacked pieces. A
`PartError` lets a family report "Wire too thick for this part" instead of a generic build failure. The UI (PrintPanel,
worker) is unchanged: new parts appear automatically.

**Tech Stack:** TypeScript 6, manifold-3d 3.5.4 (WASM CSG), vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-print-parts-stage2-design.md` (read it with
`docs/superpowers/specs/2026-10-10-print-parts-design.md`, stage 1).

## Global Constraints

- All print geometry in **mm**; lib Design is in metres: convert with `mm()` from `src/lib/print/rules.ts`.
- Fixed rules (`rules.ts`): `CLEAR = 0.3` on every diameter, `WALL = 2`, `INSULATE = 2`, `MAX_SIZE = 180`, M3 holes
  3.4, M3 nut 6.6 × 2.8 deep, zip slot 5.2 × 2.2. New: `SEG_H = 170` (tallest stacked piece before its spigot).
- `src/lib` has no DOM, no React, no i18n: strings are English, exported in `*_STRINGS` / `*_HOWTO` arrays, added to
  `PRINT_STRINGS` in `src/lib/print/index.ts`, and translated in `src/i18n/uk.ts` (key = exact English text, same
  `{0}` placeholders). `src/i18n.test.ts` fails on a missing or stale key.
- Messages with numbers use `msg(s, ...args)` (`parts.ts`); lengths as `{ len: metres }`, angles/counts as bare numbers.
- `erasableSyntaxOnly`: no enums, no parameter properties (class fields declared in the body are fine).
- Geometry comes from `Design.wires` (skip `drawOnly` / `necOnly` wires), never re-derived from antenna formulas.
- Every part must build watertight at every parameter extreme, or fail only with one of:
  `"Too large to print in one piece: {0}"`, `"Wire too thick for this part"`, `"Radome too narrow for the coax"`.
- Commit with plain `git` (never `gh`); end every commit message with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015p6rSX8cufEdbSnXaVZtxo
  ```
- Commands: `npm test` (vitest), `npm run typecheck`, `npm run lint`, `npm run build`. Single file:
  `npx vitest run src/lib/print/families/former.test.ts`.

## Review Focus

1. **LHCP built as RHCP** (twist sign wrong): a user winding an LHCP design must get a left-hand groove. Pinned in
   Task 1 (`twistGroove` hand test) and Task 2 (both hands, clear test on design wire points).
2. **Groove broken at a joint of a segmented former**: restacked pieces must keep every design wire point clear.
   Pinned in Task 2 (the clear test runs on the restacked GPS default, which has 3 pieces).
3. **Tiny 5.8 GHz helix** (R ≈ 6 mm at C/λ = 0.75, 1 mm wire): builds or says "Wire too thick", never a broken
   mesh. Pinned in Task 2.
4. **Fan dipole at HF defaults** (arms many metres): spreaders must sit where the wires fit on the bed, so defaults
   build. Pinned in Task 7.
5. **Moxon tip gap C**: the gap insulator's hole spacing must equal C from the wires exactly (± 0.01 mm). Pinned in
   Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/print/parts.ts` (modify) | `PartError`, new failure strings, `buildPart` reports a `PartError`'s message |
| `src/lib/print/rules.ts` (modify) | `SEG_H` |
| `src/lib/print/shapes.ts` (modify) | `twistGroove`, `dShape`, `stack`, `pieceBottoms`, `toZ` |
| `src/lib/print/families/testkit.ts` (create) | shared test helpers (`setup`, `part`, `inside`, `along`, `ball`) |
| `src/lib/print/families/former.ts` (+ `.test.ts`) | helix tube and frame |
| `src/lib/print/families/hub.ts` (modify) + `discone.test.ts` | discone hub |
| `src/lib/print/families/spreader.ts` (+ `.test.ts`) | Moxon hub/caps/gap insulator, quad hub/caps |
| `src/lib/print/families/standoff.ts` (+ `.test.ts`) | biquad feed standoff |
| `src/lib/print/families/spacer.ts` (+ `.test.ts`) | J-pole spacer and tap gauge, collinear radome spacer |
| `src/lib/print/families/centre.ts` (modify) + `fan.test.ts` | `centreBlock` shared by dipole and fan, fan centre and spreaders |
| `src/lib/antennas/moxon.ts`, `quad.ts`, `collinear.ts` (modify) | print-only params `rod`, `bd`, `rid` |
| `src/lib/print/index.ts` (modify) | register families and strings |
| `src/lib/print/print.test.ts` (modify) | accepted failure messages, every wire antenna has parts |
| `src/i18n/uk.ts` (modify) | Ukrainian for every new string |
| `CLAUDE.md`, `docs/ANTENNAS.md`, stage-1 spec (modify) | docs |

---

### Task 1: PartError and shape helpers

**Files:**
- Modify: `src/lib/print/parts.ts`, `src/lib/print/rules.ts`, `src/lib/print/shapes.ts`, `src/lib/print/print.test.ts`, `src/i18n/uk.ts`
- Create: `src/lib/print/families/testkit.ts`, `src/lib/print/shapes.test.ts`

**Interfaces:**
- Produces:
  - `class PartError extends Error { m: Msg }`, `export const FAIL = { thick: "Wire too thick for this part", radome: "Radome too narrow for the coax" }` in `parts.ts`
  - `SEG_H = 170` in `rules.ts`
  - `twistGroove(M, R: number, d: number, z0: number, z1: number, S: number, hand: 1 | -1): Manifold`
  - `dShape(M, r: number, flat: number): CrossSection`
  - `pieceBottoms(H: number): number[]`
  - `stack(body: Manifold, H: number, joint: (zc: number) => Joint): Manifold[]` with `type Joint = { below: Manifold; aboveAdd?: Manifold; aboveCut?: Manifold }`
  - `toZ(part: Manifold, at: V3, dir: V3): Manifold` (move `at` to the origin and turn `dir` to +z)
  - testkit: `setup(id, extra)`, `part(id, partId, extra)`, `inside(solid, probe)`, `along(M, a, u, s0, s1, d)`, `ball(M, p, d)`

- [ ] **Step 1: Write the failing tests** — create `src/lib/print/shapes.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "./manifold";
import { buildPart, msg, PartError, FAIL, type PartSpec } from "./parts";
import { dShape, pieceBottoms, stack, twistGroove, toZ } from "./shapes";
import { SEG_H } from "./rules";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const ball = (p: [number, number, number], d: number) => M.Manifold.sphere(d / 2, 24).translate(p);

describe("PartError", () => {
  it("buildPart reports the part's own message", () => {
    const spec: PartSpec = { id: "x", title: "x", use: "jig", qty: 1, purpose: msg("x"), howTo: [], build: () => { throw new PartError(msg(FAIL.thick)); } };
    const r = buildPart(M, spec, "x");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.s).toBe(FAIL.thick);
  });
});

describe("twistGroove", () => {
  const R = 30, d = 2, S = 40, z0 = 5;
  const at = (t: number, hand: 1 | -1): [number, number, number] => [R * Math.cos(t), hand * R * Math.sin(t), z0 + (S * t) / (2 * Math.PI)];
  for (const hand of [1, -1] as const) {
    it(`hand ${hand}: a wire ball on the helix fits, the mirrored helix does not`, () => {
      const g = twistGroove(M, R, d, z0, z0 + 2 * S, S, hand);
      for (const t of [0.3, 1.7, 3.1, 4.4, 6.0, 8.5]) {
        const p = at(t, hand);
        expect(ball(p, d).subtract(g).volume(), `t=${t}`).toBeLessThan(1e-3);       // whole ball inside the groove
      }
      expect(ball(at(Math.PI / 2, -hand as 1 | -1), d).subtract(g).volume()).toBeGreaterThan(1);
    });
  }
});

describe("dShape, stack", () => {
  it("dShape is a circle cut flat at x = flat", () => {
    const b = dShape(M, 10, 4).bounds();
    expect(b.max[0]).toBeCloseTo(4, 3);
    expect(b.min[0]).toBeCloseTo(-10, 1);
  });
  it("cuts a tall body into pieces no taller than SEG_H + the joint, standing on z = 0", () => {
    const H = 400, body = M.Manifold.cylinder(H, 20, 20, 48);
    const zs = pieceBottoms(H);
    expect(zs.length).toBe(3);
    const pieces = stack(body, H, (zc) => ({ below: M.Manifold.cylinder(8, 5, 5, 24).translate([0, 0, zc]) }));
    expect(pieces.length).toBe(3);
    pieces.forEach((p) => { const b = p.boundingBox(); expect(b.min[2]).toBeCloseTo(0, 6); expect(b.max[2] - b.min[2]).toBeLessThanOrEqual(SEG_H + 8 + 1e-6); });
    expect(stack(body, 100, () => { throw new Error("no joint for one piece"); }).length).toBe(1);
  });
  it("toZ turns a direction to +z and moves the point to the origin", () => {
    const m = M.Manifold.cylinder(10, 1, 1, 12).rotate([0, 90, 0]).translate([5, 5, 0]);   // along +x from (5,5,0)
    const b = toZ(m, [5, 5, 0], [1, 0, 0]).boundingBox();
    expect(b.min[2]).toBeCloseTo(0, 4); expect(b.max[2]).toBeCloseTo(10, 4);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/print/shapes.test.ts`
Expected: FAIL (imports `PartError`, `twistGroove` … not exported).

- [ ] **Step 3: Implement**

`src/lib/print/rules.ts`, append:

```ts
export const SEG_H = 170;          // tallest stacked piece; its spigot (≤ 8 mm) keeps it within MAX_SIZE
```

`src/lib/print/parts.ts`: after `msg`, add

```ts
/** Failures a family reports itself (thrown from `build`): shown to the user like "Too large". */
export const FAIL = { thick: "Wire too thick for this part", radome: "Radome too narrow for the coax" };

/** Thrown from `PartSpec.build` when the design cannot be printed this way. */
export class PartError extends Error {
  m: Msg;
  constructor(m: Msg) { super(m.s); this.m = m; }
}
```

change `PART_STRINGS` to

```ts
export const PART_STRINGS = ["Too large to print in one piece: {0}", "Could not build this part: {0}", "Wires closer than {0} apart: add sleeving.", ...Object.values(FAIL), ...Object.values(USE_LABELS)];
```

and the `catch` in `buildPart` to

```ts
  try { segs = spec.build(M); } catch (e) { return { id: spec.id, ok: false, error: e instanceof PartError ? e.m : msg("Could not build this part: {0}", String(e)) }; }
```

`src/lib/print/shapes.ts`: change the import line to
`import type { CrossSection, Manifold, ManifoldToplevel } from "manifold-3d";` and add
`SEG_H` to the `./rules` import, then append:

```ts
/** Helical groove for a wire of diameter d whose centre runs at radius R, starting at angle 0 at z0 and rising S per
 *  turn; hand +1 turns counter-clockwise seen from +z (y = +R sin t), −1 clockwise. The 2D section is the horizontal
 *  slice of a tube of diameter d + CLEAR round the helix: at a shallow pitch it is a long curved bean, the union of the
 *  discs cut from balls along the helix. Twist-extruding that section reproduces the tube exactly. */
export function twistGroove(M: M, R: number, d: number, z0: number, z1: number, S: number, hand: 1 | -1): Manifold {
  const rc = (d + CLEAR) / 2, steps = 16;
  const discs = Array.from({ length: 2 * steps + 1 }, (_, i) => {
    const dz = (rc * (i - steps)) / steps, phi = (hand * 2 * Math.PI * dz) / S, r = Math.sqrt(Math.max(rc * rc - dz * dz, 1e-6));
    return M.CrossSection.circle(r, 24).translate([R * Math.cos(phi), R * Math.sin(phi)]);
  });
  const bean = M.CrossSection.union(discs.slice(1).map((c, i) => M.CrossSection.hull([discs[i], c])));
  const turns = (z1 - z0) / S;
  const perTurn = Math.max(24, Math.ceil((2 * Math.PI) / Math.sqrt(0.4 / R)));   // chord sag R·θ²/8 < 0.05 mm
  // manifold twists the top counter-clockwise for positive degrees (checked by shapes.test.ts)
  return M.Manifold.extrude(bean, z1 - z0, Math.ceil(perTurn * turns), hand * 360 * turns).translate([0, 0, z0]);
}

/** D-shaped section: a circle of radius r cut flat at x = flat. Keys a spigot so stacked pieces fit one way only. */
export const dShape = (M: M, r: number, flat: number): CrossSection =>
  M.CrossSection.circle(r, 64).intersect(M.CrossSection.square([flat + r + 1, 2 * r + 2]).translate([-r - 1, -r - 1]));

/** Bottoms of the stacked pieces of a body of height H: equal pieces no taller than SEG_H. */
export const pieceBottoms = (H: number): number[] => { const k = Math.ceil(H / SEG_H); return Array.from({ length: k }, (_, i) => (i * H) / k); };

export type Joint = { below: Manifold; aboveAdd?: Manifold; aboveCut?: Manifold };

/** Cut a body standing on z = 0 into the pieces of `pieceBottoms(H)`, each moved down to stand on z = 0. At each cut zc,
 *  `joint(zc)` gives the spigot the piece below gains and what the piece above gains or loses (all in body coordinates). */
export function stack(body: Manifold, H: number, joint: (zc: number) => Joint): Manifold[] {
  const zs = pieceBottoms(H);
  if (zs.length === 1) return [body];
  return zs.map((z0, i) => {
    const z1 = i + 1 < zs.length ? zs[i + 1] : Infinity;
    let p = body.trimByPlane([0, 0, 1], z0);
    if (z1 !== Infinity) p = p.trimByPlane([0, 0, -1], -z1).add(joint(z1).below);
    if (i > 0) { const j = joint(z0); if (j.aboveAdd) p = p.add(j.aboveAdd); if (j.aboveCut) p = p.subtract(j.aboveCut); }
    return p.translate([0, 0, -z0]);
  });
}

/** Move `at` to the origin and turn `dir` to +z (for printing a part along its axis). */
export function toZ(part: Manifold, at: V3, dir: V3): Manifold {
  const u = unit(dir), th = (Math.acos(u[2]) * 180) / Math.PI, ph = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  return part.translate(scale(at, -1)).rotate([0, 0, -ph]).rotate([0, -th, 0]);
}
```

If the twistGroove hand test fails for both hands with the "mirrored" assertion passing the wrong way, manifold's twist
direction is the opposite of the comment: change `hand * 360 * turns` to `-hand * 360 * turns` and fix the comment.

Create `src/lib/print/families/testkit.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Params } from "../../types";
import { partsFor } from "..";
import { rod, type V3 } from "../shapes";

/** Test helpers shared by the family tests. */
export const setup = (id: string, extra: Params = {}) => { const def = ANTENNA_BY_ID[id]; const p = { ...def.defaults, ...extra }; return { p, d: def.build(p) }; };
export const part = (id: string, partId: string, extra: Params = {}) => { const { p, d } = setup(id, extra); return partsFor(id, p, d).find((s) => s.id === partId)!; };
/** Volume of plastic inside a probe solid (mm³). */
export const inside = (solid: Manifold, probe: Manifold) => solid.intersect(probe).volume();
export const along = (M: ManifoldToplevel, a: V3, u: V3, s0: number, s1: number, d: number) =>
  rod(M, [a[0] + u[0] * s0, a[1] + u[1] * s0, a[2] + u[2] * s0], [a[0] + u[0] * s1, a[1] + u[1] * s1, a[2] + u[2] * s1], d);
export const ball = (M: ManifoldToplevel, p: V3, d: number) => M.Manifold.sphere(d / 2, 24).translate(p);
```

`src/lib/print/print.test.ts`: import `FAIL` from `./parts` and replace the `else expect(...)` line in the extremes test:

```ts
          else expect(["Too large to print in one piece: {0}", FAIL.thick, FAIL.radome], `${def.id} ${JSON.stringify(extra)} ${s.id}`).toContain(r.error.s);
```

and give that `it(...)` a timeout of `300_000` (third argument) because the new helix parts at 40 turns are slow.

`src/i18n/uk.ts`, under `// 3D-printed parts`:

```ts
  "Wire too thick for this part": "Дріт надто товстий для цієї деталі",
  "Radome too narrow for the coax": "Обтічник завузький для коаксіалу",
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/print src/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print src/i18n/uk.ts
git commit -m "Print parts: PartError, twisted helix groove, keyed stacking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015p6rSX8cufEdbSnXaVZtxo"
```

---

### Task 2: Helix former (grooved tube and rib frame)

**Files:**
- Create: `src/lib/print/families/former.ts`, `src/lib/print/families/former.test.ts`
- Modify: `src/lib/print/index.ts`, `src/i18n/uk.ts`

**Interfaces:**
- Consumes: `twistGroove`, `dShape`, `stack`, `pieceBottoms`, `box` (shapes.ts); `PartError`, `FAIL`, `msg` (parts.ts); testkit.
- Produces: `helixGeometry(d: Design): { R, wireD, h0, S, n, hand: 1 | -1, top, H, pts: V3[] }` (mm),
  `helixParts(d: Design): PartSpec[]` with ids `helix-tube`, `helix-frame`; `FORMER_STRINGS`, `FORMER_HOWTO`.

- [ ] **Step 1: Write the failing test** — `src/lib/print/families/former.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { FAIL } from "../parts";
import { pieceBottoms } from "../shapes";
import { helixGeometry } from "./former";
import { ball, inside, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

const FPV = { bands: "5725e6-5875e6", d: 1e-3, turns: 5 };
const CASES = [{}, { hand: "lhcp" }, FPV, { ...FPV, hand: "lhcp" }];
/** Put the stacked pieces back where they were cut from. */
const restack = (segs: Manifold[], H: number) => { const zs = pieceBottoms(H); return M.Manifold.union(segs.map((s, i) => s.translate([0, 0, segs.length > 1 ? zs[i] : 0]))); };

describe("helix former", () => {
  it("reads the design: diameter, pitch, turns, hand", () => {
    const { d } = setup("helix");
    const g = helixGeometry(d), dims = Object.fromEntries(d.dims.filter((x) => x.key).map((x) => [x.key, x.value * 1000]));
    expect(2 * g.R).toBeCloseTo(dims.D, 3);
    expect(g.S).toBeCloseTo(dims.S, 3);
    expect(g.n).toBeCloseTo(8, 6);
    expect(g.hand).toBe(1);
    expect(helixGeometry(setup("helix", { hand: "lhcp" }).d).hand).toBe(-1);
  });
  for (const id of ["helix-tube", "helix-frame"]) {
    it(`${id}: every design wire point is clear and held, both hands, GPS and 5.8 GHz`, () => {
      for (const c of CASES) {
        const { p, d } = setup("helix", c);
        const g = helixGeometry(d);
        const spec = partsFor("helix", p, d).find((s) => s.id === id)!;
        const whole = restack(spec.build(M), g.H);
        const probes = g.pts.filter((_, i) => i % 3 === 1);
        for (const q of probes) expect(inside(whole, ball(M, q, g.wireD)), `${JSON.stringify(c)} ${q}`).toBeLessThan(1e-3);
        const held = probes.filter((q) => inside(whole, ball(M, q, g.wireD + 2)) > 0.01).length / probes.length;
        expect(held, JSON.stringify(c)).toBeGreaterThan(id === "helix-tube" ? 0.99 : 0.15);
        // feed stub: the L of wire from the axis to the first turn is clear
        expect(inside(whole, ball(M, [g.R / 2, 0, g.h0], g.wireD))).toBeLessThan(1e-3);
      }
    }, 120_000);
  }
  it("tall formers are stacked: piece heights add up, each fits the bed", () => {
    const { p, d } = setup("helix");
    const g = helixGeometry(d);
    const r = buildPart(M, partsFor("helix", p, d)[0], "t");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.segments.length).toBe(pieceBottoms(g.H).length);
      expect(r.segments.length).toBeGreaterThan(1);
      r.segments.forEach((s) => expect(Math.max(...s.size)).toBeLessThanOrEqual(180));
    }
  });
  it("a tiny 5.8 GHz helix builds or says the wire is too thick", () => {
    for (const extra of [{ ...FPV, cl: 0.75 }, { ...FPV, cl: 0.75, d: 3e-3 }]) {
      const { p, d } = setup("helix", extra);
      for (const s of partsFor("helix", p, d)) { const r = buildPart(M, s, s.id); if (!r.ok) expect(r.error.s).toBe(FAIL.thick); }
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/print/families/former.test.ts`
Expected: FAIL ("Cannot find module './former'").

- [ ] **Step 3: Implement** — `src/lib/print/families/former.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Vec3 } from "../../types";
import { FAIL, msg, PartError, type PartSpec } from "../parts";
import { CLEAR, M3_HOLE, WALL, mm } from "../rules";
import { box, dShape, stack, twistGroove, type V3 } from "../shapes";

/** Axial-mode helix: a grooved tube or a rib frame that holds the wire at the designed diameter, pitch and hand. */
export const FORMER_STRINGS = [
  "Helix former: grooved tube",
  "Helix former: rib frame",
  "Holds the wire in a helical groove along its whole length: {0} diameter, {1} per turn, {2} turns. The base flange screws to the reflector and is its drilling template.",
  "{0} ribs hold the wire in notches: {1} diameter, {2} per turn, {3} turns. Least plastic near the wire. The base flange screws to the reflector and is its drilling template.",
  "Plastic touching the wire lowers the resonance by a few %: retune with Trim, or slide the tube out after winding.",
];

/** How-to steps, in order. */
export const FORMER_HOWTO = [
  "Print only one former, the tube or the frame, standing upright; it needs no supports.",
  "If it comes in several pieces, glue each spigot into the piece above; the flat on the spigot lines up the groove.",
  "Bend the wire end into an L: the short leg (the feed height) goes down the slot in the base to the connector pin, the bend sits at the start of the groove.",
  "Wind the wire into the groove to the top, keeping it tight, and fix the end with a drop of glue.",
  "Drill the reflector through the flange holes and the centre hole, mount the SMA panel jack from behind, screw the former on and solder the wire to the pin.",
];

const FLANGE_T = 2;   // base flange on the reflector
const KEY_H = 8;      // spigot height between stacked pieces
const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];
/** Polygon sides for a circle of radius r with a chord sag under 0.05 mm. */
const sides = (r: number) => Math.max(32, Math.ceil((2 * Math.PI) / Math.sqrt(0.4 / r)));

/** Helix geometry in mm from the model: feed wire up the axis to h0, a radial stub to R, then the coil. */
export function helixGeometry(d: Design) {
  const live = d.wires.filter((w) => !w.drawOnly && !w.necOnly);
  const feed = live.find((w) => w.group === "feed")!;
  const [stub, ...coil] = live.filter((w) => w.group === "driven");
  const h0 = mm(feed.b[2]), R = mm(Math.hypot(stub.b[0], stub.b[1])), wireD = mm(2 * stub.r);
  let turn = 0;
  for (const w of coil) {
    const da = Math.atan2(w.b[1], w.b[0]) - Math.atan2(w.a[1], w.a[0]);
    turn += da - 2 * Math.PI * Math.round(da / (2 * Math.PI));
  }
  const n = Math.abs(turn) / (2 * Math.PI), hand = (turn > 0 ? 1 : -1) as 1 | -1;
  const top = mm(coil[coil.length - 1].b[2]), S = (top - h0) / n;
  return { R, wireD, h0, S, n, hand, top, H: top + S / 2, pts: coil.map((w) => mmv(w.b)) };
}
export type HelixGeometry = ReturnType<typeof helixGeometry>;

const ribs = (g: HelixGeometry) => (2 * Math.PI * g.R > 160 ? 6 : 4);

export function formerBody(M: ManifoldToplevel, style: "tube" | "frame", g: HelixGeometry): Manifold[] {
  const CS = M.CrossSection, c = g.wireD + CLEAR, inner = g.R - c / 2;     // groove bottom radius
  const bore = inner - WALL, hubR = Math.min(15, Math.max(4.5, 0.3 * g.R));
  if (style === "tube" ? bore < 2.5 : inner < hubR + 1) throw new PartError(msg(FAIL.thick));
  const n = ribs(g), aw = Math.max(4, g.wireD + 2);
  const prof = style === "tube"
    ? CS.circle(g.R, sides(g.R)).subtract(CS.circle(bore, sides(bore)))
    : CS.union([CS.circle(hubR, 48), ...Array.from({ length: n }, (_, k) => CS.square([g.R, aw]).translate([0, -aw / 2]).rotate((360 * k) / n))]);
  const fr = g.R + g.wireD / 2 + 8, hr = g.R + g.wireD / 2 + 4.5;
  const body = M.Manifold.union([M.Manifold.extrude(prof, g.H), M.Manifold.cylinder(FLANGE_T, fr, fr, sides(fr))]);
  const cuts = M.Manifold.union([
    twistGroove(M, g.R, g.wireD, g.h0, g.H + 1, g.S, g.hand),
    box(M, [-c / 2, -c / 2, -1], [g.R + g.wireD, c / 2, g.h0 + c / 2]),               // feed slot: the wire's L slides in from below
    M.Manifold.cylinder(FLANGE_T + 2, 2.1, 2.1, 24).translate([0, 0, -1]),               // SMA pin and PTFE
    ...[60, 180, 300].map((a) => M.Manifold.cylinder(FLANGE_T + 2, M3_HOLE / 2, M3_HOLE / 2, 16)
      .translate([hr * Math.cos((a * Math.PI) / 180), hr * Math.sin((a * Math.PI) / 180), -1])),
  ]);
  const part = body.subtract(cuts);
  if (style === "tube") {
    const r = bore - CLEAR / 2, f = 0.4 * r;
    return stack(part, g.H, (zc) => ({
      // C-shaped spigot in the bore, fused to the wall by a short collar below the cut
      below: M.Manifold.union([
        M.Manifold.extrude(dShape(M, r, f).subtract(CS.circle(r - WALL, 48)), KEY_H).translate([0, 0, zc]),
        M.Manifold.extrude(CS.circle(bore + 0.5, 64).subtract(CS.circle(r - WALL, 48)), 2).translate([0, 0, zc - 2]),
      ]),
      // the flat side of the bore above is filled, so the spigot only fits one way round
      aboveAdd: M.Manifold.extrude(CS.circle(bore + 0.5, 64).subtract(dShape(M, bore + 1, f + CLEAR)), KEY_H + 0.5).translate([0, 0, zc]),
    }));
  }
  const rk = hubR - WALL, f = 0.4 * rk;
  return stack(part, g.H, (zc) => ({
    below: M.Manifold.extrude(dShape(M, rk, f), KEY_H + 2).translate([0, 0, zc - 2]),
    aboveCut: M.Manifold.extrude(dShape(M, rk + CLEAR / 2, f + CLEAR / 2), KEY_H + 1.5).translate([0, 0, zc - 1]),
  }));
}

export function helixParts(d: Design): PartSpec[] {
  const g = helixGeometry(d);
  const howTo = FORMER_HOWTO.map((s) => msg(s));
  const D = { len: (2 * g.R) / 1000 }, S = { len: g.S / 1000 }, n = Math.round(g.n * 10) / 10;
  return [
    { id: "helix-tube", title: FORMER_STRINGS[0], use: "former", qty: 1, purpose: msg(FORMER_STRINGS[2], D, S, n), warn: msg(FORMER_STRINGS[4]), howTo, build: (M) => formerBody(M, "tube", g) },
    { id: "helix-frame", title: FORMER_STRINGS[1], use: "former", qty: 1, purpose: msg(FORMER_STRINGS[3], ribs(g), D, S, n), howTo, build: (M) => formerBody(M, "frame", g) },
  ];
}
```

`src/lib/print/index.ts`: import `{ FORMER_HOWTO, FORMER_STRINGS, helixParts } from "./families/former"`, add
`helix: (_p, d) => helixParts(d),` to `FAMILIES`, and `...FORMER_STRINGS, ...FORMER_HOWTO,` to `PRINT_STRINGS`.

`src/i18n/uk.ts`:

```ts
  "Helix former: grooved tube": "Каркас спіралі: трубка з канавкою",
  "Helix former: rib frame": "Каркас спіралі: ребра",
  "Holds the wire in a helical groove along its whole length: {0} diameter, {1} per turn, {2} turns. The base flange screws to the reflector and is its drilling template.": "Тримає дріт у гвинтовій канавці по всій довжині: діаметр {0}, крок {1}, {2} витків. Фланець основи кріпиться гвинтами до рефлектора і є шаблоном для свердління.",
  "{0} ribs hold the wire in notches: {1} diameter, {2} per turn, {3} turns. Least plastic near the wire. The base flange screws to the reflector and is its drilling template.": "{0} ребер тримають дріт у вирізах: діаметр {1}, крок {2}, {3} витків. Найменше пластику біля дроту. Фланець основи кріпиться гвинтами до рефлектора і є шаблоном для свердління.",
  "Plastic touching the wire lowers the resonance by a few %: retune with Trim, or slide the tube out after winding.": "Пластик, що торкається дроту, знижує резонанс на кілька %: підлаштуйте Trim або зніміть трубку після намотування.",
  "Print only one former, the tube or the frame, standing upright; it needs no supports.": "Надрукуйте лише один каркас, трубку або ребра, вертикально; підтримки не потрібні.",
  "If it comes in several pieces, glue each spigot into the piece above; the flat on the spigot lines up the groove.": "Якщо каркас з кількох частин, вклейте кожен шип у частину над ним; лиска на шипі вирівнює канавку.",
  "Bend the wire end into an L: the short leg (the feed height) goes down the slot in the base to the connector pin, the bend sits at the start of the groove.": "Зігніть кінець дроту буквою L: коротка частина (висота живлення) йде вниз по пазу в основі до штиря роз'єму, згин лежить на початку канавки.",
  "Wind the wire into the groove to the top, keeping it tight, and fix the end with a drop of glue.": "Намотайте дріт у канавку до верху, туго натягуючи, і закріпіть кінець краплею клею.",
  "Drill the reflector through the flange holes and the centre hole, mount the SMA panel jack from behind, screw the former on and solder the wire to the pin.": "Просвердліть рефлектор через отвори фланця і центральний отвір, встановіть панельне гніздо SMA ззаду, прикрутіть каркас і припаяйте дріт до штиря.",
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/print src/i18n.test.ts`
Expected: PASS (former tests, `print.test.ts` defaults/extremes/howTo, i18n coverage).
If the frame "held" ratio fails at 5.8 GHz (few ribs), check the probe sampling, not the threshold: 4 ribs of width ≥ 4 mm
on C ≈ 52 mm hold ≥ 25 % of points.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print src/i18n/uk.ts
git commit -m "Print parts: helix grooved tube and rib frame

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015p6rSX8cufEdbSnXaVZtxo"
```

---

### Task 3: Discone hub

**Files:**
- Modify: `src/lib/print/families/hub.ts`, `src/lib/print/index.ts`, `src/i18n/uk.ts`
- Create: `src/lib/print/families/discone.test.ts`

**Interfaces:**
- Consumes: `bar`, `box`, `channel`, `rod`, `scale`, `sub`, `unit`, `zipSlot` (shapes.ts); testkit.
- Produces: `disconeGeometry(d: Design): { wireD, ch, w, discZ, discDirs: V3[], coneDirs: V3[], half, rg, neck, sN, grooveZ, grooveH, top }`,
  `disconeParts(d: Design): PartSpec[]` (id `discone-hub`), `DISCONE_STRINGS`, `DISCONE_HOWTO`.

- [ ] **Step 1: Write the failing test** — `src/lib/print/families/discone.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { CLEAR, INSULATE } from "../rules";
import { disconeGeometry } from "./hub";
import { along, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const CASES = [20, 30, 45].flatMap((half) => [6, 16].map((rods) => ({ half, rods })));

describe("discone hub", () => {
  it("cone bores follow the cone angle and are held; disc channels are flat and held", () => {
    for (const c of CASES) {
      const { d } = setup("discone", c);
      const g = disconeGeometry(d);
      expect(Math.abs((g.half * 180) / Math.PI - c.half)).toBeLessThan(0.5);
      const hub = part("discone", "discone-hub", c).build(M)[0];
      for (const u of g.coneDirs) {
        expect(inside(hub, along(M, [0, 0, 0], u, g.sN + 2, g.sN + 30, g.wireD)), JSON.stringify(c)).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, 0], u, g.sN + 5, g.sN + 30, g.wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
      for (const u of g.discDirs) {
        expect(u[2]).toBeCloseTo(0, 9);
        expect(inside(hub, along(M, [0, 0, g.discZ], u, 6, 36, g.wireD))).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, g.discZ], u, 10, 36, g.wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  }, 60_000);
  it("keeps the disc and the cone apart by the insulating wall", () => {
    for (const c of CASES) {
      const g = disconeGeometry(setup("discone", c).d);
      expect(g.discZ - g.ch / 2 - (g.grooveZ + g.grooveH / 2)).toBeGreaterThanOrEqual(INSULATE);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/print/families/discone.test.ts`
Expected: FAIL (`disconeGeometry` not exported).

- [ ] **Step 3: Implement** — append to `src/lib/print/families/hub.ts` (add `rod`, `sub` to the shapes import and
`Vec3` to the types import):

```ts
/** Discone: hub with the disc rods flat on top and the cone rods at the cone angle below. */
export const DISCONE_STRINGS = [
  "Discone hub",
  "Holds {0} disc rods flat and {1} cone rods at {2}° from the axis. The coax comes up the centre: its centre conductor goes to the disc rods in the top window, its braid to a wire ring round the cone rods in the side groove.",
];

/** How-to steps, in order. */
export const DISCONE_HOWTO = [
  "Feed the coax up through the centre bore until its end shows in the top window; bring a braid pigtail out through the side hole into the groove.",
  "Push each cone rod into its bore from below until its end shows in the side groove; wind bare copper wire round all the rod ends in the groove and solder it to every rod and to the braid.",
  "Push each disc rod into its channel until its end lies in the top window; solder all disc rods to the coax centre conductor.",
  "Strap the side block to the mast with two zip ties or a hose clamp through the slots.",
  "Fill the window and the groove with hot glue or silicone against water.",
];

const D_IN = 6;          // radius of the top window where the disc rods end
const D_LUG = 35;        // disc rod support length
const BORE = 5.5;        // coax bore radius (up to RG-213)
const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];

/** Discone geometry in mm from the model. The cone rods are cut short at radius rg, where they cross a groove round the
 *  neck (a real discone's cone also starts at a small top ring); the neck grows with the rod size. */
export function disconeGeometry(d: Design) {
  const live = d.wires.filter((x) => !x.drawOnly && !x.necOnly);
  const disc = live.filter((x) => x.group === "driven"), cone = live.filter((x) => x.group === "ground");
  const wireD = mm(2 * disc[0].r), ch = wireD + CLEAR, w = Math.max(ch + 2 * WALL, 8);
  const dir = (x: (typeof live)[number]) => unit(sub(mmv(x.b), mmv(x.a)));
  const discDirs = disc.map(dir), coneDirs = cone.map(dir);
  const half = Math.atan2(Math.hypot(coneDirs[0][0], coneDirs[0][1]), -coneDirs[0][2]);   // from the axis
  const rg = BORE + WALL + 1 + ch / 2, neck = rg + ch / 2 + 1;
  const grooveZ = -rg / Math.tan(half), grooveH = ch / Math.sin(half) + 4;
  const discZ = mm(disc[0].a[2]);
  return { wireD, ch, w, discZ, discDirs, coneDirs, half, rg, neck, sN: neck / Math.sin(half), grooveZ, grooveH, top: discZ + ch / 2 + WALL };
}

export function disconeParts(d: Design): PartSpec[] {
  const g = disconeGeometry(d);
  const az = Math.atan2(g.coneDirs[0][1], g.coneDirs[0][0]) + Math.PI / g.coneDirs.length;   // mast block between two cone rods
  const azDeg = (az * 180) / Math.PI;
  const hub: PartSpec = {
    id: "discone-hub", title: DISCONE_STRINGS[0], use: "holder", qty: 1,
    purpose: msg(DISCONE_STRINGS[1], g.discDirs.length, g.coneDirs.length, Math.round((g.half * 180) / Math.PI)),
    howTo: DISCONE_HOWTO.map((s) => msg(s)),
    build: (M) => {
      const zBot = Math.min(g.grooveZ - g.grooveH / 2, -(g.sN + D_LUG) * Math.cos(g.half)) - 10;
      const zLow = g.discZ - g.ch / 2 - WALL;
      const body = M.Manifold.union([
        M.Manifold.cylinder(g.top - zBot, g.neck, g.neck, 64).translate([0, 0, zBot]),
        M.Manifold.cylinder(g.top - zLow, D_IN + D_LUG, D_IN + D_LUG, 96).translate([0, 0, zLow]),
        ...g.coneDirs.map((u) => bar(M, scale(u, g.sN), scale(u, g.sN + D_LUG), g.w)),
        box(M, [g.neck - 2, -6, zBot], [g.neck + 14, 6, zBot + 30]).rotate([0, 0, azDeg]),
      ]);
      const cuts = M.Manifold.union([
        M.Manifold.cylinder(g.discZ - zBot + 1, BORE, BORE, 32).translate([0, 0, zBot - 1]),                       // coax
        M.Manifold.cylinder(g.top - zLow + 2, D_IN, D_IN, 32).translate([0, 0, g.discZ - g.ch / 2 - 0.5]),         // top window
        ...g.discDirs.map((u) => channel(M, [u[0] * (D_IN - 1), u[1] * (D_IN - 1), g.discZ], [u[0] * (D_IN + D_LUG + 2), u[1] * (D_IN + D_LUG + 2), g.discZ], g.wireD)),
        ...g.coneDirs.map((u) => channel(M, scale(u, g.rg / Math.sin(g.half)), scale(u, g.sN + D_LUG + g.w), g.wireD)),
        M.Manifold.cylinder(g.grooveH, g.neck + 1, g.neck + 1, 64).subtract(M.Manifold.cylinder(g.grooveH, g.rg - g.ch / 2 - 1, g.rg - g.ch / 2 - 1, 64))
          .translate([0, 0, g.grooveZ - g.grooveH / 2]),                                                          // braid ring groove
        rod(M, [0, 0, g.grooveZ], [-g.neck - 1, 0, g.grooveZ], 4).rotate([0, 0, azDeg]),                          // braid pigtail hole
        ...[zBot + 8, zBot + 22].map((z) => zipSlot(M, [g.neck + 7, 0, z], 1, 2, 14).rotate([0, 0, azDeg])),
      ]);
      return [body.subtract(cuts)];
    },
  };
  return [hub];
}
```

`index.ts`: import `DISCONE_HOWTO, DISCONE_STRINGS, disconeParts` from `./families/hub`; `discone: (_p, d) => disconeParts(d),`;
add `...DISCONE_STRINGS, ...DISCONE_HOWTO` to `PRINT_STRINGS`.

`uk.ts`:

```ts
  "Discone hub": "Вузол дискоконуса",
  "Holds {0} disc rods flat and {1} cone rods at {2}° from the axis. The coax comes up the centre: its centre conductor goes to the disc rods in the top window, its braid to a wire ring round the cone rods in the side groove.": "Тримає {0} стрижнів диска горизонтально і {1} стрижнів конуса під {2}° до осі. Коаксіал іде вгору по центру: центральна жила до стрижнів диска у верхньому вікні, обплетення до дротяного кільця навколо стрижнів конуса в боковій канавці.",
  "Feed the coax up through the centre bore until its end shows in the top window; bring a braid pigtail out through the side hole into the groove.": "Просуньте коаксіал вгору через центральний отвір, доки кінець не з'явиться у верхньому вікні; виведіть косичку обплетення через бічний отвір у канавку.",
  "Push each cone rod into its bore from below until its end shows in the side groove; wind bare copper wire round all the rod ends in the groove and solder it to every rod and to the braid.": "Вставте кожен стрижень конуса в його отвір знизу, доки кінець не з'явиться в боковій канавці; обмотайте кінці всіх стрижнів у канавці голим мідним дротом і припаяйте його до кожного стрижня та до обплетення.",
  "Push each disc rod into its channel until its end lies in the top window; solder all disc rods to the coax centre conductor.": "Вставте кожен стрижень диска в його канал, доки кінець не ляже у верхньому вікні; припаяйте всі стрижні диска до центральної жили коаксіалу.",
  "Strap the side block to the mast with two zip ties or a hose clamp through the slots.": "Прикріпіть бічний блок до щогли двома стяжками або хомутом через прорізи.",
  "Fill the window and the groove with hot glue or silicone against water.": "Заповніть вікно і канавку термоклеєм або силіконом від води.",
```

(If `"Strap the side block to the mast with two zip ties or a hose clamp through the slots."` already exists in `uk.ts`,
don't add it twice: `grep -n "Strap the side block" src/i18n/uk.ts`.)

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/lib/print src/i18n.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print src/i18n/uk.ts
git commit -m "Print parts: discone hub

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015p6rSX8cufEdbSnXaVZtxo"
```

---

### Task 4: Moxon and quad spreader parts

**Files:**
- Create: `src/lib/print/families/spreader.ts`, `src/lib/print/families/spreader.test.ts`
- Modify: `src/lib/antennas/moxon.ts:26-27`, `src/lib/antennas/quad.ts:13-14`, `src/lib/print/index.ts`, `src/i18n/uk.ts`

**Interfaces:**
- Consumes: `bar`, `box`, `channel`, `m3`, `rod`, `toZ`, `zipSlot`, vector helpers (shapes.ts); testkit.
- Produces: `moxonGeometry(d)`: `{ wireD, xE, xR, yA, C, tipD, tipR }`, `quadGeometry(d)`: `{ wireD, loops: { x: number; h: number }[] }`,
  `cornerCap(M, at: V3, dir: V3, legs: [V3, V3], rodD: number, wireD: number): Manifold` (world position, unrotated),
  `moxonParts(p, d)` ids `moxon-hub`, `moxon-cap-front`, `moxon-cap-rear`, `moxon-gap`; `quadParts(p, d)` ids `quad-hub`, `quad-cap`;
  `SPREADER_STRINGS`, `SPREADER_HOWTO`.

- [ ] **Step 1: Add the params** — `moxon.ts`:

```ts
  params: [BANDS, DIAM, { key: "rod", label: "Spreader rod diameter", kind: "length", min: 3e-3, max: 25e-3, hint: "For the printed parts; 8.5 mm = 3/8\" fibreglass" }],
  defaults: { bands: "144e6-146e6", d: 2e-3, rod: 8.5e-3 },
```

`quad.ts`:

```ts
  params: [BANDS, DIAM, { key: "sp", label: "Element spacing (λ)", kind: "number", min: 0.08, max: 0.3, step: 0.01 },
    { key: "rod", label: "Spreader rod diameter", kind: "length", min: 3e-3, max: 25e-3, hint: "For the printed parts; 8.5 mm = 3/8\" fibreglass" },
    { key: "bd", label: "Boom diameter", kind: "length", min: 10e-3, max: 60e-3 }],
  defaults: { bands: "144e6-146e6", d: 2e-3, sp: 0.15, rod: 8.5e-3, bd: 25e-3 },
```

(The builders ignore these keys; nothing else changes. If a `hint` string must be translated, `src/i18n.test.ts` will
say so: add it to `uk.ts` with the label.)

- [ ] **Step 2: Write the failing test** — `src/lib/print/families/spreader.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { CLEAR } from "../rules";
import { unit, type V3 } from "../shapes";
import { cornerCap, moxonGeometry, quadGeometry } from "./spreader";
import { along, ball, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

describe("moxon", () => {
  it("hub sockets point at the four corners and hold the rods", () => {
    for (const rod of [5e-3, 8.5e-3, 12e-3]) {
      const { d } = setup("moxon", { rod });
      const g = moxonGeometry(d);
      const hub = part("moxon", "moxon-hub", { rod }).build(M)[0];
      for (const c of [[g.xE, g.yA], [g.xE, -g.yA], [g.xR, g.yA], [g.xR, -g.yA]]) {
        const u = unit([c[0], c[1], 0]);
        expect(inside(hub, along(M, [0, 0, 0], u, 20, 50, rod * 1000)), `${rod} ${c}`).toBeLessThan(1e-3);
        expect(inside(hub, along(M, [0, 0, 0], u, 25, 50, rod * 1000 + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
  it("gap insulator holes are exactly C apart", () => {
    const { d } = setup("moxon");
    const g = moxonGeometry(d);
    const gap = part("moxon", "moxon-gap").build(M)[0];
    for (const x of [-g.C / 2, g.C / 2]) expect(inside(gap, M.Manifold.cylinder(10, g.wireD / 2, g.wireD / 2, 24).translate([x, 0, -1]))).toBeLessThan(1e-3);
    expect(inside(gap, M.Manifold.cylinder(10, g.wireD / 2, g.wireD / 2, 24).translate([g.C / 2 + g.wireD, 0, -1]))).toBeGreaterThan(0.1);
    expect(g.C).toBeCloseTo(g.tipD - g.tipR, 9);
  });
});

describe("quad", () => {
  it("hub: boom bore along x, four sockets at 45° in the loop plane", () => {
    const hub = part("quad", "quad-hub").build(M)[0];
    expect(inside(hub, along(M, [0, 0, 0], [1, 0, 0], -40, 40, 25))).toBeLessThan(1e-3);
    for (const [y, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const u = unit([0, y, z]);
      expect(inside(hub, along(M, [0, 0, 0], u, 22, 50, 8.5))).toBeLessThan(1e-3);
      expect(inside(hub, along(M, [0, 0, 0], u, 25, 50, 8.5 + CLEAR + 2))).toBeGreaterThan(1);
    }
    expect(quadGeometry(setup("quad").d).loops.length).toBe(2);
  });
  it("corner cap: the wire corner is clear and the rod fits", () => {
    const at: V3 = [0, 300, 300], dir = unit([0, 1, 1]);
    const cap = cornerCap(M, at, dir, [[0, -1, 0], [0, 0, -1]], 8.5, 2);
    expect(inside(cap, ball(M, at, 2))).toBeLessThan(1e-3);
    expect(inside(cap, ball(M, [0, 295, 300], 2))).toBeLessThan(1e-3);
    expect(inside(cap, along(M, at, dir, -25, -6, 8.5))).toBeLessThan(1e-3);
    expect(inside(cap, along(M, at, dir, -25, -6, 8.5 + CLEAR + 2))).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx vitest run src/lib/print/families/spreader.test.ts`
Expected: FAIL ("Cannot find module './spreader'").

- [ ] **Step 4: Implement** — `src/lib/print/families/spreader.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Params, Vec3 } from "../../types";
import { num } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";
import { add, bar, box, channel, m3, rod, scale, sub, toZ, unit, zipSlot, type V3 } from "../shapes";

/** Moxon and quad: spreader hubs, corner caps and the Moxon tip-gap insulator. */
export const SPREADER_STRINGS = [
  "Moxon spreader hub",
  "Corner cap, front (driver)",
  "Corner cap, back (reflector)",
  "Tip-gap insulator",
  "Quad spreader hub",
  "Corner cap",
  "Holds 4 spreader rods of {0} pointing at the corners of the {1} × {2} wire rectangle. Zip-tie the block to the mast.",
  "Fits on the spreader rod end and holds the wire corner in an outward-open groove.",
  "Joins a driver tip to a reflector tip with the holes exactly {0} apart, the gap that sets the Moxon's pattern.",
  "Fits on a {0} boom and holds 4 spreader rods of {1} at 45°; one per loop.",
];

/** How-to steps, in order. */
export const SPREADER_HOWTO = {
  hub: [
    "Push the spreader rods into the sockets and lock each with an M3 screw; the nut drops into the pocket on top.",
    "Mark each rod at the corner distance from the cut list and fit a corner cap there.",
    "Strap the block under the hub to the mast with two zip ties.",
  ],
  cap: [
    "Push the cap onto the rod end; trim the rod so the corner lands at the designed position.",
    "Press the wire corner into the groove from outside; a drop of glue or a short zip tie keeps it there.",
  ],
  gap: [
    "Pass each wire tip through its hole, fold it back and twist it round itself, so the hole centres set the gap.",
    "Use one insulator on each side of the antenna.",
  ],
  quadHub: [
    "Slide the hub onto the boom at the loop position and lock it with an M3 screw.",
    "Push the spreader rods into the sockets and glue them.",
    "Fit a corner cap on each rod end and press the wire corners into the grooves.",
  ],
};

const SOCK = 40;      // socket depth
const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];
const live = (d: Design) => d.wires.filter((w) => !w.drawOnly && !w.necOnly);
const ends = (d: Design, group: string) => live(d).filter((w) => w.group === group).flatMap((w) => [mmv(w.a), mmv(w.b)]);

/** Moxon rectangle in mm: driver side at x = xE, reflector side at x = xR, long sides at y = ±yA, tips at x = tipD / tipR. */
export function moxonGeometry(d: Design) {
  const all = live(d).flatMap((w) => [mmv(w.a), mmv(w.b)]);
  const drv = ends(d, "driven"), ref = ends(d, "reflector");
  const xE = Math.max(...all.map((p) => p[0])), xR = Math.min(...all.map((p) => p[0])), yA = Math.max(...all.map((p) => Math.abs(p[1])));
  const tipD = Math.min(...drv.map((p) => p[0])), tipR = Math.max(...ref.map((p) => p[0]));
  return { wireD: mm(2 * live(d)[0].r), xE, xR, yA, C: tipD - tipR, tipD, tipR };
}

/** Quad loops in mm: plane x and half side h of each loop. */
export function quadGeometry(d: Design) {
  const pts = live(d).flatMap((w) => [mmv(w.a), mmv(w.b)]);
  const xs = [...new Set(pts.map((p) => Math.round(p[0] * 1000) / 1000))];
  return { wireD: mm(2 * live(d)[0].r), loops: xs.map((x) => ({ x, h: Math.max(...pts.filter((p) => Math.abs(p[0] - x) < 1e-3).map((p) => Math.abs(p[1]))) })) };
}

/** Cap on a spreader rod end whose wire corner is at `at`; `dir` points along the rod outwards, `legs` along the two wire
 *  sides away from the corner. The groove is open towards the outside of the corner, so wire tension pulls the wire in. */
export function cornerCap(M: ManifoldToplevel, at: V3, dir: V3, legs: [V3, V3], rodD: number, wireD: number): Manifold {
  const rb = rodD + CLEAR, ch = wireD + CLEAR, so = rb / 2 + WALL;
  const tip = sub(at, scale(dir, ch / 2 + WALL + 1));               // rod end
  const body = rod(M, sub(tip, scale(dir, 30)), add(at, scale(dir, ch / 2 + WALL)), 2 * so);
  const out = unit(scale(add(legs[0], legs[1]), -1));
  const grooves = legs.map((l) => {
    const c = channel(M, at, add(at, scale(l, 2 * so)), wireD);
    return M.Manifold.hull([c, c.translate(scale(out, 2 * so))]);
  });
  return body.subtract(M.Manifold.union([rod(M, sub(tip, scale(dir, 31)), tip, rb), ...grooves]));
}

/** Rod socket hub at the origin: a core and one socket per direction, each with an M3 lock screw from +z. */
function socketHub(M: ManifoldToplevel, dirs: V3[], rodD: number, core: number): { body: Manifold; cuts: Manifold[] } {
  const rb = rodD + CLEAR, w = Math.max(rb + 2 * WALL, 12);
  const body = M.Manifold.union(dirs.map((u) => bar(M, scale(u, core - 2), scale(u, core + SOCK), w)));
  const cuts = dirs.flatMap((u) => {
    const s = scale(u, core + SOCK / 2);
    return [channel(M, scale(u, core), scale(u, core + SOCK + w), rodD), m3(M, s[0], s[1], s[2], s[2] + w / 2 + 1, true)];
  });
  return { body, cuts };
}

export function moxonParts(p: Params, d: Design): PartSpec[] {
  const g = moxonGeometry(d), rodD = mm(num(p, "rod", 8.5e-3));
  const corners: V3[] = [[g.xE, g.yA, 0], [g.xE, -g.yA, 0], [g.xR, g.yA, 0], [g.xR, -g.yA, 0]];
  const core = rodD + 6, w = Math.max(rodD + CLEAR + 2 * WALL, 12);
  const capPart = (M: ManifoldToplevel, at: V3, legX: number) => {
    const dir = unit(at);
    return [toZ(cornerCap(M, at, dir, [[legX, 0, 0], [0, -1, 0]], rodD, g.wireD), at, dir)];
  };
  const L = (x: number) => ({ len: x / 1000 });
  return [
    {
      id: "moxon-hub", title: SPREADER_STRINGS[0], use: "holder", qty: 1,
      purpose: msg(SPREADER_STRINGS[6], L(rodD), L(2 * g.yA), L(g.xE - g.xR)), howTo: SPREADER_HOWTO.hub.map((s) => msg(s)),
      build: (M) => {
        const h = socketHub(M, corners.map(unit), rodD, core);
        const body = M.Manifold.union([h.body, M.Manifold.cylinder(w, core, core, 48).translate([0, 0, -w / 2]), box(M, [-8, -6, -w / 2 - 30], [8, 6, -w / 2 + 0.01])]);
        return [body.subtract(M.Manifold.union([...h.cuts, ...[-w / 2 - 10, -w / 2 - 22].map((z) => zipSlot(M, [0, 0, z], 1, 2, 14))]))];
      },
    },
    { id: "moxon-cap-front", title: SPREADER_STRINGS[1], use: "holder", qty: 2, purpose: msg(SPREADER_STRINGS[7]), howTo: SPREADER_HOWTO.cap.map((s) => msg(s)), build: (M) => capPart(M, corners[0], -1) },
    { id: "moxon-cap-rear", title: SPREADER_STRINGS[2], use: "holder", qty: 2, purpose: msg(SPREADER_STRINGS[7]), howTo: SPREADER_HOWTO.cap.map((s) => msg(s)), build: (M) => capPart(M, corners[2], 1) },
    {
      id: "moxon-gap", title: SPREADER_STRINGS[3], use: "holder", qty: 2, purpose: msg(SPREADER_STRINGS[8], L(g.C)), howTo: SPREADER_HOWTO.gap.map((s) => msg(s)),
      build: (M) => {
        const CS = M.CrossSection, ch = g.wireD + CLEAR, R = ch / 2 + WALL + 1;
        const outline = CS.hull([CS.circle(R, 32).translate([-g.C / 2, 0]), CS.circle(R, 32).translate([g.C / 2, 0])]);
        return [outline.subtract(CS.union([CS.circle(ch / 2, 24).translate([-g.C / 2, 0]), CS.circle(ch / 2, 24).translate([g.C / 2, 0])])).extrude(4)];
      },
    },
  ];
}

export function quadParts(p: Params, d: Design): PartSpec[] {
  const g = quadGeometry(d), rodD = mm(num(p, "rod", 8.5e-3)), bd = mm(num(p, "bd", 25e-3));
  const dirs: V3[] = [[0, 1, 1], [0, 1, -1], [0, -1, 1], [0, -1, -1]].map((v) => unit(v as V3));
  const core = (bd + CLEAR) / 2 + WALL + 1, w = Math.max(rodD + CLEAR + 2 * WALL, 12);
  const L = (x: number) => ({ len: x / 1000 });
  return [
    {
      id: "quad-hub", title: SPREADER_STRINGS[4], use: "holder", qty: g.loops.length,
      purpose: msg(SPREADER_STRINGS[9], L(bd), L(rodD)), howTo: SPREADER_HOWTO.quadHub.map((s) => msg(s)),
      build: (M) => {
        const h = socketHub(M, dirs, rodD, core);
        const body = M.Manifold.union([h.body, rod(M, [-w / 2, 0, 0], [w / 2, 0, 0], 2 * core + 2)]);
        return [body.subtract(M.Manifold.union([...h.cuts.filter((_, i) => i % 2 === 0), channel(M, [-w, 0, 0], [w, 0, 0], bd), m3(M, 0, 0, 0, core + 1, true)]))];
      },
    },
    {
      id: "quad-cap", title: SPREADER_STRINGS[5], use: "holder", qty: 4 * g.loops.length, purpose: msg(SPREADER_STRINGS[7]), howTo: SPREADER_HOWTO.cap.map((s) => msg(s)),
      build: (M) => { const at: V3 = [0, 100, 100], dir = unit(at); return [toZ(cornerCap(M, at, dir, [[0, -1, 0], [0, 0, -1]], rodD, g.wireD), at, dir)]; },
    },
  ];
}
```

The quad hub uses only the socket bores (`i % 2 === 0`), not the per-socket M3 holes,
because the boom screw locks the hub and the rods are glued; with `socketHub`'s cut order `[bore, m3, bore, m3, …]`
that filter keeps the bores.

`index.ts`: import `SPREADER_HOWTO, SPREADER_STRINGS, moxonParts, quadParts`; add `moxon: moxonParts, quad: quadParts,`;
add `...SPREADER_STRINGS, ...Object.values(SPREADER_HOWTO).flat()` to `PRINT_STRINGS`.

`uk.ts` (labels, then strings):

```ts
  "Spreader rod diameter": "Діаметр стрижня розпірки",
  "For the printed parts; 8.5 mm = 3/8\" fibreglass": "Для друкованих деталей; 8,5 мм = склопластик 3/8\"",
  "Moxon spreader hub": "Вузол розпірок Moxon",
  "Corner cap, front (driver)": "Кутовий наконечник, передній (вібратор)",
  "Corner cap, back (reflector)": "Кутовий наконечник, задній (рефлектор)",
  "Tip-gap insulator": "Ізолятор зазору між кінцями",
  "Quad spreader hub": "Вузол розпірок квадрата",
  "Corner cap": "Кутовий наконечник",
  "Holds 4 spreader rods of {0} pointing at the corners of the {1} × {2} wire rectangle. Zip-tie the block to the mast.": "Тримає 4 стрижні розпірок {0}, спрямовані в кути дротяного прямокутника {1} × {2}. Прикріпіть блок до щогли стяжками.",
  "Fits on the spreader rod end and holds the wire corner in an outward-open groove.": "Надягається на кінець стрижня розпірки і тримає кут дроту в канавці, відкритій назовні.",
  "Joins a driver tip to a reflector tip with the holes exactly {0} apart, the gap that sets the Moxon's pattern.": "З'єднує кінець вібратора з кінцем рефлектора, отвори рівно на відстані {0}: цей зазор задає діаграму Moxon.",
  "Fits on a {0} boom and holds 4 spreader rods of {1} at 45°; one per loop.": "Надягається на траверсу {0} і тримає 4 стрижні розпірок {1} під 45°; по одному на рамку.",
  "Push the spreader rods into the sockets and lock each with an M3 screw; the nut drops into the pocket on top.": "Вставте стрижні розпірок у гнізда і зафіксуйте кожен гвинтом M3; гайка лягає в кишеню зверху.",
  "Mark each rod at the corner distance from the cut list and fit a corner cap there.": "Позначте на кожному стрижні відстань до кута зі списку нарізки і встановіть там кутовий наконечник.",
  "Strap the block under the hub to the mast with two zip ties.": "Прикріпіть блок під вузлом до щогли двома стяжками.",
  "Push the cap onto the rod end; trim the rod so the corner lands at the designed position.": "Надягніть наконечник на кінець стрижня; вкоротіть стрижень, щоб кут опинився в розрахунковому місці.",
  "Press the wire corner into the groove from outside; a drop of glue or a short zip tie keeps it there.": "Втисніть кут дроту в канавку ззовні; крапля клею або коротка стяжка втримає його.",
  "Pass each wire tip through its hole, fold it back and twist it round itself, so the hole centres set the gap.": "Просуньте кожен кінець дроту в його отвір, загніть назад і закрутіть навколо себе, щоб центри отворів задали зазор.",
  "Use one insulator on each side of the antenna.": "Використайте по одному ізолятору з кожного боку антени.",
  "Slide the hub onto the boom at the loop position and lock it with an M3 screw.": "Насуньте вузол на траверсу в місці рамки і зафіксуйте гвинтом M3.",
  "Push the spreader rods into the sockets and glue them.": "Вставте стрижні розпірок у гнізда і вклейте їх.",
  "Fit a corner cap on each rod end and press the wire corners into the grooves.": "Встановіть кутовий наконечник на кінець кожного стрижня і втисніть кути дроту в канавки.",
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/lib/print src/lib/antennas src/i18n.test.ts`
Expected: PASS. If the Moxon hub test finds plastic in the socket at s = 20 mm, `core` (rodD + 6) is larger than 20 for
thick rods: start the probe at `core + 1` instead of 20 (export nothing new; compute `rod * 1000 + 6 + 1` in the test).

- [ ] **Step 6: Commit**

```bash
git add src/lib/print src/lib/antennas/moxon.ts src/lib/antennas/quad.ts src/i18n/uk.ts
git commit -m "Print parts: Moxon and quad spreader hubs, corner caps, Moxon gap insulator

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_015p6rSX8cufEdbSnXaVZtxo"
```

---

### Task 5: Biquad feed standoff

**Files:**
- Create: `src/lib/print/families/standoff.ts`, `src/lib/print/families/standoff.test.ts`
- Modify: `src/lib/print/index.ts`, `src/i18n/uk.ts`

**Interfaces:**
- Consumes: `channel`, `box`, `flangeCut`, vector helpers; testkit.
- Produces: `biquadGeometry(d)`: `{ X, wireD, legs: { at: V3; dir: V3 }[] }` in **local** coordinates (local = world
  `(y, z, x)`, so the reflector is z = 0 and the element plane is z = X); `biquadParts(d)` id `biquad-standoff`;
  `STANDOFF_STRINGS`, `STANDOFF_HOWTO`.

- [ ] **Step 1: Write the failing test** — `src/lib/print/families/standoff.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { biquadGeometry } from "./standoff";
import { along, inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

describe("biquad standoff", () => {
  for (const sp of [0.08, 0.122, 0.25]) {
    it(`sp ${sp}: holds the 4 legs at the element height, plastic only near the feed`, () => {
      const { d } = setup("biquad", { sp });
      const g = biquadGeometry(d);
      const lam = 299792458 / ((2.4e9 + 2.4835e9) / 2) * 1000;
      expect(g.X).toBeCloseTo(sp * lam, 0);
      expect(g.legs.length).toBe(4);
      const s = part("biquad", "biquad-standoff", { sp }).build(M)[0];
      for (const l of g.legs) {
        expect(inside(s, along(M, l.at, l.dir, 4, 9, g.wireD))).toBeLessThan(1e-3);
        expect(inside(s, along(M, l.at, l.dir, 4, 9, g.wireD + 2))).toBeGreaterThan(0.1);
      }
      const far = M.Manifold.cylinder(100, 200, 200, 64).subtract(M.Manifold.cylinder(100, 12, 12, 64)).translate([0, 0, g.X / 2]);
      expect(inside(s, far)).toBeLessThan(1e-3);
    });
  }
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/lib/print/families/standoff.test.ts`
Expected: FAIL ("Cannot find module './standoff'").

- [ ] **Step 3: Implement** — `src/lib/print/families/standoff.ts`:

```ts
import type { Design, Vec3 } from "../../types";
import { msg, type PartSpec } from "../parts";
import { mm } from "../rules";
import { add, box, channel, flangeCut, scale, sub, unit, type V3 } from "../shapes";

/** Biquad: a slim standoff that holds the element at its height over the reflector, only near the feed. */
export const STANDOFF_STRINGS = [
  "Biquad feed standoff",
  "Holds the element {0} above the reflector by the four wires next to the feed; the tips stay free of plastic, which would detune them. The base is the drilling template for the N or SO-239 panel jack.",
];

/** How-to steps, in order. */
export const STANDOFF_HOWTO = [
  "Drill the reflector through the base: the centre hole for the jack and the four M3 holes.",
  "Bolt the panel jack behind the reflector and the standoff in front with the same M3 screws.",
  "Run the copper tube or the coax up the centre bore to the top.",
  "Press the four wires next to the feed into the grooves on top and solder them to the feed.",
];

const RP = 10, TUBE = 6.4, JACK = 16, PLATE_T = 3, SQ = 28;
/** World (x up from the reflector) → local print frame (z up from the reflector). */
const local = (p: Vec3): V3 => [mm(p[1]), mm(p[2]), mm(p[0])];
const near = (a: V3, b: V3) => Math.hypot(...sub(a, b)) < 1e-3;

export function biquadGeometry(d: Design) {
  const live = d.wires.filter((w) => !w.drawOnly && !w.necOnly);
  const feed = live.find((w) => w.group === "feed")!;
  const ends = [local(feed.a), local(feed.b)];
  const legs = live.filter((w) => w.group === "driven").flatMap((w) => {
    const a = local(w.a), b = local(w.b);
    return ends.flatMap((e) => (near(a, e) ? [{ at: e, dir: unit(sub(b, a)) }] : near(b, e) ? [{ at: e, dir: unit(sub(a, b)) }] : []));
  });
  return { X: ends[0][2], wireD: mm(2 * feed.r), legs };
}

export function biquadParts(d: Design): PartSpec[] {
  const g = biquadGeometry(d);
  return [{
    id: "biquad-standoff", title: STANDOFF_STRINGS[0], use: "holder", qty: 1,
    purpose: msg(STANDOFF_STRINGS[1], { len: g.X / 1000 }), howTo: STANDOFF_HOWTO.map((s) => msg(s)),
    build: (M) => {
      const body = M.Manifold.union([box(M, [-SQ / 2, -SQ / 2, 0], [SQ / 2, SQ / 2, PLATE_T]), M.Manifold.cylinder(g.X, RP, RP, 64)]);
      const cuts = M.Manifold.union([
        flangeCut(M, 0, PLATE_T),
        M.Manifold.cylinder(g.X + 2, TUBE / 2, TUBE / 2, 32).translate([0, 0, -1]),
        M.Manifold.cylinder(5, JACK / 2, JACK / 2, 48).translate([0, 0, -1]),          // front of the jack through the reflector
        ...g.legs.map((l) => { const c = channel(M, l.at, add(l.at, scale(l.dir, 1.5 * RP)), g.wireD); return M.Manifold.hull([c, c.translate([0, 0, 10])]); }),
      ]);
      return [body.subtract(cuts)];
    },
  }];
}
```

`index.ts`: import and register `biquad: (_p, d) => biquadParts(d),`; add `...STANDOFF_STRINGS, ...STANDOFF_HOWTO`.

`uk.ts`:

```ts
  "Biquad feed standoff": "Стійка живлення біквадрата",
  "Holds the element {0} above the reflector by the four wires next to the feed; the tips stay free of plastic, which would detune them. The base is the drilling template for the N or SO-239 panel jack.": "Тримає елемент на висоті {0} над рефлектором за чотири дроти біля точки живлення; кінці лишаються без пластику, який би їх розстроїв. Основа є шаблоном для свердління під панельне гніздо N або SO-239.",
  "Drill the reflector through the base: the centre hole for the jack and the four M3 holes.": "Просвердліть рефлектор через основу: центральний отвір під гніздо і чотири отвори M3.",
  "Bolt the panel jack behind the reflector and the standoff in front with the same M3 screws.": "Прикрутіть панельне гніздо позаду рефлектора і стійку спереду тими самими гвинтами M3.",
  "Run the copper tube or the coax up the centre bore to the top.": "Проведіть мідну трубку або коаксіал по центральному отвору до верху.",
  "Press the four wires next to the feed into the grooves on top and solder them to the feed.": "Втисніть чотири дроти біля точки живлення в канавки зверху і припаяйте їх до живлення.",
```

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/print src/i18n.test.ts` → PASS.

- [ ] **Step 5: Commit** (message `Print parts: biquad feed standoff`, with the two trailer lines).

---

### Task 6: J-pole spacers, tap gauge and collinear radome spacers

**Files:**
- Create: `src/lib/print/families/spacer.ts`, `src/lib/print/families/spacer.test.ts`
- Modify: `src/lib/antennas/collinear.ts:13-19`, `src/lib/print/index.ts`, `src/i18n/uk.ts`

**Interfaces:**
- Consumes: `PartError`, `FAIL`, `msg`; `box`; testkit.
- Produces: `jpoleGeometry(d)`: `{ tubeD, s, tap, stubTop }` (mm); `jpoleParts(d)` ids `jpole-spacer`, `jpole-tap`;
  `collinearParts(p, d)` id `collinear-spacer`; `SPACER_STRINGS`, `SPACER_HOWTO`.

- [ ] **Step 1: Add the param** — `collinear.ts`, after the `od` param:

```ts
    { key: "rid", label: "Radome inner diameter", kind: "length", min: 8e-3, max: 60e-3, hint: "For the printed spacers" },
```

and `rid: 20e-3` in `defaults`.

- [ ] **Step 2: Write the failing test** — `src/lib/print/families/spacer.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { CLEAR } from "../rules";
import { FAIL } from "../parts";
import { jpoleGeometry } from "./spacer";
import { inside, part, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const post = (x: number, d: number) => M.Manifold.cylinder(200, d / 2, d / 2, 32).translate([x, 0, -50]);

describe("j-pole", () => {
  it("spacer bores sit at the stub spacing and fit the tube", () => {
    for (const sp of [15e-3, 25e-3, 60e-3]) {
      const g = jpoleGeometry(setup("jpole", { sp }).d);
      expect(g.s).toBeCloseTo(sp * 1000, 6);
      const s = part("jpole", "jpole-spacer", { sp }).build(M)[0];
      for (const x of [0, g.s]) {
        expect(inside(s, post(x, g.tubeD))).toBeLessThan(1e-3);
        expect(inside(s, post(x, g.tubeD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
  it("tap gauge is as tall as the tap above the shorting bar", () => {
    const g = jpoleGeometry(setup("jpole").d);
    const b = part("jpole", "jpole-tap").build(M)[0].boundingBox();
    expect(b.max[2] - b.min[2]).toBeCloseTo(g.tap - g.tubeD / 2, 3);
  });
  it("tube spacing smaller than the tube is reported", () => {
    const { p, d } = setup("jpole", { sp: 3e-3 });
    const r = buildPart(M, partsFor("jpole", p, d)[0], "x");
    expect(r.ok ? "" : r.error.s).toBe(FAIL.thick);
  });
});

describe("collinear", () => {
  it("radome spacer fits the radome and the coax; one per section", () => {
    const s = part("collinear", "collinear-spacer");
    expect(s.qty).toBe(8);
    const b = s.build(M)[0].boundingBox();
    expect(b.max[0] - b.min[0]).toBeCloseTo(20 - CLEAR, 1);
  });
  it("too narrow a radome is reported", () => {
    const { p, d } = setup("collinear", { rid: 8e-3, od: 6e-3 });
    const r = buildPart(M, partsFor("collinear", p, d)[0], "x");
    expect(r.ok ? "" : r.error.s).toBe(FAIL.radome);
  });
});
```

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/lib/print/families/spacer.test.ts` → FAIL (module missing).

- [ ] **Step 4: Implement** — `src/lib/print/families/spacer.ts`:

```ts
import type { CrossSection, ManifoldToplevel } from "manifold-3d";
import type { Design, Params } from "../../types";
import { num } from "../../types";
import { FAIL, msg, PartError, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";

/** J-pole stub spacers and feed-tap gauge; collinear radome spacers. */
export const SPACER_STRINGS = [
  "Stub spacer",
  "Feed-tap gauge",
  "Radome spacer",
  "Keeps the radiator and the stub {0} apart (centre to centre), which sets the matching section's impedance.",
  "Stands on the shorting bar and clips onto both legs; its top edge is the feed tap height, {0} above the bar.",
  "Centres the coax in a {0} radome; vents let condensation out.",
];

/** How-to steps, in order. */
export const SPACER_HOWTO = {
  spacer: [
    "Slide the spacers onto both tubes before soldering the shorting bar, and spread them evenly along the stub.",
    "Fix each with a drop of glue once the antenna is tuned.",
  ],
  tap: [
    "Clip the gauge onto both legs and push it down onto the shorting bar.",
    "Attach the coax to both legs at the gauge's top edge, then remove the gauge.",
  ],
  radome: [
    "Clip a spacer onto the middle of each section before sliding the antenna into the radome.",
  ],
};

const H = 10;   // spacer thickness

function pair(M: ManifoldToplevel, s: number, tubeD: number): CrossSection {
  const CS = M.CrossSection, rb = (tubeD + CLEAR) / 2, R = rb + WALL;
  if (s < 2 * rb + 1) throw new PartError(msg(FAIL.thick));
  return CS.hull([CS.circle(R, 48), CS.circle(R, 48).translate([s, 0])]).subtract(CS.union([CS.circle(rb, 48), CS.circle(rb, 48).translate([s, 0])]));
}

export function jpoleGeometry(d: Design) {
  const live = d.wires.filter((w) => !w.drawOnly && !w.necOnly);
  const feed = live.find((w) => w.group === "feed")!;
  const rad = live.find((w) => w.group === "driven")!;
  const stub = live.find((w) => w.group === "line" && Math.abs(w.a[2] - w.b[2]) > 1e-9)!;   // the vertical leg, not the bar
  return { tubeD: mm(2 * rad.r), s: Math.abs(mm(stub.a[0] - rad.a[0])), tap: mm(feed.a[2]), stubTop: mm(Math.max(stub.a[2], stub.b[2])) };
}

export function jpoleParts(d: Design): PartSpec[] {
  const g = jpoleGeometry(d);
  const out: PartSpec[] = [{
    id: "jpole-spacer", title: SPACER_STRINGS[0], use: "holder", qty: Math.max(2, Math.ceil((g.stubTop - g.tap) / 120)),
    purpose: msg(SPACER_STRINGS[3], { len: g.s / 1000 }), howTo: SPACER_HOWTO.spacer.map((s) => msg(s)),
    build: (M) => [pair(M, g.s, g.tubeD).extrude(H)],
  }];
  const h = g.tap - g.tubeD / 2;
  if (h >= 4) out.push({
    id: "jpole-tap", title: SPACER_STRINGS[1], use: "jig", qty: 1,
    purpose: msg(SPACER_STRINGS[4], { len: h / 1000 }), howTo: SPACER_HOWTO.tap.map((s) => msg(s)),
    build: (M) => {
      const CS = M.CrossSection, m = 0.4 * g.tubeD, big = g.tubeD + 2 * WALL + 2;
      const mouths = CS.union([0, g.s].map((x) => CS.square([2 * m, big]).translate([x - m, -big])));   // open towards −y: clips on
      return [pair(M, g.s, g.tubeD).subtract(mouths).extrude(h)];
    },
  });
  return out;
}

export function collinearParts(p: Params, d: Design): PartSpec[] {
  const rid = mm(num(p, "rid", 20e-3)), od = mm(num(p, "od", 5e-3));
  const sections = d.wires.filter((w) => !w.drawOnly && (w.group === "driven" || w.group === "parasitic")).length;
  return [{
    id: "collinear-spacer", title: SPACER_STRINGS[2], use: "holder", qty: sections,
    purpose: msg(SPACER_STRINGS[5], { len: rid / 1000 }), howTo: SPACER_HOWTO.radome.map((s) => msg(s)),
    build: (M) => {
      const CS = M.CrossSection, ro = (rid - CLEAR) / 2, rb = (od + CLEAR) / 2;
      if (ro - rb < WALL + 1) throw new PartError(msg(FAIL.radome));
      const vent = Math.min(2, (ro - rb) / 4);
      const cuts = CS.union([
        CS.circle(rb, 48),
        CS.square([0.8 * od, ro + 1]).translate([-0.4 * od, 0]),                                     // clip-on slot
        ...[45, 135, 225, 315].map((a) => CS.circle(vent, 16).translate([ro * Math.cos((a * Math.PI) / 180), ro * Math.sin((a * Math.PI) / 180)])),
      ]);
      return [CS.circle(ro, 96).subtract(cuts).extrude(6)];
    },
  }];
}
```

`index.ts`: register `jpole: (_p, d) => jpoleParts(d), collinear: collinearParts,`; add
`...SPACER_STRINGS, ...Object.values(SPACER_HOWTO).flat()`.

`uk.ts`:

```ts
  "Radome inner diameter": "Внутрішній діаметр обтічника",
  "For the printed spacers": "Для друкованих розпірок",
  "Stub spacer": "Розпірка шлейфа",
  "Feed-tap gauge": "Шаблон точки живлення",
  "Radome spacer": "Розпірка в обтічнику",
  "Keeps the radiator and the stub {0} apart (centre to centre), which sets the matching section's impedance.": "Тримає випромінювач і шлейф на відстані {0} (між центрами), що задає імпеданс узгоджувальної секції.",
  "Stands on the shorting bar and clips onto both legs; its top edge is the feed tap height, {0} above the bar.": "Стоїть на перемичці і защіпається на обидві трубки; її верхній край на висоті точки живлення, {0} над перемичкою.",
  "Centres the coax in a {0} radome; vents let condensation out.": "Центрує коаксіал в обтічнику {0}; вентиляційні вирізи випускають конденсат.",
  "Slide the spacers onto both tubes before soldering the shorting bar, and spread them evenly along the stub.": "Насуньте розпірки на обидві трубки до припаювання перемички і розставте їх рівномірно вздовж шлейфа.",
  "Fix each with a drop of glue once the antenna is tuned.": "Закріпіть кожну краплею клею після налаштування антени.",
  "Clip the gauge onto both legs and push it down onto the shorting bar.": "Защепніть шаблон на обидві трубки і опустіть його на перемичку.",
  "Attach the coax to both legs at the gauge's top edge, then remove the gauge.": "Приєднайте коаксіал до обох трубок на рівні верхнього краю шаблону, потім зніміть шаблон.",
  "Clip a spacer onto the middle of each section before sliding the antenna into the radome.": "Защепніть розпірку посередині кожної секції, перш ніж вставити антену в обтічник.",
```

- [ ] **Step 5: Run tests** — `npx vitest run src/lib/print src/lib/antennas src/i18n.test.ts` → PASS.
  The collinear section count: confirm `setup("collinear").d.wires` has 8 driven+parasitic wires at `n = 8` (the top
  whip is group `line`); if the builder splits sections into several wires, count distinct `tag`s (`S1…Sn`) instead.

- [ ] **Step 6: Commit** (message `Print parts: J-pole spacers and tap gauge, collinear radome spacers`, with trailers).

---

### Task 7: Fan dipole centre block and leg spreaders

**Files:**
- Modify: `src/lib/print/families/centre.ts`, `src/lib/print/index.ts`, `src/i18n/uk.ts`
- Create: `src/lib/print/families/fan.test.ts`

**Interfaces:**
- Consumes: existing `dipoleArms`, `channel`, `box`; testkit.
- Produces: `dipoleArms(d, groups = ["driven"])` (backward compatible), `centreBlock(M, arms, gap, wireD, tieOff): Manifold`,
  `fanSpreaders(d): { Y: number; holes: { p: V3; u: V3 }[] }[]`, `fanParts(d)` ids `fan-centre`, `fan-spreader-1`, `fan-spreader-2`;
  `FAN_STRINGS`, `FAN_HOWTO`.

- [ ] **Step 1: Write the failing test** — `src/lib/print/families/fan.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { CLEAR } from "../rules";
import { dipoleArms, fanSpreaders } from "./centre";
import { along, inside, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

describe("fan dipole", () => {
  it("HF defaults: centre and spreaders build, spreaders fit the bed", () => {
    const { p, d } = setup("fandipole");
    const specs = partsFor("fandipole", p, d);
    expect(specs.map((s) => s.id)).toEqual(["fan-centre", "fan-spreader-1", "fan-spreader-2"]);
    for (const s of specs) expect(buildPart(M, s, s.id).ok, s.id).toBe(true);
  });
  it("centre channels follow every element's arm", () => {
    const { p, d } = setup("fandipole");
    const { wireD, arms } = dipoleArms(d, ["driven", "parasitic"]);
    expect(arms.length).toBe(6);
    const c = partsFor("fandipole", p, d)[0].build(M)[0];
    for (const a of arms) expect(inside(c, along(M, a.start, a.dir, 12, 30, wireD))).toBeLessThan(1e-3);
  });
  it("spreader channels follow the wires", () => {
    const { p, d } = setup("fandipole");
    const sp = fanSpreaders(d);
    const wireD = dipoleArms(d).wireD;
    sp.forEach((s, i) => {
      expect(s.holes.length).toBeGreaterThanOrEqual(2);
      const part = partsFor("fandipole", p, d)[i + 1].build(M)[0];
      for (const h of s.holes) {
        expect(inside(part, along(M, h.p, h.u, -3, 3, wireD))).toBeLessThan(1e-3);
        expect(inside(part, along(M, h.p, h.u, -1.5, 1.5, wireD + CLEAR + 2))).toBeGreaterThan(0.1);
      }
    });
  });
  it("a single band has no spreaders", () => {
    const { p, d } = setup("fandipole", { bands: "14e6-14.35e6" });
    expect(partsFor("fandipole", p, d).map((s) => s.id)).toEqual(["fan-centre"]);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/print/families/fan.test.ts` → FAIL (`fanSpreaders` not exported).

- [ ] **Step 3: Implement** in `centre.ts`.

Change `dipoleArms`:

```ts
export function dipoleArms(d: Design, groups: string[] = ["driven"]): { wireD: number; gap: number; arms: { start: V3; dir: V3 }[] } {
  const driven = d.wires.filter((w) => groups.includes(w.group ?? "") && !w.drawOnly && !w.necOnly);
```

(rest unchanged). Move the body of the dipole centre's `build` into an exported function and call it from `dipoleParts`:

```ts
/** Centre insulator body for arms leaving a feed gap along y: hub, one socket per arm, solder window, hanging eye, coax
 *  zip-tie slots, and (dipole only) a tie-off hole beside each arm. */
export function centreBlock(M: ManifoldToplevel, arms: { start: V3; dir: V3 }[], gap: number, wireD: number, tieOff: boolean): Manifold {
  const ch = wireD + CLEAR;
  const w = Math.max(3 * ch + 4 * WALL, 12);
  const zEye = ch / 2 + 4 + WALL + 3, top = zEye + 3 + WALL;
  const hub = box(M, [-w / 2, -(gap / 2 + 6), -30], [w / 2, gap / 2 + 6, top]);
  const lugs = arms.map((a) => bar(M, a.start, add(a.start, scale(a.dir, LUG)), w));
  const cuts = [
    ...arms.map((a) => channel(M, a.start, add(a.start, scale(a.dir, LUG + w / 2)), wireD)),
    ...(tieOff ? arms.map((a) => {
      const n = unit([0, -a.dir[2], a.dir[1]]);
      const p = add(add(a.start, scale(a.dir, LUG - 6)), scale(n, ch + WALL));
      return rod(M, [-w, p[1], p[2]], [w, p[1], p[2]], ch);
    }) : []),
    box(M, [0, -(gap / 2 + 5), -ch / 2 - 1], [w / 2 + 1, gap / 2 + 5, ch / 2 + 4]),
    rod(M, [-w, 0, zEye], [w, 0, zEye], 6),
    ...[-14, -24].flatMap((z) => [-7, 7].map((y) => zipSlot(M, [0, y, z], 0, 2, w + 2))),
  ];
  return M.Manifold.union([hub, ...lugs]).subtract(M.Manifold.union(cuts));
}
```

and in `dipoleParts` the centre's `build: (M) => [centreBlock(M, arms, gap, wireD, true)],` (keep `ch`, `droop`, `w`
only where still used; the existing dipole tests must keep passing unchanged). Add imports:
`import type { Manifold, ManifoldToplevel } from "manifold-3d";`.

Append:

```ts
/** Fan dipole: centre block with a channel pair per band, and spreaders along the legs. */
export const FAN_STRINGS = [
  "Fan dipole centre insulator",
  "Leg spreader",
  "Holds {0} band elements fanned out from a {1} feed gap; all of them are soldered to the coax in the front window.",
  "Keeps the band wires at their designed spacing {0} out from the centre; one on each leg.",
];

/** How-to steps, in order. */
export const FAN_HOWTO = {
  centre: [
    "Push each element's arms into their channels from the outside until the ends show in the front window.",
    "Solder all elements on one side to the coax centre conductor and all on the other side to the braid.",
    "Strap the coax to the hub with two zip ties through the slots, and hang the antenna from the eye on top.",
    "Seal the window with hot glue or silicone against water.",
  ],
  spreader: [
    "Thread the wires through the spreader in order, the longest element in the middle hole row as in the model.",
    "Slide it out to the given distance from the centre and fix each wire with a drop of glue.",
  ],
};

/** Spreader positions along the +y leg: Y in mm, and where each wire that reaches past Y crosses the plane y = Y. Placed
 *  where the wire spread still fits the bed: Ymax = min(⅔ of the longest arm, spread 150 mm); at Ymax/2 and Ymax. */
export function fanSpreaders(d: Design): { Y: number; holes: { p: V3; u: V3 }[] }[] {
  const wires = d.wires.filter((w) => (w.group === "driven" || w.group === "parasitic") && !w.drawOnly && !w.necOnly && w.b[1] > 0)
    .map((w) => ({ a: mmv(w.a), b: mmv(w.b) }));
  const tans = wires.map((w) => (w.b[2] - w.a[2]) / (w.b[1] - w.a[1]));
  const spread = Math.max(...tans) - Math.min(...tans);
  if (spread < 1e-9) return [];
  const Ymax = Math.min((2 / 3) * Math.max(...wires.map((w) => w.b[1])), 150 / spread);
  return [Ymax / 2, Ymax].map((Y) => ({
    Y,
    holes: wires.filter((w) => w.b[1] > Y + 10).map((w) => {
      const t = (Y - w.a[1]) / (w.b[1] - w.a[1]);
      return { p: add(w.a, scale(sub(w.b, w.a), t)), u: unit(sub(w.b, w.a)) };
    }),
  })).filter((s) => s.holes.length >= 2);
}

export function fanParts(d: Design): PartSpec[] {
  const { wireD, gap, arms } = dipoleArms(d, ["driven", "parasitic"]);
  const ch = wireD + CLEAR, m = ch / 2 + WALL + 2;
  const centre: PartSpec = {
    id: "fan-centre", title: FAN_STRINGS[0], use: "holder", qty: 1,
    purpose: msg(FAN_STRINGS[2], arms.length / 2, { len: gap / 1000 }), howTo: FAN_HOWTO.centre.map((s) => msg(s)),
    build: (M) => [centreBlock(M, arms, gap, wireD, false)],
  };
  return [centre, ...fanSpreaders(d).map((s, i): PartSpec => ({
    id: `fan-spreader-${i + 1}`, title: FAN_STRINGS[1], use: "holder", qty: 2,
    purpose: msg(FAN_STRINGS[3], { len: s.Y / 1000 }), howTo: FAN_HOWTO.spreader.map((x) => msg(x)),
    build: (M) => {
      const zs = s.holes.map((h) => h.p[2]);
      const plate = box(M, [-m, s.Y - 2, Math.min(...zs) - m], [m, s.Y + 2, Math.max(...zs) + m]);
      return [plate.subtract(M.Manifold.union(s.holes.map((h) => channel(M, sub(h.p, scale(h.u, 6)), add(h.p, scale(h.u, 6)), wireD))))];
    },
  }))];
}
```

`index.ts`: import `FAN_HOWTO, FAN_STRINGS, fanParts`; register `fandipole: (_p, d) => fanParts(d),`; add
`...FAN_STRINGS, ...Object.values(FAN_HOWTO).flat()`.

`uk.ts`:

```ts
  "Fan dipole centre insulator": "Центральний ізолятор віяльного диполя",
  "Leg spreader": "Розпірка плеча",
  "Holds {0} band elements fanned out from a {1} feed gap; all of them are soldered to the coax in the front window.": "Тримає {0} елементів діапазонів віялом від зазору живлення {1}; усі припаюються до коаксіалу в передньому вікні.",
  "Keeps the band wires at their designed spacing {0} out from the centre; one on each leg.": "Тримає дроти діапазонів на розрахунковій відстані {0} від центру; по одній на кожному плечі.",
  "Push each element's arms into their channels from the outside until the ends show in the front window.": "Вставте плечі кожного елемента в їхні канали ззовні, доки кінці не з'являться в передньому вікні.",
  "Solder all elements on one side to the coax centre conductor and all on the other side to the braid.": "Припаяйте всі елементи з одного боку до центральної жили коаксіалу, а всі з іншого боку до обплетення.",
  "Thread the wires through the spreader in order, the longest element in the middle hole row as in the model.": "Протягніть дроти крізь розпірку по порядку, найдовший елемент у середньому отворі, як у моделі.",
  "Slide it out to the given distance from the centre and fix each wire with a drop of glue.": "Відсуньте її на вказану відстань від центру і закріпіть кожен дріт краплею клею.",
```

(The centre's 3rd and 4th steps reuse the dipole strings already in `uk.ts`; don't add those twice.)

- [ ] **Step 4: Run tests** — `npx vitest run src/lib/print src/i18n.test.ts` → PASS (including the unchanged dipole
  tests in `families.test.ts`).

- [ ] **Step 5: Commit** (message `Print parts: fan dipole centre block and leg spreaders`, with trailers).

---

### Task 8: Coverage test, docs, full verification

**Files:**
- Modify: `src/lib/print/print.test.ts`, `CLAUDE.md`, `docs/ANTENNAS.md`, `docs/superpowers/specs/2026-10-10-print-parts-design.md`

- [ ] **Step 1: Write the coverage test** — in `print.test.ts` `describe("partsFor")`:

```ts
  it("every wire antenna has at least one printed part", () => {
    for (const def of ANTENNAS) { const d = def.build(def.defaults); if (!d.pcb) expect(partsFor(def.id, def.defaults, d).length, def.id).toBeGreaterThan(0); }
  });
```

- [ ] **Step 2: Run** — `npx vitest run src/lib/print/print.test.ts` → PASS (all 11 wire antennas now registered). If an
  id fails, its family isn't in `FAMILIES`.

- [ ] **Step 3: Docs**
  - `CLAUDE.md` "Not done / ideas": replace the "Printed parts, stages 2–3 …" bullet with
    `- Printed parts, later: Yagi boom saddle, heat-set inserts on the GP hub, balun cavity in the dipole centre, coax strain relief, slim-jim spacers.`
    and in Layout, after the `print/` lines, add `families/former.ts (helix tube/frame, twisted groove, keyed stacking), spreader.ts, standoff.ts, spacer.ts`.
  - `docs/ANTENNAS.md`: in the build-pack / printed parts section, one paragraph listing the parts per antenna (copy the
    Scope table of the stage-2 spec).
  - Stage-1 spec, "Stage plan": mark stage 2 and 3 parts as done in `2026-10-10-print-parts-stage2-design.md`, except
    the deferred ones listed there.

- [ ] **Step 4: Full verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all pass. Then `npm run dev`, open the Build tab for helix (default and 5.8 GHz), discone, Moxon, quad,
biquad, J-pole, fan dipole, collinear: each lists its parts, the preview renders, the zip downloads. Spot-check one STL
per family in a slicer if available (watertight, flat base).

- [ ] **Step 5: Commit** (message `Print parts stage 2: coverage test and docs`, with trailers).
