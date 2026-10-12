"""Compact-variant check: SWR without cable, worst cable SWR (5 cm - 1 m) with no ferrite, one bead,
and the 6-bead sleeve of family8, sky gain at 15-50 deg, from F_LO to 6.4 GHz.
  F_LO=960e6 python compact_check.py designs/S73.json designs/B_simple.json:0.708
(`file:scale` scales every length of the design; angles stay.)"""
import json, os, sys
import numpy as np
from multiprocessing import Pool
F_LO = float(os.environ.get("F_LO", "960e6"))
os.environ.setdefault("FLO", str(0.95 * F_LO))
import family8 as F, bor, designs as D

FS = D.logf(40, F_LO, 6.4e9)
FL = D.logf(10, F_LO, 2.4e9)
LENS = (0.05, 0.10, 0.15, 0.20, 0.35, 0.5, 1.0)
ANG = {"au1", "au2", "al1", "al2", "capu"}


def load(arg):
    name, _, s = arg.partition(":")
    p = json.load(open(name))
    p = p.get("p", p)
    s = float(s or 1)
    return {k: (v if k in ANG else v * s) for k, v in p.items()}


def worst(geo):
    return max(r["swr"] for r in bor.run(geo, FL, per_lambda=14, pattern=False))


def job(arg):
    p = load(arg)
    H, Dm = F.size(p)
    rows = D.evaluate(F.geometry(p), FS, per_lambda=16, els=F.ELS)
    sw = np.array([r["swr"] for r in rows])
    G = np.array([r["g"] for r in rows])
    gavg = 10 * np.log10(np.mean(10 ** (G / 10), axis=1))
    none = max(worst(F.geometry(p, cable=L)) for L in LENS)
    one = max(worst(F.geometry(p, cable=L, choke=(0.01, 150.0))) for L in LENS)
    six = max(worst(F.cable_geo(p, L)) for L in LENS)
    return (f"{arg}: Ø{Dm * 1e3:.1f} x {H * 1e3:.1f} mm | SWR {sw.max():.2f} @ {FS[sw.argmax()] / 1e6:.0f} MHz | "
            f"cable: no ferrite {none:.2f}, 1 bead {one:.2f}, sleeve {six:.2f} | sky gain avg {gavg.mean():+.2f}, "
            f"worst freq {gavg.min():+.2f}, min {G.min():+.1f} dBi")


if __name__ == "__main__":
    with Pool(min(8, len(sys.argv) - 1)) as pl:
        for line in pl.map(job, sys.argv[1:]):
            print(line)
