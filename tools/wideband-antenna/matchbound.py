"""What an ideal lossless lumped matching network at the feed could do with a cage's unmatched impedance:
  python matchbound.py results/sweep_seed40_nosh.json [f_lo=960e6] [f_hi=6.4e9]
reads a sweep13.py JSON (rows of f, r, x), and for ladders of 1, 2 and 3 elements (every series / shunt and
L / C combination) finds the element values that minimise the worst SWR over the band (differential evolution on
log values, 1-100 nH, 0.1-50 pF). The one-element case is the lumped version of the cage's shunt wire; if two or
three elements do much better, the match, not the shape, limits the small cage; if not, it is the Q of the box."""
import itertools
import json
import sys
import numpy as np
from scipy.optimize import differential_evolution

d = json.load(open(sys.argv[1]))
f_lo = float(sys.argv[2]) if len(sys.argv) > 2 else 960e6
f_hi = float(sys.argv[3]) if len(sys.argv) > 3 else 6.4e9
rows = [r for r in d["rows"] if f_lo * 0.999 <= r["f"] <= f_hi * 1.001]
f = np.array([r["f"] for r in rows])
Z = np.array([r["r"] + 1j * r["x"] for r in rows])
w = 2 * np.pi * f
Z0 = 50.0


def swr(z):
    g = np.abs((z - Z0) / (z + Z0))
    return (1 + g) / (1 - g)


def apply(topo, vals):
    """topo: list of (place, kind) from the antenna toward the feed; vals: log10 of nH / pF."""
    z = Z.copy()
    for (place, kind), v in zip(topo, vals):
        x = 1j * w * 10 ** v * 1e-9 if kind == "L" else 1 / (1j * w * 10 ** v * 1e-12)
        z = z + x if place == "series" else 1 / (1 / z + 1 / x)
    return z


def best(topo):
    lo = [0.0 if k == "L" else -1.0 for _, k in topo]
    hi = [2.0 if k == "L" else 1.7 for _, k in topo]
    res = differential_evolution(lambda v: swr(apply(topo, v)).max(), list(zip(lo, hi)), seed=1, tol=1e-6,
                                 maxiter=400, popsize=30, polish=True)
    return res.fun, res.x


print(f"unmatched: worst SWR {swr(Z).max():.1f} over {f[0]/1e6:.0f}-{f[-1]/1e6:.0f} MHz ({len(f)} points)")
for n in (1, 2, 3):
    results = []
    for places in itertools.product(("shunt", "series"), repeat=n):
        if any(a == b for a, b in zip(places, places[1:])):
            continue                                  # two like elements in a row are one element
        for kinds in itertools.product("LC", repeat=n):
            topo = list(zip(places, kinds))
            c, v = best(topo)
            results.append((c, topo, v))
    results.sort(key=lambda r: r[0])
    c, topo, v = results[0]
    desc = ", ".join(f"{p} {10**x:.1f} {'nH' if k == 'L' else 'pF'}" for (p, k), x in zip(topo, v))
    print(f"{n} element(s): best worst-SWR {c:.2f}  ({desc})")
    s = swr(apply(topo, v))
    print("   SWR by frequency: " + " ".join(f"{ff/1e6:.0f}:{ss:.1f}" for ff, ss in zip(f, s)))
