# Antenna models: formulas, sources and verification

All builders live in `src/lib/antennas/`. Everything is SI internally (metres, hertz). Each builder returns
the wire/plate geometry, a dimension list, optional tables, performance estimates and build notes.
The formulas give a **starting point**; build slightly long, measure, trim.

## Shared helpers (`src/lib/rf.ts`)

| Helper | Formula | Source |
|---|---|---|
| End-effect factor K | K = 1 − 0.225 / ln(λ / 2d) | Fit to the ARRL Antenna Book curve (λ/2d = 100 → 0.95, 1000 → 0.967, 10⁴ → 0.976) |
| Microstrip width | Wheeler/Hammerstad synthesis (A/B forms) | Pozar, *Microwave Engineering*, §3.8 |
| Microstrip Z0, εeff | Hammerstad analysis formulas (used to round-trip-test the synthesis) | Pozar §3.8 |
| Bessel J0 | Abramowitz & Stegun 9.4.1 / 9.4.3 | A&S |

## Frequency bands (`src/lib/bands.ts`)

Every antenna takes a list of bands (`start–stop`, stored as `"144e6-146e6;430e6-440e6"`), with presets for common
band plans. A band table is added to every design.

- **Single-band types** (dipole, ground plane, J-pole, collinear, Yagi, Moxon, quad, biquad, patch): dimensions come from the **centre of band 1**. Extra bands get a note and are swept in the NEC export, so you can see how the antenna really behaves there. In NEC-2, a 2 m Moxon on 70 cm shows SWR 7–23.
- **Fan (parallel) dipole:** one element per band.
- **Discone:** broadband. The cone is sized for the lowest band ÷ 1.25, and the app warns if the top band is above 8 × the cut-off.
- **Helix:** checks that every band stays in the axial mode, 0.75 < C/λ < 1.33.
- **Patch:** warns when the band is wider than the Jackson bandwidth.

## Per antenna

| Antenna | Model | Source / verification |
|---|---|---|
| **Dipole / inverted V** | L = 0.5 λ K; feed gap max(4d, min(0.015 λ, 50 mm)); droop rotates the arms | NEC-2: 73 + j8 Ω, 2.15 dBi (145 MHz); 72 + j4 Ω (7.1 MHz) |
| **Fan (parallel) dipole** | one element per band, fanned 0, −a, +a, −2a…; each length factor is tuned by the built-in MoM (secant on X = 0 at every band centre, starting from +3 %, or −5 % near 3×) | Converged results: 40/20 m → +2.7 % (69 / 47 Ω); 20/10 m → +3.3 %; 7/21 MHz → −5 %; 40/20/10 m → 68 / 46 / 42 Ω |
| **Ground plane** | vertical = 0.25 λ K × 0.97, radials = 1.05 × vertical, droop 0–60° | Factor 0.97 tuned in NEC-2: 51 + j2 Ω at 45° droop |
| **J-pole** | stub = 0.25 λ K × 1.04, long = stub + 0.5 λ K, tap = 0.019 λ | Tuned on converged models (2 m, Ø6 mm, 25 mm spacing): NEC-2 at λ/320 gives 47.6 − j7 Ω |
| **Coaxial collinear** | section = 0.5 λ × VF, whip = 0.25 λ × 0.95; ideal gain 2.15 + 10 log N | Classic COCO; no wire model possible |
| **Yagi (DL6WU style)** | spacing table (λ): 0.185, 0.079, 0.18, 0.216, 0.252, 0.281, 0.302, 0.317, then +0.015 per director up to 0.40; director taper 0.4381 → 0.4107 λ (D1–D7), then −0.0173·ln(n/7); reflector 0.490 λ; folded DE 0.473 λ; diameter scaling by K ratio; through-metal boom adds 0.343 × boom Ø | Reproduces the DL6WU/AntMaker reference (145.5 MHz, 9 el, Ø12 mm, Ø30 mm boom) within 0.5 % ([YO5OSF](https://www.qsl.net/yo5osf/yagi.html)). NEC-2: 13.4 dBi, 238 − j38 Ω (folded) |
| Yagi gain estimate | G_dBd ≈ 9.85 + 6.9 log10(boom/λ) | Fit to the NBS (Viezbicke) Yagi curves |
| **Moxon** | Cebik regression in x = log10(d/λ): A, B, C, D quadratics, E = B + C + D | Coefficients verbatim from MoxGen ([moxgen.sl](https://jedsoft.org/slang/slshapps/moxgen.sl)). NEC-2: 50 − j4 Ω, 6.1 dBi |
| **Quad (2 el)** | driven perimeter 1.022 λ (1005/f ft), reflector 1.047 λ (1030/f ft) | ARRL. NEC-2: 52 − j6 Ω, 7.8 dBi at 0.15 λ |
| **Biquad** | side λ/4, spacing ≈ 0.122 λ, reflector ≈ 1 λ | Common 2.4 GHz builds. NEC-2: 62 Ω, 10.3 dBi |
| **Helix (axial mode)** | C = Cλ·λ, S = C tan α; D = 15 Cλ² N Sλ, HPBW = 52 / (Cλ √(N Sλ)), Z = 140 Cλ, AR = (2N+1)/2N | Kraus, *Antennas*. NEC-2: 143 Ω, 10.9 dBi for 8 turns (Kraus D says 14.4, hence the note) |
| **Patch** | W = c/2f √(2/(εr+1)); εeff; ΔL (Hammerstad); L = c/(2f√εeff) − 2ΔL; Rin = 1/2(G1+G12) by numeric integration; inset y0 = L/π · acos √(Z0/Rin); BW = 3.77 (εr−1)/εr² · W/L · h/λ | Balanis, *Antenna Theory* ch. 14 (example 14.1 reproduced in tests); bandwidth: Jackson & Alexopoulos |
| **Discone** | cone slant λ/4 at f_low / 1.25, disc Ø 0.7 × λ/4, half-angle 30°, gap max(3d, 0.0025 λ) | [Wikipedia: Discone](https://en.wikipedia.org/wiki/Discone_antenna). NEC-2 rod model: SWR ≲ 2 from ≈ 1.25 f to 8 f |

## Printed (PCB) antennas and openEMS

Printed antennas sit on a dielectric over a partial ground pour, which the free-space wire solver cannot model.
The **design formulas were calibrated with openEMS (FDTD)** using the scripts this app exports:
- openEMS was built from source (github.com/thliebig/openEMS-Project);
- every calibration run is a script produced by `toOpenEMS()`;
- the board is FR-4 unless noted, trace w = 1 mm, ground pour 30–35 × 40 mm.

| Antenna | Model | Calibration |
|---|---|---|
| **PCB trace monopole** | L = λ/4 / √εeff with εeff = 1 + q(εr − 1), **q = 0.048 √(h/w) εr^0.47** | Resonance with L = 22.6 mm: FR-4 1.6 mm 2.80 GHz (q 0.121); FR-4 0.8 mm 2.94 GHz (q 0.082); εr 10.2 1.27 mm (L 16.9 mm) 2.82 GHz (q 0.16). Z ≈ 69 Ω, directivity 3.0 dBi, efficiency 98 % |
| **Printed IFA** | f · (La + 0.225 H) = c / (4 √εIFA), εIFA = 1 + 0.2745 (h/mm)^0.133 εr^0.47 (εr − 1); 50 Ω tap S = 2.5 mm √(H/5 mm) | FR-4 1.6 mm: H = 5 mm → 2.32 GHz, 48 − j2 Ω (S11 −31 dB); H = 8 mm → 2.65 GHz, 82 Ω with S = 4 mm. RO4003C 0.8 mm, H = 5 mm → 2.52 GHz, 59 + j17 Ω. H = 3 mm could not be matched with S = 0.5 H (R < 25 Ω), so the model is limited to H ≈ 4–10 mm |
| **Printed dipole** | L = 0.855 · λ/2 / √εeff(monopole fit) | K = 0.96 resonated at 2.174 instead of 2.442 GHz, so K = 0.855. Verified: FR-4 2.411 GHz, RO4003C 2.445 GHz |
| **Meander monopole** | total trace = 1.215 × the straight monopole, folded into runs of width W and pitch P | FR-4 1.6 mm, 2.44 GHz, W 8 mm, P 3 mm: 1.25 gave 2.373 GHz (S11 −20 dB, 41 Ω), so 1.215. One calibration point only |
| **PCB small loop** | Grover inductance (ρ = 0.2235 (w + t)), Rr = 31171 (A/λ²)², Rloss = perimeter/(2w) · Rs, capacitor ESR = XL/Q; L-network Cs (series) + Cp (shunt) to 50 Ω | Analytic (Microchip AN831, TI SWRA046 style). Typical 433 MHz, 30 × 20 mm: L ≈ 80 nH, Rr ≈ 49 mΩ, efficiency ≈ 5 % |
| **Patch** | Balanis TL model (above); now also exported to openEMS | — |

### Verification on designs the fits had not seen (openEMS)

| Design | Target | openEMS result |
|---|---|---|
| IFA FR-4 1.6 mm, H = 6.5 mm (fit used 5 and 8 mm) | 2.442 GHz, 50 Ω | best match 2.471 GHz (+1.2 %), S11 −17.9 dB, 60 + j10 Ω, gain 2.75 dBi |
| Monopole on RO4003C 0.8 mm | X = 0 at 2.442 GHz | X ≈ 0 from 2.2 to 2.6 GHz (flat), but R ≈ 120 Ω, so a matching network is needed |
| Meander 2.44 GHz (factor 1.25) | 2.442 GHz | 2.373 GHz, S11 −20 dB, then refitted to 1.215 |
| Printed dipole (K = 0.96) | 2.442 GHz | 2.174 GHz, then refitted to 0.855 |
| Printed dipole, K = 0.855, FR-4 1.6 mm | 2.442 GHz | resonance 2.411 GHz (−1.3 %), 59 + j11 Ω, 1.9 dBi |
| Printed dipole, K = 0.855, **RO4003C 0.8 mm** (not in the fit) | 2.442 GHz | resonance 2.445 GHz (+0.1 %), S11 −19 dB, 2.05 dBi, 99 % |

### The openEMS export (`src/lib/openems.ts`)

The script builds the substrate (loss as κ = 2πf0·ε0·εr·tan δ), copper rectangles (PEC sheets, edge "thirds" mesh), a lumped port, a λ/2 air box (MUR) and an NF2FF box. It then:
1. runs openEMS (−50 dB end criterion);
2. prints the resonances (Im Zin = 0) and the directivity, efficiency and gain over the full sphere;
3. saves `<name>_results.json` / `_s11.csv` / `_results.png` next to itself (S11, Zin, polar cuts).

Load the JSON in the app's Simulation tab to see it in the same charts.

**Two pitfalls found while validating it against a free-space strip dipole.** The dipole's Z was right from the start, so only the far field was affected:
- **`CalcNF2FF(center=…)` is in metres, not drawing units.** Passing millimetres moved the phase centre metres away and gave 9–12 dBi "directivity" for a dipole. openEMS also caches NF2FF files (`read_cached`), so the fix only showed after disabling the cache.
- **A λ/4 air margin read 0.4 dB low** (1.82 dBi). λ/2 gives 2.14 dBi (theory 2.15). The official patch tutorial, run as a reference, gave 6.8 dBi and 94 % efficiency.

## In-browser FDTD

`src/lib/fdtd` (CPU reference) and `src/gpu/fdtdGpu.ts` (WebGPU) solve the same printed-antenna model that the openEMS
export writes, inside the browser. "Run FDTD" in the Simulation tab uses WebGPU when the browser has it and the CPU engine otherwise.

- **Mesh** (`mesh.ts`): rectilinear, λmin/20 in air and λmin/(20√εr) in the substrate, copper edges by the thirds rule,
  four cells across the substrate, exact lines at the port terminals and board edges, λ/2 of air at the lowest frequency.
  Lines are graded with ratio ≤ 1.4: cells placed evenly in ∫dx/h with h = s + ln(1.4)·distance grow geometrically by exactly 1.4.
- **Update** (`setup.ts`, `cpu.ts`): standard Yee scheme, dt = 0.95 × the Courant limit. Materials are averaged over the four
  cells around each edge; FR-4 loss is a conductivity σ = 2πf0 ε tanδ. Copper is a zero-thickness PEC sheet.
  Boundaries are first-order Mur.
- **Port:** a lumped 50 Ω resistive voltage source spread over the port edges, with Gaussian excitation over the simulated span.
  Z(f) = DFT(V) / DFT(I), with V sampled at (n+1)dt and I at (n+½)dt.
- **Far field** (`nf2ff.ts`): running DFTs of the tangential E and H on a box four cells inside the boundary, then
  J = n × H, M = −n × E radiated to 5° steps over the full sphere. Gain = 4πU / P_accepted, efficiency = P_rad / P_accepted.
- **Stop:** when the port signals are 40 dB below their peak (as openEMS EndCriteria 1e-4, which is on energy), or at 100 k steps.
  On the IFA below, truncating a 60 k-step run showed the resonance settled at 20 k steps and S11 depth at 25 k (−30 dB signal level).
- **WebGPU:** the kernels mirror the CPU code (H update, E update, port, Mur, NF2FF DFT). Fields and data are packed into
  7 storage buffers, which fits the default limit of 8. Over 400 steps the GPU matched the CPU to 1.5 × 10⁻⁴ relative.

**Validation against openEMS** (CPU engine; the dipole run to −100 dB, the IFA for 80 k steps ≈ −50 dB; openEMS with the exported script):

| Case | This FDTD | openEMS |
|---|---|---|
| Strip dipole in air, 2 × 28 mm, 1 mm gap | 74.6 + j3.7 Ω at 2.442 GHz, 2.17 dBi, efficiency 99 % (77 × 112 × 65 cells) | 74 Ω, 2.14 dBi |
| IFA, FR-4 1.6 mm, H = 5 mm, ground on both layers | best match 2.393 GHz, S11 −22.6 dB, 51.7 + j7.4 Ω, directivity 3.09 dBi, efficiency 90 % (128 × 108 × 65 cells) | 2.320 GHz, 48 − j2 Ω, 3.06 dBi, 91 % |
| Printed dipole, app defaults (FR-4, in Chromium, CPU engine) | resonance 2.398 GHz, SWR 1.39–1.45 in 2.400–2.483 GHz, 2.05 dBi, 392 k cells; 12 k steps / 218 s at −40 dB (−60 dB: 2.397 GHz, 15 k steps) | 2.411 GHz for the calibration board |

Impedance and pattern agree closely. The IFA resonance comes out **about 3 % high**. The likely cause is how the
zero-thickness copper edge and the substrate interface are averaged. Treat the in-browser FDTD as a fast first pass
and openEMS as the reference for a final board.

**Speed:** the CPU engine does ≈ 20 M cell-updates/s (single thread). The IFA above (0.9 M cells, ≈ 25–40 k steps) takes
15–25 min on the CPU and well under a minute on a desktop GPU. Headless Chromium only offers SwiftShader (software WebGPU),
which is about 5× slower than the CPU engine but runs the same kernels.

## Build pack (`src/lib/build.ts`, `fab.ts`, `template.ts`)

- **Pieces:** wires of one kind (group, diameter, mechanical or not) are joined where exactly two meet with nothing else
  attached, or where they continue in a straight line. That turns a quad's four sides into one closed loop and a J-pole's tapped
  radiator into one tube. Free ends (touching nothing) are the trim points.
- **Trim sensitivity:** the design is rebuilt with every band scaled by 1.01; the change in each resonant part gives dL/df.
  A step s at each of E trim points on n parts moves the best match by Δf = s·E / (n·|dL/df|). Steps are rounded to
  0.25/0.5/1/2/3/5/10… mm, aiming at about 0.3 % per step. Check: a 145 MHz dipole gives 2 mm per end → 603 kHz,
  and f·ΔL/L = 145 MHz × 4 mm / 966 mm = 600 kHz.
- **Measured vs model:** best match (lowest |Γ|) within ±20 % of each tuned part's frequency, SWR < 3. Change per trim point
  = (f_target − f_measured)·n·|dL/df| / E. The rescale button sets trim so (1 + trim) is multiplied by f_measured / f_target.
- **Substrate notes:** the layout is fixed, so the frequency it would give on another εr is f × L(εr′) / L(εr), with L the
  resonant dimension the formula would choose at εr′. Default IFA on FR-4: εr + 0.1 → −1.4 %; 4.2…4.7 → 2.34…2.51 GHz.
- **Gerber:** RS-274X, `%FSLAX46Y46*%`, mm, one G36/G37 region per copper rectangle, origin at the board's lower-left corner.
  Files: .GTL, .GBL, .GKO (0.1 mm outline), .DRL (Excellon, metric) for a probe feed, .dxf (R12, layers OUTLINE/TOP/BOTTOM/PORT/DRILL).
  Checked with gerbonara (all files parse, bounding boxes match the board) and ezdxf.

## Printed build parts (`src/lib/print/`)

Every wire antenna gets 3D-printable parts built from `Design.wires`. Dipole: centre block and end insulators. Ground plane: radial hub.
Yagi: element clips and driven block. Helix: grooved tube or rib frame (print one; base flange with SMA hole and feed slot, stacked
with D-keyed spigots above 170 mm). Discone: rod hub with an axial mast socket (`mast` param). Moxon: spreader hub, front and rear
corner caps (one part, turned over) and 2 tip-gap insulators set to C. Quad: a hub per loop and 8 corner caps. Biquad: feed standoff
with a 5 mm plate, a 45° connector flange, a feed-gap slot, and leg grooves that run out past the plate (works at 5.8 GHz). J-pole: stub spacers and a clip-on feed-tap gauge. Fan dipole: centre block and leg
spreaders. Collinear: radome spacers, one per section (`rid` param). Print-only params `rod`, `bd`, `rid`, `mast` do not affect NEC or MoM.
Fan spreaders use only wires within 60° of the leg, between Ymin = gap/2 + 50 mm and Ymax = min(⅔ of the longest arm, gap/2 + 150 mm / spread); midway and Ymax, or only Ymax when closer than 20 mm; none if Ymax < Ymin or fewer than 2 holes.

Shells (`print/shells/`): every antenna gets one `shell` part. A full shell (dome for helix and discone, otherwise a two-half clamshell; PCB antennas get a board enclosure with edge stops, ground posts and a raised roof for the coax) is used when it fits the 180 mm bed, otherwise a one-piece feedpoint hood open at the bottom. Style follows frequency: at 2 GHz and above wall 1.2 mm, gap 1.5 mm, flat screwed joint; below, wall 2 mm, gap 3 mm, lip, silicone and a drain. Plastic near the antenna lowers the resonance by about 1-3 %: retune with Trim and check printed antennas with FDTD. Shells are not simulated.

## Built-in simulator (`src/lib/mom.ts`, `src/lib/simulate.ts`)

The **Simulation** tab shows openEMS-style results:
- S11 (dB), input impedance (Re/Im) and SWR against frequency, with the bands shaded;
- a Smith chart with the SWR 2 circle;
- three polar far-field cuts in dBi (XY, XZ, YZ);
- a rotatable 3D gain surface;
- a summary: maximum gain and its direction, front-to-back, −3 dB beamwidth, and SWR range plus Z per band.

The S11 sweep can be exported as Touchstone `.s1p` (load it in WebVNA as an overlay) and the cuts as CSV.

- **Wire antennas** use a thin-wire Method of Moments in the MININEC formulation:
  - current pulses between segment midpoints, charge pulses on segments, point matching and a reduced kernel;
  - the static 1/R part is integrated analytically (asinh), the rest with 4/8-point Gauss;
  - junctions get k − 1 unknowns;
  - a delta-gap source sits at the feed node.
  It runs in a Web Worker at 60 segments per λ, capped at 450 unknowns.
- **Patch:** cavity-model impedance R0 / (1 + jQ(f/fr − fr/f)), with R0 the inset resistance and Q = 1/(√2 · BW). The pattern uses the two-slot model over an infinite ground plane, normalised to directivity.
- **Collinear:** the array factor of N in-phase λ/2 dipoles; it has no impedance model.

**Validation:** compared at the same geometry, as segments get finer.

| Model | MoM λ/20 → λ/160 | NEC-2 (converged) |
|---|---|---|
| Dipole 145 MHz | 70.7 − j0.1 → 73.3 + j5.6 Ω, 2.13 dBi | 73.4 + j7.5 Ω, 2.15 dBi |
| Quad | 59.5 + j15 → 52.2 − j5.9 Ω | 51.9 − j6.2 Ω |
| Moxon | 34 − j21 → 47.5 − j6.7 Ω | 50.0 − j3.9 Ω |
| Yagi 9 el (folded) | 196 + j24 → 230 − j43 Ω, 13.0 dBi | 238 − j38 Ω, 13.4 dBi |
| J-pole | 35 → 28.6 Ω | 38.5 (λ/80) → 32.6 (λ/160) → 31.3 Ω (λ/320) |

**Lesson:** the first J-pole and fan-dipole tunings were fitted to NEC-2 decks at λ/40, which are **not converged** for close-spaced parts. The J-pole moved from 38.5 to 31.3 Ω as the segments got finer. Both were re-tuned on converged models:
- J-pole: tap 0.019 λ, ≈ 45–48 − j7 Ω.
- Fan dipole: element lengths are now tuned by the solver itself.

The NEC export now uses λ/80.

## NEC-2 export

The deck is in free space:
- `GW` per wire, with λ/80 segments at the top of the sweep, λ/10 for plate grids, and an odd count on centre-fed wires.
- **Tapered segments:** wires attached to a short feed-gap wire start with a segment the size of the gap, growing ×1.4 per segment (`GW` with radius 0, then `GC`), and continue uniform after that. Without the taper, a 5 cm feed segment next to 1 m segments reads −30 % low on an HF dipole (49 Ω instead of 73 Ω).
- `GE 0`, then `EX 0` on the feed segment.
- An `FR` + `RP 0 37 73 1000 0 0 5 5` pair **per band**, each with a ±2 % margin. The discone gets one sweep across all bands.
- `EN`.
Plates (helix ground plane, biquad reflector) become wire grids. Booms are left out. The patch and the coaxial
collinear have no wire model, so the NEC button is disabled for them.

The numbers above came from `nec2++` (necpp) running the exported decks. To repeat:

```bash
nec2++ -i yagi-145.5MHz.nec -o yagi.out     # or open the .nec in 4nec2 / xnec2c
```

## FreeCAD export

`*.FCMacro`: one `Part::Feature` per wire (cylinder) and per plate (extruded polygon), in millimetres, coloured
by role. Run it from *Macro → Macros… → Execute* or paste it into the Python console.
