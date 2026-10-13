"""Differential evolution from a buildable start: the initial population is the seed X0, Gaussian perturbations of
it (NEAR, fraction of the population, sigma SIGMA of each range) and random samples, all passing the family's
cheap feasible(x) checks. Every evaluation goes to eval_<tag>.jsonl, one line per generation to opt_<tag>.jsonl.
  FAMILY=family11 SIZE=0.06 X0=seed.json POP=8 NEAR=0.5 SIGMA=0.08 python opt2.py s60 40 1"""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
import sys, json, time, importlib
import numpy as np
from multiprocessing import Pool
from scipy.optimize import differential_evolution

F = importlib.import_module(os.environ.get("FAMILY", "family11"))
tag = sys.argv[1]
maxiter = int(sys.argv[2]) if len(sys.argv) > 2 else 40
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
t0 = time.time()


def f(x):
    c = F.cost(x)
    with open(f"eval_{tag}.jsonl", "a") as fh:
        fh.write(json.dumps(dict(t=round(time.time() - t0), c=c, x=[round(float(v), 6) for v in x])) + "\n")
    return c


def start(n, rng):
    d = json.load(open(os.environ["X0"]))
    x0 = np.array([min(max(d[k], lo), hi) for k, lo, hi in zip(F.NAMES, F.LO, F.HI)])
    pop, near = [x0], int(float(os.environ.get("NEAR", "0.5")) * n)
    sig = float(os.environ.get("SIGMA", "0.08")) * (F.HI - F.LO)
    while len(pop) < n:
        x = (x0 + rng.normal(size=len(x0)) * sig) if len(pop) < near else F.LO + rng.random(len(x0)) * (F.HI - F.LO)
        x = np.clip(x, F.LO, F.HI)
        if F.feasible(x):
            pop.append(x)
    return np.array(pop)


if __name__ == "__main__":
    rng = np.random.default_rng(seed)
    n = int(os.environ.get("POP", "8")) * len(F.NAMES)
    init = start(n, rng)
    log = open(f"opt_{tag}.jsonl", "a")

    def cb(intermediate_result):                   # scipy passes an OptimizeResult to a parameter of this name
        r = intermediate_result
        p = F.unpack(r.x)
        log.write(json.dumps(dict(t=round(time.time() - t0), c=float(r.fun), p=p)) + "\n")
        log.flush()

    with Pool(int(os.environ.get("WORKERS", "8"))) as pool:
        r = differential_evolution(f, list(zip(F.LO, F.HI)), maxiter=maxiter, tol=1e-4, mutation=(0.5, 1.0),
                                   recombination=0.8, seed=seed, workers=pool.map, updating="deferred", polish=False,
                                   callback=cb, init=init)
    p = F.unpack(r.x)
    json.dump(dict(c=float(r.fun), p=p), open(f"best_{tag}.json", "w"), indent=1)
    log.write(json.dumps(dict(final=True, c=float(r.fun), p=p)) + "\n")
