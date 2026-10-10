# Antenna Shells Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every antenna (wire and printed PCB) gets one printable `shell` part: a dome radome, a clamshell box, or a
feedpoint weather box, chosen from the design's size and frequency.

**Architecture:** A new folder `src/lib/print/shells/` holds pure helpers (envelope, style, exits) and three
generators (dome, clamshell, PCB box). `shellFor()` picks one per antenna and returns a `PartSpec` with id `shell`;
`partsFor()` appends it to the family's parts (PCB antennas: the shell is their only part). No UI change.

**Tech Stack:** TypeScript 6, manifold-3d 3.5.4, vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-antenna-shells-design.md` (with the print-parts specs of stages 1–2).

## Global Constraints

- Print geometry in **mm**; Design in metres → `mm()` (`src/lib/print/rules.ts`).
- Rules: `CLEAR = 0.3`, `WALL = 2`, `MAX_SIZE = 180`, `SEG_H = 170`, `M3_HOLE = 3.4`, `M3_NUT = 6.6`, `M3_NUT_DEPTH = 2.8`.
- Styles: **FPV** when `d.f ≥ 2e9`: wall 1.2 mm, gap 1.5 mm. **Outdoor** below: wall 2 mm, gap 3 mm, Ø3 drain hole.
- Full shell only when it fits: dome diameter (outer) ≤ 170 mm and height ≤ 3·SEG_H; box: every outer extent ≤ 180 mm.
  Otherwise the feed box.
- Coax gland Ø8 mm (feed boxes, wire full boxes); PCB pigtail entry Ø3.5 mm; PCB probe port: SMA hole Ø6.5 mm.
- The shell never comes within `gap` of a live wire (not `drawOnly`/`necOnly`) or PCB copper.
- `src/lib` has no DOM/React/i18n. English strings in `SHELL_STRINGS` / `SHELL_HOWTO`, added to `PRINT_STRINGS`,
  translated in `src/i18n/uk.ts` (exact key, same placeholders). `erasableSyntaxOnly`: no enums/parameter properties.
- Allowed build failures: "Too large to print in one piece: {0}", `FAIL.thick`, `FAIL.radome`.
- Manifold batch `Manifold.union([...])` with disjoint operands has dropped volume once (stage 2): in new generators,
  subtract cuts one at a time (`for (const c of cuts) body = body.subtract(c)`).
- Plain `git` commits ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_015p6rSX8cufEdbSnXaVZtxo
  ```
- Commands: `npx vitest run src/lib/print`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

## Review Focus

1. **A shell that touches the radiator** (plastic within the gap): pinned in Tasks 4 and 5 by sampling every live wire
   point / copper rectangle against the built shell.
2. **Feed box with no hole where a wire leaves**: pinned in Task 4 (every exit ray passes clear through its hole).
3. **Helix dome sitting on the former's flange screws**: pinned in Task 3 (pocket over the flange, holes outside it).
4. **PCB coax entry on the wrong edge** (e.g. printed dipole's centre port): pinned in Task 5 (ray from the port to the
   chosen edge is clear).
5. **Defaults too slow** (shells add a build per antenna): Task 6 checks the suite time stays < 150 s.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/print/shells/geometry.ts` (+ test) | `Box3`, `envelope`, `grow`, `size`, `styleOf`, `STYLE`, `feedPoint`, `exits`, `boxFits`, `domeFits` |
| `src/lib/print/shells/clamshell.ts` (+ test) | `clamshell(M, opts)`: two halves round an inner box, lip, screw ears, cuts, drain |
| `src/lib/print/shells/dome.ts` (+ test) | `dome(M, opts)`: tube + cone top, flange or mast base, stacked pieces |
| `src/lib/print/shells/pcbbox.ts` (+ test) | PCB clamshell: board posts, pigtail/probe entry |
| `src/lib/print/shells/index.ts` (+ `shells.test.ts`) | `shellFor(defId, p, d, family)`, strings |
| `src/lib/print/shapes.ts` (modify) | `Joint.below` optional |
| `src/lib/print/families/hub.ts` (modify) | export `gpMastAxis(d)` |
| `src/lib/print/index.ts`, `print.test.ts`, `src/i18n/uk.ts` (modify) | registration, tests, translations |

---

### Task 1: Shell geometry helpers

**Files:**
- Create: `src/lib/print/shells/geometry.ts`, `src/lib/print/shells/geometry.test.ts`

**Interfaces:**
- Produces:
  - `type Box3 = { lo: V3; hi: V3 }`, `grow(b, k)`, `size(b): V3`, `inside(b, p): boolean`
  - `type Style = "fpv" | "outdoor"`, `STYLE: Record<Style, { wall: number; gap: number }>`, `FPV_HZ = 2e9`, `styleOf(d): Style`
  - `envelope(d: Design): Box3` (live wires with radius, plates, PCB board z 0..h; mm)
  - `feedPoint(d: Design): V3` (mm; origin when `d.feed` is undefined)
  - `type Exit = { at: V3; dir: V3; d: number }`, `exits(d: Design, b: Box3): Exit[]` (wires not `necOnly`, drawn ones included, crossing the box surface)
  - `boxFits(inner: Box3, wall: number): boolean`, `domeFits(r: number, h: number, wall: number): boolean`

- [ ] **Step 1: Write the failing test** — `geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Design, Params } from "../../types";
import { boxFits, domeFits, envelope, exits, feedPoint, grow, size, styleOf } from "./geometry";

const build = (id: string, extra: Params = {}): Design => { const def = ANTENNA_BY_ID[id]; return def.build({ ...def.defaults, ...extra }); };

describe("shell geometry", () => {
  it("style: FPV at and above 2 GHz, outdoor below", () => {
    expect(styleOf(build("helix"))).toBe("outdoor");                                    // GPS
    expect(styleOf(build("helix", { bands: "5725e6-5875e6", d: 1e-3 }))).toBe("fpv");
    expect(styleOf(build("biquad"))).toBe("fpv");                                       // 2.4 GHz
  });
  it("envelope of a PCB antenna is its board", () => {
    const d = build("ifa"), e = envelope(d), b = d.pcb!.board;
    expect(e.lo[0]).toBeCloseTo(b.x0 * 1000, 6); expect(e.hi[1]).toBeCloseTo(b.y1 * 1000, 6);
    expect(e.lo[2]).toBeCloseTo(0, 6); expect(e.hi[2]).toBeCloseTo(d.pcb!.h * 1000, 6);
  });
  it("envelope ignores NEC-only grids and drawn-only parts", () => {
    const e = envelope(build("helix"));            // the ground disc is a plate: included; the NEC grid is not double-counted
    expect(size(e)[0]).toBeGreaterThan(100);
    const y = build("yagi"), ey = envelope(y);
    const boom = y.wires.find((w) => w.drawOnly)!;
    expect(Math.max(Math.abs(boom.a[0]), Math.abs(boom.b[0])) * 1000).toBeGreaterThanOrEqual(ey.hi[0] - 1e-6);
  });
  it("feed point: dipole at the origin, quad at the bottom of the driven loop, collinear at the origin", () => {
    expect(feedPoint(build("dipole")).map((v) => Math.round(v))).toEqual([0, 0, 0]);
    const q = feedPoint(build("quad"));
    expect(q[2]).toBeLessThan(-100);
    expect(feedPoint(build("collinear"))).toEqual([0, 0, 0]);
  });
  it("exits: a box round the dipole centre has one exit per arm, pointing outwards", () => {
    const d = build("dipole"), b = grow({ lo: [0, 0, 0], hi: [0, 0, 0] }, 40);
    const ex = exits(d, b);
    expect(ex.length).toBe(2);
    ex.forEach((x) => { expect(Math.abs(Math.abs(x.at[1]) - 40)).toBeLessThan(1e-6); expect(Math.sign(x.dir[1])).toBe(Math.sign(x.at[1])); expect(x.d).toBeCloseTo(2, 6); });
  });
  it("exits: a wire passing through a box gives two exits", () => {
    const d = build("yagi"), boom = d.wires.find((w) => w.drawOnly)!;
    const c = [(boom.a[0] + boom.b[0]) * 500, (boom.a[1] + boom.b[1]) * 500, (boom.a[2] + boom.b[2]) * 500] as [number, number, number];
    const ex = exits(d, { lo: [c[0] - 20, c[1] - 20, c[2] - 20], hi: [c[0] + 20, c[1] + 20, c[2] + 20] }).filter((x) => x.d > 20);
    expect(ex.length).toBe(2);
  });
  it("fits", () => {
    expect(boxFits({ lo: [0, 0, 0], hi: [162, 50, 50] }, 2)).toBe(true);    // 162 + 2·(2 + 7) = 180
    expect(boxFits({ lo: [0, 0, 0], hi: [163, 50, 50] }, 2)).toBe(false);
    expect(domeFits(80, 500, 2)).toBe(true);
    expect(domeFits(84, 100, 2)).toBe(false);
    expect(domeFits(30, 600, 2)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/print/shells/geometry.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement** — `geometry.ts`:

```ts
import type { Design, Vec3 } from "../../types";
import { MAX_SIZE, SEG_H, mm } from "../rules";
import { add, scale, sub, unit, type V3 } from "../shapes";

/** Geometry helpers for shells, in mm. */
export type Box3 = { lo: V3; hi: V3 };
export type Style = "fpv" | "outdoor";
export const STYLE: Record<Style, { wall: number; gap: number }> = { fpv: { wall: 1.2, gap: 1.5 }, outdoor: { wall: 2, gap: 3 } };
export const FPV_HZ = 2e9;
const FOOT = 170;                          // largest dome diameter
const EAR = 7;                             // screw ears stick out this far past the wall (each side)

const mmv = (p: Vec3): V3 => [mm(p[0]), mm(p[1]), mm(p[2])];
export const grow = (b: Box3, k: number): Box3 => ({ lo: [b.lo[0] - k, b.lo[1] - k, b.lo[2] - k], hi: [b.hi[0] + k, b.hi[1] + k, b.hi[2] + k] });
export const size = (b: Box3): V3 => [b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2]];
export const inside = (b: Box3, p: V3) => p.every((v, i) => v >= b.lo[i] - 1e-9 && v <= b.hi[i] + 1e-9);
export const styleOf = (d: Design): Style => (d.f >= FPV_HZ ? "fpv" : "outdoor");

function bounds(pts: V3[]): Box3 {
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((p) => p[i]))) as V3, hi = [0, 1, 2].map((i) => Math.max(...pts.map((p) => p[i]))) as V3;
  return { lo, hi };
}

/** The antenna itself: live wires (with their radius), plates and the PCB board (z 0..h). */
export function envelope(d: Design): Box3 {
  const pts: V3[] = [];
  for (const w of d.wires) {
    if (w.drawOnly || w.necOnly) continue;
    const r = mm(w.r);
    for (const p of [mmv(w.a), mmv(w.b)]) pts.push(sub(p, [r, r, r]), add(p, [r, r, r]));
  }
  for (const pl of d.plates ?? []) for (const p of pl.pts) pts.push(mmv(p));
  if (d.pcb) { const b = d.pcb.board; pts.push([mm(b.x0), mm(b.y0), 0], [mm(b.x1), mm(b.y1), mm(d.pcb.h)]); }
  return bounds(pts);
}

/** Feed point from the design's feed wire; antennas without one (collinear) feed at the origin. */
export function feedPoint(d: Design): V3 {
  if (!d.feed) return [0, 0, 0];
  const w = d.wires[d.feed.wire], a = mmv(w.a), b = mmv(w.b);
  return d.feed.at === "start" ? a : d.feed.at === "end" ? b : scale(add(a, b), 0.5);
}

export type Exit = { at: V3; dir: V3; d: number };

/** Where wires (not NEC-only; drawn parts like booms included) cross the surface of a box: the crossing point, the
 *  direction out of the box and the wire diameter. A wire through the box gives two exits. */
export function exits(d: Design, b: Box3): Exit[] {
  const out: Exit[] = [];
  for (const w of d.wires) {
    if (w.necOnly) continue;
    const a = mmv(w.a), c = mmv(w.b), u = sub(c, a);
    let t0 = 0, t1 = 1, hit = true;
    for (let i = 0; i < 3 && hit; i++) {
      if (Math.abs(u[i]) < 1e-12) { if (a[i] < b.lo[i] || a[i] > b.hi[i]) hit = false; continue; }
      let ta = (b.lo[i] - a[i]) / u[i], tb = (b.hi[i] - a[i]) / u[i];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
      if (t0 > t1) hit = false;
    }
    if (!hit) continue;
    const dir = unit(u), dw = mm(2 * w.r);
    if (t0 > 1e-9) out.push({ at: add(a, scale(u, t0)), dir: scale(dir, -1), d: dw });
    if (t1 < 1 - 1e-9) out.push({ at: add(a, scale(u, t1)), dir, d: dw });
  }
  // a polyline vertex exactly on the surface gives the same exit twice
  return out.filter((x, i) => !out.slice(0, i).some((y) => Math.hypot(...sub(x.at, y.at)) < 0.5 && x.dir[0] * y.dir[0] + x.dir[1] * y.dir[1] + x.dir[2] * y.dir[2] > 0.999));
}

/** A clamshell round `inner` with this wall (and its screw ears) fits the bed. */
export const boxFits = (inner: Box3, wall: number) => Math.max(...size(grow(inner, wall + EAR))) <= MAX_SIZE;
/** A dome of inner radius r and inner height h fits: diameter within FOOT, at most 3 stacked pieces. */
export const domeFits = (r: number, h: number, wall: number) => 2 * (r + wall) <= FOOT && h <= 3 * SEG_H;
```

- [ ] **Step 4: Run** — `npx vitest run src/lib/print/shells/geometry.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git add src/lib/print/shells && git commit -m "Shells: envelope, style, feed point, exits"` (+ trailers).

---

### Task 2: Clamshell generator

**Files:**
- Create: `src/lib/print/shells/clamshell.ts`, `src/lib/print/shells/clamshell.test.ts`

**Interfaces:**
- Consumes: `Box3`, `grow`, `size` (Task 1); `box`, `channel`, `rod`, `m3` (shapes.ts).
- Produces: `type ClamOpts = { inner: Box3; wall: number; splitZ: number; cuts?: Manifold[]; drain?: boolean; adds?: { bottom?: Manifold[]; top?: Manifold[] } }`,
  `clamshell(M, o): [Manifold, Manifold]` (bottom half, top half, both in place, not flipped), `EAR_R = 4`, `earCentres(inner, wall): V3[]`.

- [ ] **Step 1: Write the failing test** — `clamshell.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { box } from "../shapes";
import { clamshell, earCentres } from "./clamshell";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const inner = { lo: [-30, -20, -10] as [number, number, number], hi: [30, 20, 15] as [number, number, number] };

describe("clamshell", () => {
  it("two halves split at splitZ, the cavity is empty, the walls are closed", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0, drain: true });
    const cavity = box(M, inner.lo, inner.hi);
    expect(bot.intersect(cavity).volume()).toBeLessThan(1e-3);
    expect(top.intersect(cavity).volume()).toBeLessThan(1e-3);
    expect(bot.boundingBox().max[2]).toBeGreaterThan(0);          // the lip rises above the split
    expect(top.boundingBox().min[2]).toBeCloseTo(0, 3);
    // the lip of the bottom half fits into the recess of the top half
    expect(bot.intersect(top).volume()).toBeLessThan(1e-3);
    // walls closed: a box just outside the cavity (inside the wall) is mostly plastic, except the drain
    const wallBand = box(M, [inner.lo[0] - 1.5, inner.lo[1] - 1.5, inner.lo[2] - 1.5], [inner.hi[0] + 1.5, inner.hi[1] + 1.5, inner.hi[2] + 1.5]).subtract(cavity);
    const shell = bot.add(top);
    expect(shell.intersect(wallBand).volume() / wallBand.volume()).toBeGreaterThan(0.95);
  });
  it("screw ears: an M3 hole goes through both halves at every ear", () => {
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0 });
    for (const c of earCentres(inner, 2)) {
      const screw = M.Manifold.cylinder(100, 1.5, 1.5, 16).translate([c[0], c[1], -50]);
      expect(bot.add(top).intersect(screw).volume()).toBeLessThan(1e-3);
      const ring = M.Manifold.cylinder(10, 3.5, 3.5, 24).subtract(M.Manifold.cylinder(10, 2.2, 2.2, 24)).translate([c[0], c[1], -5]);
      expect(bot.add(top).intersect(ring).volume()).toBeGreaterThan(1);
    }
  });
  it("applies the cuts to both halves", () => {
    const hole = M.Manifold.cylinder(40, 4, 4, 24).rotate([0, 90, 0]).translate([20, 0, 0]);
    const [bot, top] = clamshell(M, { inner, wall: 2, splitZ: 0, cuts: [hole] });
    expect(bot.add(top).intersect(M.Manifold.cylinder(10, 3.5, 3.5, 24).rotate([0, 90, 0]).translate([28, 0, 0])).volume()).toBeLessThan(1e-3);
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/print/shells/clamshell.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `clamshell.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR, M3_HOLE, M3_NUT, M3_NUT_DEPTH } from "../rules";
import { box, rod, type V3 } from "../shapes";
import { grow, type Box3 } from "./geometry";

/** Two-half box round an inner cavity: a lip on the bottom half seats in a recess of the top half (seal it with
 *  silicone outdoors), four M3 screw ears at the vertical corners, and the caller's cuts (wire, coax, connector holes). */
export type ClamOpts = { inner: Box3; wall: number; splitZ: number; cuts?: Manifold[]; drain?: boolean; adds?: { bottom?: Manifold[]; top?: Manifold[] } };

export const EAR_R = 4;
const LIP_H = 3;

/** Ear (screw) centres: just outside the outer corners, so the screw never enters the cavity. */
export function earCentres(inner: Box3, wall: number): V3[] {
  const o = grow(inner, wall), k = EAR_R - 1;
  return [[o.lo[0] - k, o.lo[1] - k, 0], [o.hi[0] + k, o.lo[1] - k, 0], [o.lo[0] - k, o.hi[1] + k, 0], [o.hi[0] + k, o.hi[1] + k, 0]];
}

export function clamshell(M: ManifoldToplevel, o: ClamOpts): [Manifold, Manifold] {
  const out = grow(o.inner, o.wall), lipOut = grow(o.inner, o.wall / 2);
  const z0 = out.lo[2], z1 = out.hi[2];
  let body = box(M, out.lo, out.hi);
  for (const c of earCentres(o.inner, o.wall)) {
    body = body.add(M.Manifold.hull([M.Manifold.cylinder(z1 - z0, EAR_R, EAR_R, 24).translate([c[0], c[1], z0]), box(M, [c[0] - 0.1, c[1] - 0.1, z0], [c[0] + 0.1, c[1] + 0.1, z1]).translate([Math.sign(-c[0]) * EAR_R, Math.sign(-c[1]) * EAR_R, 0])]));
  }
  body = body.subtract(box(M, o.inner.lo, o.inner.hi));
  const cuts: Manifold[] = [...(o.cuts ?? [])];
  for (const c of earCentres(o.inner, o.wall)) {
    cuts.push(M.Manifold.cylinder(z1 - z0 + 2, M3_HOLE / 2, M3_HOLE / 2, 16).translate([c[0], c[1], z0 - 1]));
    cuts.push(M.Manifold.cylinder(M3_NUT_DEPTH + 1, M3_NUT / 2, M3_NUT / 2, 6).translate([c[0], c[1], z0 - 1]));
  }
  if (o.drain) cuts.push(rod(M, [o.inner.lo[0] + 4, o.inner.lo[1] + 4, z0 - 1], [o.inner.lo[0] + 4, o.inner.lo[1] + 4, o.inner.lo[2] + 1], 3));
  // the lip: a band half a wall thick round the cavity, LIP_H above the split, on the bottom half
  const lip = box(M, [lipOut.lo[0], lipOut.lo[1], o.splitZ - 0.01], [lipOut.hi[0], lipOut.hi[1], o.splitZ + LIP_H]).subtract(box(M, [o.inner.lo[0], o.inner.lo[1], o.splitZ - 1], [o.inner.hi[0], o.inner.hi[1], o.splitZ + LIP_H + 1]));
  const recess = box(M, [lipOut.lo[0] - CLEAR / 2, lipOut.lo[1] - CLEAR / 2, o.splitZ - 1], [lipOut.hi[0] + CLEAR / 2, lipOut.hi[1] + CLEAR / 2, o.splitZ + LIP_H + CLEAR]);
  let bottom = body.trimByPlane([0, 0, -1], -o.splitZ).add(lip);
  let top = body.trimByPlane([0, 0, 1], o.splitZ).subtract(recess);
  for (const a of o.adds?.bottom ?? []) bottom = bottom.add(a);
  for (const a of o.adds?.top ?? []) top = top.add(a);
  for (const c of cuts) { bottom = bottom.subtract(c); top = top.subtract(c); }    // one at a time (manifold batch-union defect)
  return [bottom, top];
}
```

The ear hull above joins each ear cylinder to the box corner; if it produces a degenerate hull, replace it with
`M.Manifold.cylinder(...)` plus `box(M, [min(c, corner), …], [max(c, corner), …])` (a bridge block between ear centre
and the outer corner). Keep the ear outside the cavity (the test checks the cavity is empty).

- [ ] **Step 4: Run** — `npx vitest run src/lib/print/shells/clamshell.test.ts` → PASS.
- [ ] **Step 5: Commit** — `"Shells: clamshell generator"` (+ trailers).

---

### Task 3: Dome generator

**Files:**
- Modify: `src/lib/print/shapes.ts` (`Joint.below` optional)
- Create: `src/lib/print/shells/dome.ts`, `src/lib/print/shells/dome.test.ts`

**Interfaces:**
- Consumes: `stack`, `pieceBottoms` (shapes.ts).
- Produces: `type DomeBase = { kind: "flange"; pocketR: number; pocketH: number; ringR: number; holeR: number } | { kind: "mast"; mastD: number }`,
  `type DomeOpts = { r: number; z0: number; z1: number; wall: number; base: DomeBase; drain: boolean }`,
  `dome(M, o): Manifold[]` (pieces standing on z = 0), `domeHeight(o): number` (total body height incl. cone).

- [ ] **Step 1: `Joint.below` optional** — in `shapes.ts` change `export type Joint = { below: Manifold; …}` to
  `below?: Manifold` and in `stack`: `if (z1 !== Infinity) { p = p.trimByPlane([0, 0, -1], -z1); const j = joint(z1); if (j.below) p = p.add(j.below); }`.
  Existing tests stay green.

- [ ] **Step 2: Write the failing test** — `dome.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { pieceBottoms } from "../shapes";
import { dome, domeHeight, type DomeOpts } from "./dome";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const restack = (segs: ReturnType<typeof dome>, H: number) => { const zs = pieceBottoms(H); return M.Manifold.union(segs.map((s, i) => s.translate([0, 0, segs.length > 1 ? zs[i] : 0]))); };

describe("dome", () => {
  const flange: DomeOpts = { r: 35, z0: 0, z1: 380, wall: 2, base: { kind: "flange", pocketR: 41, pocketH: 2.3, ringR: 51, holeR: 46 }, drain: true };
  it("the inside (cylinder r, up to z1) is empty, the pieces fit the bed and add up", () => {
    const segs = dome(M, flange), H = domeHeight(flange);
    expect(segs.length).toBe(pieceBottoms(H).length);
    segs.forEach((s) => { const b = s.boundingBox(); expect(Math.max(b.max[0] - b.min[0], b.max[2] - b.min[2])).toBeLessThanOrEqual(180); });
    const whole = restack(segs, H);
    expect(whole.intersect(M.Manifold.cylinder(380 - 2.4, 34.9, 34.9, 64).translate([0, 0, 2.4])).volume()).toBeLessThan(1e-2);
    expect(whole.intersect(M.Manifold.cylinder(2.3, 40.8, 40.8, 64)).volume()).toBeLessThan(1e-2);   // pocket over the former flange
  });
  it("flange: 3 M3 holes at holeR, outside the pocket", () => {
    const whole = restack(dome(M, flange), domeHeight(flange));
    for (const a of [0, 120, 240]) {
      const x = 46 * Math.cos((a * Math.PI) / 180), y = 46 * Math.sin((a * Math.PI) / 180);
      expect(whole.intersect(M.Manifold.cylinder(20, 1.5, 1.5, 16).translate([x, y, -5])).volume()).toBeLessThan(1e-3);
    }
  });
  it("mast base: a mast hole through the bottom plate", () => {
    const o: DomeOpts = { r: 40, z0: -60, z1: 30, wall: 2, base: { kind: "mast", mastD: 25 }, drain: true };
    const whole = restack(dome(M, o), domeHeight(o));
    expect(whole.intersect(M.Manifold.cylinder(200, 12.4, 12.4, 48).translate([0, 0, -100])).volume()).toBeLessThan(1e-2);
  });
});
```

(The dome is built standing on its base: local z = 0 is `o.z0` minus the base thickness; the test's coordinates assume
`z0 = 0` → base at z = 0 for the flange case. Implement so that for `flange` the body's z = 0 is the reflector face
and the pocket is cut from z = 0 up to `pocketH`; for `mast`, the plate is below `z0`, and the body is translated so
its lowest point is at z = 0 — document the offset as `domeOffset(o)` and use it in the mast test:
`whole.translate([0, 0, domeOffset(o)])` gives world coordinates.)

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/lib/print/shells/dome.test.ts` → FAIL.

- [ ] **Step 4: Implement** — `dome.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR, M3_HOLE } from "../rules";
import { rod, stack } from "../shapes";

/** Dome radome round the z axis: a tube with a cone top steeper than 45° (prints without supports) and either a flange
 *  that screws to the reflector over the antenna's own base flange, or a bottom plate with a mast hole. */
export type DomeBase = { kind: "flange"; pocketR: number; pocketH: number; ringR: number; holeR: number } | { kind: "mast"; mastD: number };
export type DomeOpts = { r: number; z0: number; z1: number; wall: number; base: DomeBase; drain: boolean };

const SKIRT = 6;                   // joint between stacked pieces: an outer skirt on the piece above
const FLANGE_T = 2;
const sides = (r: number) => Math.max(48, Math.ceil((2 * Math.PI) / Math.sqrt(0.4 / r)));

/** World z of the body's z = 0 (the body is built standing on z = 0). */
export const domeOffset = (o: DomeOpts) => (o.base.kind === "flange" ? o.z0 : o.z0 - o.wall);
/** Height of the body from z = 0 to the cone apex. */
export const domeHeight = (o: DomeOpts) => (o.z1 - domeOffset(o)) + o.r + o.wall * Math.SQRT2;

export function dome(M: ManifoldToplevel, o: DomeOpts): Manifold[] {
  const ro = o.r + o.wall, n = sides(ro), off = domeOffset(o);
  const top = o.z1 - off;                                       // inner top of the tube in body coordinates
  const H = domeHeight(o);
  const outer = M.Manifold.union([
    M.Manifold.cylinder(top, ro, ro, n),
    M.Manifold.hull([M.Manifold.cylinder(0.01, ro, ro, n).translate([0, 0, top]), M.Manifold.sphere(0.05, 8).translate([0, 0, H])]),
  ]);
  const innerTop = M.Manifold.cylinder(o.r, o.r, 0, n).translate([0, 0, top]);
  let body = outer;
  const cuts: Manifold[] = [M.Manifold.cylinder(top + 1, o.r, o.r, n).translate([0, 0, o.base.kind === "flange" ? -1 : o.wall]), innerTop];
  if (o.base.kind === "flange") {
    const b = o.base;
    body = body.add(M.Manifold.cylinder(b.pocketH + FLANGE_T, b.ringR, b.ringR, sides(b.ringR)));
    cuts.push(M.Manifold.cylinder(b.pocketH + 0.01, b.pocketR, b.pocketR, sides(b.pocketR)).translate([0, 0, -0.01]));
    for (const a of [0, 120, 240]) cuts.push(M.Manifold.cylinder(b.pocketH + FLANGE_T + 2, M3_HOLE / 2, M3_HOLE / 2, 16).translate([b.holeR * Math.cos((a * Math.PI) / 180), b.holeR * Math.sin((a * Math.PI) / 180), -1]));
    if (o.drain) cuts.push(rod(M, [o.r - 2, 0, b.pocketH + 1], [b.ringR + 1, 0, b.pocketH + 1], 3));
  } else {
    cuts.push(M.Manifold.cylinder(o.wall + 2, (o.base.mastD + CLEAR) / 2, (o.base.mastD + CLEAR) / 2, 48).translate([0, 0, -1]));
    if (o.drain) cuts.push(M.Manifold.cylinder(o.wall + 2, 1.5, 1.5, 16).translate([o.r - 4, 0, -1]));
  }
  for (const c of cuts) body = body.subtract(c);
  return stack(body, H, (zc) => ({
    aboveAdd: M.Manifold.cylinder(SKIRT + 1, ro + o.wall + CLEAR / 2, ro + o.wall + CLEAR / 2, n)
      .subtract(M.Manifold.cylinder(SKIRT + 3, ro + CLEAR / 2, ro + CLEAR / 2, n).translate([0, 0, -1])).translate([0, 0, zc - SKIRT]),
  }));
}
```

- [ ] **Step 5: Run** — `npx vitest run src/lib/print/shells/dome.test.ts src/lib/print` → PASS (stack change keeps
  the former tests green).
- [ ] **Step 6: Commit** — `"Shells: dome radome generator; stack joints may add only above"` (+ trailers).

---

### Task 4: `shellFor` for wire antennas (full shell or feed box) and registration

**Files:**
- Create: `src/lib/print/shells/index.ts`, `src/lib/print/shells/shells.test.ts`
- Modify: `src/lib/print/families/hub.ts` (export `gpMastAxis`), `src/lib/print/index.ts`, `src/lib/print/print.test.ts`, `src/i18n/uk.ts`

**Interfaces:**
- Consumes: Tasks 1–3; `helixGeometry` (former.ts), `disconeGeometry` (hub.ts), `num` (types).
- Produces: `shellFor(defId: string, p: Params, d: Design, family: PartSpec[], category: string): PartSpec | null` (null for PCB antennas
  until Task 5), `shellPlan(defId, p, d)` (pure, returns the chosen kind and inputs, used by tests),
  `SHELL_STRINGS`, `SHELL_HOWTO`.

Per-antenna choice (`shellPlan`):

| defId | full shell when it fits | otherwise |
|---|---|---|
| `helix` | dome, flange base: `r = R + wireD/2 + gap`, `z0 = 0`, `z1 = max(g.H, g.top + wireD/2) + gap`, `pocketR = fr + CLEAR`, `pocketH = 2 + CLEAR`, `ringR = fr + 10`, `holeR = fr + 5` (fr = former flange radius `R + wireD/2 + 8`) | feed box |
| `discone` | dome, mast base: `r = max(disc radius, cone base radius) + wireD/2 + gap` (from the wires), `z0 = −coneH − gap`, `z1 = disconeGeometry.top + gap`, `mastD = mm(num(p, "mast", 25e-3))` | feed box + mast exit |
| every other wire antenna | clamshell: `inner = grow(envelope(d), gap)`, `splitZ = feedPoint(d)[2]`, cuts: one hole per `exits(d, inner)` with `d + CLEAR + 1`, coax gland Ø8 down at the feed point | feed box |

Feed box: inner = cube centred at `feedPoint(d)` of side `max(30, s)` grown by gap, where `s` comes from the family's
feed part (built once; ids `dipole-centre`, `fan-centre`, `gp-hub`, `discone-hub`, `yagi-driven` or `yagi-drill`,
`biquad-standoff`, `helix-tube`): `s = 2·max |bbox corner − feed point|` for world-frame parts (dipole, fan, GP,
discone, helix) and the bbox diagonal for the others (Yagi, biquad). Cuts: holes for `exits(d, inner)`, coax gland
Ø8 at the bottom below the feed point, plus extra exits: discone mast down (`mastD`), ground-plane mast along
`gpMastAxis(d)` (vertical, Ø30, through the bottom). Split at the feed point z.

- [ ] **Step 1: Export the GP mast axis** — in `hub.ts`, extract the mast azimuth already computed in
  `groundPlaneParts` into

```ts
/** Where a mast strapped to the GP hub's side block runs (vertical, mm): the block face at radius 28 between radials. */
export function gpMastAxis(d: Design): V3 {
  const p = hubGeometry(d).paths;
  const az = Math.atan2(p[0].h[1], p[0].h[0]) + Math.PI / p.length;
  return [Math.cos(az) * 28 + Math.cos(az) * 15, Math.sin(az) * 28 + Math.sin(az) * 15, 0];   // mast centre: block face + a 30 mm mast's radius
}
```

and use the same `az` in `groundPlaneParts` (no geometry change).

- [ ] **Step 2: Write the failing test** — `shells.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { ANTENNAS } from "../../antennas";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { rod } from "../shapes";
import { exits, STYLE, styleOf } from "./geometry";
import { shellPlan } from "./index";
import { setup } from "../families/testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const wireIds = ANTENNAS.filter((a) => a.category !== "Printed").map((a) => a.id);

describe("shells for wire antennas", () => {
  it("every wire antenna has exactly one shell, and it builds at defaults", () => {
    for (const id of wireIds) {
      const { p, d } = setup(id);
      const sh = partsFor(id, p, d).filter((s) => s.id === "shell");
      expect(sh.length, id).toBe(1);
      expect(buildPart(M, sh[0], id).ok, id).toBe(true);
    }
  }, 120_000);
  it("kind by size: a 5.8 GHz dipole is fully enclosed, a 7 MHz dipole gets a feed box; GPS helix gets a dome", () => {
    const plan = (id: string, extra = {}) => { const { p, d } = setup(id, extra); return shellPlan(id, p, d).kind; };
    expect(plan("dipole", { bands: "5725e6-5875e6", d: 1e-3 })).toBe("box");
    expect(plan("dipole", { bands: "7e6-7.2e6" })).toBe("feed");
    expect(plan("helix")).toBe("dome");
  });
  it("full shells keep the gap from every live wire", () => {
    for (const [id, extra] of [["dipole", { bands: "5725e6-5875e6", d: 1e-3 }], ["helix", {}], ["helix", { bands: "5725e6-5875e6", d: 1e-3, turns: 5 }], ["moxon", { bands: "2400e6-2483e6", d: 1e-3 }], ["biquad", {}]] as const) {
      const { p, d } = setup(id, extra);
      const plan = shellPlan(id, p, d);
      expect(plan.kind === "feed", `${id} ${JSON.stringify(extra)}`).toBe(false);
      const shell = M.Manifold.union(partsFor(id, p, d).find((s) => s.id === "shell")!.build(M).map((s, i, all) => s.translate([0, 0, plan.pieceZ?.(i, all.length) ?? 0])).map((s) => s.translate(plan.toWorld ?? [0, 0, 0])));
      const gap = STYLE[styleOf(d)].gap;
      for (const w of d.wires.filter((x) => !x.drawOnly && !x.necOnly)) {
        const a = w.a.map((v) => v * 1000) as [number, number, number], b = w.b.map((v) => v * 1000) as [number, number, number];
        expect(shell.intersect(rod(M, a, b, 2 * w.r * 1000 + 2 * (gap - 0.1))).volume(), `${id} wire`).toBeLessThan(1e-2);
      }
    }
  }, 120_000);
  it("feed boxes: every exit ray passes clear through its hole", () => {
    for (const id of ["dipole", "fandipole", "yagi", "moxon", "quad", "jpole", "collinear", "groundplane"]) {
      const { p, d } = setup(id);
      const plan = shellPlan(id, p, d);
      if (plan.kind !== "feed") continue;
      const shell = M.Manifold.union(partsFor(id, p, d).find((s) => s.id === "shell")!.build(M));
      for (const x of exits(d, plan.inner)) {
        const probe = rod(M, x.at, [x.at[0] + x.dir[0] * 20, x.at[1] + x.dir[1] * 20, x.at[2] + x.dir[2] * 20], x.d);
        expect(shell.intersect(probe).volume(), `${id} exit ${x.at}`).toBeLessThan(1e-2);
      }
    }
  }, 120_000);
});
```

(`shellPlan` returns `{ kind: "dome" | "box" | "feed", inner: Box3, style, toWorld?: V3, pieceZ?: (i, n) => number }`:
`toWorld` is the dome's `[0, 0, domeOffset]`, `pieceZ` re-stacks dome pieces with `pieceBottoms(domeHeight)`.)

- [ ] **Step 3: Run to verify it fails** — `npx vitest run src/lib/print/shells/shells.test.ts` → FAIL.

- [ ] **Step 4: Implement** `shells/index.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design, Params } from "../../types";
import { num } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, mm } from "../rules";
import { pieceBottoms, rod, scale, add, type V3 } from "../shapes";
import { helixGeometry } from "../families/former";
import { disconeGeometry, gpMastAxis } from "../families/hub";
import { boxFits, domeFits, envelope, exits, feedPoint, grow, size, STYLE, styleOf, type Box3, type Exit, type Style } from "./geometry";
import { clamshell } from "./clamshell";
import { dome, domeHeight, domeOffset, type DomeOpts } from "./dome";

/** Shells: dome radome, clamshell box or feedpoint weather box. */
export const SHELL_STRINGS = [
  "Radome shell",
  "Enclosure",
  "Feedpoint weather box",
  "Covers the antenna with a {0} wall, keeping {1} of air round the radiator.",
  "Seals the feedpoint and the connector: one hole per wire, a coax gland underneath and a drain hole.",
  "A plastic shell lowers the resonance by about 1–3 %: retune with Trim (printed antennas: check with the FDTD simulation).",
];

/** How-to steps, in order. */
export const SHELL_HOWTO = {
  dome: [
    "Print the pieces standing on their wide end; glue each skirt over the piece below.",
    "Build and tune the antenna first, then lower the radome over it.",
    "Screw the flange to the reflector with three M3 screws (or push the mast through the bottom plate), keeping the drain hole at the bottom.",
  ],
  box: [
    "Print each half on its flat outer face.",
    "Lay the antenna into the bottom half with the wires through their holes and the coax through the gland.",
    "Run a bead of silicone along the lip outdoors, close the top half and fit four M3 screws and nuts.",
  ],
  feed: [
    "Print each half on its flat outer face.",
    "Thread the wires through their holes before soldering the feedpoint; the coax goes in through the gland underneath.",
    "Fill the wire holes with silicone, close the box on its lip and fit four M3 screws and nuts; keep the drain hole at the bottom.",
  ],
};

const GLAND = 8;
const FEED_PART: Record<string, { ids: string[]; world: boolean }> = {
  dipole: { ids: ["dipole-centre"], world: true }, fandipole: { ids: ["fan-centre"], world: true },
  groundplane: { ids: ["gp-hub"], world: true }, discone: { ids: ["discone-hub"], world: true }, helix: { ids: ["helix-tube"], world: true },
  yagi: { ids: ["yagi-driven", "yagi-drill"], world: false }, biquad: { ids: ["biquad-standoff"], world: false },
};

export type ShellPlan =
  | { kind: "dome"; style: Style; inner: Box3; opts: DomeOpts; toWorld: V3; pieceZ: (i: number, n: number) => number }
  | { kind: "box" | "feed"; style: Style; inner: Box3; splitZ: number; extra: Exit[]; gland: V3; toWorld?: undefined; pieceZ?: undefined };

function domePlan(defId: string, p: Params, d: Design, s: Style): DomeOpts | null {
  const { wall, gap } = STYLE[s];
  if (defId === "helix") {
    const g = helixGeometry(d), fr = g.R + g.wireD / 2 + 8;
    return { r: g.R + g.wireD / 2 + gap, z0: 0, z1: Math.max(g.H, g.top + g.wireD / 2) + gap, wall, base: { kind: "flange", pocketR: fr + CLEAR, pocketH: 2 + CLEAR, ringR: fr + 10, holeR: fr + 5 }, drain: s === "outdoor" };
  }
  if (defId === "discone") {
    const g = disconeGeometry(d), e = envelope(d);
    const r = Math.max(...[e.lo[0], e.lo[1], e.hi[0], e.hi[1]].map(Math.abs)) + gap;
    return { r, z0: e.lo[2] - gap, z1: Math.max(g.top, e.hi[2]) + gap, wall, base: { kind: "mast", mastD: mm(num(p, "mast", 25e-3)) }, drain: s === "outdoor" };
  }
  return null;
}

function feedInner(M: ManifoldToplevel | null, defId: string, d: Design, family: PartSpec[], gap: number): Box3 {
  const fp = feedPoint(d);
  let s = 30;
  const fpart = FEED_PART[defId] && family.find((x) => FEED_PART[defId].ids.includes(x.id));
  if (M && fpart) {
    const b = fpart.build(M)[0].boundingBox();
    s = Math.max(s, FEED_PART[defId].world
      ? 2 * Math.max(...[0, 1, 2].flatMap((i) => [Math.abs(b.min[i] - fp[i]), Math.abs(b.max[i] - fp[i])]))
      : Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]));
  }
  return grow({ lo: [fp[0] - s / 2, fp[1] - s / 2, fp[2] - s / 2], hi: [fp[0] + s / 2, fp[1] + s / 2, fp[2] + s / 2] }, gap);
}

/** Pure choice of the shell (no building): the feed box's inner size from the feed part is only known at build time,
 *  so the plan uses the 30 mm default there; `shellFor` refines it. */
export function shellPlan(defId: string, p: Params, d: Design, M: ManifoldToplevel | null = null, family: PartSpec[] = []): ShellPlan {
  const style = styleOf(d), { wall, gap } = STYLE[style];
  const dp = domePlan(defId, p, d, style);
  if (dp && domeFits(dp.r, dp.z1 - dp.z0, wall)) {
    const H = domeHeight(dp);
    return { kind: "dome", style, inner: { lo: [-dp.r, -dp.r, dp.z0], hi: [dp.r, dp.r, dp.z1] }, opts: dp, toWorld: [0, 0, domeOffset(dp)], pieceZ: (i, n) => (n > 1 ? pieceBottoms(H)[i] : 0) };
  }
  const fp = feedPoint(d);
  const full = grow(envelope(d), gap);
  if (!dp && boxFits(full, wall)) return { kind: "box", style, inner: full, splitZ: fp[2], extra: [], gland: fp };
  const inner = feedInner(M, defId, d, family, gap);
  const extra: Exit[] = [];
  if (defId === "discone") extra.push({ at: [0, 0, inner.lo[2]], dir: [0, 0, -1], d: mm(num(p, "mast", 25e-3)) });
  if (defId === "groundplane") { const m = gpMastAxis(d); extra.push({ at: [m[0], m[1], inner.lo[2]], dir: [0, 0, -1], d: 30 }, { at: [m[0], m[1], inner.hi[2]], dir: [0, 0, 1], d: 30 }); }
  return { kind: "feed", style, inner, splitZ: fp[2], extra, gland: fp };
}

function holes(M: ManifoldToplevel, xs: Exit[], wall: number): Manifold[] {
  return xs.map((x) => rod(M, add(x.at, scale(x.dir, -wall - 2)), add(x.at, scale(x.dir, wall + 8)), x.d + CLEAR + 1));
}

export function shellFor(defId: string, p: Params, d: Design, family: PartSpec[], category: string): PartSpec | null {
  if (category === "Printed") return null;                        // printed antennas: Task 5
  const style = styleOf(d), { wall, gap } = STYLE[style];
  const first = shellPlan(defId, p, d);
  const L = (x: number) => ({ len: x / 1000 });
  const titles = { dome: SHELL_STRINGS[0], box: SHELL_STRINGS[1], feed: SHELL_STRINGS[2] };
  return {
    id: "shell", title: titles[first.kind], use: "holder", qty: 1,
    purpose: first.kind === "feed" ? msg(SHELL_STRINGS[4]) : msg(SHELL_STRINGS[3], L(wall), L(gap)),
    warn: first.kind === "feed" ? undefined : msg(SHELL_STRINGS[5]),
    howTo: SHELL_HOWTO[first.kind].map((s) => msg(s)),
    build: (M) => {
      const plan = first.kind === "feed" ? shellPlan(defId, p, d, M, family) : first;
      if (plan.kind === "dome") return dome(M, plan.opts);
      const xs = [...exits(d, plan.inner), ...plan.extra];
      const cuts = [...holes(M, xs, wall), rod(M, [plan.gland[0], plan.gland[1], plan.inner.lo[2] - wall - 2], [plan.gland[0], plan.gland[1], plan.inner.lo[2] + 1], GLAND)];
      return clamshell(M, { inner: plan.inner, wall, splitZ: plan.splitZ, cuts, drain: style === "outdoor" });
    },
  };
}
```

`category` comes from `ANTENNA_BY_ID[defId].category` (PCB loop has no `d.pcb`, so the category is the reliable test).
Drop unused imports (`size`) so lint passes.

`src/lib/print/index.ts`:

```ts
export const partsFor = (defId: string, p: Params, d: Design): PartSpec[] => {
  const family = FAMILIES[defId]?.(p, d) ?? [];
  const shell = shellFor(defId, p, d, family, ANTENNA_BY_ID[defId]?.category ?? "");
  return shell ? [...family, shell] : family;
};
```

(import `ANTENNA_BY_ID` from `../antennas`; check that this creates no import cycle — `antennas` must not import
`print`. If it does, pass the category from the callers instead.) Add `...SHELL_STRINGS, ...Object.values(SHELL_HOWTO).flat()`
to `PRINT_STRINGS`.

`print.test.ts`: in "every wire antenna has at least one printed part" nothing changes; the extremes test now also
builds shells (expect a longer run: keep its 300 s timeout).

`uk.ts`:

```ts
  "Radome shell": "Обтічник",
  "Enclosure": "Корпус",
  "Feedpoint weather box": "Захисна коробка точки живлення",
  "Covers the antenna with a {0} wall, keeping {1} of air round the radiator.": "Закриває антену стінкою {0} і лишає {1} повітря навколо випромінювача.",
  "Seals the feedpoint and the connector: one hole per wire, a coax gland underneath and a drain hole.": "Герметизує точку живлення і роз'єм: по отвору на кожен дріт, ввід коаксіалу знизу і дренажний отвір.",
  "A plastic shell lowers the resonance by about 1–3 %: retune with Trim (printed antennas: check with the FDTD simulation).": "Пластиковий корпус знижує резонанс приблизно на 1–3 %: підлаштуйте Trim (друковані антени: перевірте симуляцією FDTD).",
  "Print the pieces standing on their wide end; glue each skirt over the piece below.": "Друкуйте частини стоячи на широкому кінці; приклейте кожну спідницю поверх нижньої частини.",
  "Build and tune the antenna first, then lower the radome over it.": "Спершу зберіть і налаштуйте антену, потім опустіть на неї обтічник.",
  "Screw the flange to the reflector with three M3 screws (or push the mast through the bottom plate), keeping the drain hole at the bottom.": "Прикрутіть фланець до рефлектора трьома гвинтами M3 (або просуньте щоглу крізь нижню пластину), дренажний отвір має бути внизу.",
  "Print each half on its flat outer face.": "Друкуйте кожну половину на її пласкій зовнішній грані.",
  "Lay the antenna into the bottom half with the wires through their holes and the coax through the gland.": "Покладіть антену в нижню половину, дроти в їхні отвори, коаксіал крізь ввід.",
  "Run a bead of silicone along the lip outdoors, close the top half and fit four M3 screws and nuts.": "Для зовнішнього монтажу нанесіть валик силікону вздовж бортика, закрийте верхню половину і вставте чотири гвинти M3 з гайками.",
  "Thread the wires through their holes before soldering the feedpoint; the coax goes in through the gland underneath.": "Протягніть дроти крізь отвори до припаювання точки живлення; коаксіал заходить крізь ввід знизу.",
  "Fill the wire holes with silicone, close the box on its lip and fit four M3 screws and nuts; keep the drain hole at the bottom.": "Заповніть отвори для дротів силіконом, закрийте коробку по бортику і вставте чотири гвинти M3 з гайками; дренажний отвір має бути внизу.",
```

- [ ] **Step 5: Run tests** — `npx vitest run src/lib/print src/i18n.test.ts` → PASS. If a full box at defaults
  turns out larger than expected (e.g. the 2.4 GHz biquad reflector ~125 mm + gaps + ears), `boxFits` decides; the
  test only requires *a* shell that builds.
- [ ] **Step 6: Commit** — `"Shells: radome, enclosure or feed box for every wire antenna"` (+ trailers).

---

### Task 5: PCB enclosures

**Files:**
- Create: `src/lib/print/shells/pcbbox.ts`, `src/lib/print/shells/pcbbox.test.ts`
- Modify: `src/lib/print/shells/index.ts`, `src/lib/print/print.test.ts`, `src/i18n/uk.ts`

**Interfaces:**
- Consumes: `clamshell`, `STYLE`, `styleOf`, `envelope`, `grow`.
- Produces: `pcbShell(M, d): Manifold[]`, `pcbEntry(d): { at: V3; dir: V3; probe: boolean }`, `postSpots(d, layer): V3[]`.

Rules:
- Inner box = board xy grown by gap, z from −gap to h + gap. Split at z = h/2.
- Posts (3 × 3 mm) from the cavity floor up to z = 0 (bottom half) and from z = h up to the cavity top (top half), at
  the 4 board corners and 4 edge midpoints (2 mm in from the edge), only where the post footprint + 0.5 mm has no
  copper on the touching layer (bottom posts: bottom copper; top posts: top copper). At least 2 spots per side, else
  none on that side (the how-to then says to fix the board with a drop of hot glue at the connector).
- Entry: a probe port (`isProbe(pcb)`): Ø6.5 SMA hole straight down through the bottom wall at the port xy. Otherwise:
  the board edge nearest the port centre (x0, x1, y0 or y1); a Ø3.5 hole along the edge's outward normal at the port's
  coordinate along that edge, at z = h/2.
- PCB loop (`category Printed`, no `pcb`): plain clamshell round `envelope(d)` (grown by gap), split at its mid z,
  Ø3.5 entry on the nearest edge to the origin-side bottom (y = envelope lo y), no posts.

- [ ] **Step 1: Write the failing test** — `pcbbox.test.ts`:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { box, rod } from "../shapes";
import { setup } from "../families/testkit";
import { pcbEntry, postSpots } from "./pcbbox";
import { STYLE, styleOf } from "./geometry";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const PCB = ["patch", "pcbmonopole", "meander", "ifa", "printeddipole", "pcbloop"];

describe("PCB enclosures", () => {
  it("every printed antenna has exactly one part, the shell, and it builds", () => {
    for (const id of PCB) {
      const { p, d } = setup(id);
      const parts = partsFor(id, p, d);
      expect(parts.map((s) => s.id), id).toEqual(["shell"]);
      expect(buildPart(M, parts[0], id).ok, id).toBe(true);
    }
  });
  it("no plastic within the gap of any copper rectangle (except the posts' own touching face)", () => {
    for (const id of PCB.filter((x) => x !== "pcbloop")) {
      const { p, d } = setup(id);
      const gap = STYLE[styleOf(d)].gap, h = d.pcb!.h * 1000;
      const shell = M.Manifold.union(partsFor(id, p, d)[0].build(M));
      for (const r of d.pcb!.rects) {
        const z = r.layer === "top" ? [h, h + gap - 0.1] : [-(gap - 0.1), 0];
        const probe = box(M, [r.x0 * 1000, r.y0 * 1000, z[0]], [r.x1 * 1000, r.y1 * 1000, z[1]]);
        expect(shell.intersect(probe).volume(), `${id} ${r.label}`).toBeLessThan(1e-2);
      }
    }
  });
  it("posts never land on copper of the layer they touch", () => {
    for (const id of PCB.filter((x) => x !== "pcbloop")) {
      const { d } = setup(id);
      for (const layer of ["top", "bottom"] as const) for (const s of postSpots(d, layer))
        for (const r of d.pcb!.rects.filter((x) => x.layer === layer))
          expect(s[0] + 2 < r.x0 * 1000 || s[0] - 2 > r.x1 * 1000 || s[1] + 2 < r.y0 * 1000 || s[1] - 2 > r.y1 * 1000, `${id} ${layer}`).toBe(true);
    }
  });
  it("the coax entry is a clear path from the port through the wall", () => {
    for (const id of PCB.filter((x) => x !== "pcbloop")) {
      const { p, d } = setup(id);
      const e = pcbEntry(d), shell = M.Manifold.union(partsFor(id, p, d)[0].build(M));
      const end: [number, number, number] = [e.at[0] + e.dir[0] * 30, e.at[1] + e.dir[1] * 30, e.at[2] + e.dir[2] * 30];
      expect(shell.intersect(rod(M, e.at, end, e.probe ? 6 : 3)).volume(), id).toBeLessThan(1e-2);
    }
  });
});
```

- [ ] **Step 2: Run to verify it fails** — `npx vitest run src/lib/print/shells/pcbbox.test.ts` → FAIL.

- [ ] **Step 3: Implement** — `pcbbox.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Design } from "../../types";
import { isProbe } from "../../pcb";
import { mm } from "../rules";
import { box, rod, type V3 } from "../shapes";
import { clamshell } from "./clamshell";
import { envelope, grow, STYLE, styleOf, type Box3 } from "./geometry";

/** Enclosure for a printed antenna: the board floats on small posts that touch it only where there is no copper,
 *  with air above and below the copper, and the coax enters on the board edge nearest the port. */
const POST = 3, PIGTAIL = 3.5, SMA = 6.5;

export function postSpots(d: Design, layer: "top" | "bottom"): V3[] {
  const b = d.pcb!.board, x0 = mm(b.x0) + 2 + POST / 2, x1 = mm(b.x1) - 2 - POST / 2, y0 = mm(b.y0) + 2 + POST / 2, y1 = mm(b.y1) - 2 - POST / 2;
  const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
  const cand: V3[] = [[x0, y0, 0], [x1, y0, 0], [x0, y1, 0], [x1, y1, 0], [xm, y0, 0], [xm, y1, 0], [x0, ym, 0], [x1, ym, 0]];
  const k = POST / 2 + 0.5;
  const free = cand.filter((s) => d.pcb!.rects.filter((r) => r.layer === layer).every((r) => s[0] + k < mm(r.x0) || s[0] - k > mm(r.x1) || s[1] + k < mm(r.y0) || s[1] - k > mm(r.y1)));
  return free.length >= 2 ? free : [];
}

export function pcbEntry(d: Design): { at: V3; dir: V3; probe: boolean } {
  const pcb = d.pcb!, h = mm(pcb.h), b = pcb.board;
  const c: V3 = [mm((pcb.port.start[0] + pcb.port.stop[0]) / 2), mm((pcb.port.start[1] + pcb.port.stop[1]) / 2), h / 2];
  if (isProbe(pcb)) return { at: [c[0], c[1], 0], dir: [0, 0, -1], probe: true };
  const edges: { dist: number; at: V3; dir: V3 }[] = [
    { dist: c[0] - mm(b.x0), at: [mm(b.x0), c[1], h / 2], dir: [-1, 0, 0] },
    { dist: mm(b.x1) - c[0], at: [mm(b.x1), c[1], h / 2], dir: [1, 0, 0] },
    { dist: c[1] - mm(b.y0), at: [c[0], mm(b.y0), h / 2], dir: [0, -1, 0] },
    { dist: mm(b.y1) - c[1], at: [c[0], mm(b.y1), h / 2], dir: [0, 1, 0] },
  ];
  const e = edges.reduce((m, x) => (x.dist < m.dist ? x : m));
  return { at: e.at, dir: e.dir, probe: false };
}

export function pcbShell(M: ManifoldToplevel, d: Design): Manifold[] {
  const s = styleOf(d), { wall, gap } = STYLE[s];
  if (!d.pcb) {                                                     // PCB loop: no board model, plain enclosure
    const inner = grow(envelope(d), gap), zm = (inner.lo[2] + inner.hi[2]) / 2;
    const at: V3 = [(inner.lo[0] + inner.hi[0]) / 2, inner.lo[1], zm];
    return clamshell(M, { inner, wall, splitZ: zm, cuts: [rod(M, [at[0], at[1] + 1, zm], [at[0], at[1] - wall - 3, zm], PIGTAIL)], drain: s === "outdoor" });
  }
  const b = d.pcb.board, h = mm(d.pcb.h);
  const inner: Box3 = { lo: [mm(b.x0) - gap, mm(b.y0) - gap, -gap], hi: [mm(b.x1) + gap, mm(b.y1) + gap, h + gap] };
  const e = pcbEntry(d);
  const entry = e.probe
    ? rod(M, [e.at[0], e.at[1], 0.01], [e.at[0], e.at[1], -gap - wall - 2], SMA)
    : rod(M, e.at, [e.at[0] + e.dir[0] * (gap + wall + 3), e.at[1] + e.dir[1] * (gap + wall + 3), e.at[2]], PIGTAIL);
  const bottom = postSpots(d, "bottom").map((p) => box(M, [p[0] - POST / 2, p[1] - POST / 2, -gap - 0.5], [p[0] + POST / 2, p[1] + POST / 2, 0]));
  const top = postSpots(d, "top").map((p) => box(M, [p[0] - POST / 2, p[1] - POST / 2, h], [p[0] + POST / 2, p[1] + POST / 2, h + gap + 0.5]));
  return clamshell(M, { inner, wall, splitZ: h / 2, cuts: [entry], adds: { bottom, top }, drain: s === "outdoor" });
}
```

`shells/index.ts`: for category `"Printed"`, return the shell `PartSpec` with title "Enclosure", purpose
`msg(SHELL_STRINGS[3], L(wall), L(gap))`, the warn, a PCB how-to, and `build: (M) => pcbShell(M, d)`. New strings:

```ts
  // SHELL_HOWTO.pcb
  "Print each half on its flat outer face.",                                   // reuse the existing key
  "Solder the coax pigtail (or the SMA jack under a probe feed) to the board, then lay the board on the posts of the bottom half with the coax through its hole.",
  "Close the top half and fit four M3 screws and nuts; where there are no posts, fix the board with a drop of hot glue next to the coax.",
```

with UK:

```ts
  "Solder the coax pigtail (or the SMA jack under a probe feed) to the board, then lay the board on the posts of the bottom half with the coax through its hole.": "Припаяйте коаксіальний кабель (або гніздо SMA під зондовим живленням) до плати, потім покладіть плату на стійки нижньої половини, кабель крізь його отвір.",
  "Close the top half and fit four M3 screws and nuts; where there are no posts, fix the board with a drop of hot glue next to the coax.": "Закрийте верхню половину і вставте чотири гвинти M3 з гайками; якщо стійок немає, закріпіть плату краплею термоклею біля кабелю.",
```

`print.test.ts`: change "printed (PCB) antennas have no printed parts" to "printed antennas have exactly one part,
the shell" (`expect(partsFor(...).map((s) => s.id)).toEqual(["shell"])` for `category === "Printed"`).

- [ ] **Step 4: Run** — `npx vitest run src/lib/print src/i18n.test.ts` → PASS.
- [ ] **Step 5: Commit** — `"Shells: enclosures for printed antennas"` (+ trailers).

---

### Task 6: Docs and full verification

**Files:**
- Modify: `CLAUDE.md`, `docs/ANTENNAS.md`, `docs/superpowers/specs/2026-10-10-antenna-shells-design.md`

- [ ] **Step 1: Docs**
  - `CLAUDE.md` Layout, under `print/`: `shells/ geometry.ts (envelope, style, exits) clamshell.ts dome.ts pcbbox.ts index.ts (shellFor: radome, enclosure or feed box for every antenna)`.
  - `docs/ANTENNAS.md` printed-parts paragraph: one sentence on shells (styles, size rule, the 1–3 % detuning warning).
  - Spec: status "implemented"; note any deviation made during the tasks.
- [ ] **Step 2: Verify** — `npm test && npm run typecheck && npm run lint && npm run build`; all pass; the suite stays
  under 150 s (report the time). If it's slower, lower the work in the shell tests (fewer cases), not the coverage of
  "every antenna has a shell that builds".
- [ ] **Step 3: Commit** — `"Shells: docs"` (+ trailers).
