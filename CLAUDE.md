# Antenna Generator: notes for Claude Code

Static browser app (React 19 + TypeScript 6 + Vite 8, no state library) that designs antennas, **simulates** them
(built-in thin-wire MoM in a Web Worker, plus an in-browser WebGPU/CPU FDTD for printed antennas) and exports NEC-2 / FreeCAD / SVG / CSV / JSON / Touchstone, plus
**openEMS (FDTD) Python scripts** for printed (PCB) antennas.
Same stack and conventions as the WebVNA project (`~/Projects/webvna`). Repo: github.com/vkopitsa/webantenna, deployed to GitHub Pages at https://vkopitsa.github.io/webantenna/.

## Commands
```bash
npm run dev          # http://localhost:5173 (needs Node 20.19+ or 22.12+; Node 21 fails with "styleText")
npm test             # vitest: formulas, reference designs, MoM vs NEC-2, exporters, i18n coverage
npm run typecheck    # tsc -b
npm run lint         # oxlint src
npm run build        # dist/ (base './', the solver ships as its own worker chunk)
```

## CI (`.github/workflows`, same as WebVNA)
- `ci.yml`: on pull requests, Node 22: `npm ci`, test, typecheck, lint.
- `deploy.yml`: on push to `main`: test, build, upload `dist/` and deploy with `actions/deploy-pages`.
  Pages source must be "GitHub Actions". Relative `base './'` means no repo-name path is needed in vite.config.ts.

## Layout
```
src/lib/                 NO DOM, NO React, NO i18n. Runs in Node (tests) and in the worker
  types.ts               Wire, Plate, Design (f, sweeps), AntennaDef (multiband?), ParamDef ("bands" kind)
  bands.ts               "f1-f2;f3-f4" parse/format, presets, NEC sweep per band
  rf.ts geom.ts units.ts end-effect K, microstrip, Bessel, Simpson; 3D helpers; SI formatting
  antennas/*.ts          one builder per antenna; index.ts registry + withBands() (band table, single-band note)
  antennas/common.ts     BANDS / DIAM params, band(p) → { bands, f1, f2, f, sweeps }
  mom.ts                 thin-wire MoM (MININEC): buildMesh, solve, gainFn
  simulate.ts            sweep + far-field sampling (cuts, 3D grid, max/F-B/HPBW), patch & collinear analytic models, s11, toS1P
  export.ts              NEC-2 (λ/80, tapered GC next to a short feed gap, FR+RP per band), FreeCAD macro, CSV, JSON
  pcb.ts                 Pcb model: board, copper rectangles (top/bottom), lumped port; pcbPlates() for drawing/CAD
  openems.ts             toOpenEMS(): full FDTD script (mesh, run, S11/Zin/resonances, full-sphere NF2FF, plots, JSON)
  importers.ts           parseOpenEMS (the script's _results.json) and parseTouchstone (.s1p) for the Simulation tab
  antennas/pcb*.ts ifa.ts meander.ts printeddipole.ts pcbloop.ts   printed antennas (openEMS-calibrated formulas)
  build.ts               build pack: pieces() chains wires into physical parts; BOM, cut list, tuning sensitivity
                         (rebuild at +1 % frequency), substrate notes, steps, advise() for measured .s1p
  fab.ts zip.ts          Gerber RS-274X X2 / Excellon / DXF R12 / README in a stored zip (Protel extensions)
  print/                 3D-printable parts (manifold-3d CSG, mm): rules.ts fixed geometry rules, shapes.ts blocks,
                         parts.ts PartSpec/buildPart (watertight, ≤ 180 mm), families/*.ts per antenna, stl.ts writer
  drawing.ts template.ts page model in mm → PDF (own writer, Helvetica, A4) and SVG; PCB, boom strip, wire and helix templates
  synth.ts               synthesis: candidate types × bounded Nelder–Mead over each type's knobs, ranked by goal
  fdtd/mesh.ts           graded rectilinear mesh (thirds rule, smooth() with ratio 1.4, exact port/board lines)
  fdtd/setup.ts          Yee materials (ca/cb per edge, PEC sheets), lumped port, Mur coefficients, Gaussian excitation
  fdtd/cpu.ts            reference CPU engine + impedance DFT + NF2FF box accumulation
  fdtd/nf2ff.ts          far field from the box (J = n×H, M = −n×E), radiated and accepted power
src/gpu/fdtdGpu.ts       WebGPU engine: same layout as cpu.ts in WGSL compute kernels
src/fdtdJob.ts           runFdtd / tuneFdtd → SimResult; src/fdtd.worker.ts + src/useFdtd.ts run it off the main thread
src/print.worker.ts      loads manifold.wasm on demand and builds the parts; usePrintParts.ts, PrintPanel.tsx, MeshView.tsx
src/sim.worker.ts        runs simulate() and synthesize() off the main thread; useSimulation.ts / useSynthesis.ts
src/store.ts             state via useSyncExternalStore; localStorage "antgen.settings.v1"; share hash #t=…&bands=…
src/components/          Sidebar (picker, params, band editor), Preview (SVG 3D), Results, Exports, BuildPanel,
                         SimPanel (+ measured-vs-model advice) + Charts (FreqChart, SmithChart, PolarChart, Pattern3D)
src/msg.ts               formats a lib Msg {s, a: [{len}|{hz}|{pct}|…]} for the UI (translation + mm/in)
docs/ANTENNAS.md         every formula, its source, and the NEC-2 / MoM verification numbers
```

## Conventions
- **Units:** SI everywhere (metres, Hz, degrees). Complex values are `[re, im]` or split re/im arrays.
- **Labels:**
  - In lib they are English strings, translated in the UI with `t(label)`.
  - Perf values that contain words must be static strings, with no interpolated numbers.
  - Strings shown from `simulate.ts` go in `SIM_STRINGS`; from `build.ts` in `BUILD_STRINGS`.
  - Messages with numbers are `Msg { s, a }`: the key has `{0}` placeholders and the arguments are typed
    (`{ len }` metres, `{ hz }`, `{ pct }`), so the UI can format units. `en()` renders them in English for files.
  - PDF text is English only (Helvetica/WinAnsi); `drawing.ts` spells out Greek letters. Keep new characters in `SUB`/`WIN`.
- **i18n:** the key is the exact English text. `src/i18n.test.ts` enforces UK coverage and no stale keys. When you add a conditional label, add a variant to `VARIANTS` there.
- **TypeScript:** `erasableSyntaxOnly` is on, so no enums and no parameter properties.
- **Wire flags:**
  - `necOnly` marks wire-grid stand-ins for plates; they aren't drawn or exported to CAD, but they are simulated.
  - `drawOnly` marks booms and probes; they are kept out of NEC and MoM.
- **Bands:** single-band types design for the centre of band 1. Set `multiband: "per-band" | "broadband"` on a def that uses every band.
- **Charts** follow the dataviz rules: one y-axis per chart, a legend only for ≥ 2 series, 2 px lines, crosshair tooltips, and colours from CSS tokens (`--series-1/2`, `--band-fill`).

## openEMS (for printed antennas)
- **Building it:** openEMS was built from source for calibration:
  `git clone --recursive https://github.com/thliebig/openEMS-Project && ./update_openEMS.sh ~/opt/openEMS --disable-GUI --python --python-venv-mode=site`.
  It needs libhdf5, libvtk9, boost, cgal, tinyxml and cython3. Activate the venv, then run `python3 <name>_openems.py --no-show`.
- **NF2FF centre is in metres.** `CalcNF2FF(center=…)` is SI even when the mesh unit is mm. Passing mm gave a 9–12 dBi "dipole". Use `read_cached=False`, or stale far-field files survive a fix.
- **Air margin λ/2.** λ/4 read 0.4 dB low on a reference dipole; λ/2 gives 2.14 dBi.
- **Full sphere for Dmax and Prad.** openEMS integrates radiated power over the angles you pass. Sample the full sphere (5°) for Dmax and efficiency, and normalise cuts to that.
- **Validate the pipeline first.** A free-space strip dipole must give ≈ 73 Ω and 2.15 dBi before you trust any PCB result.
- **Calibration has limits:**
  - Printed formulas were fitted on FR-4 1.6/0.8 mm, RO4003C 0.8 mm and εr 10.2, all with w = 1 mm. Outside that range they are starting points.
  - A printed monopole's R depends strongly on the ground pour (70–120 Ω).
  - The IFA model is valid for H ≈ 4–10 mm at 2.4 GHz.

## In-browser FDTD (`src/lib/fdtd`, `src/gpu/fdtdGpu.ts`)
- **Two engines, one layout.** `cpu.ts` is the reference; the WGSL kernels mirror it line by line
  (updateH, saveOld, updateE, port, mur, nf). After touching either, rerun the CPU↔GPU equality check:
  the GPU must match the CPU to ~1e-4 relative over a few hundred steps.
- **WebGPU limit: 8 storage buffers per stage by default.** Fields, materials, ints, floats and work data are packed
  into 7 buffers. Don't add an 8th+ without packing.
- **Port:** a resistive lumped source. V = −Σ E·len averaged over parallel edges at (n+1)dt; I = the summed
  edge current at (n+½)dt; `impedance()` corrects the half-step. The sign was validated (R must come out positive).
- **Mesh smoothing:** midpoint halving cascaded fine cells across the whole grid (931×1832×517 → OOM). Use the
  graded ∫dx/h fill with slope ln(ratio) (gives exactly geometric growth), seeds from the real neighbour cells,
  and merge lines closer than edge/4 except the "keep" lines.
- **Validation (CPU engine, `endCriteria` 1e-5):** strip dipole in air 74.6 + j3.7 Ω, 2.17 dBi, 99 % (openEMS
  74 Ω, 2.14 dBi); IFA on FR-4 see docs/ANTENNAS.md. The app stops at 1e-2 (−40 dB on the port signals, like openEMS EndCriteria 1e-4 on energy): on the IFA the resonance and S11 depth are settled by then (checked by truncating a 60 k-step run); 1e-3 needs > 80 k steps.
- **Speed:** CPU ≈ 20 Mcell·step/s single-threaded; real GPUs are 10–50× faster. Headless Chromium only has
  SwiftShader (software WebGPU), which is ~5× slower than the CPU engine but exercises the same code.

## Accuracy rules (learned the hard way)
- **Check convergence before tuning anything.** NEC-2 decks at λ/40 were not converged for close-spaced parts: the J-pole moved 38.5 → 31.3 Ω between λ/40 and λ/320. Refine the segments until Z stops moving, in both MoM and NEC.
- **Feed gaps:** a short feed gap next to long segments biases the impedance (−30 % on an HF dipole). The NEC export tapers those segments; keep that whenever you add a feed-gap model.
- **References:** every antenna needs a reference test, ideally against a published design. The solver tests compare against converged NEC-2 numbers recorded in docs/ANTENNAS.md.
- **nec2++:** the cross-checks used nec2++ built from source (github.com/tmolteno/necpp). Its decks are produced by `toNEC()`.

## Build pack notes
- **Tuning sensitivity comes from the formulas**, not from MoM: rebuild with every band ×1.01 and compare the resonant
  parts (driven group, `E*` band elements, or the printed antenna's resonant copper). It matches f·ΔL/L for a dipole.
- **Paper templates only when useful:** a real 2D shape that fits on ≤ 6 A4 tiles (rotated if that saves pages), a boom strip
  when there is a boom, the helix wrap; otherwise the cut list is the template.
- **Printed parts:** geometry comes from `Design.wires` (never re-derived from formulas); every part must build watertight
  at all parameter extremes or report "too large" (tested). No printer settings: fixed rules in `print/rules.ts`.
  Each part has `howTo` steps (panel + README.txt in the zip).
- **Probe feed** (patch, `isProbe()`): Ø1.3 mm plated hole and a Ø4.2 mm clearance in the bottom ground for an SMA panel jack.
- External checks used while building it: gerbonara parses every Gerber/drill file, ezdxf the DXF, pdfinfo/pdftoppm the PDF.

## Not done / ideas
- Printed parts, stages 2–3 (docs/superpowers/specs/2026-10-10-print-parts-design.md): helix former, Moxon/quad spreaders,
  discone hub, Yagi boom saddle; J-pole, collinear, biquad, fan-dipole parts.
- openEMS export for wire antennas (thin wires) and for the PCB loop (needs lumped capacitors in parallel with the port).
- Auto-tune loop inside the openEMS script (run → find resonance → rescale → rerun). (The in-browser FDTD has "Tune to band".)
- FDTD: lumped capacitors (needed for the PCB loop), PML instead of Mur, multi-GPU-dispatch for > 4 M cells.
- Ground (GN card / Sommerfeld) and conductor loss in MoM; matching-network calculator.
- Fan dipole with ≥ 5 bands takes ≈ 2 s to tune on the main thread; move design building to the worker if it matters.
