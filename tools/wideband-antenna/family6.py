"""Family v6: the v2/v4 shape (two-angle hot cone + cylinder + cap over a two-angle ground cone +
skirt, UT-141 feed) re-scoped to 800 MHz - 6.4 GHz with a compact size budget.

Environment: SIZE = max height and diameter in metres (default 0.12)."""
import os
import numpy as np
import bor
import designs as D
import family as F1
import family2 as F2

SIZE = float(os.environ.get("SIZE", "0.12"))
HMAX = DMAX = SIZE
FS_MAIN = D.logf(26, 760e6, 6.6e9)          # 5 % margin at both ends
FS_LOW = D.logf(10, 760e6, 2.0e9)           # band where the feed cable matters
ELS = (15, 20, 25, 30, 35, 40, 45, 50)
s = SIZE / 0.30
PARAMS = [
    ("g", 0.5e-3, 4e-3),
    ("r0u", 1.5e-3, 6e-3),
    ("au1", 20.0, 88.0),
    ("L1", 0.0, 0.08 * s),
    ("au2", 10.0, 80.0),
    ("Ru", 0.04 * s, SIZE / 2),
    ("Hcu", 0.0, 0.20 * s),
    ("capu", 0.0, 1.0),
    ("al1", 20.0, 90.0),
    ("Ll1", 0.0, 0.08 * s),
    ("al2", 20.0, 90.0),
    ("Rl", 0.02 * s, SIZE / 2),
    ("Sl", 0.0, 0.20 * s),
]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])
unpack, profile, geometry, size = F2.unpack, F2.profile, F2.geometry, F2.size


def evaluate(p, per_lambda=14):
    H, Dm = size(p)
    res = dict(H=H, D=Dm)
    rows = D.evaluate(geometry(p), FS_MAIN, per_lambda=per_lambda, els=ELS)
    res["main"] = rows
    res["swr_main"] = max(r["swr"] for r in rows)
    cab = []
    for Lc in (0.10, 0.20, 0.35):
        rr = bor.run(geometry(p, cable=Lc, choke=(0.01, 150.0)), FS_LOW, per_lambda=per_lambda, pattern=False)
        cab.append(max(r["swr"] for r in rr))
    res["swr_cab"] = max(cab)
    nc = []
    for Lc in (0.15, 0.35):
        rr = bor.run(geometry(p, cable=Lc), FS_LOW, per_lambda=per_lambda, pattern=False)
        nc.append(max(r["swr"] for r in rr))
    res["swr_nochoke"] = max(nc)
    return res


def cost_of(res):
    swrs = np.array([r["swr"] for r in res["main"]])
    worst = max(res["swr_main"], res["swr_cab"])
    c = max(worst, 1.85) + 0.5 * np.mean(np.maximum(0, swrs - 1.8)) + 0.3 * max(0.0, res["swr_nochoke"] - 2.0)
    G = np.array([r["g"] for r in res["main"]])
    gavg = 10 * np.log10(np.mean(10 ** (G / 10), axis=1))
    gmin = G.min(axis=1)
    c += 0.1 * (np.mean(np.maximum(0, 1.0 - gavg)) + 0.5 * np.mean(np.maximum(0, -2.0 - gmin)) + 0.5 * max(0.0, -1.0 - gavg.min()))
    c += 20 * max(0.0, res["H"] - HMAX) / 0.01 + 20 * max(0.0, res["D"] - DMAX) / 0.01
    return float(c)


def cost(x):
    p = unpack(x)
    H, Dm = size(p)
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    try:
        return cost_of(evaluate(p))
    except Exception:
        return 100.0
