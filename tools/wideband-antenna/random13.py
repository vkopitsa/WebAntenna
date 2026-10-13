"""Random search over family 13 (the "try any shape" step): sample the box uniformly in the FREE parameters
(the rest from X0, or the family's defaults), keep the buildable ones (box, clearances, frame spacing, NEC
collisions: a cheap check), and score them with NEC in 8 processes. Every sample goes to rand_<tag>.jsonl
(the same {t, c, x} lines as opt_cma.py's eval files), the best to best_<tag>.json: a seed for opt_cma.py.
  OMP_NUM_THREADS=1 FAMILY=family13 NCAGE=12 SIZE=0.040 FLO=960e6 SEG=2e-3 ABORT=12 X0=seed.json \\
    FREE=ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr,hf,ah,tw_f,tw_k python random13.py r40 200 1
  arguments: tag, number of buildable samples to score, random seed. SPREAD (default 1: the whole box) shrinks the
  sampling to +- SPREAD * range round X0."""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
import sys, json, time, importlib
import numpy as np
from multiprocessing import Pool

F = importlib.import_module(os.environ.get("FAMILY", "family13"))
tag = sys.argv[1]
want = int(sys.argv[2]) if len(sys.argv) > 2 else 200
seed = int(sys.argv[3]) if len(sys.argv) > 3 else 1
spread = float(os.environ.get("SPREAD", "1"))
t0 = time.time()
span = F.HI - F.LO


def f(x):
    c = F.cost(x)
    with open(f"rand_{tag}.jsonl", "a") as fh:
        fh.write(json.dumps(dict(t=round(time.time() - t0), c=c, x=[round(float(v), 6) for v in x])) + "\n")
    return c


if __name__ == "__main__":
    rng = np.random.default_rng(seed)
    dflt = getattr(F, "DEFAULTS", {})
    if os.environ.get("X0"):
        d = json.load(open(os.environ["X0"]))
        d = d.get("p", d)
        u0 = np.array([(min(max(d.get(k, dflt.get(k, lo)), lo), hi) - lo) / (hi - lo) for k, lo, hi in zip(F.NAMES, F.LO, F.HI)])
    else:
        u0 = np.array([(min(max(dflt.get(k, lo), lo), hi) - lo) / (hi - lo) for k, lo, hi in zip(F.NAMES, F.LO, F.HI)])
    names = os.environ.get("FREE", "").split(",") if os.environ.get("FREE") else list(F.NAMES)
    free = np.array([F.NAMES.index(k) for k in names])
    xs, tried = [], 0
    while len(xs) < want:
        u = u0.copy()
        u[free] = np.clip(u0[free] + spread * rng.uniform(-1, 1, len(free)), 0, 1) if spread < 1 else rng.uniform(0, 1, len(free))
        x = F.LO + u * span
        tried += 1
        if F.feasible(x):
            xs.append(x)
    print(f"{len(xs)} buildable of {tried} samples ({100 * len(xs) / tried:.0f} %) in {time.time() - t0:.0f} s", flush=True)
    best = (1e9, None)
    with Pool(int(os.environ.get("WORKERS", "8"))) as pool:
        for i, (x, c) in enumerate(zip(xs, pool.imap(f, xs))):
            if c < best[0]:
                best = (c, x)
                json.dump(dict(c=c, p=F.unpack(x)), open(f"best_{tag}.json", "w"), indent=1)
            if (i + 1) % 20 == 0:
                print(f"{i + 1}/{len(xs)}  best {best[0]:.3f}  {time.time() - t0:.0f} s", flush=True)
    print(f"done: best {best[0]:.3f} -> best_{tag}.json")
