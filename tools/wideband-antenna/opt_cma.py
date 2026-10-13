"""CMA-ES from a seed design in the family's box-normalised space (each parameter mapped to [0, 1] by its bounds),
8 worker processes. Better than DE for a ~25-dimensional search that starts from a good design: it adapts its
step sizes and correlations instead of waiting for a random population to find the good region.
Every evaluation goes to eval_<tag>.jsonl, the best so far to best_<tag>.json after each generation.
FREE (comma-separated names): search only those, the rest stay at the seed's values.
  FAMILY=family11 SIZE=0.066 X0=seed.json SIGMA=0.12 POP=16 python opt_cma.py c66 120 1"""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
import sys, json, time, importlib
import numpy as np
from multiprocessing import Pool
import cma

F = importlib.import_module(os.environ.get("FAMILY", "family11"))
tag = sys.argv[1]
maxiter = int(sys.argv[2]) if len(sys.argv) > 2 else 120
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
t0 = time.time()
span = F.HI - F.LO


FREE = None
U0 = None


def full_u(v):
    u = U0.copy()
    u[FREE] = v
    return u


def f(v):
    u = full_u(np.asarray(v))
    x = F.LO + np.clip(u, 0, 1) * span
    c = F.cost(x)
    c += 10 * float(np.sum(np.maximum(0, -u) + np.maximum(0, u - 1)))      # outside the bounds: pull back
    with open(f"eval_{tag}.jsonl", "a") as fh:
        fh.write(json.dumps(dict(t=round(time.time() - t0), c=c, x=[round(float(v), 6) for v in x])) + "\n")
    return c


if __name__ == "__main__":
    d = json.load(open(os.environ["X0"]))
    d = d.get("p", d)
    u0 = np.array([(min(max(d[k], lo), hi) - lo) / (hi - lo) for k, lo, hi in zip(F.NAMES, F.LO, F.HI)])
    names = os.environ.get("FREE", "").split(",") if os.environ.get("FREE") else list(F.NAMES)
    globals()["FREE"] = np.array([F.NAMES.index(k) for k in names])
    globals()["U0"] = u0
    es = cma.CMAEvolutionStrategy(u0[FREE], float(os.environ.get("SIGMA", "0.12")),
                                  dict(popsize=int(os.environ.get("POP", "16")), seed=seed, maxiter=maxiter, verbose=-9))
    best = (1e9, None)
    with Pool(int(os.environ.get("WORKERS", "8"))) as pool:
        while not es.stop():
            U = es.ask()
            C = pool.map(f, U)
            es.tell(U, C)
            i = int(np.argmin(C))
            if C[i] < best[0]:
                best = (C[i], F.LO + np.clip(full_u(U[i]), 0, 1) * span)
                json.dump(dict(c=best[0], p=F.unpack(best[1])), open(f"best_{tag}.json", "w"), indent=1)
            with open(f"opt_{tag}.jsonl", "a") as log:
                log.write(json.dumps(dict(t=round(time.time() - t0), it=es.countiter, c=float(C[i]), best=best[0],
                                          sigma=float(es.sigma), median=float(np.median(C)))) + "\n")
