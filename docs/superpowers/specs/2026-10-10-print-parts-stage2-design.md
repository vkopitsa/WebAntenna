# 3D-printable build parts, stage 2: helix formers and parts for the other wire antennas

Date: 2026-10-10. Status: approved in brainstorming, awaiting spec review.
Builds on `2026-10-10-print-parts-design.md` (stage 1: dipole, ground plane, Yagi). Same rules, engine,
worker and panel; this stage only adds families, a few shapes and three antenna parameters.

## Goal

Every wire antenna in the app gets at least one printed part that makes it easy to build accurately.
Priority is **the simplest part that fixes the geometry that matters** (diameter and pitch of a helix, the
spreader angle of a Moxon, the tip gap, the stub spacing), with as little plastic near the radiator as
possible. References: the stylesuxx "Customizable Helix Antenna Frame and Winding Template" and the Cults3D
"helix cylinder" (both styles are offered), printed Moxon hubs (jpole-antenna.com, Printables 1163677),
the rtl-sdr.com discone rod hub, martybugs.net biquad, cage-antenna spacers (Printables 192029).

## Scope

| Antenna | Parts (use) |
|---|---|
| Helix | **Grooved tube** (former) *or* **rib frame** (former), print one; both with the reflector base built in |
| Discone | **Rod hub** (holder): disc rods radial, cone rods at the cone angle, coax through the centre, mast zip slots |
| Moxon | **Spreader hub** (holder), **corner caps** (holder, driver ×2 and reflector ×2), **gap insulators** (holder ×2, set C) |
| Quad | **Spreader hub** per loop (holder ×2, on the boom), **corner caps** (holder ×8) |
| Biquad | **Feed standoff** (holder): sets the element height over the reflector, drill template for the connector |
| J-pole | **Stub spacers** (holder), **feed-tap gauge** (jig) |
| Fan dipole | **Centre block** (holder, one channel pair per band), **leg spreaders** (holder) |
| Collinear | **Radome spacers** (holder) |

Out of scope (later): Yagi boom saddle (the paper boom strip covers it), heat-set inserts on the GP hub, a
balun cavity in the dipole centre, coax strain relief on every feedpoint part, a slim-jim variant.

Afterwards a test enforces that **every wire antenna returns at least one part**.

## Shared additions

- **New antenna parameters** (print-only; they don't change wires, NEC or MoM; read by the family from `p`):
  - Moxon, quad: `rod` "Spreader rod diameter", length 3–25 mm, default 8.5 mm (3/8" fibreglass).
  - Quad: `bd` "Boom diameter", length 10–60 mm, default 25 mm.
  - Collinear: `rid` "Radome inner diameter", length 8–60 mm, default 20 mm.
- **shapes.ts**
  - `twistGroove(M, R, d, z0, z1, S, hand)`: a circle of diameter d + CLEAR centred at radius R, extruded
    from z0 to z1 with `twistDegrees = ±360·(z1−z0)/S` (manifold `extrude`, ~48 divisions per turn). Sign
    from the handedness of the design wires. This is the exact helix path and is cheap to build.
  - `cornerCap(M, rodD, wireD, corner, legA, legB, spreader)`: a sleeve on the spreader rod end and a
    head with a V channel through the wire corner, open outward so the wire is pressed in.
  - `segments(M, body, zMax, joint)`: cut a tall body into equal stacked pieces ≤ 170 mm (room for the
    spigot) with a keyed spigot/socket at each cut, so grooves line up across joints.
- **New failure message** (thrown from `build`, shown like "Too large"): "Wire too thick for this
  former". The parameter-extreme test accepts it (and the collinear "Radome too narrow for the coax") alongside "Too large to print in one piece".
- All strings in `*_STRINGS` / `*_HOWTO`, added to `PRINT_STRINGS`, with Ukrainian translations.

## Helix (`families/former.ts`)

From the design wires: radius R, wire diameter d, turn spacing S, turns n, first-turn height h0, handedness.

**Body profile** extruded from z = 0 to H = h0 + n·S + S/2:
- **Tube:** annulus, outer radius R, bore radius R − (d+CLEAR)/2 − WALL (solid when that is < 2.5 mm).
  The wire sits half-buried in the groove and is supported along its whole length. `warn`: plastic
  touching the wire lowers resonance a few %; use the Trim knob, or use the tube only as a winding tool.
- **Frame:** a hub (radius 6 mm) and 4 arms (6 when C > 160 mm, so no free span exceeds ~40 mm), arm
  width max(4, d + 2) mm, reaching radius R. The groove becomes a notch in every arm. Least plastic at
  the wire; best at 5.8 GHz.

**Cuts and base** (same for both):
- `twistGroove` from h0 to the top.
- Feed: open radial slot at z = h0 from the axis to R (the stub from the builder's feed wire), and a
  Ø4.2 mm centre hole through the base for an SMA panel jack pin under the reflector.
- Base flange at z = 0..2 mm, radius R + d/2 + 8, three M3 holes: it screws to the reflector and is the
  drilling template for it.
- Height above 170 mm → `segments()`. Diameter above 180 mm → "Too large". R too small for the groove
  and a wall → "Wire too thick for this former".

Prints upright with no supports (a 10–16° groove is a shallow overhang). The paper wrap template stays.

## Discone (`families/hub.ts`, next to the GP hub)

- Disc rods: horizontal radial channels at z = g, open from the top for soldering, inner ends meeting at
  a centre solder pad window above the coax.
- Cone rods: bores from near the apex at the cone half-angle; inner ends exit into an annular groove where
  a bare copper ring or hose clamp joins them to the braid.
- ≥ 2 mm plastic between the disc and cone levels (they must not touch); coax up the centre from below;
  mast box with zip slots like the GP hub. Rod count and angles from the wires (`group` driven/ground).

## Moxon and quad (`families/spreader.ts`)

- **Moxon hub:** a disc at the rectangle centre with 4 horizontal rod sockets (rod + CLEAR, 40 mm deep,
  M3 grub-screw hole) pointing at the 4 corners, angles from the wires (atan2(A/2, E/2)), plus a mast box
  with zip slots below.
- **Moxon corner caps:** `cornerCap` at each corner; driver and reflector corners differ, left and right
  are the same part flipped (qty 2 each).
- **Moxon gap insulator:** a bar with two wire holes exactly C apart (centre to centre, from the tip
  coordinates); the wire tips are looped through it, so C cannot drift. Qty 2. C > 170 mm → "Too large".
- **Quad hub:** a block on the boom (bore bd + CLEAR, M3 screw) with 4 rod sockets at 45° in the loop
  plane; qty 2 (one per loop). **Quad corner caps:** symmetric 90° corner, qty 8.

## Biquad (`families/standoff.ts`)

A slim pedestal from the reflector (x = 0) to the element plane (x = sp·λ − d/2) that holds the 4 legs
only within ~10 mm of the feed (plastic is kept away from the tips, which detune). Top: 4 channels along
the wire directions, open from above, and the feed gap; centre bore Ø6.4 mm for the copper tube or coax.
Base: `flangeCut` (N/SO-239), also the reflector drilling template.

## J-pole, fan dipole, collinear (`families/spacer.ts`, fan centre in `centre.ts`)

- **J-pole stub spacers:** a block with two bores (d + CLEAR) at the stub spacing s, slid on before the
  shorting bar is soldered; qty max(2, ceil(stub / 120 mm)).
- **J-pole feed-tap gauge:** the same block with height tap − d/2, standing on the shorting bar; its top
  edge marks where the coax is attached; zip slot for the coax.
- **Fan centre block:** the dipole centre generalised to n channel pairs at the fan angles (`dipoleArms`
  takes driven + parasitic wires).
- **Fan leg spreaders:** a plate across the legs at 1/3 and 2/3 of the longest arm, with channels along
  each wire's own direction, only for wires that reach that far; qty 2 each (same part on both legs).
  A plate that would exceed 180 mm is skipped at that position (`warn`).
- **Collinear radome spacers:** a disc of diameter rid − CLEAR with a bore od + CLEAR and vent notches,
  slid to the middle of each section; qty n. rid < od + 2·WALL → its own message "Radome too narrow for
  the coax" (also accepted by the extremes test).

## Tests

- `former.test.ts`: for RHCP and LHCP, at 5.8 GHz and the GPS default, for tube and frame:
  every helix wire point is clear of the plastic (a sphere of the wire diameter at the point intersects it
  with ~0 volume) and supported (a sphere of d + 2 mm intersects it); segment heights add up to H and each
  is ≤ 180 mm; wrong handedness fails the clear check (guards the twist sign).
- Families: Moxon hub socket angles match the corner directions within 0.5°, gap insulator hole spacing
  equals C; quad sockets at 45°; discone bores match the cone rods within 0.5° and disc/cone levels keep
  2 mm apart; biquad standoff height equals sp·λ − d/2 and no plastic is further than 12 mm from the feed;
  J-pole bore spacing equals s; fan spreader channels follow the wires; collinear spacer fits rid/od.
- `print.test.ts`: every wire antenna returns ≥ 1 part; existing extremes / howTo / README tests cover the
  new parts (extremes also accept the new messages).
- `i18n.test.ts` coverage; `npm test`, typecheck, lint, build.

## Docs

CLAUDE.md "Not done" list and `docs/ANTENNAS.md` build notes updated; the stage-1 spec's stage table marks
stage 2/3 parts as done or deferred.
