"""Family v7 = v6 (800 MHz - 6.4 GHz) with cable robustness as a hard requirement: the worst SWR
also covers 5, 10, 15, 25 and 40 cm of cable WITHOUT a ferrite (plus 10/35 cm with one)."""
import numpy as np
import bor
import designs as D
import family6 as F6

HMAX, DMAX = F6.HMAX, F6.DMAX
PARAMS, NAMES, LO, HI = F6.PARAMS, F6.NAMES, F6.LO, F6.HI
unpack, profile, geometry, size = F6.unpack, F6.profile, F6.geometry, F6.size
FS_MAIN, FS_LOW, ELS = F6.FS_MAIN, F6.FS_LOW, F6.ELS


def evaluate(p, per_lambda=14):
    H, Dm = size(p)
    res = dict(H=H, D=Dm)
    rows = D.evaluate(geometry(p), FS_MAIN, per_lambda=per_lambda, els=ELS)
    res["main"] = rows
    res["swr_main"] = max(r["swr"] for r in rows)
    cab = []
    for Lc, ch in ((0.05, None), (0.10, None), (0.15, None), (0.25, None), (0.40, None), (0.10, (0.01, 150.0)), (0.35, (0.01, 150.0))):
        rr = bor.run(geometry(p, cable=Lc, choke=ch), FS_LOW, per_lambda=per_lambda, pattern=False)
        cab.append(max(r["swr"] for r in rr))
    res["swr_cab"] = max(cab)
    res["swr_nochoke"] = max(cab[:5])
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
