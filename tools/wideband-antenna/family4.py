"""Family v4 = v2 geometry fed by UT-141 semi-rigid (designs.A_PIN/B_COAX), build limits on the
pin gap (>= 0.8 mm) and the hot washer (>= 2 mm radius), sky-weighted cost (family.cost_of2)."""
import numpy as np
import family as F1
import family2 as F2

HMAX, DMAX = F2.HMAX, F2.DMAX
B = dict((n, (lo, hi)) for n, lo, hi in F2.PARAMS)
B["g"] = (0.8e-3, 5e-3)
B["r0u"] = (2.0e-3, 10e-3)
PARAMS = [(n,) + B[n] for n, _, _ in F2.PARAMS]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])
unpack = F2.unpack
profile, geometry, size, evaluate = F2.profile, F2.geometry, F2.size, F2.evaluate


def cost(x):
    p = unpack(x)
    H, Dm = size(p)
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    try:
        return F1.cost_of2(evaluate(p))
    except Exception:
        return 100.0
