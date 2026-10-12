"""Differential evolution over family.PARAMS, 8 worker processes, progress in opt_<tag>.jsonl (one JSON line per generation)."""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
import sys, json, time
import numpy as np
from multiprocessing import Pool
from scipy.optimize import differential_evolution
import importlib, os as _os
F = importlib.import_module(_os.environ.get("FAMILY", "family"))

tag = sys.argv[1] if len(sys.argv) > 1 else "run1"
maxiter = int(sys.argv[2]) if len(sys.argv) > 2 else 60
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
log = open(f"opt_{tag}.jsonl", "a")
best = {"c": 1e9}
t0 = time.time()


def cb(xk, convergence=None):
    c = F.cost(xk)
    if c < best["c"]:
        best.update(c=c, x=list(map(float, xk)))
    p = F.unpack(xk)
    H, Dm = F.size(p)
    log.write(json.dumps(dict(t=round(time.time() - t0), c=c, conv=convergence, H=H, D=Dm, p=p)) + "\n")
    log.flush()


if __name__ == "__main__":
    x0 = None
    if _os.environ.get("X0"):
        d = json.load(open(_os.environ["X0"]))
        x0 = np.array([min(max(d.get(n, (lo + hi) / 2), lo), hi) for n, lo, hi in zip(F.NAMES, F.LO, F.HI)])
    lo = np.array(json.loads(_os.environ["LO"])) if _os.environ.get("LO") else F.LO
    hi = np.array(json.loads(_os.environ["HI"])) if _os.environ.get("HI") else F.HI
    with Pool(8) as pool:
        r = differential_evolution(F.cost, list(zip(lo, hi)), popsize=int(_os.environ.get("POP", 12)), maxiter=maxiter, tol=1e-4,
                                   mutation=(0.5, 1.0), recombination=0.8, seed=seed, workers=pool.map,
                                   updating="deferred", polish=False, callback=cb, init="sobol", x0=x0)
    p = F.unpack(r.x)
    json.dump(dict(c=float(r.fun), p=p), open(f"best_{tag}.json", "w"), indent=1)
    log.write(json.dumps(dict(final=True, c=float(r.fun), p=p)) + "\n")
