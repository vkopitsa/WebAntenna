"""Cable check of a family-10 wire cage (NEC-2): the coax jacket as a wire down the axis (common-mode path) of
several lengths, bare, with one ferrite bead, and with the 6-bead sleeve (150 ohm each at 1, 3, 5, 7, 9, 11 cm):
python cage_cable.py <design.json> [seg_m=2.5e-3]
prints the worst SWR over 912 MHz - 2 GHz (where the cable matters; `FLO` / `FHI` move the window: W40 needs FLO=1.4e9 FHI=3e9) per case; W16 = designs/W16.json."""
import os, sys, json
import numpy as np
import family10 as F
import family13  # noqa: F401  (patches the shunt coil, csh and cser of the split-study designs into family 10)

d = json.load(open(sys.argv[1]))
p = d.get("p", d)
if "ru" in p:
    import family11 as F11
    p = F11.to_abs(p)
p = F.full(p)
seg = float(sys.argv[2]) if len(sys.argv) > 2 else 2.5e-3
fs = np.geomspace(float(os.environ.get("FLO", "912e6")), float(os.environ.get("FHI", "2.0e9")), 10)   # FLO / FHI: the window
SLEEVE = [(z, 150.0) for z in (0.01, 0.03, 0.05, 0.07, 0.09, 0.11)]
ONE = [(0.01, 150.0)]
print(f"{'case':28s} " + " ".join(f"{f/1e6:6.0f}" for f in fs) + "   worst")
for name, L, beads in [("no cable", 0.0, ())] + [(f"{L*100:.0f} cm, {lab}", L, b) for L in (0.15, 0.25, 0.35)
                                                     for lab, b in (("bare", ()), ("1 bead", ONE), ("6-bead sleeve", SLEEVE))]:
    sw = [F.swr(F.model(p, f, seg=seg, cable=L, beads=beads)[0]) for f in fs]
    print(f"{name:28s} " + " ".join(f"{x:6.2f}" for x in sw) + f"   {max(sw):5.2f}", flush=True)
