"""Compare dense sweeps (sweep13.py JSON=... files) on what a detector gets from a small cage:
  python band13.py results/sweep_p40.json results/sweep_c40.json ... [--lo 960e6] [--hi 6.4e9]
One row per file: size and frames, SWR at the band's bottom, worst SWR over the band, the lowest frequency from
which the SWR stays <= 2 / 2.5 / 3, the mean mismatch loss -10 log10(1 - |G|^2) over the band's log grid (dB:
the average signal lost to the mismatch), and the mean 15-50 deg gain."""
import json
import sys
import numpy as np

opts = {a: b for a, b in zip(sys.argv[1:], sys.argv[2:]) if a.startswith("--")}
args = [a for i, a in enumerate(sys.argv[1:]) if not a.startswith("--") and (i == 0 or not sys.argv[i].startswith("--"))]
f_lo = float(opts.get("--lo", 960e6))
f_hi = float(opts.get("--hi", 6.4e9))


def covered(rows, lim):
    f0 = None
    for r in rows:
        if r["swr"] <= lim:
            f0 = f0 if f0 is not None else r["f"]
        else:
            f0 = None
    return f0


print(f"{'design':28s} {'D x H mm':>12s} {'n':>3s} {'SWR@lo':>7s} {'worst':>6s} {'<=2 from':>9s} {'<=2.5':>7s} {'<=3':>7s} "
      f"{'loss dB':>8s} {'gain':>6s}")
for fn in args:
    d = json.load(open(fn))
    rows = sorted(d["rows"], key=lambda r: r["f"])
    band = [r for r in rows if f_lo * 0.999 <= r["f"] <= f_hi * 1.001]
    s = np.array([r["swr"] for r in band])
    g = (s - 1) / (s + 1)
    loss = float(np.mean(-10 * np.log10(np.maximum(1e-9, 1 - g ** 2))))
    gain = float(np.mean([r["g"] for r in band]))
    at_lo = min(band, key=lambda r: abs(r["f"] - f_lo))["swr"]
    cov = [covered(band, lim) for lim in (2.0, 2.5, 3.0)]
    name = fn.split("/")[-1].replace("sweep_", "").replace(".json", "")
    print(f"{name:28s} {d['D']*1e3:5.1f} x {d['H']*1e3:4.1f} {d.get('ncage', 16):3d} {at_lo:7.2f} {s.max():6.2f} "
          + " ".join(f"{(c/1e6):7.0f}  " if c else "  never  " for c in cov)
          + f"{loss:8.2f} {gain:+6.1f}")
