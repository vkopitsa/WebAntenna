"""Family v9: the v6 profile built as a WIRE CAGE (wirecage.py, NEC-2): NCAGE frames of Ø2·RWIRE wire with hoops
at the kinks, hub rings at the washer / lid / ground apex and a wire up the axis. No cable (add a ferrite sleeve
as for S73). Environment: NCAGE (12), RWIRE (m, 0.5e-3), FLO (lowest frequency incl. margin, 912e6), SIZE (m).
  NCAGE=12 FLO=912e6 SIZE=0.075 FAMILY=family9 X0=designs/S73.json POP=10 python opt.py w12 20 1"""
import json
import os
import subprocess
import sys
import numpy as np
import designs as D
import family6 as F6
import wirecage as W

NCAGE = int(os.environ.get("NCAGE", "12"))
RWIRE = float(os.environ.get("RWIRE", "0.5e-3"))
FLO = float(os.environ.get("FLO", "912e6"))
HMAX, DMAX = F6.HMAX, F6.DMAX
PARAMS, NAMES, LO, HI = F6.PARAMS, F6.NAMES, F6.LO, F6.HI
unpack, profile, geometry, size = F6.unpack, F6.profile, F6.geometry, F6.size
FS_MAIN = D.logf(20, FLO, 6.6e9)
ELS = W.ELS


def evaluate(p, fs=None):
    H, Dm = size(p)
    rows = []
    for f in (FS_MAIN if fs is None else fs):
        z, gg = W.model(__import__(__name__), p, f, NCAGE, RWIRE)
        g = 10 * np.log10(np.mean(10 ** (gg / 10), axis=1))       # mean over phi per elevation
        rows.append(dict(f=f, z=z, swr=W.swr(z), g=g.tolist()))
    return dict(H=H, D=Dm, main=rows, swr_main=max(r["swr"] for r in rows), swr_cab=0.0, swr_nochoke=0.0)


def cost_of(res):
    return F6.cost_of(res)


def cost(x):
    p = unpack(x)
    H, Dm = size(p)
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    # each candidate in its own process with a hard timeout: a degenerate geometry can stall NEC inside C++
    try:
        r = subprocess.run([sys.executable, os.path.abspath(__file__), json.dumps(p)], capture_output=True, text=True,
                           timeout=90, env=os.environ, cwd=os.path.dirname(os.path.abspath(__file__)))
        return float(r.stdout.strip().splitlines()[-1])
    except Exception:
        return 100.0


if __name__ == "__main__":
    try:
        print(cost_of(evaluate(json.loads(sys.argv[1]))))
    except Exception:
        print(100.0)
