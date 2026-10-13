"""Sweep a family-12 design (box-normalised, needs the same SIZE as its search) in parallel over frequencies:
SIZE=0.060 SEG=2e-3 python sweep12.py results/best_sp60b.json 48 912e6 6.6e9 [key=value ...]
Prints SWR, R+jX and the mean 15-50 deg gain per frequency and the worst SWR from 960 MHz and from f_lo."""
import os
os.environ.setdefault("OMP_NUM_THREADS", "1")
import sys, json
import numpy as np
from multiprocessing import Pool
import family12 as F
import family10 as F10

d = json.load(open(sys.argv[1]))
q = d.get("p", d)
args = [a for a in sys.argv[2:] if "=" not in a]
for a in sys.argv[2:]:
    if "=" in a:
        k, v = a.split("=")
        q[k] = float(v)
P = F.to_abs(q)
SEG = float(os.environ.get("SEG", "2e-3"))


def one(f):
    z, gg = F10.model(P, f, seg=SEG)
    g = 10 * np.log10(np.mean(10 ** (gg / 10)))
    return f, z, F10.swr(z), g


if __name__ == "__main__":
    nf = int(args[0]) if args else 48
    fs = np.geomspace(float(args[1]) if len(args) > 1 else 912e6, float(args[2]) if len(args) > 2 else 6.6e9, nf)
    H, D = F.size(P)
    print(f"size: D {D*1e3:.1f} x H {H*1e3:.1f} mm, wires {len(F.wire_list(F.build(P)))}")
    with Pool(8) as pool:
        rows = pool.map(one, fs)
    for f, z, s, g in rows:
        print(f"{f/1e6:7.0f} MHz  Z {z.real:6.1f}{z.imag:+6.1f}j  SWR {s:5.2f}  gain 15-50 {g:+.1f} dBi")
    print(f"worst SWR {max(r[2] for r in rows):.2f}; from 960 MHz {max(r[2] for r in rows if r[0] >= 960e6):.2f}; "
          f"mean sky gain {np.mean([r[3] for r in rows]):+.2f} dBi")
