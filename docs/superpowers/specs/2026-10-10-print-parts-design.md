# 3D-printable build parts (STL): design

Date: 2026-10-10. Status: approved in brainstorming, awaiting spec review.

## Goal

Help people build the wire antennas the app designs by generating 3D-printable parts from the current design:
soldering **jigs** (removed after soldering), permanent **holders** (stay in the antenna) and **formers** /
bending guides. A user prints a part, lays the cut wires in it and gets the geometry the model simulated,
without measuring angles or spacings by hand.

Cover every wire antenna in the app. Printed (PCB) antennas are out of scope; they already get Gerbers.

## Decisions

- **Output is STL only.** No printer or slicer settings in the app: those belong to the slicer. Parts are
  designed to print on any common FDM printer with fixed, conservative geometry rules (below).
- **Geometry engine: manifold-3d** (Apache-2.0, WASM, v3.5.x). Real CSG booleans and guaranteed watertight
  meshes. Loaded on demand in a worker so normal page loads don't grow; runs in Node for tests.
- **Dimensions come from the model** (`Design.wires`, `pieces()`, `dims`), the same source as the NEC deck and
  the cut list, so a jig puts wires exactly where the simulation has them.

## Fixed geometry rules (no UI)

| Rule | Value | Why |
|---|---|---|
| Fit clearance on wire channels and bores | 0.3 mm on diameter | fits most FDM printers |
| Minimum wall | 2 mm | solid with 0.2–0.6 mm nozzles |
| Insulating wall between conductors | ≥ 2 mm | keeps wires that must not touch apart |
| Maximum part size | 180 × 180 × 180 mm | fits almost every printer; larger parts are split into keyed segments |
| Screws | M3, with hex nut traps | |
| Connector cut-out | universal 4-hole square flange, 18.3 mm hole spacing, Ø16 mm body hole, M3 holes | fits SO-239 and N panel jacks |
| Mast mounting | slots for a hose clamp or zip ties | fits any mast diameter |

Solder joints are always left in an open window, never buried in plastic.

## Architecture

```
src/lib/print/                 NO DOM, NO React, NO i18n (same rule as src/lib)
  rules.ts       the constants above
  parts.ts       PartSpec { id, title, use: "jig" | "holder" | "former", qty, purpose: Msg,
                 build(M: ManifoldToplevel) → Manifold[] (one per segment) }
                 partsFor(def, design) → { parts: PartSpec[], skipped: { title, reason: Msg }[] }
  shapes.ts      wireChannel, snapClip, tubeClamp, boltHole + nutTrap, connectorFlange,
                 clampSlots, helixGroove, keyedSplit
  families/      centre.ts  dipole / inverted-V / fan-dipole centre and end insulators, fan spreaders
                 hub.ts     ground-plane radial hub, discone hub
                 boom.ts    Yagi element clips, driven-element block, boom drilling saddle,
                            Moxon and quad spreaders / spider hub
                 former.ts  helix former (segmented) + helix ground mount
                 jig.ts     biquad bending/soldering jig + standoffs, J-pole stub spacers and tap gauge,
                            collinear cut/strip gauge and joint sleeves, Moxon tip-gap gauge
  stl.ts         binary STL writer
src/print.worker.ts            loads manifold-3d, builds parts, returns STL bytes and preview meshes
src/usePrintParts.ts           hook, same pattern as useSimulation / useFdtd
src/components/PrintPanel.tsx  section in the Build tab
```

**Data flow:** Design → `partsFor()` (pure, cheap, runs on the main thread to list parts) → worker builds the
selected parts with manifold → `stl.ts` → download one STL, or all parts as a zip via the existing `zip.ts`.

**UI (Build tab, "3D-printed parts"):** a list of parts for the current antenna: title, jig/holder/former,
quantity, bounding size, one-line purpose (e.g. "sets the radial droop to 45°, which gives ≈ 50 Ω"),
an **STL** button per part and **All parts (.zip)**. Selecting a part shows it in the existing SVG 3D view
(triangle mesh drawn as flat-shaded faces; no WebGL). Skipped parts are listed with their reason.
The build steps get one neutral line: "PETG or ASA for outdoor parts." Strings go through `t()`; numbers
through `Msg` so mm/inch works.

## Part catalogue

J = jig, H = holder, F = former.

| Antenna | Parts |
|---|---|
| Dipole / inverted V | H centre insulator: two channels at the designed V angle, wire tie-off holes, coax clamp, hanging eye. H end insulators ×2 |
| Fan dipole | H centre block with a channel pair per band. H spreaders keeping band wires at the designed spacing (count from length) |
| Ground plane | H radial hub: connector flange, N radial bores at the designed droop angle, mast clamp slots. J radiator alignment sleeve |
| J-pole | H stub spacers (several along the stub) at the designed spacing. J feed-tap gauge. H mast clamp |
| Collinear (COCO) | J cut-and-strip gauge with stops at section and strip lengths. H joint sleeves for the crossed joints |
| Yagi | H element-to-boom clip per element (boom Ø, element Ø, insulated or through-boom). H driven-element block with feed terminals (folded or split). J boom drilling saddle with element marks |
| Moxon | H two cross spreaders with channels at the A/B/C/D points, centre hub with mast slots. J tip-gap gauge (C) |
| Quad (2 el.) | H spider hub with spreader sockets at 45°. H spreader tips with a corner wire channel |
| Biquad | F/J bending and soldering jig (both squares as grooves, feed gap). H reflector standoffs at the designed height with a connector pass-through |
| Helix | F former: spine with a helical groove at the designed diameter, pitch and turns, split into keyed segments ≤ 180 mm. H ground-plane mount with connector flange and feed lead-in |
| Discone | H hub: disc rods radial, cone rods at the cone angle, connector flange |

Where an element is a tube too thick for a wire clip, the clip becomes a tube clamp and the part's purpose says so.

## Errors

- **Part larger than 180 mm** in a direction that can't be split: listed under skipped, "too large to print in one piece", no STL.
- **Conductors closer than the 2 mm insulating wall:** the part is still made; its purpose gets a warning
  ("wires closer than 2 mm apart: add sleeving").
- **manifold fails to load** (offline before first load, unsupported browser): the section shows the error;
  the rest of the app is unaffected.
- **A build throws or returns a non-manifold mesh:** that part shows an error, others still work.

## Testing (vitest, Node)

- Every wire antenna in `ANTENNAS` returns at least one part; every printed antenna returns none.
- Every part, at default parameters and at the extremes of each antenna's parameter ranges, builds with
  `status() === "NoError"`, is non-empty and every segment fits in 180 mm.
- Geometry is checked against the model, per family. Examples: ground-plane hub bore axes match the radial
  angle within 0.5°; Yagi clip channel Ø = element Ø + 0.3 mm; helix groove pitch and diameter match the dims;
  stacked helix segments add up to the axial length.
- STL writer: header, triangle count and byte length are consistent; a test parser reads the mesh back.
- i18n: new labels translated in `uk.ts` (existing coverage test).
- External check per family, as done for Gerber/DXF: slice the STL with a CLI slicer (PrusaSlicer or OrcaSlicer)
  if installed and note the result in `docs/ANTENNAS.md`.

## Delivery

One design, three implementation plans, each shippable on its own:

1. Core (rules, shapes, STL, worker, PrintPanel, tests) + Yagi clips and driven block, dipole centre and end
   insulators, ground-plane hub.
2. Helix former and mount, Moxon and quad spreaders/hub, discone hub, Yagi boom saddle.
3. J-pole, collinear, biquad and fan-dipole parts, Moxon tip-gap gauge, ground-plane alignment sleeve.

After stage 1, update CLAUDE.md: replace the "STL … skipped on purpose" note with the print layout above.
