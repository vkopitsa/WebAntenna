# Antenna Generator

A browser app that designs common antennas. Pick a type, enter the frequency and materials, and you get
build dimensions, a 3D drawing and expected performance. You can export to NEC-2, FreeCAD, SVG, CSV or JSON.
It is a static React + TypeScript site and runs entirely in the browser.

**Try it now: [vkopitsa.github.io/webantenna](https://vkopitsa.github.io/webantenna/)**

[![Deploy to GitHub Pages](https://github.com/vkopitsa/webantenna/actions/workflows/deploy.yml/badge.svg)](https://github.com/vkopitsa/webantenna/actions/workflows/deploy.yml)

![Animated tour: a 9-element Yagi is rotated in 3D and set to 12 elements, the Simulation tab shows S11, impedance, SWR, Smith chart and radiation patterns, the Build tab shows the bill of materials and cut list, Synthesis ranks candidate antennas, a printed inverted-F antenna is opened and an in-browser FDTD run starts, then the theme switches to dark and the language to Ukrainian](docs/demo.gif)

*A tour: design, simulation, build pack, synthesis, printed antennas with in-browser FDTD, dark theme and Ukrainian.*

![Antenna Generator Simulation tab for a 9-element 2 m Yagi: S11, input impedance and SWR over the band, Smith chart, and horizontal and vertical radiation patterns](docs/screenshot.jpg)

*Simulation tab: a 9-element Yagi for 2 m, solved by the built-in MoM solver (13.3 dBi, F/B 17.7 dB).*

![Antenna Generator Design tab: parameter panel on the left, 3D wire drawing of the Yagi with labelled elements and feed point, dimension table below](docs/screenshot-design.jpg)

*Design tab: parameters, 3D drawing and dimensions.*

**Printed (PCB) antennas:** trace monopole, meander line monopole, inverted-F (IFA), printed dipole, printed V dipole, dual-band (2.4 / 5 GHz) printed dipole, printed sleeve dipole, small loop with matching capacitors, and the rectangular microstrip patch. Each exports a ready-to-run **openEMS** script.

**Antennas:** half-wave dipole / inverted V, fan (parallel) multi-band dipole, quarter-wave ground plane, spring (normal-mode helix), J-pole, coaxial collinear (COCO),
Yagi-Uda (DL6WU style, 3–40 elements), Moxon rectangle, 2-element cubical quad, biquad with reflector,
axial-mode helix (RHCP/LHCP), FPV cloverleaf (3 or 4 leaves, RHCP/LHCP), rectangular microstrip patch (inset or probe feed), discone, sky-tilted capped bicone (compact 6.7:1 also as a wire cage, 8:1 and 21:1, sheet metal or wire, for FPV / drone detectors).

Formulas, sources and NEC-2 checks: [docs/ANTENNAS.md](docs/ANTENNAS.md).

Wideband (800 MHz – 6.4 GHz) omni antenna for a handheld FPV / drone detector, a simulation study with
build instructions: [docs/FPV-DETECTOR-ANTENNA.md](docs/FPV-DETECTOR-ANTENNA.md), home build guide with 3D-printed jigs, cover and cup:
[docs/FPV-DETECTOR-BUILD.md](docs/FPV-DETECTOR-BUILD.md) (tools in `tools/wideband-antenna/`).

## Features

- **Frequency bands:** one or more start–stop ranges, with presets (HF, 2 m, 70 cm, ISM 433/868/915, ADS-B, GPS, Wi-Fi, FPV 5.8 and more). Single-band types use band 1 and sweep the rest in NEC; the fan dipole and the discone use all bands.
- **openEMS export (printed antennas):** a Python script that builds the board, runs the FDTD simulation and plots S11, Zin and the far field. It also saves `_results.json`, which you load back into the Simulation tab. You can also load any `.s1p` measurement from WebVNA as an overlay.
- **Simulation tab (openEMS-style plots):** S11, Zin, SWR, Smith chart, polar cuts (XY / XZ / YZ) and a 3D gain pattern. A built-in thin-wire MoM solver runs in a Web Worker; the patch and collinear use analytic models. Export S11 as Touchstone `.s1p` (load it in WebVNA) and the pattern as CSV.
- **In-browser FDTD (WebGPU) for printed antennas:** "Run FDTD" in the Simulation tab meshes the board and runs a full-wave FDTD
  simulation (lumped 50 Ω port, Mur boundaries, near-to-far-field box) on the GPU through WebGPU, or on the CPU when WebGPU is missing.
  It fills the same S11 / Zin / Smith / pattern charts. "Tune to band" reruns it and rescales the resonant length onto the band centre.
  Checked against openEMS: strip dipole 74.6 Ω and 2.17 dBi (openEMS 74 Ω, 2.14 dBi); IFA resonance about 3 % high, gain and efficiency within 0.03 dB / 1 %. See [docs/ANTENNAS.md](docs/ANTENNAS.md#in-browser-fdtd).
- **Synthesis:** pick one or more bands, press "⚡ Synthesize", and the app tries every suitable antenna type, optimises its dimensions
  with the built-in solver and ranks the results by match, gain and size. Printed candidates can then be refined with the FDTD.
- **Build tab:** bill of materials, cut list (driven parts cut 2 % long), a tuning table ("trim 2 mm off each end → best match up ≈ 600 kHz",
  computed from the design formulas) and step-by-step build notes. Downloads:
  - **Build sheet + 1:1 template (PDF)**, A4, prints at actual size with a 50 mm check bar: PCB copper layers (mirrored option for toner transfer),
    a boom drilling strip for Yagis, a bending template for small wire antennas, a winding wrap for the helix;
  - **1:1 template (SVG)** in millimetres for plotters and laser cutters;
  - **Gerber + drill + DXF (.zip)** for printed antennas (RS-274X with X2 attributes, Excellon, DXF R12, README with the stack-up),
    plus notes on how εr shifts the frequency (FR-4 spread, the same layout on RO4003C).
- **3D-printed parts (STL):** for the dipole, ground plane and Yagi, the Build tab generates parts that hold the wires where the model has them
  (dipole centre and end insulators, a ground-plane radial hub with a jack flange at the designed droop, Yagi element clips, a driven-element block
  or a boom drilling guide), each with how-to steps. STL is in mm with the fit clearance built in; use your slicer's usual settings.
- **Measured vs model:** load a NanoVNA / VNA `.s1p` or `.s2p` in the Simulation tab. It is overlaid on the simulation, and the app compares the
  measured best match with the target, says how many mm to trim (or add), and can rescale the design for the next build.
- Dimension table plus per-element tables (Yagi elements, collinear sections). mm or inches.
- 3D wire/plate drawing: drag to rotate, plus top, front and side views. Shows the feed point, scale bar and axes.
- Exports:
  - **NEC-2** `.nec`: opens in 4nec2, xnec2c and nec2c, with the feed segment and a sweep set up.
  - **FreeCAD** `.FCMacro`: solid model in mm.
  - **SVG** drawing, **CSV** dimensions and **JSON**.
- Share links (`#t=yagi&f=145500000&n=9…`), settings kept in localStorage, print layout, light/dark themes and a mobile layout.
- English and Ukrainian; translation keys follow the WebVNA scheme (the key is the English text).

## Quick start

Needs **Node.js 20.19+ or 22.12+** (Vite 8). Node 21 does not work. With `n`: `sudo n 22`; with nvm: `nvm use` (reads `.nvmrc`).

```bash
npm install
npm run dev        # http://localhost:5173
```

### WebGPU

Chrome / Edge 113+ on Windows, macOS and ChromeOS and Safari 26 have WebGPU on by default. On **Linux Chrome**, open
`chrome://flags`, enable **Unsafe WebGPU Support** (`#enable-unsafe-webgpu`) and **Vulkan** (`#enable-vulkan`), then restart.
Firefox 141+ has it on Windows. Without WebGPU the FDTD falls back to the CPU engine: it gives the same numbers but takes minutes instead of seconds.

## Development

```bash
npm test           # vitest: formulas, reference designs, exporters, i18n coverage
npm run typecheck  # tsc -b
npm run lint       # oxlint src
npm run build      # static site in dist/ (relative paths, base './')
```

**CI:** `.github/workflows/ci.yml` runs tests, typecheck and lint on every pull request.
`.github/workflows/deploy.yml` tests, builds and publishes `dist/` to GitHub Pages on every push to `main`
(Settings → Pages → Source: **GitHub Actions**).

```
src/lib/               NO DOM, NO React, NO i18n: runs in Node
  types.ts             Wire, Plate, Design, AntennaDef, ParamDef
  rf.ts geom.ts        RF maths (end effect, microstrip, Bessel, Simpson) and 3D helpers
  antennas/*.ts        one builder per antenna; index.ts is the registry
  export.ts            NEC-2, FreeCAD, CSV, JSON
src/store.ts           state (useSyncExternalStore), localStorage, share-link hash
src/i18n.ts, i18n/     translate()/useT(); uk.ts dictionary
src/components/        Sidebar (picker + params), Preview (SVG 3D), Results, Exports, inputs
```

**Adding an antenna:** create `src/lib/antennas/<id>.ts` exporting an `AntennaDef`, add it to `index.ts`,
add tests (ideally against a published reference design), then run `npm test`. The i18n test lists the new
strings that need Ukrainian entries.

## Deploying to GitHub Pages (later)

`.github/workflows/deploy.yml` tests, builds and publishes `dist/` on every push to `main`. In the GitHub repo,
enable **Settings → Pages → Source: GitHub Actions**. Nothing deploys until the project is pushed.
`ci.yml` runs tests, typecheck, lint and build on pull requests.

## Disclaimer

The calculators give starting dimensions. Real antennas depend on materials, mounting and surroundings,
so build slightly long, measure with an antenna analyser or VNA, and trim.
