"""No-ferrite cable fix: a quarter-wave choke sleeve (bazooka) round the coax under a cage. The cage with a bare
jacket of 15 / 25 / 35 cm (cage_cable.py's cases) and a sleeve of each length in SLEEVES (mm, default 50-80), radius
5 mm: worst SWR over FLO - FHI (10 log points).
  SIZE=0.055 NCAGE=16 FLO=960e6 FHI=1.36e9 SLEEVES=55,60,65,70 python cage_sleeve.py designs/A55.json"""
import os, sys, json
import numpy as np
import family13  # noqa: F401  (shunt coils, csh / cser of the split-study designs)
import family10 as F

d = json.load(open(sys.argv[1]))
p = F.full(d.get("p", d))
fs = np.geomspace(float(os.environ.get("FLO", "960e6")), float(os.environ.get("FHI", "1.36e9")), 10)
rs = float(os.environ.get("RSLEEVE", "5e-3"))
# SLEEVES: lengths in mm; "75+55" stacks two tubes (75 mm then 55 mm further down the cable); "75+55@8" gives the
# second one its own radius (mm)
def parse(v):
    out = []
    for part in v.split("+"):
        L, _, R = part.partition("@")
        out.append((float(L) * 1e-3, float(R) * 1e-3 if R else rs))
    return out
sleeves = [parse(v) for v in os.environ.get("SLEEVES", "50,60,70,80").split(",")]
seg = float(os.environ.get("SEG", "2.5e-3"))
print("case".ljust(30) + "".join(f"{f / 1e6:7.0f}" for f in fs) + "  worst")
for cable in (0.15, 0.25, 0.35):
    for sl in [None] + sleeves:
        sw = [F.swr(F.model(p, f, seg=seg, cable=cable, sleeve=sl)[0]) for f in fs]
        name = f"{cable * 100:.0f} cm, " + ("bare" if sl is None else "sleeve " + "+".join(f"{L * 1e3:.0f}@{R * 1e3:.0f}" for L, R in sl))
        print(name.ljust(30) + "".join(f"{v:7.2f}" for v in sw) + f"{max(sw):7.2f}", flush=True)
