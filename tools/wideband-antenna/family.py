"""Parametric family for the FPV detector antenna (hot element up, ground element + cable down)."""
import math
import numpy as np
import bor
import designs as D

HMAX, DMAX = 0.30, 0.30

# name, lo, hi
PARAMS = [
    ("g", 0.4e-3, 8e-3),        # pin length: aperture plane -> start of hot element
    ("r0u", D.A_PIN, 12e-3),    # flat hot disc from the pin out to r0u before the cone starts
    ("au", 15.0, 80.0),         # hot cone half-angle from +z (deg)
    ("Ru", 0.04, 0.15),         # hot element radius
    ("Hcu", 0.0, 0.20),         # cylinder continuing upward from the hot cone rim
    ("capu", 0.0, 1.0),         # top annulus closing the cylinder inward (fraction of Ru)
    ("al", 20.0, 90.0),         # ground cone half-angle from -z (90 = flat disc)
    ("Rl", 0.02, 0.15),         # ground radius
    ("Sl", 0.0, 0.20),          # ground skirt (cylinder) length downward
]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])


def unpack(x):
    return dict(zip(NAMES, x))


def profile(p):
    a, b = D.A_PIN, D.B_COAX
    g, r0u, au, Ru, Hcu, capu = p["g"], max(p["r0u"], a), math.radians(p["au"]), p["Ru"], p["Hcu"], p["capu"]
    al, Rl, Sl = math.radians(p["al"]), p["Rl"], p["Sl"]
    upper = []
    if r0u > a + 1e-5:
        upper.append(np.array([(a, g), (r0u, g)]))
    Ru = max(Ru, r0u + 1e-3)
    z1 = g + (Ru - r0u) / math.tan(au)
    upper.append(np.array([(r0u, g), (Ru, z1)]))
    ztop = z1
    if Hcu > 1e-3:
        ztop = z1 + Hcu
        upper.append(np.array([(Ru, z1), (Ru, ztop)]))
        if capu > 0.02:
            upper.append(np.array([(Ru, ztop), (max(Ru * (1 - capu), 1e-3), ztop)]))
    Rl = max(Rl, b + 1e-3)
    hl = 0.0 if p["al"] >= 89.9 else (Rl - b) / math.tan(al)
    lower = [np.array([(b, 0.0), (Rl, -hl)])]
    zbot = -hl
    if Sl > 1e-3:
        lower.append(np.array([(Rl, -hl), (Rl, -hl - Sl)]))
        zbot = -hl - Sl
    return upper, lower, ztop, zbot, max(Ru, Rl)


def geometry(p, cable=0.0, choke=None):
    upper, lower, ztop, zbot, rmax = profile(p)
    cab = (-zbot + cable) if cable > 0 else 0.0
    ch = (zbot - choke[0], choke[1]) if choke else None
    return D.geo_from(upper, lower, p["g"], cable=cab, choke=ch)


def size(p):
    _, _, ztop, zbot, rmax = profile(p)
    return ztop - zbot, 2 * rmax


FS_MAIN = D.logf(32, 290e6, 6.6e9)
FS_LOW = D.logf(12, 290e6, 950e6)
ELS = (15, 25, 35, 50)


def evaluate(p, per_lambda=14, full=False):
    """Returns dict of metrics.  Main: no cable (ideal choke).  Cable scenarios: low band only."""
    H, Dm = size(p)
    res = dict(H=H, D=Dm)
    rows = D.evaluate(geometry(p), FS_MAIN, per_lambda=per_lambda, els=ELS)
    res["main"] = rows
    res["swr_main"] = max(r["swr"] for r in rows)
    res["gmin"] = np.array([min(r["g"]) for r in rows])
    cab = []
    for Lc in (0.20, 0.35, 0.50):
        rr = bor.run(geometry(p, cable=Lc, choke=(0.02, 150.0)), FS_LOW, per_lambda=per_lambda, pattern=False)
        cab.append(max(r["swr"] for r in rr))
    res["swr_cab"] = max(cab)
    rr = bor.run(geometry(p, cable=0.35), FS_LOW, per_lambda=per_lambda, pattern=False)
    res["swr_nochoke"] = max(r["swr"] for r in rr)
    return res


def cost_of(res):
    swrs = np.array([r["swr"] for r in res["main"]])
    worst = max(res["swr_main"], res["swr_cab"])
    c = worst + 0.5 * np.mean(np.maximum(0, swrs - 1.8)) + 0.15 * max(0.0, res["swr_nochoke"] - 2.5)
    c += 0.05 * np.mean(np.maximum(0, -1.0 - res["gmin"]))
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


ELS2 = (15, 20, 25, 30, 35, 40, 45, 50)


def cost_of2(res, swr_floor=1.85, lam=0.1):
    """Satisfice SWR (no reward below swr_floor), then maximise gain toward 15-50 deg elevation."""
    swrs = np.array([r["swr"] for r in res["main"]])
    worst = max(res["swr_main"], res["swr_cab"])
    c = max(worst, swr_floor) + 0.5 * np.mean(np.maximum(0, swrs - 1.8)) + 0.15 * max(0.0, res["swr_nochoke"] - 2.5)
    G = np.array([r["g"] for r in res["main"]])           # [f, el] in dBi
    gavg = 10 * np.log10(np.mean(10 ** (G / 10), axis=1))
    gmin = G.min(axis=1)
    c += lam * (np.mean(np.maximum(0, 1.0 - gavg)) + 0.5 * np.mean(np.maximum(0, -2.0 - gmin)) + 0.5 * max(0.0, -1.0 - gavg.min()))
    c += 20 * max(0.0, res["H"] - HMAX) / 0.01 + 20 * max(0.0, res["D"] - DMAX) / 0.01
    return float(c)


def cost_of3(res):
    """Stricter sky targets for polishing: average over 15-50 deg >= +2 dBi, worst >= -1 dBi."""
    swrs = np.array([r["swr"] for r in res["main"]])
    worst = max(res["swr_main"], res["swr_cab"])
    c = max(worst, 1.85) + 0.5 * np.mean(np.maximum(0, swrs - 1.8)) + 0.15 * max(0.0, res["swr_nochoke"] - 2.5)
    G = np.array([r["g"] for r in res["main"]])
    gavg = 10 * np.log10(np.mean(10 ** (G / 10), axis=1))
    gmin = G.min(axis=1)
    c += 0.1 * (np.mean(np.maximum(0, 2.0 - gavg)) + 0.5 * np.mean(np.maximum(0, -1.0 - gmin)) + 0.5 * max(0.0, 0.0 - gavg.min()))
    c += 20 * max(0.0, res["H"] - HMAX) / 0.01 + 20 * max(0.0, res["D"] - DMAX) / 0.01
    return float(c)
