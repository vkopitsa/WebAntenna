"""Detailed report for one design: python report.py <family> '<json params>' [per_lambda] [npts]"""
import sys, json, importlib
import numpy as np
import bor, designs as D

fam = importlib.import_module(sys.argv[1])
p = json.loads(sys.argv[2])
pl = float(sys.argv[3]) if len(sys.argv) > 3 else 20
n = int(sys.argv[4]) if len(sys.argv) > 4 else 60
F_LO = float(sys.argv[5]) if len(sys.argv) > 5 else 300e6
H, Dm = fam.size(p)
print(f"height {H*1000:.1f} mm, diameter {Dm*1000:.1f} mm")
fs = D.logf(n, 0.95 * F_LO, 6.6e9)
els = (0, 10, 15, 25, 35, 50, 70)
rows = D.evaluate(fam.geometry(p), fs, per_lambda=pl, els=els)
print("NO CABLE (ideal choke)")
D.show(rows, els)
print(f"worst SWR {F_LO/1e6:.0f} MHz-6.4 GHz:", max(r["swr"] for r in rows if 0.999 * F_LO <= r["f"] <= 6.41e9))
fl = D.logf(30, 0.95 * F_LO, 3.3 * F_LO)
print("\nLOW BAND WITH CABLE:            " + " ".join(f"{f/1e6:4.0f}" for f in fl[::2]))
for Lc in (0.05, 0.1, 0.2, 0.35, 0.5, 1.0):
    for ch in (None, (0.01, 150.0)):
        rr = bor.run(fam.geometry(p, cable=Lc, choke=ch), fl, per_lambda=pl, pattern=False)
        lab = f"cable {Lc*100:3.0f} cm {'+150R ferrite' if ch else 'no ferrite  '}"
        print(f"{lab:31s} " + " ".join(f"{r['swr']:4.1f}" for r in rr[::2]) + f"   max {max(r['swr'] for r in rr if r['f']>=0.999*F_LO):.2f}")
