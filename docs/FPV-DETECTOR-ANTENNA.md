# Wideband omni antenna for a handheld FPV / drone detector (800 MHz – 6.4 GHz)

A simulation study: the antenna has been designed and checked with two independent solvers, but
**not yet built and measured**. Everything needed to build it, to check it with a VNA, and to repeat
or extend the search is here and in [`tools/wideband-antenna/`](../tools/wideband-antenna/README.md).

**Recommended design (B): a sky-tilted cone antenna, Ø113 × 110 mm.** A hot cone with a closed lid
sits on the coax centre pin and opens upward; a shallow ground cone is soldered to the coax jacket
underneath it. Fed by 0.141″ semi-rigid / hand-formable coax.

| | Design B (recommended) |
|---|---|
| Band | 800 MHz – 6.4 GHz (8:1): 868/915 MHz control, 1.2–1.3, 2.4, 3.3, 5.8 GHz video |
| SWR (50 Ω) | ≤ 1.38 over the whole band (MoM, no cable); with 15 cm of cable and no ferrite ≤ 1.75 (MoM) / 1.71 (independent FDTD) |
| Gain toward the sky, 15–50° elevation | average +2.3 dBi, never below −1.2 dBi at any frequency |
| Pattern | omni in azimuth (rotationally symmetric), vertical polarisation; peak 1.7–5 dBi at 10–56° elevation |
| Size | Ø113 mm × 110 mm; ≈ 75 g of 0.2 mm brass (hot element ≈ 55 g) |
| Build tolerance | lengths ±1 mm, gap ±0.3 mm, angles ±1.5°: 48 of 48 random builds SWR < 2 (worst 1.77) |
| Feed cable | ferrite on the cable under the ground cone recommended: then SWR ≤ 1.61 with any cable length; without it ≤ 1.75 except a 10 cm cable (2.15 at 800 MHz) |

A larger variant **A** (Ø275 × 294 mm) covers **300 MHz – 6.4 GHz** (433 MHz too) with SWR ≤ 1.58 (≤ 1.76 with 35 cm of cable, MoM and FDTD; needs a ferrite);
see [Variant A](#variant-a-full-range-300-mhz--64-ghz).
A compact variant **S73** (Ø73 × 71 mm) covers **960 MHz – 6.4 GHz** with SWR ≤ 1.97 (≤ 1.80 with any cable; needs a 6-bead ferrite sleeve; FDTD with the plastic kit ≤ 2.00);
see [Smaller: compact variants](#smaller-compact-variants-from-960-mhz).
The same compact size can be bent from **Ø1 mm wire**: 16 frames per side plus hoops (design **W16**, Ø71.5 × 74.7 mm,
NEC-2 SWR ≤ 1.97 over 960 MHz – 6.4 GHz); see [Wire-cage version](#wire-cage-version-w16).
One straight **shorting wire** from a hot frame to the ground frame makes the cage smaller: design **W65**,
Ø65 × 65 mm, NEC-2 SWR ≤ 1.85 over the same band; see [Smaller wire cage](#smaller-wire-cage-one-shorting-wire-w65).
Ø40 × 40 mm is below the physical floor for 960 MHz (SWR ≥ 4.65 with a perfect match; bent, twisted and coiled frames
do not change that), but a 40 mm cage covers **1.4 – 6.4 GHz** at SWR ≤ 2.1 (design **W40**, in the app);
see [How small can the cage go?](#how-small-can-the-cage-go-ø40--40-mm-study).
Splitting the band between **two antennas** gets below that: **B44f** (Ø43 × 44 mm, 1.36 – 7 GHz, SWR ≤ 1.73; 43 mm at ≤ 1.95 with cable) and
**A55** (Ø51 × 54 mm, 960 MHz – 1.36 GHz, SWR ≤ 1.9 with two small capacitors); no ferrite: a quarter-wave choke sleeve on the coax keeps them ≤ 2.0 / ≤ 1.7 with any cable;
see [Two antennas instead of one](#two-antennas-instead-of-one-960-mhz--136-ghz-and-136--7-ghz).

![Cross-section of design B](fpv-detector/profile.png)

![Designs B and A at the same scale](fpv-detector/A_B_3d.png)

![Sections of designs B and A at the same scale](fpv-detector/A_B_section.png)

**In the app:** the designs are antenna types in the Broadband group, **"Sky-tilted capped bicone (8:1)"** (B),
**"(21:1)"** (A), **"compact (6.7:1)"** (S73), **"wire cage (6.7:1)"** (W16), **"small wire cage (6.7:1)"** (W65), **"mini wire cage (4.6:1)"** (W40, 1.4 – 6.4 GHz) and **"mini wire cage 7 GHz (5.1:1)"** (B44f, 1.36 – 7 GHz, choke sleeve instead of ferrite) and **"low-band wire cage (1.4:1)"** (A55, 960 MHz – 1.36 GHz, two coiled shorting wires and two capacitors, two choke tubes). The band editor scales the shape (e.g. 1–8 GHz); Simulation shows this study's
tabulated MoM sweep and elevation pattern, scaled to the size; Build lists the flat patterns and
prints them at 1:1 (`src/lib/antennas/skycone.ts`). The name: an *asymmetric bicone*, or an *inverted
discone* (cone on top as the hot element, a shallow ground cone below), with a capped top (rim + lid).

## Requirements

| Item | Target | Notes |
|---|---|---|
| Band | 800 MHz – 6.4 GHz | (first asked as 300 MHz – 6.4 GHz; variant A meets that) |
| Match | SWR ≤ 2 (50 Ω) over the whole band | designed for ≤ 1.85 in MoM, margin for model error and build tolerance |
| Pattern | omni in azimuth, like a cloverleaf on a coax stick; good gain at **15–50° elevation** | the detector is held upright; drones are in the air |
| Size | ≤ 300 mm height and diameter | handheld; the 800 MHz design needs only 113 mm |
| Polarisation | linear (vertical) accepted | CP drone signals arrive 3 dB down, fine for detection |

## Starting point: why a cloverleaf cannot do it

App MoM (`src/lib/mom.ts`), log sweeps; the discone rows use the new body-of-revolution solver.

| Candidate | Result |
|---|---|
| **Cloverleaf** (app default: 3 leaves, 45°, Ø1 mm, 5.8 GHz) | SWR < 2 only from 5.1 to 6.8 GHz; 6.7 at 4 GHz, 22 at 3.2 GHz, > 100 below 2 GHz. A cloverleaf is a set of resonant loops: scaling or bending them moves a ~30 % window, it never makes it 8:1. |
| **Discone, app builder** (16 rods Ø3 mm, slant 310 mm) | SWR < 2 only up to ~700 MHz, 1.8–3.7 above. 16 rods stop acting as a cone above ~1 GHz. Above 1 GHz the beam goes **down** (toward the cone): −3 … −28 dBi at 15–50° elevation. |
| **Solid discone** (sheet metal) | SWR ≤ 2 over a decade, but the beam points 40° **below** the horizon above 1.3 GHz (−5 … −22 dBi toward the sky). |
| **Same, upside down** (hot cone on top, ground disc below) | the beam tilts **up** to +35…+50° at high frequencies — the 15–50° window. But a small ground disc drives current onto the feed cable: with 300 mm of cable the SWR went to 9.9 at the bottom of the band. |

What shaped the design:

1. A wide band needs a shape defined by **angles** (cones) made of **solid sheet**, not resonant wires.
2. A discone/bicone beam tilts toward its **narrower** element at high frequencies. Hot cone on top +
   wide ground below = beam tilted to the sky.
3. At the bottom of the band a small antenna drives current onto its feed cable; the cable is part of
   the antenna unless a ferrite (or a sleeve) stops it. Every candidate was scored with cables.
4. Above 3 GHz everything is decided within ~10 mm of the feed: pin gap, the washer on the pin and the
   ground around the coax. A flat 13 mm SMA flange at the apex raised the 6 GHz SWR from 2 to 3.3, so
   the feed is a 0.141″ semi-rigid coax with the ground cone soldered to its jacket.

## Design B: dimensions

z = 0 is the cut end of the coax (outer conductor and PTFE cut flush); the centre conductor continues
upward. All sheet parts are cones, cylinders or discs; flat patterns are annular sectors: draw two
arcs of radius R_in and R_out, keep the given sector angle, add a 4–5 mm overlap tab on one straight
edge, roll until the straight edges meet and solder the seam.

| Part | Shape | Flat pattern |
|---|---|---|
| Feed | 0.141″ semi-rigid or hand-formable coax (UT-141, RG-402: centre Ø0.92 mm, PTFE Ø2.98 mm, jacket Ø3.58 mm), cut flush at z = 0 | an SMA–SMA .141 jumper cut in half gives the cable and the connector |
| Ground cone | apex on the jacket at z = 0, opens **down**, half-angle **69.0°** (21° below horizontal), Ø3.6 → **Ø113.0 mm**, depth 21.1 mm, slant 58.9 mm | sector R 1.6–60.5 mm, **336.1°** (cut out a 23.9° wedge); drill the apex for the jacket |
| Washer (hot) | brass disc **Ø5.0 mm**, Ø1 mm hole, soldered on the centre pin with its underside **1.9 mm** above the coax end | — |
| Feed cone (hot) | from the washer edge, opens **up**, half-angle **52.5°**, Ø5.0 → **Ø29.6 mm**, height 9.4 mm, slant 15.5 mm | sector R 3.2–18.7 mm, **285.6°** |
| Main cone (hot) | half-angle **34.5°**, Ø29.6 → **Ø111.0 mm**, height 59.2 mm, slant 71.9 mm | sector R 26.1–98.0 mm, **203.9°** |
| Rim (hot) | cylinder **Ø111.0 × 18.5 mm** | strip 348.7 × 18.5 mm |
| Lid (hot) | flat disc **Ø111.0 mm** closing the top at z = 89.1 mm | disc |

Overall: Ø113.0 mm, from z = −21.1 mm (ground rim) to z = +89.1 mm (lid), 110.2 mm tall.

Parameters (metres, degrees) for the tools: [`tools/wideband-antenna/designs/B_simple.json`](../tools/wideband-antenna/designs/B_simple.json).
The optimiser's original shape (two-angle ground, a Ø9 mm hole in the lid, a 2.5 mm skirt) is
`B.json`; simplifying it changed the worst SWR from 1.42 to 1.38 and the sky gain by < 0.3 dB.

## Design B: simulated performance

![SWR of design B](fpv-detector/swr.png)

![Gain toward the sky](fpv-detector/gain_elev.png)

![Elevation cuts](fpv-detector/elev_cuts.png)

Drone bands (MoM, λ/24 mesh, no cable; gain in dBi, averaged over 5 points per band):

| Band, GHz | Max SWR | 0° | 15° | 30° | 50° | Peak (elevation) |
|---|---|---|---|---|---|---|
| 0.86–0.93 | 1.34 | 1.6 | 1.7 | 1.2 | −0.8 | 1.7 (11°) |
| 1.08–1.36 | 1.36 | 1.2 | 1.8 | 2.0 | 0.7 | 2.0 (25°) |
| 2.40–2.48 | 1.23 | 0.1 | 0.3 | 0.9 | 4.2 | 4.6 (56°) |
| 3.17–3.47 | 1.15 | −2.7 | 2.7 | 3.3 | 1.7 | 4.1 (48°) |
| 5.65–5.95 | 1.30 | −1.8 | 4.0 | 4.0 | −0.1 | 5.1 (22°) |

Over the whole band: worst SWR 1.38 (at 809 MHz); gain over 15–50° elevation averages +2.3 dBi and
never drops below −1.2 dBi. Below the horizon the gain falls off (the ground cone and the hand are
there), which is what a sky-watching detector wants. Full sweep:
[`results/B_simple_sweep.csv`](../tools/wideband-antenna/results/B_simple_sweep.csv).

### Feed cable and ferrite

Worst SWR over 800 MHz – 3.2 GHz with a coax hanging below the antenna (the cable's outer surface is
part of the antenna). Ferrite = a 150 Ω series loss on the cable 10 mm below the ground cone.

| Cable below the antenna | 5 cm | 10 cm | 15 cm | 20 cm | 35 cm | 50 cm | 100 cm |
|---|---|---|---|---|---|---|---|
| no ferrite | 1.74 | 2.15 | 1.71 | 1.56 | 1.68 | 1.75 | 1.61 |
| with ferrite | 1.35 | 1.39 | 1.58 | 1.56 | 1.61 | 1.50 | 1.48 |

Put one or two ferrite beads (material 61 or 43, inner Ø ≥ 3.7 mm) on the coax right under the
ground cone. Without them the antenna still works with most cables, but a 10 cm cable resonates at
the bottom of the band. In real use the detector box and the hand are the "cable": the ferrite makes
the antenna independent of them.

### Build tolerance

Monte Carlo, 48 random builds each, every dimension perturbed independently (uniform):

| Tolerance | Builds with SWR < 2 | Median worst SWR | 90th percentile | Worst |
|---|---|---|---|---|
| lengths ±1 mm, pin gap ±0.3 mm, angles ±1.5° | 100 % | 1.41 | 1.59 | 1.77 |
| lengths ±2 mm, pin gap ±0.5 mm, angles ±3° | 92 % | 1.47 | 1.81 | 2.21 |

One at a time (worst SWR in 0.8–1.5 / 1.5–4 / 4–6.4 GHz; nominal 1.40 / 1.33 / 1.36):

| Change | 0.8–1.5 GHz | 1.5–4 GHz | 4–6.4 GHz |
|---|---|---|---|
| pin gap −0.5 mm / +0.5 mm | 1.34 / 1.46 | 1.33 / 1.49 | **1.11 / 1.67** |
| washer Ø −2 mm / +2 mm | 1.46 / 1.37 | 1.43 / 1.27 | **1.60 / 1.26** |
| main cone angle −3° / +3° | 1.34 / **1.55** | 1.29 / 1.39 | 1.33 / 1.40 |
| feed cone angle −3° / +3° | 1.44 / 1.40 | 1.39 / 1.32 | 1.32 / 1.40 |
| ground angle −3° / +3° | 1.45 / 1.43 | 1.40 / 1.29 | 1.38 / 1.34 |
| hot / ground diameter ±4 mm, rim ±2 mm | ≤ 1.45 | ≤ 1.35 | ≤ 1.40 |

The pin gap and the washer set the top of the band; the main cone angle sets the bottom. Everything
else is forgiving.

## How to build design B

### Materials

- 0.2–0.3 mm brass or copper sheet (or tin-plate from food cans: it solders well). About 300 × 200 mm.
  Aluminium works electrically but cannot be soldered; copper foil tape with **conductive** adhesive
  on a 3D-printed or card former also works if every seam is soldered.
- 0.141″ (3.58 mm) semi-rigid or hand-formable coax, 50 Ω, PTFE — e.g. one half of an
  SMA-male–SMA-male .141 jumper, 15–30 cm. RG-402 / UT-141 / "hand-formable .141" all match the model.
- One or two ferrite beads, material 61 or 43, inner Ø ≥ 3.7 mm, to slide on the coax.
- For the holder: PETG or PLA (3D-printed cover) or rigid foam (EPS/XPS, any shape, electrically invisible).

### Steps

**Full step-by-step guide with 3D-printed templates, formers, soldering jigs, cover and cup:
[FPV-DETECTOR-BUILD.md](FPV-DETECTOR-BUILD.md).** In short:

1. Cut the flat patterns (printed templates or the app's 1:1 PDF), roll the cones on the printed
   former and in the cup's cradle, and solder the seams.
2. Thread the coax through the handle and cup, cut its end flush, solder the ground cone apex to the
   jacket (coax end flush with the inside of the apex).
3. Solder washer + feed cone to the centre pin on the **1.9 mm** gap fork.
4. Rest the main cone + rim on three printed wedges, solder it to the feed cone, then the lid.
5. Measure, remove the wedges, glue the cover to the lid and the cup. The ferrite sits in the handle.

### Plastic cover or holder

FDTD, design B with 15 cm of cable, bare vs a 1.2 mm PETG (εr 2.6) cover: a cylinder Ø117 mm
(2 mm outside the ground rim) from the ground rim to just above the lid, closed by a 1.2 mm top that
rests on the lid.

| | Bare | With cover |
|---|---|---|
| Max SWR 800 MHz – 6.4 GHz | 1.71 | 1.72 |
| Largest change | — | 3.7–4.2 GHz: 1.28 → 1.43 |
| Patterns at 0.9 / 1.25 / 2.44 / 3.3 / 5.8 GHz | — | within 1.1 dB |

So a printed cup that clips onto the ground rim and is glued to the lid is fine. Rigid foam
(εr ≈ 1.05) is even less visible. Keep plastic out of the feed region (the first ~15 mm around the
coax end): the pin gap is the most sensitive dimension and a plastic plug there was not simulated.

### Checking it with a VNA

- Calibrate at the SMA end of the coax (or include the coax: the PTFE coax loss is ~1 dB/m at 6 GHz
  and only improves the reading).
- Expect S11 below about −13 dB (SWR 1.6) over most of the band and below −10 dB (SWR 2) everywhere
  from 800 MHz to 6.4 GHz; the model without cable is −16 dB or better everywhere. Compare with
  [`results/B_simple.s1p`](../tools/wideband-antenna/results/B_simple.s1p) — the app's Simulation tab
  imports `.s1p` for the measured-vs-model view.
- Hold it the way it will be used (on the detector, in the hand) for the final check.
- **Too high at 4–6.4 GHz:** the pin gap is the knob — reduce it (−0.5 mm took the top-band SWR from
  1.36 to 1.11), or the washer is too small / off-centre. **Too high near 800 MHz:** check the main
  cone angle and that the lid and rim are soldered all round; add the ferrite. A resonance that moves
  when you touch the cable means the ferrite is missing or too far down.

## Variant A: full range 300 MHz – 6.4 GHz

The same topology optimised for the first requirement (300 MHz – 6.4 GHz, ≤ 300 mm). Use it only if
433 MHz matters: it is 2.5× larger.

| | Design A |
|---|---|
| Band | 300 MHz – 6.4 GHz (21:1), including 433 MHz |
| SWR (50 Ω) | ≤ 1.58 (MoM, no cable, worst at 480 MHz); with 35 cm of cable ≤ 1.76 in both MoM and the independent FDTD |
| Gain toward the sky, 15–50° elevation | average +2.2 dBi, lowest −3.0 dBi |
| Size | Ø275 × 294 mm (hot element Ø274.7, ground Ø222.1 with a 51.9 mm skirt) |
| Feed cable | **ferrite required**: with it SWR ≤ 1.66 for any cable length; without it a 15 cm cable gives 4.5 and 20 cm 2.4 at the bottom of the band |

| Band | SWR | Gain 0 / 15 / 30 / 50° (dBi) | Peak |
|---|---|---|---|
| 433 MHz | 1.57 | 1.6 / 1.7 / 1.2 / −0.8 | 1.7 dBi @ 11° |
| 868/915 MHz | 1.19 | 0.1 / 0.6 / 2.0 / 3.4 | 3.4 dBi @ 49° |
| 1.2 GHz | 1.44 | 0.8 / 2.4 / 1.1 / 2.3 | 3.6 dBi @ 41° |
| 2.4 GHz | 1.08 | −1.3 / 3.2 / 3.1 / 1.9 | 4.0 dBi @ 22° |
| 3.3 GHz | 1.29 | 0.0 / 1.9 / 4.5 / −2.4 | 4.8 dBi @ 32° |
| 5.8 GHz | 1.48 | 2.2 / 2.9 / 2.0 / 2.1 | 4.0 dBi @ 11° |

Cut list (z = 0 at the coax end; flat patterns as for B):

| Part | Shape | Flat pattern |
|---|---|---|
| Washer (pin) | flat annulus Ø0.9 → Ø9.5 mm at z = 2.4 mm | disc Ø9.5, hole Ø0.9 |
| Hot feed cone | 53.2°, Ø9.5 → Ø39.9 mm, height 11.3 mm | sector R 6.0 – 24.9 mm, 288.4° |
| Hot main cone | 33.9°, Ø39.9 → Ø274.7 mm, height 174.4 mm | sector R 35.7 – 245.9 mm, 201.0° |
| Rim | cylinder Ø274.7 × 13.6 mm | strip 862.9 × 13.6 mm |
| Lid ring | flat annulus Ø76.6 → Ø274.7 mm at z = 201.7 mm | ring Ø274.7, hole Ø76.6 |
| Ground inner cone | 70.9°, Ø3.0 → Ø93.1 mm, height 15.6 mm | sector R 1.6 – 49.3 mm, 340.1° |
| Ground outer cone | 68.8°, Ø93.1 → Ø222.1 mm, height 25.0 mm | sector R 49.9 – 119.1 mm, 335.7° |
| Ground skirt | cylinder Ø222.1 × 51.9 mm | strip 697.6 × 51.9 mm |

FDTD check (35 cm cable): SWR ≤ 1.76 from 300 MHz to 6.4 GHz, identical to MoM at the bottom
(300 MHz: 1.76 both) and within 0.2 at the top; patterns agree within 0.5 dB except 5.8 GHz at 30°
(0.4 vs 1.9 dBi, a deep null region). Design file: `tools/wideband-antenna/designs/A.json`; in the
app: "Sky-tilted capped bicone (21:1)".

![SWR of design A](fpv-detector/A_swr.png)

![Gain of design A versus elevation](fpv-detector/A_gain_elev.png)

## Smaller: compact variants from 960 MHz

The size is set by the lowest frequency (the shape scales with 1/f_low) and, once the antenna gets
small, by the feed cable: the shorter ground cone hands more of the bottom-band current to the coax
shield, and a single bead no longer stops it (a 15–35 cm cable resonates by itself past one bead).
A **ferrite sleeve** — about 6 beads (material 43/61, inner Ø ≥ 3.7 mm) stacked on the first ~11 cm
of coax under the ground cone, inside the handle — fixes that. Model: 6 × 150 Ω series loss at
1, 3 … 11 cm. Over 960 MHz – 6.4 GHz (MoM, worst SWR over cables of 5 cm – 1 m):

| Design | Size | SWR, no cable | Cable, no ferrite | 1 bead | 6-bead sleeve | Gain 15–50°: avg / worst freq |
|---|---|---|---|---|---|---|
| B rescaled to 960 MHz | Ø94 × 92 mm | 1.38 | — | 1.66 | 1.35 | +2.1 / +0.7 dBi |
| B × 0.75 | Ø85 × 82 mm | 1.59 | — | 2.12 | 1.58 | +1.9 / +0.5 dBi |
| **B × 0.708** | **Ø80 × 78 mm** | 1.81 | 4.87 | 2.57 | **1.79** | +1.9 / +0.5 dBi |
| **S73** (re-optimised, ≤ 75 mm, built simplified) | **Ø73 × 71 mm** | 1.97 | 7.94 | 2.93 | **1.80** | +1.8 / +0.4 dBi |
| S68 (re-optimised, ≤ 68 mm) | Ø68 × 67 mm | 2.36 | 8.77 | 3.29 | 2.38 | +1.7 / +0.3 dBi |

- Rescaling alone gets to Ø80 mm with SWR ≤ 2; re-optimising the shape buys ~7 mm more (S73).
  Below ~70 mm the bottom of the band goes over SWR 2 whatever the shape.
- The pattern barely changes (only the lowest frequencies get electrically small); sky gain drops
  by ~0.3 dB.
- Receive-only: mismatch loss is 0.5 dB at SWR 2, 0.9 dB at 2.5, 1.25 dB at 3, so S68 (or B × 0.6,
  Ø68 mm, SWR 2.8–3.1) still works for a detector at ~1 dB cost near 1 GHz.
- **The ferrite sleeve is mandatory** for every compact variant: without ferrite a 10 cm cable gives
  SWR 5–9 at 960 MHz.
- S73 straight out of the optimiser had a Ø14 mm hole in the lid and a 1.1 mm skirt; the built
  version closes the lid and drops the skirt (`designs/S73.json`; the raw result is `S73_raw.json`).
  No-cable SWR 1.92 → 1.97, with the sleeve 1.84 → 1.80.
- In the app: **"Sky-tilted capped bicone, compact (6.7:1)"** (Simulation = this table, Build = cut
  list, 1:1 templates, the 6 beads in the BOM and the printed kit with a 130 mm handle whose pocket
  holds the sleeve). "Sky-tilted capped bicone (8:1)" with the band `960e6-6400e6` is the Ø94 × 92 mm
  rescale.

### Design S73: cut list and checks

z = 0 at the coax end; top z = 57.8 mm, bottom z = −13.2 mm.

| Part | Shape | Flat pattern |
|---|---|---|
| Washer (pin) | flat annulus Ø0.9 → Ø5.6 mm at z = 2.65 mm | disc Ø5.6, hole Ø0.9 |
| Hot feed cone | 38.1°, Ø5.6 → Ø20.3 mm, height 9.4 mm | sector R 4.5 – 16.4 mm, 222.4° |
| Hot main cone | 31.3°, Ø20.3 → Ø73.1 mm, height 43.4 mm | sector R 19.5 – 70.3 mm, 187.0° |
| Rim | cylinder Ø73.1 × 2.4 mm | strip 229.6 × 2.4 mm |
| Lid | flat disc Ø73.1 mm at z = 57.8 mm | disc Ø73.1 (Ø2 centring hole) |
| Ground inner cone | 67.3°, Ø3.0 → Ø19.0 mm, height 3.4 mm | sector R 1.6 – 10.3 mm, 332.1° |
| Ground outer cone | 69.3°, Ø19.0 → Ø70.9 mm, height 9.8 mm | sector R 10.2 – 37.9 mm, 336.7° |

The pin gap (2.65 mm) is again the top-of-band knob. Build it like B
([FPV-DETECTOR-BUILD.md](FPV-DETECTOR-BUILD.md)) with the parts from the app, and put the 6 beads
on the coax before it goes through the handle.

FDTD check (independent axisymmetric solver, 3 cm of cable; the FDTD has no ferrite model, so the
short cable stands in for the sleeve), `results/fdtd_S73_*cable3cm.txt`:

| | Bare | Cover + solid cup + 130 mm handle (PETG) |
|---|---|---|
| Worst SWR, 960 MHz – 6.4 GHz (FDTD) | 1.91 (MoM 1.90) | 2.00 |
| Patterns vs MoM / vs bare | within 0.3 dB | within 0.5 dB at 15–30°; 5.8 GHz at 50°: −1.8 dB |

The 2.00 is a narrow feature at 1.6–1.8 GHz that comes from the short cable (MoM shows it too, and it
is absent without a cable); elsewhere the plastic moves the SWR by ≤ 0.2 (top of the band
1.60 → 1.79). The cover sits 2 mm outside the rim, as for B, which is relatively closer on this
smaller antenna.

### Wire-cage version (W16)

The compact antenna built from wire instead of sheet: each cone, the rim and the lid become N
radial wire **frames** that follow the (ρ, z) profile, with a wire **hoop** soldered round them at
every bend. The frames meet the axis on a Ø6 mm washer on the centre pin (hot) and a Ø6 mm collar on
the coax jacket (ground). It is modelled in NEC-2 (PyNEC) by `wirecage.py`, and the shape was
re-optimised for the cage with `family9.py` (DE, 20 generations, no cable model).

| Ø1 mm wire, 960 MHz – 6.4 GHz, free space | Size | Worst SWR | Gain at 15–50°, mean (worst f) |
|---|---|---|---|
| Solid S73 (BoR MoM) | Ø73 × 71 mm | 1.97 | +1.8 dBi |
| S73 shape as a 16-frame cage | Ø73 × 71 mm | 2.09 | |
| **W16**: 16 frames, re-optimised | **Ø71.5 × 74.7 mm** | **1.95** (1.97 in the app table) | **+1.9 dBi (−0.2)** |
| W12: 12 frames, re-optimised | Ø66 × 75 mm | 2.51 at 6.4 GHz (2.15 up to 6 GHz) | +0.4 dBi (−0.9) |

- **16 frames is the practical number.** Fewer frames lose the top of the band (the cage stops
  looking like a surface); more do not fit: NEC rejects more than about 16 Ø1 mm wires meeting the
  Ø6 mm hub, and the real washer has the same problem.
- Extra hoops between the bends make it worse (S73 cage: 2.36 with hoops every 15 mm, 3.22 every 8 mm).
- Segment convergence: λ/20 vs λ/40 moves the SWR by ≤ 0.04. The feed model matters more: the pin
  gap as 1, 3 or 5 segments (source in the middle) moves it by up to 0.2. The app's NEC-2 export
  cuts the wires at λ/80 of 6.4 GHz (0.6 mm, shorter than the wire diameter, outside the thin-wire
  kernel's range): it gives 1.56 / 1.99 / 1.45 at 1 / 3.5 / 6 GHz, the same as `wirecage.py` with
  the same segments, against 1.72 / 1.91 / 1.64 in the table (λ/30, one-segment gap).
- **The ferrite sleeve is still required.** The cage model has no cable, but it is the same size as
  S73, which couples to the cable just as strongly.
- **Not smaller than the sheet version.** Wire buys lightness and less wind load, not size, and it
  costs 32 bent frames, 7 hoops and about 150 solder joints (every hoop crosses every frame).
- No FDTD check of the cage (the axisymmetric FDTD cannot model frames). The cover is the same
  1.2 mm PETG tube 2 mm outside the wires; expect a shift of about 0.1 in SWR, as with S73.

W16 (`designs/W16.json`), z = 0 at the coax end, Ø1 mm wire:

| Part | Qty | Shape |
|---|---|---|
| Hot frame | 16 | washer edge (ρ 3.2, z 2.6) → (14.1, 18.9) → (35.7, 59.9) → (35.7, 61.4) → (16.8, 61.4); 86.4 mm of wire, 3 bends |
| Ground frame | 16 | collar (ρ 3.0, z −0.7) → (10.3, −2.6) → (34.5, −11.5) → (34.5, −13.3); 35.1 mm, 2 bends |
| Hot hoops | 4 | Ø30.0 at z 18.3; Ø73.4 at z 59.6; Ø72.9 at z 62.1; Ø33.6 at z 62.4 (the lid edge: the lid is an open ring) |
| Ground hoops | 3 | Ø21.2 at z −1.6; Ø70.6 at z −10.9; Ø71.0 at z −13.3 |
| Hot washer | 1 | Ø6.4 on the centre pin, 2.6 mm above the coax end |
| Ground collar | 1 | Ø6.0 on the coax jacket, 0.7 mm below its end |

The hoop sizes are where the hoops really sit: against the outside of the frames (under the hot cones, over the
ground cone, outside the rims, over the lid), centre 1 mm from the frame's centre line (on the mitre of a bend toward the hoop, on the bisector
at the corner of a bend away from it).
The NEC model puts them through the bend points (Ø28.2 / 71.5 / 33.6 hot, Ø20.6 / 69.0 ground); 1 mm is λ/50 at
6.4 GHz.

In the app: **"Sky-tilted capped bicone, wire cage (6.7:1)"**. Simulation is the NEC-2 table
(`export_cage_table.py`, 64 frequencies, gain = mean over φ). Build has the cut list, a 1:1 frame
template and the printed kit: the cover, a cup with one groove per ground frame, the 130 mm sleeve
handle, the stand, the gap fork, a frame bending jig, a stepped hoop mandrel (one step per hoop
size, a slot for the solder joint) and a cradle for the hot side (washer pocket, a groove per frame up the
cones, a slot for each cone hoop under them). The hot cage lifts off the cradle upward; a mandrel inside it
would be trapped by the lid hoops. NEC-2 export is enabled.

### Smaller wire cage: one shorting wire (W65)

W16 cannot simply be scaled down. At 0.88 × (Ø63 × 64 mm) the SWR at 912 MHz goes from 1.9 to 4.0,
and at 0.80 × to 5.4. From 1.15 GHz up the scaled cage is still fine. At 912 MHz it is
Z ≈ 14 − 18j Ω: **the resistance is too low**, and the reactance is small. Every way of making the
frames longer in the same box therefore failed. It brings the reactance down but not the resistance
up. These were tried in NEC-2 (`family10.py`) from the 0.85–0.88 × seeds:

| Frame shape (same box) | 912 MHz | Rest of the band |
|---|---|---|
| Hot frames twisted into conical spirals, up to 120° | SWR 4.0 → 2.7–3.1 | 1.2–2.0 GHz rises to 2.8–3.6 (helical-sheath resonances) |
| Frames zigzagged in their own plane (2–5 mm, 4–10 half-waves), hot or ground | unchanged (Z stays 13 − 15j Ω) | slightly worse |
| A fold-down brim on the hot rim (10–25 mm, straight or helical) | unchanged | a strong resonance at 2.5–3 GHz (SWR up to 9) |
| 2 or 4 frames continued as legs from the hot rim to the ground rim (straight or helical) | R rises, but X goes to −40…−100j Ω | worse, with resonances |
| Shunt stubs from the hot cone to the ground cone near the axis (5 mm out) | the feed is shorted | SWR 10–2000 |
| **One** shunt wire from a hot frame to the ground frame, 11–15 mm out | **2.1–2.4** | 1.3–2.4 GHz at 2.0–2.7 before re-optimising, ≤ 1.85 after |

The last row is the answer. A shunt inductor across a small antenna is the classic L-network:
R − jX in parallel with jωL becomes (R² + X²)/R ≈ 35–55 Ω when ωL cancels the parallel susceptance
(about 5 nH at 912 MHz). A 9.8 mm wire between the cones 11 mm from the axis is that inductor. Its
admittance falls with frequency, and the profile was re-optimised around it, so the upper band
keeps its match. It is a DC short across the coax: fine for a receiver, but no bias-tee.

Search: differential evolution over all 25 shape parameters stalled at cost 4.1 inside 60 mm. Most
random candidates collide or crowd the hub, and the landscape is rough. CMA-ES over all 25 stalled
at 2.6 inside 66 mm. CMA-ES over the 14 profile parameters plus the wire's radius, seeded with
W16 × 0.88 and one wire, found W65 in 30 generations (`opt_cma.py`, `family11.py`).

**Mesh.** With the wire carrying the match, λ/20 segments are 0.4 off in SWR at 912 MHz, and up to
0.3 off at 4.5–5 GHz. A 60 mm run tuned on λ/20 showed 2.0, but it is 2.4 on a converged mesh. W65
came from a λ/20 run and holds on the converged mesh. The 63 and 60 mm runs used 2.5 mm segments,
which are within 0.1 of converged. Every number below is at 1.5 or 2 mm, which are within 0.03 of
each other.

| Ø1 mm wire, free space, no cable | Size (frames) | Worst SWR, 960 MHz – 6.4 GHz | at 912 MHz (−5 %) | Gain at 15–50°, mean |
|---|---|---|---|---|
| W16 | Ø71.5 × 74.7 mm | 1.95 (2.02 on its 3.6 GHz feature) | 1.94 | +1.8 dBi |
| **W65**: W16 + one shorting wire, re-optimised | **Ø65.1 × 64.9 mm** | **1.85** (1.74 in the app table) | **1.76** | **+2.1 dBi** |
| W63: same, 63 mm box | Ø63.0 × 62.4 mm | 1.99, but a narrow feature at 3.78 GHz reaches 2.40 | 1.88 | +1.9 dBi |
| W60: same, 60 mm box | Ø59.7 × 59.6 mm | 2.23 | 2.24 | +1.8 dBi |

W65 is 13 % lower and 9 % narrower than W16 (about 30 % less volume), and it matches better. The
optimiser's 16-point grid did not see W63's 100 MHz-wide feature (W16 has a milder one at 3.6 GHz).
Only a fine scan found it, so W65 was checked the same way: its feature peaks at 1.85 at 3.84 GHz.

**Cable** (`cage_cable.py`: the coax jacket as a wire down the axis, 15, 25 and 35 cm, worst SWR over
912 MHz – 2 GHz):

| | No cable | Bare cable | 1 bead | 6-bead sleeve |
|---|---|---|---|---|
| W16 | 1.96 | up to 4.46 | up to 3.13 | ≤ 1.93 |
| W65 | 1.78 | up to 5.76 | up to 3.90 | ≤ 1.90 |

The smaller cage couples more to the cable, but the same 6-bead sleeve keeps it in spec.

**Tolerance of the wire.** Its distance from the axis sets the bottom of the band. At 9.96 / 11.12 /
11.63 / 12.37 mm the worst SWR is 2.00 / 1.77 / 1.85 / 1.97, so place it within ±0.5 mm. It passes
1.1 mm (centre to centre) outside the small ground hoop. Keep the two from touching.

![W65: 16 frames per side and one shorting wire](fpv-detector/W65_cage.png)

W65 (`designs/W65.json`), z = 0 at the coax end, Ø1 mm wire:

| Part | Qty | Shape |
|---|---|---|
| Hot frame | 16 | washer edge (ρ 3.2, z 1.8) → (15.0, 13.3) → (31.6, 50.9) → (31.6, 59.2) → (14.4, 59.2); 83.0 mm of wire, 3 bends |
| Ground frame | 16 | collar (ρ 3.0, z −0.1) → (10.0, −0.2) → (32.6, −2.9) → (32.6, −5.7); 32.5 mm, 2 bends |
| **Shorting wire** | **1** | straight, at ρ 11.1 mm from one hot frame (z 9.5) down to the ground frame under it (z −0.3); 9.8 mm |
| Hot hoops | 4 | Ø31.7 at z 12.7; Ø65.1 at z 50.7; Ø64.5 at z 59.9; Ø28.9 at z 60.2 (the lid edge) |
| Ground hoops | 3 | Ø20.1 at z 0.8; Ø66.6 at z −2.2; Ø67.1 at z −5.7 |
| Hot washer | 1 | Ø6.5 on the centre pin, 1.8 mm above the coax end |
| Ground collar | 1 | Ø6.0 on the coax jacket, at its end |

In the app: **"Sky-tilted capped bicone, small wire cage (6.7:1)"**. It uses the same build as W16:
cut list, 1:1 frame template (an × marks the wire's two ends), the printed kit, and NEC-2 export.
Simulation is the NEC-2 table (`export_shaped_table.py`: 1.5 mm segments, 64 frequencies, gain is
the mean over 8 azimuths because the wire breaks the 16-fold symmetry). The Radiation view puts the
frame currents on all 16 frames and the wire's current on the wire alone.

### How small can the cage go? Ø40 × 40 mm study

The question was whether bending the frames (curves, twists, zigzags, coils, legs, brims) could bring
the cage to Ø40 × 40 mm and keep 960 MHz – 6.4 GHz. It cannot, and the reason is the volume, not the
shape. A Ø40 × 40 mm cylinder fits in a sphere of radius 28 mm; at 960 MHz that is ka = 0.57, the Chu
Q is 7.2, and the Bode–Fano bound for a flat |Γ| above f_lo, ln(1/|Γ|) ≤ π/Q, allows SWR 4.65 at best
with a perfect lossless matching network — SWR 2 at 40 mm is possible only from 1.42 GHz.

| Box (D = H) | ka at 960 MHz | Floor (ideal match) | Best cage with one shunt wire, worst SWR 960 MHz – 6.4 GHz |
|---|---|---|---|
| 40 mm | 0.57 | 4.65 | 12.3 (4.9 with a series capacitor, below) |
| 45 mm | 0.64 | 3.5 | 5.6 |
| 50 mm | 0.71 | 2.8 | 3.6 |
| 60 mm | 0.85 | 1.95 | 1.9 (W60, above) |

Every bend was tried in NEC-2 at 40 mm (`family13.py`: family 11's profile, brim, twists of the cone,
brim, ground and skirt frames up to a full turn, legs, shunt wires, zigzags and family 12's coils, all
searchable at once; 16 frames for the profile, 12 for the bends), each from the scaled 60 mm cage and
from 150 random buildable shapes of its kind (`random13.py`), then CMA-ES. Judged on dense sweeps:

| Ø40 × 40 mm, Ø1 mm wire | SWR at 960 MHz | SWR ≤ 2 from | Mean mismatch loss, 0.96–6.4 GHz |
|---|---|---|---|
| The 60 mm cage scaled to 40 mm, nothing else changed | 53 | 1.51 GHz | 1.37 dB |
| Profile + shunt re-optimised for the worst SWR | 12.3 | never | 2.73 dB |
| + frames twisted into conical spirals (−150°), skirt twisted 166° | 11.4 | 4.8 GHz | 2.39 dB |
| + zigzag frames | 16.2 | never | 2.29 dB |
| + legs from the hot rim to the ground rim | 12.7 | never | 3.11 dB |
| + coils wound into the frames and the shunt | 8.6–13.1 | never | 2.2–3.5 dB |
| + a **series capacitor** (1.6 pF) in the pin | **4.9** (5.5 worst) | never (≤ 3 from 5.4 GHz) | 1.49 dB |

Every bend lowers the SWR at 960 MHz by moving the mismatch elsewhere: the mean loss over the band
goes up, not down (the rows above were scored on the worst SWR, which a cage below its floor cannot
improve, so the optimiser flattened the band instead). Scored on the mean mismatch loss itself
(`COST=loss`), the same cages come out as the best a 40 mm box can do over 960 MHz – 6.4 GHz:

| Ø40 × 40 mm, scored on the mean loss | SWR at 960 MHz | SWR ≤ 2 from | Mean loss | SWR at 0.96 / 1.24 / 2.5 / 3.5 / 5.8 GHz |
|---|---|---|---|---|
| Profile + shunt wire (**W40x**, `designs/W40x.json`) | 24 | 1.51 GHz | **1.07 dB** | 24 / 4.9 / 1.7 / 1.5 / 1.1 |
| + coils in the frames and the shunt (12 frames) | 26 | 1.51 GHz | 1.14 dB | — |
| + a 2.0 pF series capacitor (**C40x**, `designs/C40x.json`) | 12 | 1.95 GHz | **0.92 dB** | 12 / 4.4 / 1.5 / 1.8 / 1.5 |

Against the untouched scaled seed (1.37 dB) the re-optimised profile gains 0.3 dB on average, the
coils add nothing on top of it, and the capacitor another 0.15 dB — all of it in 1–1.8 GHz, while
900 MHz stays 6–8 dB down and 1.2–1.3 GHz 2–2.5 dB down. The mechanism is the match, then the Q: with the cage's unmatched impedance
(3 Ω − 55j at 960 MHz, 50 Ω from 2 GHz up) an ideal lossless network gives worst SWR 16 with one
element (a shunt inductor — the shunt wire), 6.3 with two (shunt L + series 2.4 pF) and 5.9 with
three (`matchbound.py`). The coils and the capacitor are the second element in wire and in SMD form.
A helical sheath (frames wound round the outer wall) was also checked for a loop-mode contribution,
which in theory halves the Chu Q: with 8 frames, brim +180° and skirt ∓70°, R at 960 MHz drops
1.3 → 0.4 Ω whichever way the moments add, because the azimuthal current sits at the open end.

What a 40 mm cage does do: scored from 1.4 GHz, the plain profile with one shunt wire gives
**W40, Ø39 × 40 mm, SWR ≤ 2.1 over 1.4 – 6.4 GHz** (2.03 at 2 mm segments, 2.08 at 1.5 mm, on 96-point
sweeps; mean loss 0.37 dB, +2.0 dBi at 15–50°), right where the floor puts SWR 2. The first 18-point run
claimed 1.91 and hid a 70 MHz-wide resonance at 6.3 GHz (SWR 2.9, converged at 2 / 1.5 / 1.2 mm segments);
re-tuned with every 60 MHz of 5.8–6.6 GHz in the cost (`FEXTRA`) it is gone, at the price of 2.0–2.1
in the middle of the band. Scored from 1.2 GHz the cage reaches 2.9 at 1.2 GHz and 3.5 worst.
W40 (`tools/wideband-antenna/designs/W40.json`), z = 0 at the coax end, 16 frames per side:

| Part | Qty | Shape |
|---|---|---|
| Hot frame | 16 | washer edge (ρ 3.3, z 1.2) → (6.9, 9.9) → (11.8, 21.5) → (18.3, 32.5) → (18.3, 35.2) → (4.4, 35.2); 51.6 mm, 4 bends |
| Ground frame | 16 | collar (ρ 3.0, z −0.1) → (6.9, −0.5) → (19.6, −2.0) → (19.6, −4.6); 19.3 mm, 2 bends |
| Shorting wire | 1 | at ρ 6.9 mm, from the hot frame (z 9.9) to the ground frame (z −0.5); 10.4 mm |
| Hot hoops | 4 | Ø23.6 at z 21.5; Ø36.5 at z 32.5; Ø36.5 at z 35.2; Ø8.8 at z 35.2 (the lid edge) |
| Ground hoops | 3 | Ø8.0 at z −0.1; Ø39.3 at z −2.0; Ø39.3 at z −4.6 |
| Hot washer | 1 | Ø6.5 on the centre pin, 1.25 mm above the coax end (the washer radius sets the bottom edge: ±0.3 mm moves the SWR there by ≈ 0.1) |

In the app it is **"Sky-tilted capped bicone, mini wire cage (4.6:1)"** (`skyconecage40`), with W65's build
kit, template and NEC-2 table (`export_shaped_table.py`, 1.5 mm segments). Cable (`cage_cable.py`, 1.4–3 GHz):
bare up to 3.5, one bead 2.1, the 6-bead sleeve ≤ 1.75. The FPV bands at 0.9 and 1.2–1.3 GHz are what
the 40 mm box gives up; the capacitor-matched cage needs a lumped part the app's cage model does not have. Reproduce the study with
`results/run40.sh` (the runs) and `results/run40m.sh` (the same cages re-optimised for the mean loss);
`band13.py` prints the table above from the `results/sweep_*.json` files.

### Two antennas instead of one: 960 MHz – 1.36 GHz and 1.36 – 7 GHz

The 40 mm study ends at the Chu floor: one cage cannot be small *and* cover 960 MHz – 6.4 GHz. Two cages can,
because the floor is set by the lowest frequency and the *shape* of the band. For a high-pass band (f_lo up) the
Bode–Fano form above applies; for a narrow band-pass of fractional width B, B · ln(1/|Γ|) ≤ π / Q, so the
960 MHz – 1.36 GHz antenna (B = 0.34) needs far less volume than one that must also reach 6.4 GHz, *if* it is
matched over the band with more than one element. The split, with the same cost as the cages above (worst SWR,
15–50° sky gain, Ø1 mm wire, 16 frames, 2 mm segments, `FHI` caps the scored band; no ferrite anywhere):

| Antenna | Band | Box | Floor (ideal match) | Design | Worst SWR, dense sweep (2 mm / 1.5 mm segments) | Mean gain 15–50° |
|---|---|---|---|---|---|---|
| **B44f** | 1.36 – 7.0 GHz | Ø43.1 × 43.8 mm | 1.83 | profile + 1 shorting wire, searched with the cost floor lowered to 1.5 (`designs/B44f.json`, `runZ3.sh`) | **1.73 / 1.74** (at 2.05 GHz) | +2.1 dBi |
| B44 | 1.36 – 7.0 GHz | Ø42.5 × 43.8 mm | 1.83 | profile + 1 shorting wire (`designs/B44.json`, cost floor 1.85) | 1.81 / 1.82 (SWR ≤ 2 from 1.35 GHz; 1.69 at 1.36 GHz) | +2.1 dBi |
| B42 | 1.36 – 7.0 GHz | Ø42.0 × 40.8 mm | 1.98 | the same, 42 mm (`designs/B42.json`) | 2.04 / 2.04 (at 2.24 GHz) | +1.7 dBi |
| B43 | 1.36 – 7.0 GHz | Ø42.8 × 43.0 mm | 1.90 | the same, 43 mm (`designs/B43.json`) | 1.85 / 1.86 (at 2.09 GHz) | +2.1 dBi |
| B43s | 1.36 – 7.0 GHz | Ø42.9 × 42.9 mm | 1.90 | 43 mm searched with the 50 mm sleeve and the cables in the cost (`designs/B43s.json`) | 1.87 alone, **≤ 1.95 with any cable** (sleeve table) | +2.1 dBi |
| B46 | 1.36 – 7.0 GHz | Ø44.0 × 45.9 mm | 1.70 | the same, 46 mm | 1.81 (the search's cost floors at 1.85) | +2.6 dBi |
| **A55** | 0.96 – 1.36 GHz | Ø51.3 × 54.1 mm | 1.15 | profile + 2 coiled shorting wires, 2 capacitors (`designs/A55.json`) | **1.86 / 1.88** (1.63 – 1.84 inside, 1.86 at the ends) | +1.0 dBi |
| **A52** | 0.96 – 1.36 GHz | Ø50.9 × 51.5 mm | 1.21 | the same, 52 mm (`designs/A52.json`): the smallest at SWR < 2, less margin than A55 | **1.94 / 1.98** (at 956 MHz) | +0.8 dBi |
| A51 | 0.96 – 1.36 GHz | Ø50.6 × 50.8 mm | 1.18 | the same, 51 mm (`results/best_a51f.json`, 40 generations from A52): over 2 | 2.03 / 2.10 (at 956 MHz) | +1.0 dBi |
| A50 | 0.96 – 1.36 GHz | Ø48.6 × 49.8 mm | 1.27 | the same, 50 mm (`designs/A50.json`) | 2.13 / 2.19 (at 956 MHz; 1.8 – 2.1 above) | +1.0 dBi |

![B44: 16 frames per side, one shorting wire](fpv-detector/B44_cage.png)

**B44** is W40 one size up, re-tuned for 1.36 – 7 GHz with `FEXTRA` every 100 MHz over 5.8 – 7.2 GHz (the band
top is 7 GHz now; the 40 mm cage's 6.3 GHz feature does not come back). It sits on its floor: 44 and 46 mm both
end at 1.81, 43 mm at 1.85, 42 mm at 2.04 — with the search's cost floor at 1.85. Lowering the floor to 1.5
(`SWRFLOOR`) lets the same 44 mm box reach **1.73** (B44f), so B44f is the design to build; B44 (1.81) stays as
the reference. In the app B44f is **"Sky-tilted capped bicone, mini wire cage 7 GHz (5.1:1)"** (`skyconecage44`, the
NEC-2 table from `export_shaped_table.py`, W65's build kit and template; its cable note describes the choke sleeve).
B44f (`tools/wideband-antenna/designs/B44f.json`), z = 0 at the coax end:

| Part | Qty | Shape |
|---|---|---|
| Hot frame | 16 | washer edge (ρ 3.0, z 2.1) → (ρ 3.8, z 2.1) → (ρ 8.0, z 8.7) → (ρ 13.2, z 16.7) → (ρ 21.6, z 32.8) → (ρ 21.6, z 41.4) → (ρ 9.6, z 41.4); 56.8 mm, 5 bends |
| Ground frame | 16 | collar (ρ 3.0, z -0.0) → (ρ 5.7, z -0.1) → (ρ 8.0, z -0.1) → (ρ 21.2, z -0.4) → (ρ 21.2, z -2.5); 20.3 mm, 3 bends |
| Shorting wire | 1 | at ρ 8.0 mm, from the hot frame (z 8.7) to the ground frame (z -0.1); 8.9 mm |
| Hot hoops | 4 | Ø26.5 at z 16.7; Ø43.1 at z 32.8; Ø43.1 at z 41.4; Ø19.2 at z 41.4 |
| Ground hoops | 3 | Ø11.3 at z -0.1; Ø42.4 at z -0.4; Ø42.4 at z -2.5 |
| Hot washer | 1 | Ø7.5 on the centre pin, 2.1 mm above the coax end |

**A55 needs two capacitors.** With one shorting wire (a shunt inductor, one matching element) the low band is
single-tuned, and the band at SWR ≤ 2 is only (S − 1)/(Q √S) ≈ 0.7 / Q wide: 10 % at 40 mm, 25 % at 50 mm, 36 %
at 60 mm against the 34 % needed, which is why W60 / W65 are the smallest wire-only cages for 960 MHz. The
optimiser confirms it: the plain profile + shorting wire ends at SWR 7.4 / 4.6 / 3.35 / 2.8 at 40 / 45 / 50 /
55 mm, and bending the frames (coils 8.0 at 40 mm; 100 random zigzag, leg and coil shapes each: best 20 – 32)
does not change that. What does is a second resonance: an ideal-ladder check on the unmatched cage
(`dtune.py`) gives, on the unoptimised 50 mm seed over 0.96 – 1.36 GHz, 3.7 with the shunt wire alone, 2.8 with
a series capacitor in the pin added, and **1.94 with a second shunt branch of L and C in series** (`shunt L,
series C, shunt L-C`, the double-tuned match). In wire: two shorting wires, every second one with a small
capacitor in it (`csh`), plus the capacitor in the pin (`cser`). Searched in two stages (`results/runA3.sh`,
`runA4.sh`: the five matching knobs with the profile frozen, then everything), it gives 2.13 at 50 mm, 2.03 at 51 mm, 1.94 at 52 mm and
**1.86 at 55 mm** (1.95 after the first stage alone, Ø54.9 × 54.8 mm). The capacitors are 0402 / 0603 ceramics (2 – 5 pF, no ferrite). In the app A55 is **"Sky-tilted capped bicone,
low-band wire cage (1.4:1)"** (`skyconecage55`): the cage model draws the coiled shorting wires with the study's
geometry, lists the capacitors (E24 values, 2.2 and 3.6 pF) in a table and the notes, and the Simulation tab is the
NEC-2 table with the capacitors as series loads. A55 (`tools/wideband-antenna/designs/A55.json`), z = 0 at the coax end:

![A55: a cup over a shallow cone, two coiled shorting wires](fpv-detector/A55_cage.png)

| Part | Qty | Shape |
|---|---|---|
| Hot frame | 16 | washer edge (ρ 3.0, z 3.2) → (4.5, 3.2) → (10.2, 17.7) → (12.5, 23.5) → (25.5, 27.5) → (25.5, 37.4) → (12.3, 37.4); 60.1 mm, 5 bends |
| Ground frame | 16 | collar ring (ρ 3.0, z −5.0) → (6.2, −10.2) → (10.2, −11.5) → (25.6, −16.7); 26.6 mm, 2 bends (4 spokes from the coax end to the ring) |
| Shorting wire | 2 | at ρ 10.2 mm, from the hot frame (z 17.7) to the ground frame (z −11.5), wound into 2 turns Ø3.6 mm (37.4 mm of wire, 29.2 mm end to end); one of them with a 3.6 pF capacitor in series |
| Hot hoops | 5 | Ø9.1 at z 3.2; Ø24.9 at z 23.5; Ø51.0 at z 27.5; Ø51.0 at z 37.4; Ø24.6 at z 37.4 (the lid edge) |
| Ground hoops | 2 | Ø12.3 at z −10.2; Ø51.3 at z −16.7 |
| Hot washer | 1 | Ø9.1 on the centre pin, 3.2 mm above the coax end |
| Series capacitor | 1 | 2.2 pF in the centre pin, between the coax and the washer |

**Tolerance of A55's parts** (`results/tol_A55.log`, worst SWR over the band, nominal 1.85): the pin capacitor
is the sensitive one, 2.2 pF ± 5 % gives 1.93 / 1.94 and ± 10 % 2.06, so use a C0G 2.2 pF ± 0.1 pF; the shunt's
3.6 pF can be ± 10 % (1.86 – 1.89); the shunt coils must be wound to the count, +0.25 turn gives 2.18, −0.25 turn
1.85 (both capacitors + 10 %: 2.08, − 10 %: 1.99).

**Random shapes, springs and every bend were tried again** for the low band (`results/runAB.sh`: coils in the
frames and the shunt, zigzags, legs, twisted brims; CMA-ES and 100 random buildable shapes per group at 40 mm):
every one scores worse than the plain profile with the same match. The lever is the number of matching elements,
not the form of the wire — the same lesson as the 40 mm study.

**Cable (no ferrite).** A bare coax down the axis is part of these antennas: B44 alone is 1.81, with a bare
15 / 25 / 35 cm jacket 3.25 / 2.77 / 2.39 (one bead would give 2.0, the 6-bead sleeve 1.8). The cable-robust
variants (`results/runX.sh`: the three bare lengths in the cost, `CABLES`) are in the table below.

| Antenna | Cage only | Bare cable 15 / 25 / 35 cm | 1 bead | 6-bead sleeve |
|---|---|---|---|---|
| B44 | 1.81 | 3.25 / 2.77 / 2.39 | 1.97 / 1.86 / 2.01 | 1.78 / 1.77 / 1.80 |
| A55 | 1.83 | 10.4 / 7.1 / 3.9 | 4.4 / 2.2 / 2.3 | 1.85 / 1.67 / 1.78 |
| B44x: B44 re-optimised with the bare cables in the cost (`designs/B44x.json`, `runX.sh`) | 2.04 | 2.54 / 2.42 / 2.36 | 2.27 / 2.14 / 2.40 | 1.99 / 1.97 / 1.99 |

| Antenna + choke sleeve (no ferrite) | Cage only | With 15 / 25 / 35 cm of bare cable and the sleeve, 0.96 – 1.36 or 1.36 – 7 GHz |
|---|---|---|
| **B44s**: B44 re-optimised with the Ø10 × 50 mm sleeve and the cables in the cost (`designs/B44s.json`, `runX4.sh`; Ø43.6 × 42.4 mm) | 1.89 | **1.82 / 1.84 / 1.87** |
| B44 as found + Ø10 × 50 mm sleeve | 1.81 | 1.86 / 1.90 / 2.00 |
| **A55 + Ø20 × 75 mm sleeve** (1.5 mm segments) | 1.88 | **2.16 / 1.62 / 1.80** |
| A55s: A55 re-optimised with the Ø20 × 75 mm sleeve and the cables in the cost (`designs/A55s.json`, `runX5.sh`; Ø48.8 × 54.2 mm) | 1.96 / 1.95 | 2.06 / 1.62 / 1.81 (2.10 / 1.62 / 1.82 at 1.5 mm segments) |
| **A52 + two Ø20 mm sleeves 70 + 50 mm** (`results/sleeve2_A52.log`) | 1.94 | **1.82 / 1.64 / 1.78** |
| B43 + Ø10 × 50 mm sleeve, 1.36 – 7 GHz (`results/sleeve_B43_full.log`) | 1.85 | 1.68 / 2.02 / 2.08 (B44: 1.86 / 1.90 / 2.00) |
| **B43s**: 43 mm searched with the sleeve and the cables in the cost (`designs/B43s.json`, `runZ3.sh`) | 1.87 | **1.68 / 1.90 / 1.95** |
| **B44f** + Ø10 × 50 mm sleeve (`results/sleeve_B44f_full.log`) | 1.73 | **1.58 / 1.81 / 2.00** |

The 15 cm cable with A55 stays at 2.1 whatever the cage does: one quarter-wave tube chokes well near one
frequency only. **Two tubes in series** (the second starts just below the first's short) cover the band
(`cage_sleeve.py` `SLEEVES=70+50`, both Ø20 mm, `results/sleeve2_A55_*.log`), worst SWR with 15 / 25 / 35 cm:

| A55, two Ø20 mm sleeves | 60 + 40 mm | 65 + 45 | **70 + 50** | 75 + 45 | 75 + 55 | 80 + 50 |
|---|---|---|---|---|---|---|
| | 2.8 / 3.5 / 2.2 | 1.97 / 2.26 / 1.84 | **1.64 / 1.64 / 1.70** | 1.88 / 1.86 / 1.90 | 1.88 / 1.62 / 1.80 | 2.2 / 1.9 / 2.1 |

On 1.5 mm segments 70 + 50 mm gives 1.68 / 1.69 / 1.76, and the lengths are not critical: 68 + 50, 72 + 50,
70 + 55 and 70 + 45 all stay within 1.5 – 2.0. So the low-band antenna is **≤ 1.9 alone and ≤ 1.8 with any of the
three cables and a 70 + 50 mm two-section sleeve (Ø20 mm, 120 mm of tube under the cage), no ferrite**; the
same sleeve on the smaller A52 gives 1.82 / 1.64 / 1.78, so A52 (Ø51 × 51.5 mm) also holds SWR < 2 with any cable.
For B, 43 mm works with any cable once the sleeve and cables are in the search (B43s, ≤ 1.95), and 44 mm with the
cost floor lowered gives the best cage of all (B44f, 1.73 alone, ≤ 2.00 with cable): B43s is the smallest, B44f the
best-matched.

At 960 MHz a 55 mm cage is a quarter of a wavelength across the diagonal, and a bare 15 – 25 cm jacket is the
other half of the dipole: A55 on its own is 1.83, with the cable 7 – 10. The hoop-and-frame ground side does not
shield it; W65 showed the same (5.8 bare). Without ferrite the cable has to be part of the design.

**A quarter-wave choke sleeve instead of ferrite.** A metal tube over the coax, open towards the cage and shorted
to the jacket at its far end (a bazooka: Ø10 mm, 8 wires in the model, `cage_sleeve.py`, `family10.model(sleeve=)`),
stops the jacket current without any ferrite. With the cages as found:

| Antenna + sleeve | Bare cable 15 / 25 / 35 cm | Sleeve 50 mm | 60 mm | 70 mm | 80 mm |
|---|---|---|---|---|---|
| A55, 0.96 – 1.36 GHz | 10.4 / 7.1 / 3.9 | 8.4 / 9.3 / 5.1 | 3.3 / 3.1 / 3.5 | **2.24 / 1.80 / 2.33** | 2.7 / 2.5 / 2.7 |
| B44, 1.36 – 3 GHz (above 3 GHz the sleeve changes nothing, ≤ 1.75) | 3.25 / 2.77 / 2.39 | **1.86 / 1.90 / 2.00** | 2.1 / 2.2 / 2.1 | — | — |

B44 with a 50 mm sleeve is at SWR ≤ 2.0 with any of the three cables over the whole 1.36 – 7 GHz band. For
A55 the sleeve wants to be fatter (the band is 34 % wide, a thin sleeve is a quarter wave at one frequency):
worst SWR with 15 / 25 / 35 cm of cable, sleeve radius × length (`results/sleeve_A55_r*.log`):

| A55 sleeve | 65 mm | 70 mm | 75 mm | 80 mm | 85 mm |
|---|---|---|---|---|---|
| Ø8 mm | 2.8 / 2.8 / 3.2 | 2.4 / 2.0 / 2.6 | 2.5 / 2.4 / 2.5 | | |
| Ø10 mm | | 2.24 / 1.80 / 2.33 | | 2.7 / 2.5 / 2.7 | |
| Ø16 mm | 2.2 / 1.9 / 2.2 | 2.1 / 1.8 / 2.0 | 2.15 / 1.67 / 1.84 | | |
| **Ø20 mm** | | 2.14 / 1.75 / 1.84 | **2.15 / 1.61 / 1.74** | 2.3 / 1.8 / 2.0 | 2.6 / 2.1 / 2.3 |
| Ø24 mm | | 2.16 / 1.75 / 1.71 | 2.14 / 1.59 / 1.70 | 2.3 / 1.7 / 1.9 | 2.5 / 1.9 / 2.1 |

So **A55 + a Ø20 × 75 mm sleeve: SWR ≤ 2.15 with any cable** (the 2.15 is the 15 cm cable at 960 MHz; 25 and
35 cm stay ≤ 1.75), **B44 + a Ø10 × 50 mm sleeve: ≤ 2.0**, and the two-section sleeve above takes A55 to ≤ 1.8.
The sleeve is a tube under the cage, soldered to the jacket at its far end, nothing else. Re-optimising the cage
with its sleeve and the three cables in the cost (`results/runX3.sh` – `runX5.sh`) adds little: with the thin
sleeve A55 stays at its seed's cost (stopped after 12 generations), with the fat one it trades 0.1 of cage-only
SWR for 0.1 on the 15 cm cable (**A55s**), and B44 moves from 2.00 to 1.89 on the search grid (**B44s**,
`designs/B44s.json`); both in the sleeve table above.

Reproduce: `results/runAB.sh` (phase 1 and the random screening), `runA2.sh` (series capacitor), `runA3.sh` /
`runA4.sh` (double-tuned, 45 – 55 mm), `runB2.sh` (42 mm), `runX.sh` – `runX5.sh` (bare cable and sleeves),
`runZ.sh` / `runZ2.sh` (52 / 43 mm); `results/status.sh <tags>` prints the best cost of each run, `parts_table.py` the tables
above, `sweep13.py` the dense sweeps, `cage_sleeve.py` the cable + sleeve tables.

## How it was found

Tools: [`tools/wideband-antenna/`](../tools/wideband-antenna/README.md) (Python + numba; the README
has the step-by-step workflow). The app's thin-wire MoM cannot model solid cones up to 6.4 GHz (a wire
grid fine enough would need ~10 000 unknowns), so two solvers for **bodies of revolution** were
written for this search:

- **BoR MoM** (`bor.py`): EFIE for PEC surfaces of revolution, axisymmetric (m = 0) current, exact ring
  kernel (static part via the complete elliptic integral, log singularity integrated analytically).
  Design B at 6.4 GHz is ~90 unknowns; a 26-point sweep plus the cable cases takes ~3 s, so a global
  optimiser can afford thousands of designs. Coax feed = TEM "frill" on the aperture annulus between
  the centre conductor (Ø0.92 mm) and the PTFE (Ø2.98 mm). Lumped loads model the ferrite.
- **BoR FDTD** (`fdtd_bor.py`): a different method used only for checking — graded Yee grid, CPML,
  staircased metal, the coax modelled physically (PTFE, soft TEM source, matched termination,
  de-embedded to the coax end), dielectric shells (cover), near-to-far-field box for patterns.

Search: differential evolution (8 processes) over a shape family — hot element = washer on the pin +
two cone angles + cylinder + top cap; ground = two cone angles + skirt; everything inside a size
budget. Each design is scored on

- 26 log-spaced frequencies 760 MHz – 6.6 GHz (5 % margin at both ends), no cable;
- 760 MHz – 2 GHz with 10, 20 and 35 cm of cable plus a 150 Ω ferrite, and 15 and 35 cm without;
- **max SWR, floored at 1.85, + sky-gain deficit**: below SWR 1.85 the optimiser gets nothing for a
  better match and works on gain at 15, 20 … 50° elevation (target average ≥ +1 dBi, worst ≥ −2 dBi).
  A first run without the floor found SWR ≤ 1.67 designs whose beam pointed 10–20° *down* above
  1.3 GHz (−3 … −6 dBi at 35–50°), so the pattern has to be in the score.

History: run 1 (300 MHz, SMA-sized feed, one-angle cones) → run 2 (two-angle cones, UT-141 feed, sky
score) gave **A**; for 800 MHz, design A scaled by ⅜ was the seed of run 4 (≤ 120 mm), which gave
**B** within 6 generations. A short run at ≤ 95 mm stayed at SWR ≈ 3 (λ/4 at 800 MHz is 94 mm:
~110 mm is the practical minimum for this pattern and margin).

Run 6 then made the cable a hard requirement **without** a ferrite (5, 10, 15, 25 and 40 cm, ≤ 120 mm):
it found **design C** (`designs/C.json`, Ø114 × 118 mm, a two-angle ground cone with a 26 mm skirt):
SWR ≤ 1.61 without cable and ≤ 1.70 with any cable from 5 cm to 1 m, ferrite or not. The price is the
pattern: the gain at 50° elevation drops to about −2.5 dBi below 2 GHz and −3.4 dBi at 2.4 GHz (B:
−0.8 and +4.2), and the 2.6–4 GHz beam sits at 0–10°. B with a clip-on ferrite stays the
recommendation; C is the fallback if a ferrite really cannot be fitted (not FDTD-checked).

### Solver validation

| Check | Result |
|---|---|
| Ring kernel vs adaptive quadrature (I₀, I₀ − I₁; 6 cases incl. near-singular at 6.4 GHz) | 4–6 digits; worst 0.4 % (near-singular real part) |
| Analytic log-singular integrals vs quadrature | 15 digits |
| Tube dipole Ø2 × 500 mm vs NEC-2 (nec2++, 101 segments) | 250 MHz 45.9 − j112.8 vs 47.8 − j109.4 Ω; 280 MHz 66.7 − j19.0 vs 68.4 − j13.7 Ω; 300 MHz 85.9 + j44.2 vs 86.8 + j49.9 Ω; gain 2.04 / 2.12 / 2.18 dBi in both |
| Far-field-integrated power / input power (MoM) | 1.0000 on every case |
| Mesh convergence (12 → 40 segments/λ, feed cells 0.3 → 0.1 mm) | Z moves ≤ 2 Ω at 0.3–6.4 GHz, gain ≤ 0.1 dB |
| FDTD vs MoM, design B (as optimised) + 15 cm cable, 36 frequencies 0.76–6.4 GHz | SWR within 0.01–0.09 everywhere; FDTD ≤ 1.59 in band (MoM ≤ 1.62) |
| FDTD vs MoM patterns, design B, 0.9 / 1.25 / 2.44 / 3.3 / 5.8 GHz, 0–70° elevation | within 0.1–0.8 dB; FDTD P_rad/P_acc 0.993–1.003 |
| FDTD vs MoM, design A + 35 cm cable, 0.3–6.4 GHz | SWR within 0.2; FDTD ≤ 1.76 |
| FDTD vs MoM patterns, design A, 0.43–5.8 GHz | within 0–1.5 dB |

The two solvers share no code and differ in feed model (frill vs physical coax) and geometry
(exact vs staircased), so agreement to ~0.1 in SWR is a strong check of the numbers above.

## Limitations

- Not built or measured yet. Simulated: perfect conductors, no hand, no detector box (the cable cases
  and the ferrite bound that), no solder blobs.
- The cover/holder is modelled as a uniform PETG shell (εr 2.6); other plastics shift the result a
  little (see the cover section).
- Vertical polarisation only: a drone antenna lying horizontally is seen 10–20 dB down near the
  horizon. CP video links (cloverleaf/pagoda on the drone) arrive 3 dB down.
- Gain below the horizon is low by design; a detector pointed at a drone *below* the operator
  (hills, rooftops) loses ~5 dB.

## Reproduce or extend

See [`tools/wideband-antenna/README.md`](../tools/wideband-antenna/README.md): set-up, every script,
the workflow (baseline → validate → model the cable → satisfice-then-optimise → verify) and the
lessons. To redo this design for another band or size:

```bash
cd tools/wideband-antenna
SIZE=0.12 FAMILY=family6 X0=designs/B_simple.json .venv/bin/python opt.py myrun 30 1   # edit FS_MAIN/FS_LOW in family6.py for the band
.venv/bin/python report.py family6 "$(cat designs/B_simple.json)" 16 34 800e6
F_LO=800e6 .venv/bin/python tolerance.py family6 "$(cat designs/B_simple.json)" 48 1 0.3 1.5
F_LO=760e6 MARGIN=0.15 .venv/bin/python fdtd_verify.py family6 designs/B_simple.json 0.15 out.json
```
