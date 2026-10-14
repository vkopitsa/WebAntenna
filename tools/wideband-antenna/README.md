# Wideband rotationally symmetric antennas: solvers, optimiser, checks

Python tools used to find the FPV-detector antenna in
[docs/FPV-DETECTOR-ANTENNA.md](../../docs/FPV-DETECTOR-ANTENNA.md). They are separate from the web app
(nothing in `src/` imports them; `npm test` does not run them). They work for any antenna that is a
**body of revolution fed on its axis by a coax**: discones, bicones, conical / teardrop monopoles,
skirted and sleeve monopoles, cups, caps — any profile you can draw as polylines in the (ρ, z)
half-plane.

## Setup

```bash
cd tools/wideband-antenna
python3 -m venv --system-site-packages .venv
.venv/bin/pip install numpy scipy matplotlib numba manifold3d PyNEC cma   # PyNEC (nec2++): val_*.py and the wire-cage tools; cma: opt_cma.py
```

Run every script from this directory (they import each other by module name). Numba compiles the
kernels on first use (`cache=True`, a few seconds once). Scripts that run several designs use 8
processes with `NUMBA_NUM_THREADS=1` each; single-design scripts use numba threads.

## Files

| File | What it does |
|---|---|
| `bor.py` | **Body-of-revolution MoM** (EFIE, m = 0, PEC, free space). Unknown = total axial current (triangles, Galerkin); exact ring kernel (static part via the complete elliptic integral, log singularity integrated analytically, the rest by Gauss and a midpoint rule in φ). Coax "frill" feed on the aperture annulus or a delta gap; junctions of ≥ 3 sheets; lumped series loads (ferrite). `run(geo, freqs)` → Z, SWR, gain at chosen elevations, peak gain; `prad_check(sol)` = energy check (must be 1.000). |
| `fdtd_bor.py` | **Axisymmetric FDTD** (E_ρ, E_z, H_φ): graded mesh, CPML, staircased PEC sheets, dielectrics, physical PTFE coax with a soft TEM source and a matched lossy termination, V/I de-embedded to the coax end, NF2FF box → elevation pattern. Shares no code with `bor.py`. |
| `fdtd_run.py` | Builds an FDTD model from a family design (`build(p, cable, shells=...)`). |
| `fdtd_verify.py` | FDTD vs MoM for one design: Z sweep + patterns. `F_LO=760e6 MARGIN=0.15 [SHELLS='<json>'] python fdtd_verify.py family6 designs/B_simple.json 0.15 out.json` (≈ 2–4 min for B, 15 min for A). |
| `designs.py` | Geometry helpers. **Feed constants: UT-141 / RG-402** (centre Ø0.92 mm, PTFE Ø2.98 mm). Classic discone, cone-over-ground, `evaluate()`, log sweeps. |
| `family.py` | Family v1 (one-angle hot cone + cylinder + cap over a cone + skirt) and the cost functions `cost_of` (weighted), `cost_of2` (SWR floor 1.85 + sky-gain deficit), `cost_of3` (stricter sky). Frequencies for 300 MHz – 6.4 GHz. |
| `family2.py` | Family v2: two-angle hot cone (feed taper + flare) and two-angle ground; `profile()`, `geometry()`, `size()`. All later families reuse it. |
| `family3.py` | v2 with a flat 13 mm SMA flange at the feed — **rejected** (6 GHz SWR 3.3). |
| `family4.py` | v2 with build limits (gap ≥ 0.8 mm, washer ≥ Ø4 mm) and the sky cost: **design A** (300 MHz – 6.4 GHz, ≤ 300 mm). |
| `family5.py` | v4 with stricter sky targets (polishing; not used for the final designs). |
| `family6.py` | **800 MHz – 6.4 GHz**, size budget from `SIZE` (m): **design B**. Edit `FS_MAIN` / `FS_LOW` for another band. |
| `family7.py` | v6 + cables of 5–40 cm **without** ferrite as a hard requirement (design C). |
| `family8.py` | v6 with cables scored through a **6-bead ferrite sleeve**, lowest frequency from `FLO`: compact designs S73 / S68 (960 MHz – 6.4 GHz, `FLO=912e6 SIZE=0.075`). |
| `opt.py` | Differential evolution, 8 processes: `SIZE=0.12 FAMILY=family6 X0=seed.json python opt.py <tag> <generations> <seed>`. Progress: `opt_<tag>.jsonl` (one JSON line per generation: time, cost, parameters, size). `LO` / `HI` (JSON lists) narrow the bounds, `POP` sets the population factor (default 12 × parameters). |
| `shells.py` | FDTD plastic shells (cover, solid cup, handle) from a design by `print_parts.py`'s rules, rows kept clear of the coax: `python shells.py family8 designs/S73.json 0.3 130 > shells.json`, then `SHELLS="$(cat shells.json)" F_LO=912e6 MARGIN=0.15 python fdtd_verify.py family8 designs/S73.json 0.03 out.json` |
| `compact_check.py` | Compact-variant table: SWR, cable SWR with no ferrite / 1 bead / sleeve, sky gain; `file:scale` rescales a design: `F_LO=960e6 python compact_check.py designs/S73.json designs/B_simple.json:0.708` |
| `wirecage.py` | NEC-2 (PyNEC) wire-cage version of a solid design: N frames along the profile, hoops at the kinks, hub rings near the axis (NEC rejects > ~16 Ø1 mm wires meeting there): `python wirecage.py family8 designs/S73.json 16 0.5` |
| `export_cage_table.py` | App table for the wire cage (NEC-2, same JSON as `export_app_table.py` plus `cage`; currents of frame 0 × n): `python export_cage_table.py family6 designs/W16.json 16 0.5 960e6 6.4e9 64 app_W16.json`, then `to_ts.py app_B.json app_A.json app_S73.json app_W16.json` |
| `family9.py` | Wire-cage family for `opt.py` (NEC per candidate in a subprocess with a 90 s timeout, no cable model): `NCAGE=16 FLO=912e6 SIZE=0.075 FAMILY=family9 X0=designs/S73.json POP=10 python opt.py w16 20 1` → designs/W16.json (Ø71.5 × 74.7 mm, SWR ≤ 1.95 over 0.96–6.4 GHz, 15–50° gain +1.9 dBi mean; W12: SWR 2.5 at 6.4 GHz) |
| `family10.py` | **Shaped wire cage** (NEC-2): the v6 profile plus twisted frames (conical spirals), in-plane zigzags, a fold-down brim, a signed ground skirt (down or folded up), hot-to-ground legs and **shunt wires** (`sh`: 0/1/2/4 straight wires from a hot frame to the ground frame at radius `shr`). `wire_list()` (the NEC model, kinds frame0/frame/ring/spoke/shunt/…), `collisions()` (wires closer than their radii: NEC-2++ rejects them), `model(p, f, seg=, nphi=, cable=, beads=)` (fixed segment length, full-azimuth pattern, coax jacket with ferrite beads). All extras zero = `wirecage.py`. Env: `SEG` (fixed segments in the cost; use 2–2.5e-3), `NFREQ`, `ABORT`, `TIMEOUT`, `COST=loss` (mean mismatch loss in dB over the grid instead of the worst SWR, for a cage that cannot reach SWR 2 at the bottom), `FEXTRA=f1,f2,…` (extra frequencies in the cost: W40's 70 MHz-wide feature at 6.3 GHz sat between the 18 log points; every 60 MHz over 5.8–6.6 GHz caught it); `cser` in a design = series capacitor (pF) in the pin |
| `family11.py` | Family 10 in box-normalised parameters (ground depth, radii and kinks as fractions of the box), so every candidate fits `SIZE`; `to_abs()` / `from_abs()` convert to and from family 10 |
| `opt_cma.py` | **CMA-ES** from a seed, 8 processes; `FREE=a,b,…` searches only those parameters (the rest stay at the seed): `OMP_NUM_THREADS=1 FAMILY=family11 SIZE=0.066 FLO=912e6 X0=seed.json SIGMA=0.08 POP=16 FREE=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr python opt_cma.py s66sh 120 2` → W65. Progress in `opt_<tag>.jsonl`, best in `best_<tag>.json` (family-11 parameters: convert with `to_abs()` at the same `SIZE`) |
| `opt2.py` | Differential evolution from a buildable start (the seed, perturbations of it and random samples that pass `feasible()`); stalled on the 25-parameter family 11 |
| `family12.py` | Family 11's profile + shunt wires with **springs**: the hot frames, ground frames and shunt wire can each be wound into a coil round their own centre line (turns, coil radius, radius window; straight leads keep the turns clear of joints and hoops). Same cost as family 10 (it patches `family10.build` / `wire_list`). `OMP_NUM_THREADS=1 FAMILY=family12 SIZE=0.060 FLO=960e6 SEG=2e-3 X0=results/best_sp60b.json SIGMA=0.05 POP=16 FREE=ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr,th,ch,tg,cg,ts python opt_cma.py sp60f 40 4` |
| `sweep12.py` | Dense parallel sweep of a family-12 design (8 processes): `SIZE=0.060 SEG=2e-3 python sweep12.py results/best_sp60f.json 48 960e6 6.6e9 [th=0 tg=0 ...]` (key=value overrides, e.g. springs off) |
| `family13.py` | **Every bend at once**, for a small box: family 11's cage (profile, fold-down brim, twists of cone / brim / ground / skirt frames, legs, shunt wires, zigzags) + family 12's springs + `cser`, a series capacitor (pF) in the pin (one SMD part at the SMA: with the shunt wire an L-network), all searchable together; brim and skirt twists widened to ±360° (a helical sheath). `NCAGE` 8 / 12 / 16 frames. Geometry rejects cost ≥ 1000 (a 40 mm cage's real cost, its SWR at 960 MHz, is 5–50: on the 60 mm scale, 30–50, CMA-ES preferred rejected shapes). Seeds from a smaller family get the missing parameters off (`DEFAULTS`). `OMP_NUM_THREADS=1 FAMILY=family13 NCAGE=16 SIZE=0.040 FLO=960e6 SEG=2e-3 ABORT=50 X0=results/seed_p40.json SIGMA=0.15 POP=16 FREE=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr,cser python opt_cma.py c40 50 1`. Split-study additions: `FHI` (top of the scored band, default 6.6 GHz), `csh` (series capacitor, pF, in every second shunt wire: with `sh=2` one plain shunt and one L-C branch, the double-tuned match of antenna A55), `CABLES=0.15,0.25,0.35` (bare coax lengths in the cost: the worst SWR with the jacket down the axis over `NCABLE`=8 points between `FLO` and 2.4 `FLO` joins the worst SWR, ~60 s per evaluation) |
| `random13.py` | **Random shapes** ("try any form"): uniform samples of the `FREE` parameters over the whole box (`SPREAD` < 1: ± that fraction round `X0`), kept when buildable (box, clearances, frame spacing, NEC collisions: 26 ms each), scored with NEC in 8 processes; `rand_<tag>.jsonl`, `best_<tag>.json` (a seed for `opt_cma.py`): `FAMILY=family13 NCAGE=12 SIZE=0.040 FLO=960e6 SEG=2e-3 ABORT=50 X0=results/seed_p40.json FREE=… python random13.py rt40 150 1`. Buildable fraction at 40 mm: profile 75 %, zigzags 38 %, legs 15 %, springs 5 %, brim / twists 1 %, everything at once 0 % — sample one group at a time |
| `sweep13.py` | Dense parallel sweep of a family-13 design with the band it covers (lowest frequency from which SWR stays ≤ 2 / 2.5 / 3), `JSON=out.json` saves the rows: `SIZE=0.040 NCAGE=16 SEG=2e-3 python sweep13.py results/best_p40.json 96 900e6 6.6e9 [sh=0 cser=2.4 ...]` |
| `top13.py` | Best candidates of a search log with the parameters that differ from the defaults, and how many samples the geometry rules rejected: `python top13.py results/eval_t40.jsonl 5` |
| `matchbound.py` | What an **ideal lossless matching network** could do with a cage's unmatched impedance (a `sweep13.py` JSON with `sh=0`): ladders of 1, 2 and 3 L / C elements, series or shunt, values by differential evolution for the lowest worst SWR over the band. One element is the lumped version of the shunt wire: `python matchbound.py results/sweep_seed40_nosh.json 960e6 6.6e9` |
| `results/run40.sh` | The 40 mm study in one script: the plain profile (16 frames), the random screening of each shape group and CMA-ES over each group (12 frames), then 45 / 50 mm and the 40 mm cage scored from 1.2 / 1.4 GHz. `results/lowband_only/` keeps the first round, which `ABORT=4` reduced to the two lowest frequencies |
| `shapecage.py` | Sweep of a family-10 design: `python shapecage.py designs/W65.json 96 912e6 6.6e9 1.5e-3` (last argument: λ/per, or a segment length in metres; `key=value` overrides a parameter) |
| `export_shaped_table.py` | App table for a cage with shunt wires (1.5 mm segments, gain = mean over 8 azimuths, `cage.short` with the wire's node radius, heights, frame and its current segments): `python export_shaped_table.py designs/W65.json 960e6 6.4e9 64 app_W65.json`, then `python to_ts.py --entry app_W65.json` (one entry, to replace the `SKYCONE_W65` line in `skycone.data.ts`) |
| `cage_cable.py` | Cable check of a cage: the coax jacket as a wire down the axis (15/25/35 cm), bare, 1 bead or the 6-bead sleeve: `python cage_cable.py designs/W65.json`; `FLO` / `FHI` move the 912 MHz – 2 GHz window (`FLO=1.4e9 FHI=3e9` for W40: bare ≤ 3.5, 1 bead ≤ 2.1, sleeve ≤ 1.75) |
| `render_cage.py` | 3D view and profile of a family-10 cage (shunt wire in red): `python render_cage.py designs/W65.json out.png "title"` |
| `cage_sleeve.py` | **Choke sleeve instead of ferrite:** a cage with 15 / 25 / 35 cm of bare coax and a quarter-wave sleeve (bazooka, Ø10 mm, 8 wires shorted to the jacket at the far end, `family10.model(sleeve=(length, radius))`) of each length in `SLEEVES` (mm): `SIZE=0.055 NCAGE=16 FLO=960e6 FHI=1.36e9 SLEEVES=50,60,70,80 python cage_sleeve.py designs/A55.json`. `SLEEVES=70+50` stacks two tubes (`70+50@8`: own radius for the second); `SLEEVE=0.07,0.005` puts one sleeve into the `CABLES` cost of a search |
| `parts_table.py` | Parts table of a cage design (frame bend points, shorting wires and their capacitors, hoops, washer) as in the doc: `SIZE=0.044 NCAGE=16 python parts_table.py designs/B44.json` |
| `dtune.py` | `matchbound.py` plus a **double-tuning branch** (shunt L and C in series) on a cage's unmatched impedance over 960 MHz – 1.36 GHz: `python dtune.py results/sweepA_seed50_nosh.json` (1.94 at 50 mm with shunt L + series C + shunt L-C; the ladder family 13 builds with `sh=2`, `csh`, `cser`) |
| `results/runAB.sh` … `runX.sh` | **The split study** (two antennas, `docs/FPV-DETECTOR-ANTENNA.md` "Two antennas instead of one"): `runAB.sh` phase 1 (A = 960 MHz – 1.36 GHz at 40 / 45 mm, coils, B = 1.36 – 7 GHz at 44 mm) and the random screening of the bend groups; `runA2.sh` the series capacitor; `runA3.sh` / `runA4.sh` the double-tuned A in two stages (matching knobs first, profile frozen; then everything) at 45 / 50 / 55 mm; `runB2.sh` B at 42 mm; `runX.sh` – `runX5.sh` the cable-robust variants (`CABLES`, bare; `SLEEVE`, with the choke sleeve: B44s, A55s). `results/status.sh <tags>` prints one line with the best cost per run |
| `report.py` | Text report of one design: no-cable sweep with gains at 0–70° elevation, then cable ± ferrite cases. `python report.py family6 "$(cat designs/B_simple.json)" 16 34 800e6` |
| `final_report.py` | Dense sweep (λ/24, 140 points), drone-band table, cable table, `sweep.csv`, `summary.json` and the PNG charts used in the doc: `python final_report.py family6 "$(cat designs/B_simple.json)" outdir 800e6 6.4e9` |
| `tolerance.py` | Monte Carlo build tolerance: `F_LO=800e6 python tolerance.py family6 "$(cat designs/B_simple.json)" 48 1.0 0.3 1.5` (lengths ±1 mm, gap ±0.3 mm, angles ±1.5°). |
| `sens.py` | One-at-a-time sensitivity (which dimension moves which end of the band): `python sens.py family6 designs/B_simple.json 800e6` |
| `simplify.py` | Tests build simplifications (closed lid, one ground angle, rounding) of a design. |
| `cutlist.py` | Sheet-metal flat patterns (annular sectors, strips, discs): `python cutlist.py family6 "$(cat designs/B_simple.json)"` |
| `export_app_table.py`, `to_ts.py` | Tables for the web app's "Sky-tilted capped bicone" types: `python export_app_table.py family6 designs/B_simple.json 800e6 6.4e9 64 app_B.json` (and `family4 designs/A.json 300e6 6.4e9 90 app_A.json`), then `python to_ts.py app_B.json app_A.json > ../../src/lib/antennas/skycone.data.ts`. Profile, R/X, gain every 5° of elevation and the surface current on a λ/12 mesh at 16 frequencies (Radiation view); the app scales them with the band. |
| `print_parts.py`, `render_parts.py` | 3D-printable cover, cup, handle, bench stand, hot-element former, support wedges, pin-gap fork and flat-pattern cutting templates (STL, mm) + an assembly section: `python print_parts.py family6 designs/B_simple.json out/`. Needs `pip install manifold3d`. Used by [docs/FPV-DETECTOR-BUILD.md](../../docs/FPV-DETECTOR-BUILD.md). |
| `render3d.py`, `section.py` | Same-scale 3D render and axial cross-section of designs: `python render3d.py out.png "family6:designs/B_simple.json:B" "family4:designs/A.json:A"`. |
| `make_s1p.py` | Touchstone `.s1p` from a `sweep.csv` (import it in the app's Simulation tab to compare with a measurement). |
| `val_kernel.py`, `val_dipole.py`, `val_discone.py`, `check_convergence.py`, `check_cable.py` | Solver checks: ring kernel vs quadrature, tube dipole vs NEC-2, discone vs NEC-2 rod cage (the rod model is the unreliable one: 64 rods meet at the apex), mesh convergence, cable effect on discones. `check_cable.py` / `check_convergence.py` use the current (UT-141) feed constants, the doc's early numbers used SMA-sized ones (0.635 / 2.05 mm). |
| `app_mom_baseline.test.ts.txt` | The scratch vitest used for the cloverleaf / stock-discone baseline with the app's own MoM. Copy to `src/lib/<name>.test.ts`, run `npx vitest run src/lib/<name>.test.ts`, delete afterwards. |
| `designs/*.json` | Final designs (metres, degrees): `A.json`, `B.json` (as optimised), `B_simple.json` (**build this**), `B_cover_shells.json` (the PETG cover used in the FDTD check), `C.json` if present. |
| `results/` | Optimiser histories (`opt_run*.jsonl`), FDTD-vs-MoM outputs, the B sweep (`.csv`, `.s1p`, `summary.json`). |

Design parameters (family2 and later): `g` pin gap from the coax end to the washer; `r0u` washer
radius; `au1`, `L1` feed-cone half-angle (from +z) and slant; `au2` main-cone half-angle; `Ru` hot
radius; `Hcu` rim height; `capu` lid closure (1 = closed); `al1`, `Ll1`, `al2` ground-cone half-angles
(from −z, 90 = flat) and the first section's slant; `Rl` ground radius; `Sl` ground skirt length.

## Workflow that worked (repeat it for a new requirement)

1. **Baseline the obvious candidates** with the app's own MoM (`app_mom_baseline.test.ts.txt`):
   it showed in minutes that the cloverleaf is a ~30 % antenna and that a rod discone fails above 1 GHz.
2. **Validate the solver on things with known answers** before trusting it: `val_kernel.py`,
   `val_dipole.py` (vs NEC-2), `bor.prad_check()` = 1.000, `check_convergence.py` (Z must not move by
   more than a few ohms from 12 to 40 segments/λ and from 0.3 to 0.1 mm feed cells).
3. **Model the cable.** At the bottom of the band a small antenna drives current onto its feed cable.
   Score the low band with a cable tube hanging below (`cable=`) of several lengths, with and without
   a ferrite (`choke=(distance_m, ohms)`), and put the worst case into the cost.
4. **Write the cost as "satisfice SWR, then optimise the pattern"** (`cost_of2` / `family6.cost_of`):
   SWR below the floor (1.85 = margin for model error) earns nothing, so the optimiser spends its
   effort on gain where it is needed (15–50° elevation). A plain weighted sum let it trade the pattern
   for SWR (beam tilted down, −6 dBi at 50°).
5. **Run DE on a broad family, then on a richer or buildable one seeded with the best** (`X0`).
   Scaling a good design to a new band (all lengths × f_old/f_new, feed details kept) is an excellent
   seed: design A × ⅜ was already within spec at 800 MHz.
6. **Verify the winner**: `final_report.py` (fine mesh, 140 points), `simplify.py` (make it easy to
   build, re-check), `tolerance.py`, `sens.py` (tuning hints), `fdtd_verify.py` (independent solver,
   with and without the plastic cover). Design for MoM SWR ≤ 1.85: MoM and FDTD differ by up to ≈ 0.1–0.3
   in SWR at the top of the band.

Timing (8-core desktop): one design with all cable cases ≈ 3–5 s, a DE generation ≈ 1.5–3 min,
an FDTD verification 2–15 min. Don't run FDTD while the optimiser uses all cores (both slow down 2×).
Stop an optimiser by PID (`ps -eo pid,comm,args | awk '$2 ~ /python/ && /opt.py <tag>/ {print $1}' | xargs kill`),
not `pkill -f`, which also matches your own shell command line.

## Lessons (numbers in the doc)

- Resonant shapes (cloverleaf, dipoles, loops) cover tens of percent; 8:1 or 21:1 needs a shape
  defined by angles (cones) and solid sheet.
- Rod-built discones stop working above ~1 GHz (16 rods).
- A discone's beam tilts toward its narrower element at high frequencies; the classic one looks at
  the ground. Hot cone on top, ground below = beam tilted to the sky.
- The feed decides 3–6.4 GHz: pin gap, washer radius and the ground within ~10 mm of the axis.
  A flat SMA flange at the apex costs SWR 2 → 3.3 at 6 GHz; feed through .141 semi-rigid.
- The optimiser exploits whatever the cost does not see: first the pattern (beam tilted down), then the
  cable (designs fine with a ferrite but resonant with 10 cm of bare cable). Put every real use case
  in the score.
- At 800 MHz, ~110 mm is the practical minimum for SWR ≤ 2 with sky gain (λ/4 = 94 mm); ≤ 95 mm did
  not get below SWR ≈ 3 in a short run.
- **A small cage is short of resistance, not of length.** Scaled to 0.88 × the W16 cage is 14 − 18j Ω at
  912 MHz. Twisting, zigzagging, brims and rim-to-ground legs lengthen the current path but leave R near
  14 Ω (and add resonances). One shunt wire between the cones (≈ 5 nH, an L-network) brings it to 50 Ω:
  W65, Ø65 × 65 mm, SWR 1.85 (W16: Ø71.5 × 74.7, 1.95). 60 mm reaches 2.2.
- **Converge the mesh before tuning a shunt.** With the wire carrying the low-band match, λ/20 is 0.4 off in
  SWR at 912 MHz (and 0.3 at 4.5–5 GHz); the optimiser exploits it. Use 2–2.5 mm segments in the cost.
- **A coarse frequency grid hides narrow features.** 16 points missed a 100 MHz-wide resonance of W63 at
  3.78 GHz (SWR 2.4); sweep the winner at ≥ 96 points and scan any bump.
- **CMA-ES on a small subspace beats DE on everything.** DE over 25 shape parameters (most random cages
  collide) and CMA-ES over all 25 stalled; CMA-ES over the 14 profile parameters + the wire's radius from a
  scaled seed converged in 30 generations.
- **Springs do not shrink the cage.** Coiling the frames or the shunt (family 12) adds wire, not radiation
  resistance. At 60 mm, scored from 912 MHz, the best design (2 turns on the hot frames, 1 on the ground frames)
  reached SWR 2.16, against 2.24 for the same profile without coils. The limit there is a +40j hump at 1.3–1.7 GHz
  between the shunt's two tunings. Scored from 960 MHz (no low-band margin), Ø59.7 × 59.6 mm reaches SWR 1.90
  (1.94 at 1.5 mm segments), and **1.90 with the coils removed too**: the profile does the work
  (`results/best_sp60f.json`, SIZE = 0.060).
- **The size floor is physics, not shape.** Chu Q with the Bode–Fano bound for a constant |Γ| above f_lo,
  ln(1/|Γ|) ≤ π / Q(ka), predicts SWR 1.86 for W65 at 912 MHz (achieved: 1.77). For Ø40 × 40 mm at 960 MHz
  (ka ≈ 0.57) it allows only SWR ≈ 4–5, whatever the wire shape. A cage that small needs a higher f_lo
  (W65 × 0.62 ≈ 1.5–6.4 GHz) or resistive loading.
- **The 40 mm study confirmed it, shape by shape** (family 13, `results/run40.sh`, dense sweeps in
  `results/sweep_*.json`, `band13.py`). Floor (sphere = the box's half diagonal) and the best wire-only cage with one
  shunt wire, worst SWR over 960 MHz – 6.4 GHz: 40 mm 4.65 → 12.3, 45 mm 3.5 → 5.6, 50 mm 2.8 → 3.6, 60 mm 1.95 →
  1.9. At 40 mm every bend was tried from the scaled 60 mm seed and from random shapes (150 buildable each):
  twisted frames and helical skirts 11.4, zigzags 16.2, legs 12.7, coils 8.6–13.1 at 960 MHz — and each of them
  bought that by wrecking the rest of the band (SWR ≤ 2 never, or only above 4.8 GHz; mean mismatch loss over the
  band 2.2–3.5 dB against 1.37 dB for the untouched scaled seed). A helical sheath does not add a loop (TE) mode
  either: with 8 frames, brim +180° and skirt ∓70°, R at 960 MHz goes 1.3 → 0.4 Ω whether the magnetic moments
  add or cancel (the azimuthal current sits at the open end, where the current is small).
- **At 40 mm the match is the first limit, then the Q** (`matchbound.py` on the unmatched cage, `sh=0`): an ideal
  lossless network at the feed gives worst SWR 16.2 with one element (a shunt L: the shunt wire), 6.3 with two
  (shunt L + series 2.4 pF) and 5.9 with three, against the Bode–Fano 4.65. So the one "bend" that pays is a
  **series capacitor in the pin** (`cser`): the optimised cage with 1.6 pF reaches SWR 4.9 at 960 MHz and 5.5
  worst — but then sits at SWR 3–4 from 2.5 to 6 GHz (mean loss 1.49 dB, the same as the scaled seed). At 40 mm you
  choose where the mismatch goes; you cannot remove it.
- **What a 40 mm cage is good for:** scored from 1.4 GHz the plain profile + shunt gives **Ø39 × 40 mm, SWR ≤ 2.1
  over 1.4–6.4 GHz** (2.03 at 2 mm segments, 2.08 at 1.5 mm, 96 points; mean loss 0.37 dB, +2.0 dBi at 15–50°;
  `designs/W40.json`, app type `skyconecage40`), where the floor puts SWR 2 (1.42 GHz). The first run's 1.91 on 18
  points hid a 70 MHz feature at 6.3 GHz (SWR 2.9, converged); `FEXTRA` every 60 MHz over 5.8–6.6 GHz removed it.
  Scored from 1.2 GHz: 2.9 at 1.2 GHz, worst 3.5 (`designs/W40b.json`).
- **Three traps of a cage below its floor.** (1) `ABORT=4` (the 60 mm setting) cut every 40 mm candidate off after
  the two lowest frequencies, and the optimiser built a narrow-band top-loaded dipole (SWR 4–9 across 1.5–4.5 GHz)
  that scored well; use `ABORT=50` there. (2) The geometry penalties (30–50) were on the scale of a 40 mm cage's real
  cost (5–50), so CMA-ES converged on rejected shapes; family 13 puts them at ≥ 1000. (3) The minimax cost (worst
  SWR + 0.5 × mean excess) flattens the band once the worst point cannot come down: the coiled cage scored 11.6 with
  SWR 5–9 everywhere. Judge small cages on dense sweeps — SWR at the bottom, the band at SWR ≤ 2 / 2.5 / 3 and the
  mean mismatch loss (`band13.py`) — and optimise the mean loss (`COST=loss`) when SWR 2 is out of reach:
  `results/run40m.sh` took the 40 mm profile + shunt from 1.37 dB (the scaled seed) to 1.07 dB (`designs/W40x.json`,
  SWR ≤ 2 from 1.51 GHz, 24 at 960 MHz), the coils to 1.14 dB and the series capacitor (2.0 pF) to 0.92 dB
  (`designs/C40x.json`, SWR ≤ 2 from 1.95 GHz, 12 at 960 MHz, 4.4 at 1.24 GHz).
- **Two antennas beat one small one** (the split study, `results/runAB.sh` … `runX.sh`): the floor depends on the
  band's shape, not only on f_lo. High-pass 1.36 – 7 GHz: the profile + one shunt wire sits on the floor at 42 / 44 /
  46 mm (2.04 / 1.81 / 1.81 on dense sweeps; `designs/B44.json`). Band-pass 960 MHz – 1.36 GHz (34 % wide): one
  matching element (the shunt wire) gives a single-tuned band of ≈ 0.7 / Q, so the plain cage ends at 7.4 / 4.6 /
  3.35 / 2.8 at 40 / 45 / 50 / 55 mm and no bend helps (coils 8.0 at 40 mm; 100 random zigzag / leg / coil shapes:
  20 – 32). `dtune.py` on the unmatched 50 mm seed: shunt L 3.7, + series C 2.8, **+ a shunt L-C branch 1.94**. In
  wire that is `sh=2` with `csh` in every second shunt and `cser` in the pin: 2.13 at 50 mm, **1.95 at 55 mm**
  (`designs/A55.json`, two 0402 capacitors, no ferrite). Search it in two stages: the five matching knobs
  (`shr,cser,csh,ts,cs`) with the profile frozen, then everything from that point — with everything free from the
  start CMA-ES stalled for 14 generations.
- **Size pinning** (`results/runZ.sh`, resumed by `runZ2.sh` after a full disk): A double-tuned at 52 mm gives 1.94 / 1.98
  on dense sweeps (Ø50.9 × 51.5 mm, `designs/A52.json`; 50 mm: 2.13, 51 mm: 2.03 / 2.10 (`runZ3.sh`), 55 mm: 1.86), so 52 mm is where SWR 2 crosses, B at 43 mm 1.85 / 1.86
  (`designs/B43.json`; 42 mm: 2.04, 44 mm: 1.81) — the size / SWR curve is smooth, no cliff between the sizes. B44f is in the app as `skyconecage44`: `python export_shaped_table.py designs/B44f.json 1.36e9 7.0e9 64 app_B44f.json`, then `python to_ts.py --entry app_B44f.json >> ../../src/lib/antennas/skycone.data.ts`; A55 likewise as `skyconecage55` (`SIZE=0.055 … designs/A55.json 0.96e9 1.36e9 64 app_A55.json`: `export_shaped_table.py` writes the coil (`turns`, `coilDia`), the capacitors as E24 values (`cap`, `pinCap`) and no shunt currents for a coiled shunt).
- **The cost floors at 1.85** (`max(swr, SWRFLOOR)`, default 1.85): B at 44 and 46 mm both report 1.86 on the grid and
  1.81 on the dense sweep. `SWRFLOOR=1.5` on the same 44 mm box gives **1.73 / 1.74** (`designs/B44f.json`, `runZ3.sh`),
  and 43 mm searched with the sleeve + cables in the cost holds ≤ 1.95 with any cable (`designs/B43s.json`).
- **Run scripts must not wait with `pgrep -f "<text>"`:** the launcher shell of an earlier script keeps that text in its
  command line and the guard never clears (`runA2.sh` hung 3 h); wait on output files instead, and kill by PID with
  `ps -eo pid,args | awk '$3=="../opt_cma.py" && $4=="<tag>"'`.
- **No ferrite: a bare coax is half of a small cage, a quarter-wave sleeve is the cure** (`cage_sleeve.py`). A55
  alone 1.83, with a bare 15 / 25 / 35 cm jacket 10.4 / 7.1 / 3.9, with a 70 mm × Ø10 mm sleeve 2.24 / 1.80 / 2.33;
  B44: 3.25 / 2.77 / 2.39 bare, 1.86 / 1.90 / 2.00 with a 50 mm sleeve, and nothing changes above 3 GHz. For a
  34 %-wide band the sleeve must be fat: A55 with Ø20 × 75 mm 2.15 / 1.61 / 1.74 (`RSLEEVE`, `results/sleeve_A55_r*.log`),
  and **two tubes in series** cover the band: `SLEEVES=70+50` (Ø20 mm) **1.64 / 1.64 / 1.70** (`results/sleeve2_A55_*.log`;
  `family10.model(sleeve=[(L1, r1), (L2, r2)])` stacks them down the cable, the jacket split at every short). Optimising
  the cage against the bare cable alone cannot do it (b44x stuck at 2.6, a55x at 6.0). In NEC the sleeve's short must
  land on a wire *end*: split the jacket wire at the short, a short onto a segment end inside one wire fails
  `geometry_complete` ("Unknown exception").
