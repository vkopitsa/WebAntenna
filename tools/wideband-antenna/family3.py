"""Family v3 = v2 with build constraints: the ground starts with the flat SMA flange (radius 6.5 mm)
at z = 0, the pin gap g >= 1 mm, the hot washer radius >= 2.5 mm (solder joint on the pin)."""
import numpy as np
import family2 as F2
import family as F1
import bor
import designs as D

HMAX, DMAX = F2.HMAX, F2.DMAX
R_FLANGE = 6.5e-3
PARAMS = [
    ("g", 1.0e-3, 5e-3),
    ("r0u", 2.5e-3, 10e-3),
    ("au1", 20.0, 88.0),
    ("L1", 0.0, 0.08),
    ("au2", 10.0, 80.0),
    ("Ru", 0.06, 0.15),
    ("Hcu", 0.0, 0.20),
    ("capu", 0.0, 1.0),
    ("al2", 20.0, 90.0),
    ("Rl", 0.03, 0.15),
    ("Sl", 0.0, 0.20),
]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])


def full(p):
    q = dict(p)
    q["al1"] = 90.0
    q["Ll1"] = R_FLANGE - D.B_COAX
    return q


def unpack(x):
    return dict(zip(NAMES, x))


def profile(p):
    return F2.profile(full(p))


def geometry(p, cable=0.0, choke=None):
    return F2.geometry(full(p), cable, choke)


def size(p):
    return F2.size(full(p))


def evaluate(p, per_lambda=14):
    return F2.evaluate(full(p), per_lambda)


def cost(x):
    p = unpack(x)
    H, Dm = size(p)
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    try:
        return F1.cost_of2(evaluate(p))
    except Exception:
        return 100.0
