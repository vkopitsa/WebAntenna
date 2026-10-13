"""Sweep a family-13 design (box-normalised: needs the same SIZE and NCAGE as its search) in parallel over
frequencies, 8 processes:
  SIZE=0.040 NCAGE=12 SEG=2e-3 python sweep13.py results/best_t40.json 48 912e6 6.6e9 [key=value ...]
key=value overrides a parameter (tw_f=0 straightens the brim, th=0 removes the hot coils, ...). Prints SWR, R+jX
and the mean 15-50 deg gain per frequency, the worst SWR from 960 MHz, and the lowest frequency from which the
SWR stays under 2 / 2.5 / 3 (the band a small cage really covers). JSON=out.json also writes the rows."""
import os
os.environ.setdefault("OMP_NUM_THREADS", "1")
import sys, json, time
import numpy as np
from multiprocessing import Pool
import family13 as F
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
    t = time.time()
    z, gg = F10.model(P, f, seg=SEG)
    g = 10 * np.log10(np.mean(10 ** (gg / 10)))
    return f, z, F10.swr(z), g, time.time() - t


def covered(rows, lim):
    """Lowest frequency from which every sweep point stays under lim (None: never)."""
    f0 = None
    for f, _, s, _, _ in sorted(rows):
        if s <= lim:
            f0 = f0 if f0 is not None else f
        else:
            f0 = None
    return f0


if __name__ == "__main__":
    nf = int(args[0]) if args else 48
    fs = np.geomspace(float(args[1]) if len(args) > 1 else 912e6, float(args[2]) if len(args) > 2 else 6.6e9, nf)
    H, D = F.size(P)
    wires = F.wire_list(F.build(P))
    print(f"size: D {D*1e3:.1f} x H {H*1e3:.1f} mm, {F10.NCAGE} frames, {len(wires)} wires, "
          f"wire {sum(np.linalg.norm(np.subtract(w[2], w[1])) for w in wires)*1e3:.0f} mm")
    with Pool(8) as pool:
        rows = pool.map(one, fs)
    for f, z, s, g, t in rows:
        print(f"{f/1e6:7.0f} MHz  Z {z.real:6.1f}{z.imag:+6.1f}j  SWR {s:5.2f}  gain 15-50 {g:+.1f} dBi  ({t:.1f} s)")
    hi = [r for r in rows if r[0] >= 960e6]
    print(f"worst SWR {max(r[2] for r in rows):.2f}; from 960 MHz {max(r[2] for r in hi):.2f}; "
          f"mean sky gain {np.mean([r[3] for r in rows]):+.2f} dBi")
    for lim in (2.0, 2.5, 3.0):
        f0 = covered(rows, lim)
        print(f"SWR <= {lim}: " + (f"from {f0/1e6:.0f} MHz" if f0 else "never"))
    if os.environ.get("JSON"):
        json.dump(dict(H=H, D=D, ncage=F10.NCAGE, p=q,
                       rows=[dict(f=f, r=z.real, x=z.imag, swr=s, g=g) for f, z, s, g, _ in rows]),
                  open(os.environ["JSON"], "w"), indent=1)
