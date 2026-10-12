"""Family v8 = v6 shape with a SIZE cap, cable cases with a distributed ferrite sleeve
(6 x 150 ohm, 1..11 cm below the ground cone) instead of one bead. Lowest frequency incl. margin from FLO (Hz, default 760e6):
  FLO=912e6 SIZE=0.075 FAMILY=family8 X0=seed.json python opt.py h75 25 1   (compact 960 MHz variant)"""
import numpy as np
import bor
import designs as D
import family6 as F6

HMAX, DMAX = F6.HMAX, F6.DMAX
PARAMS, NAMES, LO, HI = F6.PARAMS, F6.NAMES, F6.LO, F6.HI
unpack, profile, geometry, size = F6.unpack, F6.profile, F6.geometry, F6.size
import os
FLO = float(os.environ.get("FLO", "760e6"))
FS_MAIN = D.logf(26, FLO, 6.6e9)
FS_LOW = D.logf(10, FLO, 2.4e9)
ELS = F6.ELS
SLEEVE = [(0.01 + 0.02 * i, 150.0) for i in range(6)]


def cable_geo(p, L):
    _, _, _, zbot, _ = profile(p)
    g = geometry(p, cable=L)
    g.loads = [((D.B_COAX, zbot - z), Z) for z, Z in SLEEVE if z < L - 0.005]
    return g


def evaluate(p, per_lambda=14):  # FLO = lowest frequency incl. 5 % margin
    H, Dm = size(p)
    res = dict(H=H, D=Dm)
    rows = D.evaluate(geometry(p), FS_MAIN, per_lambda=per_lambda, els=ELS)
    res["main"] = rows
    res["swr_main"] = max(r["swr"] for r in rows)
    cab = []
    for L in (0.10, 0.20, 0.35):
        rr = bor.run(cable_geo(p, L), FS_LOW, per_lambda=per_lambda, pattern=False)
        cab.append(max(r["swr"] for r in rr))
    res["swr_cab"] = max(cab)
    res["swr_nochoke"] = 0.0
    return res


def cost_of(res):
    return F6.cost_of(res)


def cost(x):
    p = unpack(x)
    H, Dm = size(p)
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    try:
        return cost_of(evaluate(p))
    except Exception:
        return 100.0
