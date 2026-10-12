"""One-at-a-time sensitivity: python sens.py <family> <json-file> <f_lo>"""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
import sys, json, importlib
import numpy as np
from multiprocessing import Pool
import designs as D
fam = importlib.import_module(sys.argv[1]); p0 = json.load(open(sys.argv[2])); F_LO = float(sys.argv[3])
FS = D.logf(34, F_LO, 6.4e9)
STEPS = {"g": 0.5e-3, "r0u": 1e-3, "au1": 3.0, "L1": 2e-3, "au2": 3.0, "Ru": 2e-3, "Hcu": 2e-3, "al1": 3.0, "al2": 3.0, "Rl": 2e-3}
cases = [("nominal", p0)]
for k, d in STEPS.items():
    if k not in p0: continue
    for sgn in (-1, 1):
        q = dict(p0); q[k] = p0[k] + sgn * d
        if k in ("al1", "al2") and p0.get("al1") == p0.get("al2"):   # single ground cone: move both
            q["al1"] = q["al2"] = p0["al1"] + sgn * d
        cases.append((f"{k} {'+' if sgn > 0 else '-'}{d*1e3 if d < 1 else d:g}{' mm' if d < 1 else '°'}", q))
def run(c):
    name, q = c
    rows = D.evaluate(fam.geometry(q), FS, per_lambda=14)
    s = np.array([r["swr"] for r in rows])
    lo, mid, hi = s[FS < 1.5e9].max(), s[(FS >= 1.5e9) & (FS < 4e9)].max(), s[FS >= 4e9].max()
    return name, lo, mid, hi
with Pool(8) as pool:
    for name, lo, mid, hi in pool.map(run, cases):
        print(f"{name:14s}  worst SWR  <1.5 GHz {lo:4.2f}   1.5-4 GHz {mid:4.2f}   4-6.4 GHz {hi:4.2f}")
