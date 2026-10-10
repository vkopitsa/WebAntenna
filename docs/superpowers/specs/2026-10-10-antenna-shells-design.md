# Printed antenna shells (radomes, enclosures, feedpoint boxes): design

Date: 2026-10-10. Status: approved in brainstorming, awaiting spec review.
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
