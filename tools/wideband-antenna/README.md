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
| `family10.py` | **Shaped wire cage** (NEC-2): the v6 profile plus twisted frames (conical spirals), in-plane zigzags, a fold-down brim, a signed ground skirt (down or folded up), hot-to-ground legs and **shunt wires** (`sh`: 0/1/2/4 straight wires from a hot frame to the ground frame at radius `shr`). `wire_list()` (the NEC model, kinds frame0/frame/ring/spoke/shunt/…), `collisions()` (wires closer than their radii: NEC-2++ rejects them), `model(p, f, seg=, nphi=, cable=, beads=)` (fixed segment length, full-azimuth pattern, coax jacket with ferrite beads). All extras zero = `wirecage.py`. Env: `SEG` (fixed segments in the cost; use 2–2.5e-3), `NFREQ`, `ABORT`, `TIMEOUT` |
| `family11.py` | Family 10 in box-normalised parameters (ground depth, radii and kinks as fractions of the box), so every candidate fits `SIZE`; `to_abs()` / `from_abs()` convert to and from family 10 |
| `opt_cma.py` | **CMA-ES** from a seed, 8 processes; `FREE=a,b,…` searches only those parameters (the rest stay at the seed): `OMP_NUM_THREADS=1 FAMILY=family11 SIZE=0.066 FLO=912e6 X0=seed.json SIGMA=0.08 POP=16 FREE=g,r0u,ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr python opt_cma.py s66sh 120 2` → W65. Progress in `opt_<tag>.jsonl`, best in `best_<tag>.json` (family-11 parameters: convert with `to_abs()` at the same `SIZE`) |
| `opt2.py` | Differential evolution from a buildable start (the seed, perturbations of it and random samples that pass `feasible()`); stalled on the 25-parameter family 11 |
| `shapecage.py` | Sweep of a family-10 design: `python shapecage.py designs/W65.json 96 912e6 6.6e9 1.5e-3` (last argument: λ/per, or a segment length in metres; `key=value` overrides a parameter) |
| `export_shaped_table.py` | App table for a cage with shunt wires (1.5 mm segments, gain = mean over 8 azimuths, `cage.short` with the wire's node radius, heights, frame and its current segments): `python export_shaped_table.py designs/W65.json 960e6 6.4e9 64 app_W65.json`, then `python to_ts.py --entry app_W65.json` (one entry, to replace the `SKYCONE_W65` line in `skycone.data.ts`) |
| `cage_cable.py` | Cable check of a cage: the coax jacket as a wire down the axis (15/25/35 cm), bare, 1 bead or the 6-bead sleeve: `python cage_cable.py designs/W65.json` |
| `render_cage.py` | 3D view and profile of a family-10 cage (shunt wire in red): `python render_cage.py designs/W65.json out.png "title"` |
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
