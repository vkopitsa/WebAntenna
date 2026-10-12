"""Monte Carlo build tolerance: python tolerance.py <family> '<json>' [n] [dl_mm] [dg_mm] [dang_deg]"""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
import sys, json, importlib
import numpy as np
from multiprocessing import Pool
import designs as D

fam = importlib.import_module(sys.argv[1])
p0 = json.loads(sys.argv[2])
N = int(sys.argv[3]) if len(sys.argv) > 3 else 48
dl = float(sys.argv[4]) * 1e-3 if len(sys.argv) > 4 else 1e-3
dg = float(sys.argv[5]) * 1e-3 if len(sys.argv) > 5 else 0.3e-3
da = float(sys.argv[6]) if len(sys.argv) > 6 else 1.5
import os as _o
F_LO = float(_o.environ.get("F_LO", "300e6"))
FS = D.logf(40, F_LO, 6.4e9)
ANG = {"au", "au1", "au2", "al", "al1", "al2"}


def perturb(seed):
    r = np.random.default_rng(seed)
    p = dict(p0)
    for k, v in p0.items():
        if k == "g":
            p[k] = max(0.2e-3, v + r.uniform(-dg, dg))
        elif k in ANG:
            p[k] = min(90.0, v + r.uniform(-da, da))
        elif k == "capu":
            p[k] = v
        else:
            p[k] = max(0.0, v + r.uniform(-dl, dl)) if v > 0 else v
    return p


def worst(seed):
    p = p0 if seed < 0 else perturb(seed)
    rows = D.evaluate(fam.geometry(p), FS, per_lambda=14)
    s = np.array([r["swr"] for r in rows])
    return float(s.max()), float(s[FS < 1e9].max()), float(s[FS >= 1e9].max())


if __name__ == "__main__":
    with Pool(8) as pool:
        res = pool.map(worst, [-1] + list(range(N)))
    nom = res[0]
    w = np.array(res[1:])
    print(f"nominal worst SWR {nom[0]:.2f} (<1 GHz {nom[1]:.2f}, >=1 GHz {nom[2]:.2f})")
    print(f"tolerance: lengths ±{dl*1e3:.1f} mm, gap ±{dg*1e3:.2f} mm, angles ±{da:.1f}°, {N} builds")
    for q in (50, 90, 100):
        print(f"  {q:3d}th percentile worst SWR {np.percentile(w[:, 0], q):.2f}  (<1 GHz {np.percentile(w[:, 1], q):.2f}, >=1 GHz {np.percentile(w[:, 2], q):.2f})")
    print(f"  builds with SWR < 2 everywhere: {np.mean(w[:, 0] < 2) * 100:.0f} %")
