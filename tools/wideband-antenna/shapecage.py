"""Sweep a family-10 (shaped wire cage) design with NEC-2, like wirecage.py:
python shapecage.py <design.json> [n_freq=24] [f_lo=960e6] [f_hi=6.4e9] [per=20 | segment length in m] [key=value ...]
key=value overrides design parameters (e.g. tw_h=60 Hf=0.01); prints SWR and the 15-50 deg gain per frequency,
the worst SWR, the size and the family-10 cost over the same points."""
import sys, json
import numpy as np
import family10 as F

p = json.load(open(sys.argv[1]))
p = F.full(p.get("p", p))
args = [a for a in sys.argv[2:] if "=" not in a]
for a in sys.argv[2:]:
    if "=" in a:
        k, v = a.split("=")
        p[k] = float(v)
nf = int(args[0]) if len(args) > 0 else 24
f_lo = float(args[1]) if len(args) > 1 else 960e6
f_hi = float(args[2]) if len(args) > 2 else 6.4e9
per = float(args[3]) if len(args) > 3 else 20      # < 1: a fixed segment length in metres
H, Dm = F.size(p)
print(f"size: D {Dm*1e3:.1f} x H {H*1e3:.1f} mm, hot/ground clearance {F.clearance(F.build(p))*1e3:.1f} mm")
res = F.evaluate(p, np.geomspace(f_lo, f_hi, nf), per=20, seg=per) if per < 1 else F.evaluate(p, np.geomspace(f_lo, f_hi, nf), per=per, seg=None)
for r in res["main"]:
    z, g = r["z"], np.array(r["g"])
    gavg = 10 * np.log10(np.mean(10 ** (g / 10)))
    print(f"{r['f']/1e6:7.0f} MHz  Z {z.real:6.1f}{z.imag:+6.1f}j  SWR {r['swr']:5.2f}  gain 15-50 deg mean {gavg:+.1f}, min {g.min():+.1f} dBi")
gs = [10 * np.log10(np.mean(10 ** (np.array(r["g"]) / 10))) for r in res["main"]]
print(f"worst SWR {res['swr_main']:.2f}, mean sky gain {np.mean(gs):+.2f} dBi, cost {F.cost_of(res):.3f}")
