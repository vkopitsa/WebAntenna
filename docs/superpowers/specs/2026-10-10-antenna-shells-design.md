# Printed antenna shells (radomes, enclosures, feedpoint boxes): design

Date: 2026-10-10. Status: implemented (see "As built" at the end).
Builds on the printed-parts stages 1–2 (`2026-10-10-print-parts-design.md`, `2026-10-10-print-parts-stage2-design.md`):
same engine (manifold-3d), rules (`rules.ts`), worker, panel, `PartSpec`, `PartError`, `stack()`.

## Goal

Every antenna in the app, wire and printed (PCB), gets a printable **shell**, so the build ends in a finished, protected
antenna, like the Printables "5.8 GHz Pagoda antenna shell". Small antennas are fully enclosed; antennas too large to
enclose get a sealed **feedpoint weather box** (the part that fails in rain).

## Decisions

- **Size class, from the design (no new settings).** Envelope = the antenna's geometry in mm (live wires, i.e. not
  `drawOnly`/`necOnly`; plates; the PCB board) plus the gap. **Full shell** when the envelope footprint (the two larger
  extents, for a dome the diameter) is ≤ 170 mm and the height is ≤ 3 stacked pieces (3·`SEG_H`). Otherwise **feed box**.
- **Style, from the frequency** `d.f` (centre of band 1):
  - **FPV** (f ≥ 2 GHz): wall 1.2 mm, gap 1.5 mm, rounded/cone top, SMA. Light, impact-friendly, like the Pagoda shell.
  - **Outdoor** (f < 2 GHz): wall 2 mm, gap 3 mm, overlapping lip joint (sealable with silicone), Ø3 mm drain hole at
    the lowest point, README note "PETG/ASA, dark colour".
- **Shell is one more `PartSpec`** (`use: "holder"`, id `shell`), appended by `partsFor` for every antenna through a
  separate dispatch `shellFor(defId, p, d)`. PCB antennas, which had no parts, now get their shell. No UI change.
- **RF warning on every full shell** (`warn`): "A plastic shell lowers the resonance by about 1–3 %: retune with Trim
  (printed antennas: check with the FDTD simulation)." Purpose text states the gap and wall used.
- **Plastic never touches the radiator:** the shell keeps the gap from every live wire and from PCB copper.

## Shell generators (`src/lib/print/shells/`)

| File | Responsibility |
|---|---|
| `classify.ts` | `shellClass(d)` → `{ kind: "full" \| "feed", style: "fpv" \| "outdoor", wall, gap, env }` (env = mm bounding box of the geometry) |
| `dome.ts` | Dome radome: vertical tube round the z axis, 45° cone top (prints without supports), base either a **flange** (screws to the reflector/ground plane with 3 M3 holes outside the antenna's own base parts; also the drilling template) or a **mast** base (bottom plate with a mast hole and M3 lock). Tall domes stack with a plain lip spigot (`stack()`; rotation doesn't matter). |
| `box.ts` | Clamshell box: two halves split on a plane through the feed, inner = envelope + gap, wall, lip joint, 4 M3 screws through bosses at the corners, connector cut-out, edge-clamp ribs for a PCB/reflector. |
| `feedbox.ts` | Feedpoint weather box: two halves round an **envelope** (an existing feed part's outer box + gap, or a 30 mm cube at the feed point when there is none), one entry hole per **exit ray** (a wire or tube leaving the feed region: point, direction, diameter + CLEAR + 1 for sealant), a coax gland hole Ø8 mm at the bottom, drain hole, M3 screws. |
| `index.ts` | `shellFor(defId, p, d)`: picks the generator and its inputs per antenna (table below); `SHELL_STRINGS`, `SHELL_HOWTO`. |

## Per antenna

| Antenna | Full shell | Feed box (when too big) envelope / exits |
|---|---|---|
| Helix | Dome, flange base over the helix (inner radius R + d/2 + gap, height to the top of the coil + gap); its M3 holes sit outside the former's flange | (only at UHF and below) envelope round the former's base flange, exit: coil start |
| Discone | Dome, mast base (`mast` param) round disc and cone | discone hub top window + disc ring; exits: disc rods, cone rods, mast |
| Ground plane | Box round radiator and radials | GP hub plate (jack on top); exits: radiator up, radials, coax down |
| Dipole, fan dipole | Box (FPV-size dipoles) | dipole/fan centre insulator hub box; exits: every arm, the hanging eye rope, coax |
| Yagi | Box | Yagi driven block; exits: driven element both sides, boom both ways |
| Moxon, quad | Box | 30 mm cube at the feed; exits: the driven wires at the feed |
| J-pole | Box (only UHF+) | 30 mm cube at the feed tap; exits: both legs up and down, coax |
| Collinear | Box (only short, high-band) | 30 mm cube at the bottom of S1; exits: the coax up, the feed coax down |
| Biquad | Box: back half holds the reflector plate by its edge, front cover over the element; N/SO-239 flange cut-out behind the feed | — (always fits at 2.4 GHz; feed box round the standoff otherwise) |
| Printed: patch, PCB monopole, meander, IFA, printed dipole, PCB loop | Box round the board with ≥ gap of air over top and bottom copper; ribs clamp the board edge only where there is no top copper; coax entry on the board edge nearest the port, aligned with it; a probe port (patch probe option) gets an SMA panel hole under the probe instead | — (boards are always small) |

Notes:
- PCB loop has no `pcb` model: its envelope comes from its substrate plate and wires.
- Feed-box exits come from the design (`Design.wires` meeting the feed region) and from the feed part's own geometry
  functions (`dipoleArms`, `hubGeometry`, `disconeGeometry`, `yagiGeometry`, …), so holes line up with the wires.

## Failure modes

- Too large to print even as a feed box → the existing "Too large to print in one piece" (the feed box is never split).
- Wire or tube too thick for an entry hole in the wall → `FAIL.thick`.

## Tests (`src/lib/print/shells/*.test.ts`)

- `shellClass`: FPV vs outdoor by frequency (2.4 GHz helix → fpv, GPS helix → outdoor); full vs feed by size
  (5.8 GHz dipole → full, 7 MHz dipole → feed).
- Every antenna in `ANTENNAS` (PCB ones included) returns exactly one `shell` part, and it builds at defaults.
- Full shells: no plastic within `gap − 0.1` of any live wire point (sampled) or PCB copper rectangle.
- Feed boxes: every exit ray passes through its entry hole (a probe of the wire diameter along the ray, through the wall,
  is clear) and the wall surrounds it (wire + CLEAR + 2 + 2 hits plastic).
- Dome: piece heights add up to the dome height, each ≤ 180 mm; helix dome flange holes clear the former's flange.
- PCB: coax entry lines up with the port (ray from the port to the nearest edge is clear through the wall).
- Existing extremes / how-to / i18n tests cover the shells (update the test that PCB antennas have no parts: they now have exactly the shell).

## Out of scope

- Simulating the shell's dielectric effect (the FDTD could, later: a `shell` material layer).
- Threaded or bayonet joints, gaskets, cable glands with nuts: lip joint + silicone and screws only.
- Shells for the stage-2 parts themselves beyond the feed box.

## As built (changes from this spec)

- **Shell kinds.** Every antenna gets exactly one `shell` part. Full shell (helix dome with flange over the former's flange and M3 into the reflector; discone dome on the mast base; otherwise a two-half clamshell) when it fits the 180 mm bed. Otherwise a **feedpoint hood** replaces the two-part feed box: one piece, open at the bottom, lowered over the feed part after soldering. Wires leave through slots running to the open bottom edge. A roof exit is a round hole only when it points nearly straight up (|dir z| > 0.9) and its wire ends free outside (no other live wire endpoint within 0.5 mm of its outer end), as on the GP radiator and the dipole/fan halyard eye rope; every other roof exit (a closed loop such as the biquad at <= 1.5 GHz, a steep lug) is an L-slot, along the roof past the nearest side wall and then down past the open bottom, so the hood can still be lowered after soldering. It encloses only the feed core (dipole/fan hub block, GP plate + jack, discone top disc ring, Yagi driven block, else a 30 mm cube). On the ground plane the mast must end at the top of the hub's side block.
- **No full box over a world-frame feed holder.** The dipole, fan dipole, ground plane and Yagi feed parts are built at the feed, in the antenna's own frame, so a full box around a small one would cut through them: these four always get the hood, at any frequency. The discone and the helix keep their dome (or its fallback); the other wire antennas keep the full box when it fits.
- **Helix fallback: connector cover.** When the dome does not fit, the helix shell is a hood mirrored under the reflector over the SMA panel jack: a 30 mm cube cavity from z = -30 - gap up to 0 with its open face against the reflector's underside, the coax out through a Ø8 hole in its floor, sealed to the reflector with silicone. Nothing of it is above z = 0, so it never meets the former or the reflector.
- **Style by frequency.** FPV (>= 2 GHz): wall 1.2, gap 1.5, no lip (flat joint), screwed. Outdoor: wall 2, gap 3, lip and silicone, drain.
- **Clamshell.** Lip height adapts to the cavity; 4 M3 screw ears. In full boxes the coax gland is Ø8 and stays inside the cavity footprint.
- **PCB enclosures** (all printed antennas). The board is located by edge stops on all four sides, with 1 mm overhang clamps where the rim is free of non-ground copper, and sits on posts touching only ground copper or bare board. The Ø3.5 coax pigtail enters over the ground pour on the nearest edge; on non-probe (edge-fed) boards the roof is raised (>= 4 mm air) so the cable lies on the board, and the split is at cable height. A probe-fed patch gets a Ø6.5 SMA hole underneath and the plain gap over the board. The PCB loop gets a plain box.
- **RF warning.** Full shells warn that the plastic lowers the resonance by about 1-3 % (retune with Trim; check printed antennas with FDTD).
- **Deferred.** Fan dipole hoods at 30-45 deg fan angles keep only about 50–70 % (see shells.test.ts) of the roof because the steep lugs exit through it; seal with silicone. Shells are not simulated.
