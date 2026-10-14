"""Ideal lossless ladders with a double-tuning branch on a cage's unmatched impedance (the split study, antenna A):
matchbound.py's single L / C elements plus a shunt branch of L and C in series (a second resonance across the port).
  python dtune.py results/sweepA_seed45_nosh.json [results/sweepA_seed50_nosh.json ...]
Each file is a sweep13.py JSON of the cage with sh=0; the band is 960 MHz - 1.36 GHz. Result (seed shape, scaled):
shunt L alone 7.9 / 3.7 at 45 / 50 mm, shunt L + series C 4.0 / 2.8, shunt L + series C + shunt L-C 2.8 / 1.94 -
the ladder family 13 builds with sh = 2, csh (the C in every second shunt wire) and cser (the C in the pin)."""
import json, sys, numpy as np
from scipy.optimize import differential_evolution
Z0=50.0
def run(path):
    d=json.load(open(path)); rows=[r for r in d["rows"] if 0.96e9*0.999<=r["f"]<=1.36e9*1.001]
    f=np.array([r["f"] for r in rows]); Z=np.array([r["r"]+1j*r["x"] for r in rows]); w=2*np.pi*f
    def swr(z):
        g=np.abs((z-Z0)/(z+Z0)); return (1+g)/(1-g)
    def X(kind,v): return 1j*w*10**v*1e-9 if kind=="L" else 1/(1j*w*10**v*1e-12)
    def apply(topo,vals):
        z=Z.copy(); i=0
        for place,kinds in topo:
            x=sum(X(k,vals[i+j]) for j,k in enumerate(kinds)); i+=len(kinds)   # elements in one branch in series
            z = z+x if place=="series" else 1/(1/z+1/x)
        return z
    topos={"shL":[("shunt","L")],
           "shL,seC":[("shunt","L"),("series","C")],
           "seC,shL":[("series","C"),("shunt","L")],
           "shL,seC,shL":[("shunt","L"),("series","C"),("shunt","L")],
           "sh(LC),seC":[("shunt","LC"),("series","C")],
           "seC,sh(LC)":[("series","C"),("shunt","LC")],
           "shL,seC,sh(LC)":[("shunt","L"),("series","C"),("shunt","LC")],
           "seL,shL,seC":[("series","L"),("shunt","L"),("series","C")],
           "shL,seC,shL,seC":[("shunt","L"),("series","C"),("shunt","L"),("series","C")],
           "sh(LC),seC,shL":[("shunt","LC"),("series","C"),("shunt","L")]}
    print(path.split('/')[-1], "unmatched", round(swr(Z).max(),1))
    for name,topo in topos.items():
        kinds=[k for _,ks in topo for k in ks]
        b=[(0.0,2.0) if k=="L" else (-1.0,1.7) for k in kinds]
        r=differential_evolution(lambda v: swr(apply(topo,v)).max(), b, seed=1, tol=1e-7, maxiter=400, popsize=30, polish=True)
        vals=" ".join(f"{10**v:.1f}{'nH' if k=='L' else 'pF'}" for v,k in zip(r.x,kinds))
        print(f"  {name:18s} worst SWR {r.fun:.2f}   {vals}")
for p in sys.argv[1:]: run(p)
