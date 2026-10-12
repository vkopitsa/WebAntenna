"""Family v5 = v4 with the stricter sky cost (family.cost_of3), for polishing around design A."""
import family as F1
import family4 as F4
HMAX, DMAX = F4.HMAX, F4.DMAX
PARAMS, NAMES, LO, HI = F4.PARAMS, F4.NAMES, F4.LO, F4.HI
unpack, profile, geometry, size, evaluate = F4.unpack, F4.profile, F4.geometry, F4.size, F4.evaluate


def cost(x):
    p = unpack(x)
    H, Dm = size(p)
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    try:
        return F1.cost_of3(evaluate(p))
    except Exception:
        return 100.0
