# 3D-printable build parts, stage 1: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build tab gets a "3D-printed parts" section that generates STL files, with how-to instructions, for the dipole, ground plane and Yagi, on a core that the later stages (helix, Moxon, quad, discone, J-pole, collinear, biquad, fan dipole) plug into.

**Architecture:** Pure geometry in `src/lib/print/` (no DOM, runs in Node tests) built with manifold-3d CSG, in mm, driven by `Design.wires` (the same geometry the solver uses). `partsFor()` lists parts cheaply on the main thread; a Web Worker loads the WASM on demand and builds and validates the meshes; `PrintPanel` lists the parts, previews the selected one as flat-shaded SVG, shows its how-to steps and downloads STL or a zip with a README.

**Tech Stack:** TypeScript 6, React 19, Vite 8, vitest 5, manifold-3d 3.5.4 (Apache-2.0, WASM).

**Spec:** `docs/superpowers/specs/2026-10-10-print-parts-design.md`

**Verified:** every code block below was run in a throwaway worktree first: `npm test` 79/79, `npm run typecheck`, `npm run lint` and `npm run build` clean, and the panel checked in Chrome (worker loads the WASM, parts listed, preview and how-to shown).

## Global Constraints

- Units: model is SI (metres); printed geometry is **mm** (`mm()` in `rules.ts`). STL is mm.
- Fixed rules, no UI: clearance 0.3 mm on diameter, wall ≥ 2 mm, insulating wall ≥ 2 mm, max part 180 mm, M3 screws with nut pockets, universal SO-239/N 4-hole flange (18.3 mm pitch, Ø16 body hole), zip-tie slots instead of fixed mast sizes.
- No printer or slicer settings anywhere in the app.
- `src/lib/**` has no DOM, no React, no i18n. Labels are English; numbers go in `Msg { s, a }` with `{ len }` in metres so the UI formats mm/inch.
- Every new English string is listed in `PRINT_STRINGS` (lib) or used as a `t("…")` literal (UI), and has a Ukrainian entry in `src/i18n/uk.ts` (the i18n test enforces both, and rejects stale keys). Check `uk.ts` for an existing key before adding (duplicate keys are a TS error); `"Part"`, `"Size"` and `"Quantity"` already exist.
- `erasableSyntaxOnly`: no enums, no parameter properties.
- manifold-3d is imported only from `src/lib/print/` and `src/print.worker.ts`, so it stays out of the main bundle.
- Commits end with the session's attribution lines.

## Review Focus

1. **Extreme parameters** (thinnest wire 0.05 mm, thickest 200 mm tube, boom 200 mm, droop 0° and 60°, 2–8 radials, 3–40 elements): a part must either build or say "too large", never crash or export a broken mesh. Pinned by "at parameter extremes…" in Task 2, which loops over every antenna that has parts.
2. **The worker can't load the WASM** (offline first visit, blocked WASM): the panel must show the error and the rest of the Build tab must keep working. Task 6 shows `st.error`; the manual check in Task 6 step 6 covers it.
3. **Units toggle**: sizes, gaps and drill sizes must follow mm/inch. Every number is a `{ len }` argument; Task 6 step 6 checks inch mode.
4. **Fast parameter edits**: stale worker results must not overwrite newer ones. The hook drops messages whose id is not the latest and terminates a busy worker (the same pattern as `useSimulation`).
5. **Printed (PCB) antennas** must show no print section (they already get Gerbers). Task 2 test plus `!design.pcb` in Task 6.

---

### Task 1: manifold-3d, rules, loader and STL writer

**Files:**
- Modify: `package.json`, `package-lock.json` (dependency)
- Create: `src/lib/print/rules.ts`, `src/lib/print/manifold.ts`, `src/lib/print/stl.ts`
- Test: `src/lib/print/print.test.ts`

**Interfaces:**
- Produces: `loadManifold(wasmUrl?: string): Promise<ManifoldToplevel>`; `meshOf(m: Manifold): TriMesh`; `flatTris(m: TriMesh): Float32Array`; `toSTL(m: TriMesh, name: string): Uint8Array`; constants `CLEAR, WALL, INSULATE, MAX_SIZE, M3_HOLE, M3_NUT, M3_NUT_DEPTH, ZIP_W, ZIP_T, FLANGE_PITCH, FLANGE_BODY` and `mm(m)`.

- [ ] **Step 1: Install the dependency**

Run: `npm install manifold-3d@3.5.4`
Expected: `package.json` dependencies gain `"manifold-3d": "^3.5.4"`.

- [ ] **Step 2: Write the failing test** (`src/lib/print/print.test.ts`)

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { loadManifold } from "./manifold";
import { meshOf, toSTL } from "./stl";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

/** Minimal binary STL reader for the round-trip test. */
function readSTL(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(80, true);
  const tris: number[][] = [];
  for (let t = 0; t < n; t++) { const o = 84 + 50 * t + 12; tris.push(Array.from({ length: 9 }, (_, k) => v.getFloat32(o + 4 * k, true))); }
  return { n, tris };
}

describe("STL writer", () => {
  it("header, count and size are consistent, and the triangles read back", () => {
    const stl = toSTL(meshOf(M.Manifold.cube([10, 20, 30])), "cube");
    const { n, tris } = readSTL(stl);
    expect(n).toBe(12);
    expect(stl.length).toBe(84 + 50 * 12);
    expect(new TextDecoder().decode(stl.slice(0, 5))).not.toBe("solid");
    const xs = tris.flatMap((t) => [t[0], t[3], t[6]]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 5);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/lib/print`
Expected: FAIL, cannot resolve `./manifold`.

- [ ] **Step 4: Implement** `src/lib/print/rules.ts`

```ts
/** Fixed geometry rules for printed parts, in mm. There are no printer settings: these suit any common FDM printer. */
export const CLEAR = 0.3;          // added to every wire, tube and boom diameter
export const WALL = 2;             // minimum wall
export const INSULATE = 2;         // plastic between conductors that must not touch
export const MAX_SIZE = 180;       // largest extent printed in one piece
export const M3_HOLE = 3.4;
export const M3_NUT = 6.6;         // M3 nut across corners (6.35) + clearance, hexagonal pocket
export const M3_NUT_DEPTH = 2.8;
export const ZIP_W = 5.2;          // zip-tie slot, fits ties up to 4.8 × 1.3 mm
export const ZIP_T = 2.2;
export const FLANGE_PITCH = 18.3;  // screw spacing of SO-239 and N 4-hole panel jacks
export const FLANGE_BODY = 16;     // hole for the jack body
export const mm = (m: number) => m * 1000;
```

`src/lib/print/manifold.ts`:

```ts
import Module from "manifold-3d";
import type { ManifoldToplevel } from "manifold-3d";

let ready: Promise<ManifoldToplevel> | null = null;

/** Load manifold-3d once. The browser passes the URL of manifold.wasm; Node finds it next to manifold.js. */
export function loadManifold(wasmUrl?: string): Promise<ManifoldToplevel> {
  ready ??= Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((M) => {
    M.setup();
    M.setCircularSegments(48);
    return M;
  });
  return ready;
}
```

`src/lib/print/stl.ts`:

```ts
import type { Manifold } from "manifold-3d";

/** Indexed triangle mesh in mm: xyz per vertex, three vertex indices per triangle. */
export interface TriMesh { pos: Float32Array; tri: Uint32Array }

export function meshOf(m: Manifold): TriMesh {
  const g = m.getMesh();
  const n = g.vertProperties.length / g.numProp;
  const pos = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) pos[3 * i + k] = g.vertProperties[i * g.numProp + k];
  return { pos, tri: g.triVerts };
}

/** Triangles as a flat array of 9 floats each (three xyz corners), for the preview. */
export function flatTris(m: TriMesh): Float32Array {
  const out = new Float32Array(3 * m.tri.length);
  m.tri.forEach((v, i) => { out[3 * i] = m.pos[3 * v]; out[3 * i + 1] = m.pos[3 * v + 1]; out[3 * i + 2] = m.pos[3 * v + 2]; });
  return out;
}

/** Binary STL (little-endian): 80-byte header, triangle count, then 50 bytes per triangle. Units are mm. */
export function toSTL(m: TriMesh, name: string): Uint8Array {
  const n = m.tri.length / 3;
  const out = new Uint8Array(84 + 50 * n), v = new DataView(out.buffer);
  const head = `antenna-generator ${name}`.slice(0, 80);   // must not start with "solid"
  for (let i = 0; i < head.length; i++) out[i] = head.charCodeAt(i) & 0x7f;
  v.setUint32(80, n, true);
  let o = 84;
  const p = (i: number) => [m.pos[3 * i], m.pos[3 * i + 1], m.pos[3 * i + 2]];
  for (let t = 0; t < n; t++) {
    const a = p(m.tri[3 * t]), b = p(m.tri[3 * t + 1]), c = p(m.tri[3 * t + 2]);
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const nx = u[1] * w[2] - u[2] * w[1], ny = u[2] * w[0] - u[0] * w[2], nz = u[0] * w[1] - u[1] * w[0];
    const l = Math.hypot(nx, ny, nz) || 1;
    for (const x of [nx / l, ny / l, nz / l, ...a, ...b, ...c]) { v.setFloat32(o, x, true); o += 4; }
    o += 2;   // attribute byte count, 0
  }
  return out;
}
```

- [ ] **Step 5: Run the test and the typecheck**

Run: `npx vitest run src/lib/print && npm run typecheck`
Expected: 1 test passes; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/print
git commit -m "Add manifold-3d, print geometry rules and binary STL writer"
```

---

### Task 2: shapes, part model, registry and the all-antenna checks

**Files:**
- Create: `src/lib/print/shapes.ts`, `src/lib/print/parts.ts`, `src/lib/print/index.ts`
- Modify: `src/i18n.test.ts` (register `PRINT_STRINGS`), `src/i18n/uk.ts`
- Test: `src/lib/print/print.test.ts`

**Interfaces:**
- Consumes: Task 1 (`rules.ts`, `stl.ts`); `Msg`, `Arg`, `en` from `src/lib/build.ts`; `Design`, `Params` from `src/lib/types.ts`.
- Produces:
  - `shapes.ts`: `type V3`, `add/sub/scale/unit`, `rod(M, a, b, d)`, `bar(M, a, b, w)`, `box(M, lo, hi)`, `channel(M, a, b, d)`, `m3(M, x, y, z0, z1, nutTop)`, `zipSlot(M, c, through, wide, len)`, `flangeCut(M, z0, z1)`.
  - `parts.ts`: `interface PartSpec { id; title; use: "jig" | "holder" | "former"; qty; purpose: Msg; howTo: Msg[]; build(M): Manifold[] }`, `type BuiltPart`, `interface Segment`, `msg(s, ...a)`, `USE_LABELS`, `PART_STRINGS`, `buildPart(M, spec, name): BuiltPart`.
  - `index.ts`: `partsFor(defId, p, d): PartSpec[]`, `PRINT_STRINGS`, `partsReadme(title, specs): string`, re-exports of `parts.ts`. Families register in `FAMILIES` (Tasks 3–5).

- [ ] **Step 1: Write the failing tests**: append to `src/lib/print/print.test.ts` and extend its imports

```ts
// add to the imports at the top
import { ANTENNAS } from "../antennas";
import type { Params } from "../types";
import { buildPart, partsFor } from ".";
import { MAX_SIZE } from "./rules";

describe("partsFor", () => {
  it("printed (PCB) antennas have no printed parts", () => {
    for (const def of ANTENNAS) { const d = def.build(def.defaults); if (d.pcb) expect(partsFor(def.id, def.defaults, d)).toEqual([]); }
  });
  it("every part of every antenna builds at defaults", () => {
    for (const def of ANTENNAS) for (const s of partsFor(def.id, def.defaults, def.build(def.defaults))) expect(buildPart(M, s, s.id).ok, `${def.id} ${s.id}`).toBe(true);
  });
  it("at parameter extremes every part builds or is reported too large, never broken", () => {
    for (const def of ANTENNAS) {
      const cases: Params[] = [];
      for (const q of def.params) {
        if ((q.kind === "int" || q.kind === "length" || q.kind === "angle") && q.min != null && q.max != null) cases.push({ [q.key]: q.min }, { [q.key]: q.max });
        if (q.kind === "select") for (const [v] of q.options!) cases.push({ [q.key]: v });
      }
      for (const extra of cases) {
        const p = { ...def.defaults, ...extra };
        for (const s of partsFor(def.id, p, def.build(p))) {
          const r = buildPart(M, s, s.id);
          if (r.ok) r.segments.forEach((g) => expect(Math.max(...g.size)).toBeLessThanOrEqual(MAX_SIZE));
          else expect(r.error.s, `${def.id} ${JSON.stringify(extra)} ${s.id}`).toBe("Too large to print in one piece: {0}");
        }
      }
    }
  });
});

describe("how-to instructions", () => {
  it("every part has numbered steps, and the zip README lists them", async () => {
    const { partsReadme } = await import(".");
    for (const def of ANTENNAS) {
      const specs = partsFor(def.id, def.defaults, def.build(def.defaults));
      specs.forEach((s) => expect(s.howTo.length, s.id).toBeGreaterThan(0));
      if (specs.length) {
        const txt = partsReadme(def.name, specs);
        for (const s of specs) expect(txt).toContain(s.title);
        expect(txt).toContain("1. ");
        expect(txt).not.toMatch(/\{\d\}/);
      }
    }
  });
});
```

These loops cover every antenna that has parts, so Tasks 3–5 automatically get the defaults, extremes and how-to checks.

In `src/i18n.test.ts`, import and register the strings:

```ts
import { PRINT_STRINGS } from "./lib/print";
// inside libStrings(), next to BUILD_STRINGS.forEach(add);
    PRINT_STRINGS.forEach(add);
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/print src/i18n.test.ts`
Expected: FAIL, cannot resolve `"."` (no `index.ts`).

- [ ] **Step 3: Implement** `src/lib/print/shapes.ts`

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { CLEAR, FLANGE_BODY, FLANGE_PITCH, M3_HOLE, M3_NUT, M3_NUT_DEPTH, ZIP_T, ZIP_W } from "./rules";

/** Building blocks for printed parts. Everything is in mm. */
export type V3 = [number, number, number];
type M = ManifoldToplevel;

export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const unit = (a: V3): V3 => scale(a, 1 / Math.hypot(...a));

/** Cylinder of diameter d from a to b. */
export function rod(M: M, a: V3, b: V3, d: number): Manifold {
  const u = sub(b, a), L = Math.hypot(...u);
  const th = (Math.acos(u[2] / L) * 180) / Math.PI, ph = (Math.atan2(u[1], u[0]) * 180) / Math.PI;
  return M.Manifold.cylinder(L, d / 2, d / 2, undefined, false).rotate([0, th, ph]).translate(a);
}

/** Bar of width w from a to b: the hull of two cubes centred on the ends. */
export const bar = (M: M, a: V3, b: V3, w: number): Manifold =>
  M.Manifold.hull([M.Manifold.cube(w, true).translate(a), M.Manifold.cube(w, true).translate(b)]);

/** Axis-aligned box between two corners. */
export const box = (M: M, lo: V3, hi: V3): Manifold => M.Manifold.cube(sub(hi, lo), false).translate(lo);

/** Channel for a wire or tube of diameter d from a to b: d + clearance, 1 mm past both ends so it cuts cleanly. */
export function channel(M: M, a: V3, b: V3, d: number): Manifold {
  const u = unit(sub(b, a));
  return rod(M, sub(a, u), add(b, u), d + CLEAR);
}

/** Vertical M3 screw hole at (x, y) from z0 to z1, with a hexagonal nut pocket at the top (z1) or the bottom (z0). */
export function m3(M: M, x: number, y: number, z0: number, z1: number, nutTop: boolean): Manifold {
  const hole = M.Manifold.cylinder(z1 - z0 + 2, M3_HOLE / 2, M3_HOLE / 2, undefined, false).translate([x, y, z0 - 1]);
  const nut = M.Manifold.cylinder(M3_NUT_DEPTH + 1, M3_NUT / 2, M3_NUT / 2, 6, false)
    .translate([x, y, nutTop ? z1 - M3_NUT_DEPTH : z0 - 1]);
  return hole.add(nut);
}

/** Slot for a zip tie centred at c, cut through along `through` with the strap width along `wide`. */
export function zipSlot(M: M, c: V3, through: 0 | 1 | 2, wide: 0 | 1 | 2, len: number): Manifold {
  const s: V3 = [ZIP_T, ZIP_T, ZIP_T];
  s[through] = len; s[wide] = ZIP_W;
  return M.Manifold.cube(s, true).translate(c);
}

/** Cut-out for an SO-239 or N 4-hole panel jack centred on the z axis, through z0..z1: body hole and four M3 holes with nut pockets at z0. */
export function flangeCut(M: M, z0: number, z1: number): Manifold {
  const h = FLANGE_PITCH / 2;
  return M.Manifold.union([
    M.Manifold.cylinder(z1 - z0 + 2, FLANGE_BODY / 2, FLANGE_BODY / 2, undefined, false).translate([0, 0, z0 - 1]),
    ...[[h, h], [-h, h], [-h, -h], [h, -h]].map(([x, y]) => m3(M, x, y, z0, z1, false)),
  ]);
}
```

`src/lib/print/parts.ts`:

```ts
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Arg, Msg } from "../build";
import { MAX_SIZE } from "./rules";
import { flatTris, meshOf, toSTL } from "./stl";
import type { V3 } from "./shapes";

/** One printable part for the current design. `build` returns one manifold per printed segment, in mm. */
export interface PartSpec {
  id: string;
  title: string;                       // English, translated in the UI
  use: "jig" | "holder" | "former";
  qty: number;
  purpose: Msg;
  howTo: Msg[];                        // numbered instructions: how to use the part
  build(M: ManifoldToplevel): Manifold[];
}

export interface Segment { stl: Uint8Array; tris: Float32Array; size: V3 }
export type BuiltPart = { id: string; ok: true; segments: Segment[] } | { id: string; ok: false; error: Msg };

export const msg = (s: string, ...a: Arg[]): Msg => ({ s, a });

export const USE_LABELS: Record<PartSpec["use"], string> = { jig: "Jig", holder: "Holder", former: "Former" };

export const PART_STRINGS = ["Too large to print in one piece: {0}", "Could not build this part: {0}", ...Object.values(USE_LABELS)];

/** Build a part and check it: watertight, non-empty, every segment within MAX_SIZE. */
export function buildPart(M: ManifoldToplevel, spec: PartSpec, name: string): BuiltPart {
  let segs: Manifold[];
  try { segs = spec.build(M); } catch (e) { return { id: spec.id, ok: false, error: msg("Could not build this part: {0}", String(e)) }; }
  const out: Segment[] = [];
  for (const [k, s] of segs.entries()) {
    if (s.status() !== "NoError" || s.isEmpty()) return { id: spec.id, ok: false, error: msg("Could not build this part: {0}", s.status()) };
    const b = s.boundingBox();
    const size: V3 = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
    const big = Math.max(...size);
    if (big > MAX_SIZE + 1e-6) return { id: spec.id, ok: false, error: msg("Too large to print in one piece: {0}", { len: big / 1000 }) };
    const mesh = meshOf(s);
    out.push({ stl: toSTL(mesh, segs.length > 1 ? `${name}-${k + 1}` : name), tris: flatTris(mesh), size });
  }
  return { id: spec.id, ok: true, segments: out };
}
```

`src/lib/print/index.ts` (families are added in Tasks 3–5):

```ts
import type { Design, Params } from "../types";
import type { PartSpec } from "./parts";
import { PART_STRINGS } from "./parts";
import { en } from "../build";

export { buildPart, USE_LABELS, type BuiltPart, type PartSpec, type Segment } from "./parts";

const FAMILIES: Record<string, (p: Params, d: Design) => PartSpec[]> = {};

/** Printable parts for an antenna design; empty when the type has none (yet). Cheap: nothing is built here. */
export const partsFor = (defId: string, p: Params, d: Design): PartSpec[] => FAMILIES[defId]?.(p, d) ?? [];

/** Every English string the print parts can show, for the i18n coverage test. */
export const PRINT_STRINGS = [
  ...PART_STRINGS,
];
/** README.txt for the parts zip: every part with its quantity, purpose and how-to steps, in English with lengths in mm. */
export function partsReadme(title: string, specs: PartSpec[]): string {
  const out = [`3D-printed parts: ${title}`, "", "STL files are in millimetres. Use PETG or ASA for parts that stay outdoors; PLA is fine for jigs.", ""];
  for (const s of specs) {
    out.push(`${s.title} (${s.qty} pc)`, en(s.purpose), "How to use:", ...s.howTo.map((h, i) => `  ${i + 1}. ${en(h)}`), "");
  }
  return out.join("\n");
}
```

Add to the end of `UK` in `src/i18n/uk.ts` (before the closing `};`):

```ts
  // 3D-printed parts
  "Too large to print in one piece: {0}": "Завелика, щоб надрукувати цілою: {0}",
  "Could not build this part: {0}": "Не вдалося побудувати деталь: {0}",
  "Jig": "Кондуктор",
  "Holder": "Тримач",
  "Former": "Оправка",
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run src/lib/print src/i18n.test.ts && npm run typecheck && npm run lint`
Expected: all pass (the loops have no parts yet, so they pass vacuously; Tasks 3–5 give them work).

- [ ] **Step 5: Commit**

```bash
git add src/lib/print src/i18n.test.ts src/i18n/uk.ts
git commit -m "Add printed-part model, CSG shapes and validation"
```

---

### Task 3: Dipole centre insulator and end insulators

**Files:**
- Create: `src/lib/print/families/centre.ts`
- Modify: `src/lib/print/index.ts`, `src/i18n/uk.ts`
- Test: `src/lib/print/families/families.test.ts`

**Interfaces:**
- Consumes: `shapes.ts`, `parts.ts` (`msg`, `PartSpec`), `rules.ts`.
- Produces: `dipoleArms(d: Design): { wireD: number; gap: number; arms: { start: V3; dir: V3 }[] }` (mm), `dipoleParts(d: Design): PartSpec[]` (ids `dipole-centre` qty 1, `dipole-end` qty 2), `CENTRE_STRINGS`, `CENTRE_HOWTO`.

Geometry (dipole arms lie along ±y from the feed gap, drooping in −z): a hub around the feed gap plus a square lug per arm along the arm direction; wire channels along each arm; a tie-off hole through each lug beside the channel; a solder window cut from the front half (x > 0) so the back half stays as a spine; a hanging eye on top; two pairs of zip-tie slots below for the coax.

- [ ] **Step 1: Write the failing test** (`src/lib/print/families/families.test.ts`)

```ts
import { beforeAll, describe, expect, it } from "vitest";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { partsFor } from "..";
import { rod, type V3 } from "../shapes";
import { CLEAR } from "../rules";
import { dipoleArms } from "./centre";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

const setup = (id: string, extra: Params = {}) => { const def = ANTENNA_BY_ID[id]; const p = { ...def.defaults, ...extra }; return { p, d: def.build(p) }; };
const part = (id: string, partId: string, extra: Params = {}) => { const { p, d } = setup(id, extra); return partsFor(id, p, d).find((s) => s.id === partId)!; };
/** Volume of plastic inside a probe solid (mm³). */
const inside = (solid: Manifold, probe: Manifold) => solid.intersect(probe).volume();
const along = (a: V3, u: V3, s0: number, s1: number, d: number) => rod(M, [a[0] + u[0] * s0, a[1] + u[1] * s0, a[2] + u[2] * s0], [a[0] + u[0] * s1, a[1] + u[1] * s1, a[2] + u[2] * s1], d);

describe("dipole", () => {
  it("has a centre insulator and two end insulators", () => {
    const { p, d } = setup("dipole");
    expect(partsFor("dipole", p, d).map((s) => [s.id, s.qty])).toEqual([["dipole-centre", 1], ["dipole-end", 2]]);
  });
  it("centre: the arm channels follow the droop and are clear for the wire", () => {
    for (const droop of [0, 30, 60]) {
      const { d } = setup("dipole", { droop });
      const { wireD, arms } = dipoleArms(d);
      arms.forEach((a) => expect(Math.abs((Math.asin(-a.dir[2]) * 180) / Math.PI - droop)).toBeLessThan(0.5));
      const centre = part("dipole", "dipole-centre", { droop }).build(M)[0];
      for (const a of arms) {
        expect(inside(centre, along(a.start, a.dir, 10, 30, wireD))).toBeLessThan(1e-3);
        expect(inside(centre, along(a.start, a.dir, 10, 30, wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/print/families`
Expected: FAIL, cannot resolve `./centre`.

- [ ] **Step 3: Implement** `src/lib/print/families/centre.ts`

```ts
import type { Design, Vec3, Wire } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, WALL, mm } from "../rules";
import { add, bar, box, channel, rod, scale, sub, unit, zipSlot, type V3 } from "../shapes";

/** Dipole / inverted V: centre insulator and end insulators. */
export const CENTRE_STRINGS = [
  "Dipole centre insulator",
  "End insulator",
  "Holds both arms at {0}° droop with a {1} feed gap. The front window leaves the arm ends open for soldering the coax; two zip ties hold the coax.",
  "One per arm end: the wire through the small hole, the support rope through the large one.",
];

/** How-to steps, in order. */
export const CENTRE_HOWTO = {
  centre: [
    "Push each arm into its channel from the outside until its end shows in the front window.",
    "Pass each arm through the tie-off hole beside its channel and twist it back on itself, so the plastic takes the pull, not the solder joint.",
    "Solder the coax centre conductor to one arm and the braid to the other in the front window.",
    "Strap the coax to the hub with two zip ties through the slots, and hang the antenna from the eye on top.",
    "Seal the window with hot glue or silicone against water.",
  ],
  end: [
    "Pass the arm end through the small hole, fold it back and twist it round itself.",
    "Tie the support rope through the large hole.",
  ],
};

const LUG = 35;   // length of each arm socket

const mmv = (p: Vec3): V3 => scale(p, 1000);

/** Arm geometry in mm from the model: start point at the feed gap and unit direction outwards. */
export function dipoleArms(d: Design): { wireD: number; gap: number; arms: { start: V3; dir: V3 }[] } {
  const driven = d.wires.filter((w) => w.group === "driven" && !w.drawOnly && !w.necOnly);
  const feed = d.wires.find((w) => w.group === "feed") as Wire;
  const arms = driven.map((w) => ({ start: mmv(w.a), dir: unit(sub(mmv(w.b), mmv(w.a))) }));
  return { wireD: mm(2 * driven[0].r), gap: Math.hypot(...sub(mmv(feed.b), mmv(feed.a))), arms };
}

export function dipoleParts(d: Design): PartSpec[] {
  const { wireD, gap, arms } = dipoleArms(d);
  const ch = wireD + CLEAR;
  const w = Math.max(3 * ch + 4 * WALL, 12);                 // lug and hub thickness
  const droop = (Math.asin(-arms[0].dir[2]) * 180) / Math.PI;
  const zEye = ch / 2 + 4 + WALL + 3, top = zEye + 3 + WALL;
  const centre: PartSpec = {
    id: "dipole-centre", title: "Dipole centre insulator", use: "holder", qty: 1,
    purpose: msg(CENTRE_STRINGS[2], Math.round(droop), { len: gap / 1000 }),
    howTo: CENTRE_HOWTO.centre.map((s) => msg(s)),
    build: (M) => {
      const hub = box(M, [-w / 2, -(gap / 2 + 6), -30], [w / 2, gap / 2 + 6, top]);
      const lugs = arms.map((a) => bar(M, a.start, add(a.start, scale(a.dir, LUG)), w));
      let part = M.Manifold.union([hub, ...lugs]);
      const cuts = [
        ...arms.map((a) => channel(M, a.start, add(a.start, scale(a.dir, LUG + w / 2)), wireD)),
        // tie-off hole through each lug, beside the wire channel: the wire end loops through it
        ...arms.map((a) => {
          const n = unit([0, -a.dir[2], a.dir[1]]);                 // perpendicular to the arm in the y-z plane
          const p = add(add(a.start, scale(a.dir, LUG - 6)), scale(n, ch + WALL));
          return rod(M, [-w, p[1], p[2]], [w, p[1], p[2]], ch);
        }),
        box(M, [0, -(gap / 2 + 5), -ch / 2 - 1], [w / 2 + 1, gap / 2 + 5, ch / 2 + 4]),   // solder window, front half
        rod(M, [-w, 0, zEye], [w, 0, zEye], 6),                                          // hanging eye
        ...[-14, -24].flatMap((z) => [-7, 7].map((y) => zipSlot(M, [0, y, z], 0, 2, w + 2))),   // coax zip ties
      ];
      part = part.subtract(M.Manifold.union(cuts));
      return [part];
    },
  };
  const R = Math.max(ch, 6) / 2 + 3;
  const end: PartSpec = {
    id: "dipole-end", title: "End insulator", use: "holder", qty: 2, purpose: msg(CENTRE_STRINGS[3]), howTo: CENTRE_HOWTO.end.map((s) => msg(s)),
    build: (M) => {
      const outline = M.CrossSection.hull([M.CrossSection.circle(R).translate([0, -14]), M.CrossSection.circle(R).translate([0, 14])]);
      const holes = M.CrossSection.union([M.CrossSection.circle(ch / 2).translate([0, -14]), M.CrossSection.circle(3).translate([0, 14])]);
      return [outline.subtract(holes).extrude(Math.max(6, ch + 2 * WALL))];
    },
  };
  return [centre, end];
}
```

Register in `src/lib/print/index.ts`:

```ts
import { CENTRE_HOWTO, CENTRE_STRINGS, dipoleParts } from "./families/centre";
// in FAMILIES:
  dipole: (_p, d) => dipoleParts(d),
// in PRINT_STRINGS:
  ...CENTRE_STRINGS, ...Object.values(CENTRE_HOWTO).flat(),
```

Add to `UK` (after the Task 2 block):

```ts
  "Dipole centre insulator": "Центральний ізолятор диполя",
  "End insulator": "Кінцевий ізолятор",
  "Holds both arms at {0}° droop with a {1} feed gap. The front window leaves the arm ends open for soldering the coax; two zip ties hold the coax.": "Тримає обидва плечі з нахилом {0}° і зазором живлення {1}. Переднє вікно залишає кінці плечей відкритими для паяння коаксіалу; дві стяжки тримають кабель.",
  "One per arm end: the wire through the small hole, the support rope through the large one.": "По одному на кінець плеча: дріт — у малий отвір, мотузка підвісу — у великий.",
  "Push each arm into its channel from the outside until its end shows in the front window.": "Вставте кожне плече в його канал ззовні, доки кінець не з'явиться в передньому вікні.",
  "Pass each arm through the tie-off hole beside its channel and twist it back on itself, so the plastic takes the pull, not the solder joint.": "Протягніть кожне плече через отвір поруч із каналом і закрутіть його на себе, щоб натяг тримав пластик, а не пайка.",
  "Solder the coax centre conductor to one arm and the braid to the other in the front window.": "У передньому вікні припаяйте центральну жилу коаксіалу до одного плеча, а обплетення — до іншого.",
  "Strap the coax to the hub with two zip ties through the slots, and hang the antenna from the eye on top.": "Притягніть коаксіал до корпусу двома стяжками через прорізи й підвісьте антену за вушко згори.",
  "Seal the window with hot glue or silicone against water.": "Загерметизуйте вікно термоклеєм або силіконом від води.",
  "Pass the arm end through the small hole, fold it back and twist it round itself.": "Протягніть кінець плеча в малий отвір, загніть назад і закрутіть навколо себе.",
  "Tie the support rope through the large hole.": "Прив'яжіть мотузку підвісу через великий отвір.",
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run src/lib/print src/i18n.test.ts && npm run typecheck && npm run lint`
Expected: all pass, including the Task 2 loops now covering the dipole.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print src/i18n/uk.ts
git commit -m "Print parts: dipole centre and end insulators"
```

---

### Task 4: Ground-plane radial hub

**Files:**
- Create: `src/lib/print/families/hub.ts`
- Modify: `src/lib/print/index.ts`, `src/i18n/uk.ts`
- Test: `src/lib/print/families/families.test.ts`

**Interfaces:**
- Produces: `radialDirs(d: Design): V3[]` (unit vectors), `groundPlaneParts(d: Design): PartSpec[]` (id `gp-hub`), `HUB_STRINGS`, `HUB_HOWTO`.

Geometry: a 5 mm plate (top face at z = 0, the feed point) with the jack flange cut-out; a square lug per radial along its direction with a channel from the centre outwards, so the radial ends meet at the flange screws; a clearance bore under the plate for the jack body and coax; a mast block between the first two radials with two zip-tie slots.

- [ ] **Step 1: Write the failing test**: add `import { radialDirs } from "./hub";` to the test imports and append:

```ts
describe("ground plane", () => {
  it("hub: bores follow the radials (within 0.5°) and are surrounded by plastic", () => {
    for (const droop of [0, 30, 45, 60]) {
      const { d } = setup("groundplane", { droop });
      const dirs = radialDirs(d);
      dirs.forEach((u) => expect(Math.abs((Math.asin(-u[2]) * 180) / Math.PI - droop)).toBeLessThan(0.5));
      const hub = part("groundplane", "gp-hub", { droop }).build(M)[0];
      const wireD = 2000 * d.wires[1].r;
      for (const u of dirs) {
        expect(inside(hub, along([0, 0, 0], u, 20, 45, wireD))).toBeLessThan(1e-3);
        expect(inside(hub, along([0, 0, 0], u, 20, 45, wireD + CLEAR + 2))).toBeGreaterThan(1);
      }
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/print/families`
Expected: FAIL, cannot resolve `./hub`.

- [ ] **Step 3: Implement** `src/lib/print/families/hub.ts`

```ts
import type { Design } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, FLANGE_BODY, WALL, mm } from "../rules";
import { bar, box, channel, flangeCut, scale, unit, zipSlot, type V3 } from "../shapes";

/** Ground plane: radial hub that takes the panel jack and sets the radial droop. */
export const HUB_STRINGS = [
  "Ground-plane radial hub",
  "Sets {0} radials at {1}° droop (the droop sets the feed impedance). Takes an SO-239 or N 4-hole panel jack with M3 screws and nuts; the radial ends meet at the flange screws for soldering. Zip-tie the block to the mast.",
];

/** How-to steps, in order. */
export const HUB_HOWTO = [
  "Bolt the panel jack on top with four M3 screws; the nuts drop into the pockets underneath.",
  "Push each radial into its bore until the end reaches a flange screw; wrap the end round the screw or under a solder lug and solder it.",
  "Solder the radiator to the jack's centre pin so it stands vertical.",
  "Strap the side block to the mast with two zip ties or a hose clamp through the slots; the coax goes down through the centre.",
  "Seal the jack and the joints against water.",
];

const R0 = 14, LUG = 40, PLATE = 5;

/** Unit directions of the radials from the feed point, from the model. */
export function radialDirs(d: Design): V3[] {
  return d.wires.filter((w) => w.group === "ground" && !w.drawOnly).map((w) => unit([w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]]));
}

export function groundPlaneParts(d: Design): PartSpec[] {
  const dirs = radialDirs(d);
  const wireD = mm(2 * d.wires.find((w) => w.group === "ground")!.r);
  const ch = wireD + CLEAR;
  const w = Math.max(ch + 2 * WALL, 8);
  const droop = (Math.asin(-dirs[0][2]) * 180) / Math.PI;
  const az = Math.atan2(dirs[0][1], dirs[0][0]) + Math.PI / dirs.length;   // mast block between the first two radials
  const hub: PartSpec = {
    id: "gp-hub", title: "Ground-plane radial hub", use: "holder", qty: 1,
    purpose: msg(HUB_STRINGS[1], dirs.length, Math.round(droop)),
    howTo: HUB_HOWTO.map((s) => msg(s)),
    build: (M) => {
      const plate = M.Manifold.cylinder(PLATE, R0 + 4, R0 + 4, undefined, false).translate([0, 0, -PLATE]);
      const lugs = dirs.map((u) => bar(M, scale(u, 8), scale(u, R0 + LUG), w));
      const mast = box(M, [10, -6, -35], [26, 6, -PLATE + 0.01]).rotate([0, 0, (az * 180) / Math.PI]);
      const slots = [-12, -28].map((z) => zipSlot(M, [20, 0, z], 1, 2, 14).rotate([0, 0, (az * 180) / Math.PI]));
      const body = M.Manifold.union([plate, ...lugs, mast]);
      const cuts = M.Manifold.union([
        flangeCut(M, -PLATE, 0),
        M.Manifold.cylinder(41, (FLANGE_BODY + 1) / 2, (FLANGE_BODY + 1) / 2, undefined, false).translate([0, 0, -40]),  // jack body and coax
        ...dirs.map((u) => channel(M, [0, 0, 0], scale(u, R0 + LUG + w), wireD)),
        ...slots,
      ]);
      return [body.subtract(cuts)];
    },
  };
  return [hub];
}
```

Register in `index.ts`:

```ts
import { HUB_HOWTO, HUB_STRINGS, groundPlaneParts } from "./families/hub";
// in FAMILIES:
  groundplane: (_p, d) => groundPlaneParts(d),
// in PRINT_STRINGS:
  ...HUB_STRINGS, ...HUB_HOWTO,
```

Add to `UK`:

```ts
  "Ground-plane radial hub": "Вузол радіалів GP",
  "Sets {0} radials at {1}° droop (the droop sets the feed impedance). Takes an SO-239 or N 4-hole panel jack with M3 screws and nuts; the radial ends meet at the flange screws for soldering. Zip-tie the block to the mast.": "Задає радіали ({0} шт.) з нахилом {1}° (нахил визначає вхідний опір). Під панельне гніздо SO-239 або N з 4 отворами, гвинти й гайки M3; кінці радіалів сходяться біля гвинтів фланця для паяння. Блок кріпиться до щогли стяжками.",
  "Bolt the panel jack on top with four M3 screws; the nuts drop into the pockets underneath.": "Прикрутіть панельне гніздо зверху чотирма гвинтами M3; гайки вкладаються в гнізда знизу.",
  "Push each radial into its bore until the end reaches a flange screw; wrap the end round the screw or under a solder lug and solder it.": "Вставте кожен радіал у його канал, доки кінець не дійде до гвинта фланця; обгорніть кінець навколо гвинта або під пелюстку й припаяйте.",
  "Solder the radiator to the jack's centre pin so it stands vertical.": "Припаяйте випромінювач до центрального контакту гнізда вертикально.",
  "Strap the side block to the mast with two zip ties or a hose clamp through the slots; the coax goes down through the centre.": "Притягніть боковий блок до щогли двома стяжками або хомутом через прорізи; коаксіал іде вниз через центр.",
  "Seal the jack and the joints against water.": "Загерметизуйте гніздо та з'єднання від води.",
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run src/lib/print src/i18n.test.ts && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print src/i18n/uk.ts
git commit -m "Print parts: ground-plane radial hub"
```

---

### Task 5: Yagi element clips, driven-element block, drilling guide

**Files:**
- Create: `src/lib/print/families/boom.ts`
- Modify: `src/lib/print/index.ts`, `src/i18n/uk.ts`
- Test: `src/lib/print/families/families.test.ts`

**Interfaces:**
- Consumes: Yagi params `boom` ("insulated" | "through"), `driven` ("folded" | "split"), `n`; the boom is the `drawOnly` wire; the folded dipole's upper conductor is the max z of the `driven` group.
- Produces: `yagiGeometry(d): { elemD; boomD; fs }` (mm), `yagiParts(p, d): PartSpec[]` (`yagi-clip` qty n − 1 and `yagi-driven`, or `yagi-drill` for through-boom), `BOOM_STRINGS`, `BOOM_HOWTO`.

Geometry (element along y at z = 0, boom along x below it, separated by the 2 mm insulating wall): a block with a half-pipe boom saddle, element channel(s), an M3 set screw from the top with a nut pocket, and vertical zip-tie slots on both sides of the boom. The driven block splits the fed conductor with a 2 mm wall and opens a front feed window. Through-boom gives a drilling guide (saddle plus a vertical hole) instead.

- [ ] **Step 1: Write the failing test**: change the test imports to `import { buildPart, partsFor } from "..";` and `import { CLEAR, INSULATE } from "../rules";`, then append:

```ts
describe("yagi", () => {
  it("insulated: n − 1 clips and a driven block; through-boom: one drilling guide", () => {
    const { p, d } = setup("yagi");
    expect(partsFor("yagi", p, d).map((s) => [s.id, s.qty])).toEqual([["yagi-clip", Number(p.n) - 1], ["yagi-driven", 1]]);
    const t = setup("yagi", { boom: "through" });
    expect(partsFor("yagi", t.p, t.d).map((s) => s.id)).toEqual(["yagi-drill"]);
  });
  it("clip: the element fits with 0.3 mm clearance and sits on 2 mm of plastic above the boom", () => {
    const { d } = setup("yagi");
    const elemD = 2000 * d.wires.find((w) => !w.drawOnly)!.r;
    const clip = part("yagi", "yagi-clip").build(M)[0];
    expect(inside(clip, along([0, 0, 0], [0, 1, 0], -20, 20, elemD))).toBeLessThan(1e-3);
    expect(inside(clip, along([0, 0, 0], [0, 1, 0], -20, 20, elemD + CLEAR + 0.4))).toBeGreaterThan(0.1);
    const wall = M.Manifold.cube([1, 1, INSULATE * 0.8], true).translate([0, 6, -(elemD + CLEAR) / 2 - INSULATE / 2]);
    expect(inside(clip, wall)).toBeCloseTo(INSULATE * 0.8, 3);
  });
  it("folded driven block: both conductors fit, spaced as in the model", () => {
    const { d } = setup("yagi", { driven: "folded" });
    const elemD = 2000 * d.wires.find((w) => !w.drawOnly)!.r;
    const fs = 1000 * Math.max(...d.wires.filter((w) => w.group === "driven").map((w) => w.a[2]));
    const block = part("yagi", "yagi-driven").build(M)[0];
    expect(inside(block, along([0, 0, fs], [0, 1, 0], -20, 20, elemD))).toBeLessThan(1e-3);
    expect(inside(block, along([0, 0, 0], [0, 1, 0], 2, 20, elemD))).toBeLessThan(1e-3);
  });
  it("a boom too wide for the printer is reported, not exported", () => {
    expect(buildPart(M, part("yagi", "yagi-clip", { bd: 0.2 }), "x").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/lib/print/families`
Expected: FAIL, the Yagi has no parts.

- [ ] **Step 3: Implement** `src/lib/print/families/boom.ts`

```ts
import type { Design, Params } from "../../types";
import { msg, type PartSpec } from "../parts";
import { CLEAR, INSULATE, M3_NUT_DEPTH, WALL, ZIP_T, mm } from "../rules";
import { box, m3, rod, zipSlot } from "../shapes";

/** Yagi: element clips, driven-element block, or a drilling guide for through-boom elements. */
export const BOOM_STRINGS = [
  "Yagi element clip",
  "Yagi driven element block",
  "Boom drilling guide",
  "Holds an element square to the boom, {0} above it and insulated. Two zip ties fix it to the boom; an M3 screw locks the element.",
  "Holds the folded dipole conductors {0} apart, {1} above the boom. The front window opens the feed point for the balun; the fed conductor is split by a 2 mm wall.",
  "Holds both halves of the split driven element {0} above the boom; they butt against a 2 mm wall, and the front window opens the feed point.",
  "Sits on the boom so each element hole is drilled straight through the centre. Use a {0} drill and zip-tie the guide at each mark from the boom strip.",
];

/** How-to steps, in order. "{0}" in the drill step is the element diameter. */
export const BOOM_HOWTO = {
  clip: [
    "Drop an M3 nut into the pocket on top and start the screw.",
    "Slide the clip onto the element and centre it: the element's middle goes under the screw.",
    "Set the clip on the boom at the element's mark from the boom strip, square to the boom, and fix it with two zip ties through the slots.",
    "Tighten the screw to lock the element.",
  ],
  folded: [
    "Slide the continuous conductor into the top channel and the two halves of the fed conductor into the lower channel from each side until they stop at the wall.",
    "Solder the balun or coax to the two ends in the front window.",
    "Fix the block on the boom at the driven-element mark with two zip ties, and lock the top conductor with the M3 screw.",
    "Seal the window with hot glue or silicone against water.",
  ],
  split: [
    "Slide the two halves in from each side until they stop at the wall.",
    "Solder the feed (coax, gamma or hairpin match) to the two ends in the front window.",
    "Fix the block on the boom at the driven-element mark with two zip ties, and lock the element with the M3 screw.",
    "Seal the window with hot glue or silicone against water.",
  ],
  drill: [
    "Mark the element positions on the boom with the boom strip from the build PDF.",
    "Zip-tie the guide on the boom with its hole over a mark.",
    "Drill a small pilot hole through the guide, then open it to {0}; the guide keeps the drill on the boom's centre line.",
    "Move the guide to the next mark and repeat.",
  ],
};

/** Element and boom diameters (mm) and the folded-dipole spacing (mm, 0 for split) from the model. */
export function yagiGeometry(d: Design): { elemD: number; boomD: number; fs: number } {
  const boom = d.wires.find((w) => w.drawOnly)!;
  const elems = d.wires.filter((w) => !w.drawOnly);
  const fs = Math.max(0, ...d.wires.filter((w) => w.group === "driven").flatMap((w) => [w.a[2], w.b[2]]));
  return { elemD: mm(2 * elems[0].r), boomD: mm(2 * boom.r), fs: mm(fs) };
}

export function yagiParts(p: Params, d: Design): PartSpec[] {
  const { elemD, boomD, fs } = yagiGeometry(d);
  const ch = elemD + CLEAR, bc = boomD + CLEAR;
  const Y = bc / 2 + 2 * WALL + ZIP_T;                       // half width across the boom, room for the zip-tie slots
  const zb = -(bc / 2 + INSULATE + ch / 2);                  // boom axis; the element axis is z = 0, along y
  const n = Number(p.n);
  const slots = (M: Parameters<PartSpec["build"]>[0], z0: number, z1: number) =>
    [-1, 1].map((s) => zipSlot(M, [0, s * (bc / 2 + WALL + ZIP_T / 2), (z0 + z1) / 2], 2, 0, z1 - z0 + 2));

  if (p.boom === "through") {
    const top = bc / 2 + 12;
    return [{
      id: "yagi-drill", title: "Boom drilling guide", use: "jig", qty: 1, purpose: msg(BOOM_STRINGS[6], { len: elemD / 1000 }),
      howTo: BOOM_HOWTO.drill.map((s) => msg(s, { len: elemD / 1000 })),
      build: (M) => {
        const body = box(M, [-12, -Y, 0], [12, Y, top]);
        const cuts = M.Manifold.union([rod(M, [-20, 0, 0], [20, 0, 0], bc), rod(M, [0, 0, -1], [0, 0, top + 1], ch), ...slots(M, 0, top)]);
        return [body.subtract(cuts)];
      },
    }];
  }

  const clipTop = ch / 2 + WALL + M3_NUT_DEPTH + 1;
  const clip: PartSpec = {
    id: "yagi-clip", title: "Yagi element clip", use: "holder", qty: n - 1, purpose: msg(BOOM_STRINGS[3], { len: INSULATE / 1000 }),
    howTo: BOOM_HOWTO.clip.map((s) => msg(s)),
    build: (M) => {
      const L = Math.max(ch + 2 * WALL, 16);
      const body = box(M, [-L / 2, -Y, zb], [L / 2, Y, clipTop]);
      const cuts = M.Manifold.union([
        rod(M, [-L, 0, zb], [L, 0, zb], bc),                          // boom saddle
        rod(M, [0, -Y - 1, 0], [0, Y + 1, 0], ch),                    // element
        m3(M, 0, 0, 0, clipTop, true),                                // set screw
        ...slots(M, zb, clipTop),
      ]);
      return [body.subtract(cuts)];
    },
  };

  const folded = fs > 0;
  const top = (folded ? fs : 0) + ch / 2 + WALL + M3_NUT_DEPTH + 1;
  const driven: PartSpec = {
    id: "yagi-driven", title: "Yagi driven element block", use: "holder", qty: 1,
    purpose: folded ? msg(BOOM_STRINGS[4], { len: fs / 1000 }, { len: INSULATE / 1000 }) : msg(BOOM_STRINGS[5], { len: INSULATE / 1000 }),
    howTo: (folded ? BOOM_HOWTO.folded : BOOM_HOWTO.split).map((s) => msg(s)),
    build: (M) => {
      const L = Math.max(ch + 2 * WALL, 24);
      const body = box(M, [-L / 2, -Y, zb], [L / 2, Y, top]);
      const cuts = M.Manifold.union([
        rod(M, [-L, 0, zb], [L, 0, zb], bc),
        rod(M, [0, -Y - 1, 0], [0, -1, 0], ch), rod(M, [0, 1, 0], [0, Y + 1, 0], ch),   // fed conductor, split by a 2 mm wall
        ...(folded ? [rod(M, [0, -Y - 1, fs], [0, Y + 1, fs], ch)] : []),
        box(M, [0, -8, -ch / 2 - 1], [L / 2 + 1, 8, ch / 2 + 2]),                        // feed window, front half
        m3(M, 0, Y - 6, folded ? fs : 0, top, true),                                     // locks the top conductor
        ...slots(M, zb, top),
      ]);
      return [body.subtract(cuts)];
    },
  };
  return [clip, driven];
}
```

`src/lib/print/index.ts` is now complete:

```ts
import type { Design, Params } from "../types";
import type { PartSpec } from "./parts";
import { PART_STRINGS } from "./parts";
import { CENTRE_HOWTO, CENTRE_STRINGS, dipoleParts } from "./families/centre";
import { HUB_HOWTO, HUB_STRINGS, groundPlaneParts } from "./families/hub";
import { BOOM_HOWTO, BOOM_STRINGS, yagiParts } from "./families/boom";
import { en } from "../build";

export { buildPart, USE_LABELS, type BuiltPart, type PartSpec, type Segment } from "./parts";

const FAMILIES: Record<string, (p: Params, d: Design) => PartSpec[]> = {
  dipole: (_p, d) => dipoleParts(d),
  groundplane: (_p, d) => groundPlaneParts(d),
  yagi: yagiParts,
};

/** Printable parts for an antenna design; empty when the type has none (yet). Cheap: nothing is built here. */
export const partsFor = (defId: string, p: Params, d: Design): PartSpec[] => FAMILIES[defId]?.(p, d) ?? [];

/** Every English string the print parts can show, for the i18n coverage test. */
export const PRINT_STRINGS = [
  ...PART_STRINGS, ...CENTRE_STRINGS, ...HUB_STRINGS, ...BOOM_STRINGS,
  ...Object.values(CENTRE_HOWTO).flat(), ...HUB_HOWTO, ...Object.values(BOOM_HOWTO).flat(),
];

/** README.txt for the parts zip: every part with its quantity, purpose and how-to steps, in English with lengths in mm. */
export function partsReadme(title: string, specs: PartSpec[]): string {
  const out = [`3D-printed parts: ${title}`, "", "STL files are in millimetres. Use PETG or ASA for parts that stay outdoors; PLA is fine for jigs.", ""];
  for (const s of specs) {
    out.push(`${s.title} (${s.qty} pc)`, en(s.purpose), "How to use:", ...s.howTo.map((h, i) => `  ${i + 1}. ${en(h)}`), "");
  }
  return out.join("\n");
}
```

Add to `UK` (`"Seal the window with hot glue or silicone against water."` is already there from Task 3):

```ts
  "Yagi element clip": "Тримач елемента Yagi",
  "Yagi driven element block": "Блок активного елемента Yagi",
  "Boom drilling guide": "Кондуктор для свердління траверси",
  "Holds an element square to the boom, {0} above it and insulated. Two zip ties fix it to the boom; an M3 screw locks the element.": "Тримає елемент перпендикулярно до траверси, на {0} вище та ізольовано. Дві стяжки кріплять його до траверси; гвинт M3 фіксує елемент.",
  "Holds the folded dipole conductors {0} apart, {1} above the boom. The front window opens the feed point for the balun; the fed conductor is split by a 2 mm wall.": "Тримає провідники петлевого диполя на відстані {0}, на {1} над траверсою. Переднє вікно відкриває точку живлення для балуна; живлений провідник розділено стінкою 2 мм.",
  "Holds both halves of the split driven element {0} above the boom; they butt against a 2 mm wall, and the front window opens the feed point.": "Тримає обидві половини розрізного активного елемента на {0} над траверсою; вони впираються в стінку 2 мм, а переднє вікно відкриває точку живлення.",
  "Sits on the boom so each element hole is drilled straight through the centre. Use a {0} drill and zip-tie the guide at each mark from the boom strip.": "Ставиться на траверсу, щоб кожен отвір під елемент свердлився точно через центр. Свердло {0}; кріпіть кондуктор стяжкою на кожній позначці зі смуги розмітки траверси.",
  "Drop an M3 nut into the pocket on top and start the screw.": "Вкладіть гайку M3 у гніздо згори й наживіть гвинт.",
  "Slide the clip onto the element and centre it: the element's middle goes under the screw.": "Насуньте тримач на елемент і відцентруйте: середина елемента — під гвинтом.",
  "Set the clip on the boom at the element's mark from the boom strip, square to the boom, and fix it with two zip ties through the slots.": "Поставте тримач на траверсу на позначку елемента зі смуги розмітки, перпендикулярно, і закріпіть двома стяжками через прорізи.",
  "Tighten the screw to lock the element.": "Затягніть гвинт, щоб зафіксувати елемент.",
  "Slide the continuous conductor into the top channel and the two halves of the fed conductor into the lower channel from each side until they stop at the wall.": "Вставте суцільний провідник у верхній канал, а дві половини живленого — у нижній з обох боків до упору в стінку.",
  "Solder the balun or coax to the two ends in the front window.": "Припаяйте балун або коаксіал до двох кінців у передньому вікні.",
  "Fix the block on the boom at the driven-element mark with two zip ties, and lock the top conductor with the M3 screw.": "Закріпіть блок на траверсі на позначці активного елемента двома стяжками й зафіксуйте верхній провідник гвинтом M3.",
  "Slide the two halves in from each side until they stop at the wall.": "Вставте дві половини з обох боків до упору в стінку.",
  "Solder the feed (coax, gamma or hairpin match) to the two ends in the front window.": "Припаяйте живлення (коаксіал, гамма- або шпилькове узгодження) до двох кінців у передньому вікні.",
  "Fix the block on the boom at the driven-element mark with two zip ties, and lock the element with the M3 screw.": "Закріпіть блок на траверсі на позначці активного елемента двома стяжками й зафіксуйте елемент гвинтом M3.",
  "Mark the element positions on the boom with the boom strip from the build PDF.": "Розмітьте положення елементів на траверсі за смугою розмітки з PDF.",
  "Zip-tie the guide on the boom with its hole over a mark.": "Закріпіть кондуктор на траверсі стяжкою отвором над позначкою.",
  "Drill a small pilot hole through the guide, then open it to {0}; the guide keeps the drill on the boom's centre line.": "Просвердліть через кондуктор тонкий напрямний отвір, потім розсвердліть до {0}; кондуктор тримає свердло на осі траверси.",
  "Move the guide to the next mark and repeat.": "Перемістіть кондуктор на наступну позначку й повторіть.",
```

- [ ] **Step 4: Run tests, typecheck and lint**

Run: `npx vitest run src/lib/print src/i18n.test.ts && npm run typecheck && npm run lint`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/print src/i18n/uk.ts
git commit -m "Print parts: Yagi element clips, driven block and drilling guide"
```

---

### Task 6: Worker, hook, preview and the Build-tab panel

**Files:**
- Create: `src/print.worker.ts`, `src/usePrintParts.ts`, `src/components/MeshView.tsx`, `src/components/PrintPanel.tsx`
- Modify: `src/components/BuildPanel.tsx`, `src/index.css`, `src/i18n/uk.ts`

**Interfaces:**
- Consumes: `partsFor`, `buildPart`, `partsReadme`, `USE_LABELS`, `BuiltPart` from `src/lib/print`; `zip` from `src/lib/zip.ts`; `download` from `src/download.ts`; `fmtLen(m, unit)` from `src/format.ts`; `fmtMsg(t, unit, msg)` from `src/msg.ts`.
- Produces: `usePrintParts(defId, params, design, enabled): PrintState`; `<PrintPanel def params design base />`; `<MeshView tris />`.

- [ ] **Step 1: Worker** `src/print.worker.ts` (the `?url` import makes Vite emit the WASM as an asset and hands its URL to the loader)

```ts
import wasmUrl from "manifold-3d/manifold.wasm?url";
import type { Design, Params } from "./lib/types";
import { loadManifold } from "./lib/print/manifold";
import { buildPart, partsFor } from "./lib/print";

/** Builds the printable parts of a design with manifold-3d (WASM, loaded on first use). */
self.onmessage = async (e: MessageEvent<{ id: number; defId: string; params: Params; design: Design }>) => {
  const { id, defId, params, design } = e.data;
  try {
    const M = await loadManifold(wasmUrl);
    const parts = partsFor(defId, params, design).map((s) => buildPart(M, s, `${defId}-${s.id}`));
    const transfer = parts.flatMap((p) => (p.ok ? p.segments.flatMap((g) => [g.stl.buffer, g.tris.buffer]) : []));
    postMessage({ id, parts }, { transfer });
  } catch (err) {
    postMessage({ id, error: String(err) });
  }
};
```

- [ ] **Step 2: Hook** `src/usePrintParts.ts` (same pattern as `useSimulation.ts`: 350 ms debounce, terminate a busy worker, drop stale ids)

```ts
import { useEffect, useRef, useState } from "react";
import type { Design, Params } from "./lib/types";
import type { BuiltPart } from "./lib/print";

export type PrintState =
  | { status: "idle" | "running"; parts: BuiltPart[] | null; error?: undefined }
  | { status: "done"; parts: BuiltPart[]; error?: undefined }
  | { status: "error"; parts: BuiltPart[] | null; error: string };

/** Debounced part build in a Web Worker (manifold-3d); a new request terminates a running one. */
export function usePrintParts(defId: string, params: Params, design: Design, enabled: boolean): PrintState {
  const [state, setState] = useState<PrintState>({ status: "idle", parts: null });
  const worker = useRef<Worker | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const key = JSON.stringify([defId, params]);   // the design follows from these

  useEffect(() => {
    if (!enabled) return;
    const id = ++seq.current;
    const timer = setTimeout(() => {
      if (busy.current && worker.current) { worker.current.terminate(); worker.current = null; }
      if (!worker.current) worker.current = new Worker(new URL("./print.worker.ts", import.meta.url), { type: "module" });
      const w = worker.current;
      busy.current = true;
      setState((s) => ({ status: "running", parts: s.parts }));
      w.onmessage = (e: MessageEvent<{ id: number; parts?: BuiltPart[]; error?: string }>) => {
        if (e.data.id !== seq.current) return;
        busy.current = false;
        if (e.data.parts) setState({ status: "done", parts: e.data.parts });
        else setState((s) => ({ status: "error", parts: s.parts, error: e.data.error ?? "" }));
      };
      w.postMessage({ id, defId, params, design });
    }, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled]);

  useEffect(() => () => worker.current?.terminate(), []);
  return state;
}
```

- [ ] **Step 3: Preview** `src/components/MeshView.tsx` (isometric, back faces culled, painter-sorted, shaded with `color-mix` of the theme tokens, so it works in light and dark)

```tsx
import { useMemo } from "react";

const YAW = 35, PITCH = 25, SIZE = 260;

/** Flat-shaded isometric view of a triangle mesh (9 floats per triangle, mm), drawn as SVG polygons. */
export function MeshView({ tris }: { tris: Float32Array }) {
  const polys = useMemo(() => {
    const cy = Math.cos((YAW * Math.PI) / 180), sy = Math.sin((YAW * Math.PI) / 180);
    const cp = Math.cos((PITCH * Math.PI) / 180), sp = Math.sin((PITCH * Math.PI) / 180);
    const P = (x: number, y: number, z: number) => { const X = x * cy - y * sy, Y = x * sy + y * cy; return [X, -(z * cp - Y * sp), Y * cp + z * sp]; };
    const fs: { q: number[][]; d: number; s: number }[] = [];
    for (let i = 0; i < tris.length; i += 9) {
      const q = [0, 1, 2].map((k) => P(tris[i + 3 * k], tris[i + 3 * k + 1], tris[i + 3 * k + 2]));
      if ((q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) <= 0) continue;   // back face
      const a = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]];
      const b = [tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
      const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const s = 0.35 + 0.65 * Math.max(0, (0.3 * n[0] - 0.5 * n[1] + 0.8 * n[2]) / (Math.hypot(...n) || 1));
      fs.push({ q, d: q[0][2] + q[1][2] + q[2][2], s });
    }
    fs.sort((u, v) => u.d - v.d);
    const xs = fs.flatMap((f) => f.q.map((p) => p[0])), ys = fs.flatMap((f) => f.q.map((p) => p[1]));
    const x0 = Math.min(...xs), y0 = Math.min(...ys), k = (SIZE - 20) / Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0, 1e-9);
    return fs.map((f) => ({ pts: f.q.map((p) => `${((p[0] - x0) * k + 10).toFixed(1)},${((p[1] - y0) * k + 10).toFixed(1)}`).join(" "), op: f.s }));
  }, [tris]);
  return (
    <svg className="mesh-view" viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img">
      {polys.map((p, i) => { const c = `color-mix(in srgb, var(--accent) ${Math.round(30 + 70 * p.op)}%, var(--panel))`; return <polygon key={i} points={p.pts} fill={c} stroke={c} strokeWidth={0.6} strokeLinejoin="round" />; })}
    </svg>
  );
}
```

- [ ] **Step 4: Panel** `src/components/PrintPanel.tsx`

```tsx
import { useMemo, useState } from "react";
import type { AntennaDef, Design, Params } from "../lib/types";
import { partsFor, partsReadme, USE_LABELS, type BuiltPart } from "../lib/print";
import { zip } from "../lib/zip";
import { usePrintParts } from "../usePrintParts";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { fmtMsg } from "../msg";
import { download } from "../download";
import { MeshView } from "./MeshView";

/** "3D-printed parts" box in the Build tab: STL per part, all parts as a zip, and a preview. */
export function PrintPanel({ def, params, design, base }: { def: AntennaDef; params: Params; design: Design; base: string }) {
  const t = useT();
  const unit = useStore((s) => s.unit);
  const specs = useMemo(() => partsFor(def.id, params, design), [def.id, params, design]);
  const st = usePrintParts(def.id, params, design, specs.length > 0);
  const [sel, setSel] = useState(0);
  const built = (id: string): BuiltPart | undefined => st.parts?.find((p) => p.id === id);
  const files = (id: string) => { const b = built(id); return b?.ok ? b.segments.map((g, k) => ({ name: `${base}-${id}${b.segments.length > 1 ? `-${k + 1}` : ""}.stl`, data: g.stl })) : []; };
  const save = (fs: { name: string; data: Uint8Array }[], zipName: string) => fs.length === 1 ? download(fs[0].name, fs[0].data, "model/stl") : download(zipName, zip(fs), "application/zip");
  const saveAll = () => download(`${base}-parts.zip`, zip([{ name: "README.txt", data: partsReadme(def.name, specs) }, ...specs.flatMap((s) => files(s.id))]), "application/zip");
  const preview = built(specs[sel]?.id ?? "");

  return (
    <div className="box">
      <h3>{t("3D-printed parts")}</h3>
      {specs.length === 0 ? <p className="hint">{t("No printed parts for this antenna yet.")}</p> : (
        <>
          <div className="exports">
            <button className="primary" disabled={st.status !== "done"} onClick={saveAll}>{t("All parts (.zip)")}</button>
            {st.status === "running" && <span className="hint">{t("Building parts…")}</span>}
            {st.status === "error" && <span className="hint err-text">{t("Could not load the 3D geometry engine: {0}", st.error)}</span>}
          </div>
          <div className="scroll-x">
            <table className="data print-parts">
              <thead><tr><th>{t("Part")}</th><th>{t("Use")}</th><th className="num">{t("Quantity")}</th><th>{t("Size")}</th><th>{t("What it does")}</th><th /></tr></thead>
              <tbody>
                {specs.map((s, i) => {
                  const b = built(s.id);
                  const size = b?.ok ? b.segments[0].size.map((x) => fmtLen(x / 1000, unit)).join(" × ") : b ? fmtMsg(t, unit, b.error) : "…";
                  return (
                    <tr key={s.id} className={i === sel ? "on" : undefined} onClick={() => setSel(i)}>
                      <td>{t(s.title)}</td><td>{t(USE_LABELS[s.use])}</td><td className="num">{s.qty}</td>
                      <td>{size}</td><td>{fmtMsg(t, unit, s.purpose)}</td>
                      <td><button className="small" disabled={!b?.ok} onClick={() => save(files(s.id), `${base}-${s.id}.zip`)}>STL</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="print-detail">
            {preview?.ok && <MeshView tris={preview.segments[0].tris} />}
            {specs[sel] && (
              <div>
                <h4>{t("How to use: {0}", t(specs[sel].title))}</h4>
                <ol className="notes">{specs[sel].howTo.map((h, i) => <li key={i}>{fmtMsg(t, unit, h)}</li>)}</ol>
              </div>
            )}
          </div>
          <p className="hint">{t("Click a part to see it and how to use it. STL in millimetres. PETG or ASA for parts that stay outdoors; PLA is fine for jigs. Slice with your printer's usual settings; the zip has every part and a README with the instructions.")}</p>
        </>
      )}
    </div>
  );
}
```

In `src/components/BuildPanel.tsx`, import it and render it right after the "Build pack" box (`base` is already defined there):

```tsx
import { PrintPanel } from "./PrintPanel";
// after the closing </div> of the "Build pack" box:
      {!design.pcb && <PrintPanel def={def} params={params} design={design} base={base} />}
```

Append to `src/index.css`:

```css
/* 3D-printed parts */
.print-parts tbody tr { cursor: pointer; }
.print-parts tbody tr.on td { background: color-mix(in srgb, var(--accent) 10%, transparent); }
.mesh-view { display: block; margin: 8px auto; max-width: 100%; height: auto; }
.print-detail { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }
.print-detail > div { flex: 1 1 280px; }
.print-detail h4 { margin: 8px 0 4px; font-size: 13px; }
```

Add to `UK`:

```ts
  "3D-printed parts": "Деталі для 3D-друку",
  "No printed parts for this antenna yet.": "Для цієї антени ще немає деталей для друку.",
  "All parts (.zip)": "Усі деталі (.zip)",
  "Building parts…": "Будуються деталі…",
  "Could not load the 3D geometry engine: {0}": "Не вдалося завантажити 3D-рушій геометрії: {0}",
  "Use": "Призначення",
  "What it does": "Що робить",
  "Click a part to see it and how to use it. STL in millimetres. PETG or ASA for parts that stay outdoors; PLA is fine for jigs. Slice with your printer's usual settings; the zip has every part and a README with the instructions.": "Натисніть на деталь, щоб побачити її та як нею користуватися. STL у міліметрах. PETG або ASA для деталей, що стоять надворі; для кондукторів підійде PLA. Друкуйте зі звичайними налаштуваннями свого принтера; zip містить усі деталі та README з інструкціями.",
  "How to use: {0}": "Як користуватися: {0}",
```

- [ ] **Step 5: Run everything**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all tests pass (79 in the verified prototype); the build lists `print.worker-*.js` and `manifold-*.wasm` (≈ 208 kB gzip) as separate assets, and the main `index-*.js` does not grow by the WASM.

- [ ] **Step 6: Check in the browser**

Run `npm run dev`, then for `#t=yagi`, `#t=dipole&droop=30` and `#t=groundplane` open the Build tab and confirm:
- the "3D-printed parts" box lists the parts with sizes, the preview shows the selected part, and "How to use" lists its steps;
- **STL** downloads a file that opens in a slicer; **All parts (.zip)** contains every STL plus `README.txt`;
- switching to inches updates sizes and the gap and drill values; Ukrainian translates the box;
- a printed antenna (`#t=ifa`) shows no print box;
- with the network offline before the first visit to the Build tab, the box shows the load error and the rest of the tab works.

- [ ] **Step 7: Commit**

```bash
git add src/print.worker.ts src/usePrintParts.ts src/components/MeshView.tsx src/components/PrintPanel.tsx src/components/BuildPanel.tsx src/index.css src/i18n/uk.ts
git commit -m "Build tab: 3D-printed parts with STL, zip, preview and how-to"
```

---

### Task 7: Docs and final verification

**Files:**
- Modify: `CLAUDE.md`, `README.md`, `docs/superpowers/specs/2026-10-10-print-parts-design.md`

- [ ] **Step 1: Spec**: record the two changes agreed after the spec was approved. Under "UI", replace "The build steps get one neutral line: …" with: "The panel hint carries the printing advice (STL in mm, PETG/ASA outdoors, PLA for jigs). Each part has numbered how-to steps (`PartSpec.howTo`), shown under the preview and written to `README.txt` in the parts zip." Add `howTo: Msg[]` to the `PartSpec` line.

- [ ] **Step 2: CLAUDE.md**: in Layout, add after the `fab.ts zip.ts` line:

```
  print/                 3D-printable parts (manifold-3d CSG, mm): rules.ts fixed geometry rules, shapes.ts blocks,
                         parts.ts PartSpec/buildPart (watertight, ≤ 180 mm), families/*.ts per antenna, stl.ts writer
src/print.worker.ts      loads manifold.wasm on demand and builds the parts; usePrintParts.ts, PrintPanel.tsx, MeshView.tsx
```

and replace the "STL for 3D-printed parts … skipped on purpose" bullet in "Not done / ideas" with:
"Printed parts, stages 2–3 (docs/superpowers/specs/2026-10-10-print-parts-design.md): helix former, Moxon/quad spreaders, discone hub, Yagi boom saddle; J-pole, collinear, biquad, fan-dipole parts."
Add a Build pack note: "**Printed parts:** geometry comes from `Design.wires` (never re-derived from formulas); every part must build watertight at all parameter extremes or report 'too large' (tested). No printer settings: fixed rules in `print/rules.ts`."

- [ ] **Step 3: README.md**: add a Features bullet after the Build tab bullet:
"- **3D-printed parts (STL):** for the dipole, ground plane and Yagi, the Build tab generates parts that hold the wires where the model has them (dipole centre and end insulators, a ground-plane radial hub with a jack flange at the designed droop, Yagi element clips, a driven-element block or a boom drilling guide), each with how-to steps. STL is in mm, with fit clearance built in; use your slicer's usual settings."

- [ ] **Step 4: Final verification**

Run: `npm test && npm run typecheck && npm run lint && npm run build`
Expected: all green. If `prusa-slicer` or `orca-slicer` is installed, slice one STL per family from the CLI and note the result in `docs/ANTENNAS.md`; otherwise state in the PR or commit message that no CLI slicer was available.

- [ ] **Step 5: Commit**

```bash
git add CLAUDE.md README.md docs/superpowers/specs/2026-10-10-print-parts-design.md docs/ANTENNAS.md
git commit -m "Docs: 3D-printed parts (stage 1)"
```
