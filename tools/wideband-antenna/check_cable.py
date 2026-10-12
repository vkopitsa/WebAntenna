import numpy as np, designs as D
fs = D.logf(16, 300e6, 1500e6)
def brief(title, geo):
    rows = D.evaluate(geo, fs)
    print(f"{title:55s} " + " ".join(f"{r['swr']:4.1f}" for r in rows))
print(" " * 56 + " ".join(f"{f/1e6:4.0f}" for f in fs))
brief("classic discone, no cable", D.discone(0.27, 30, 0.095, 3e-3))
for Lc in (0.15, 0.30, 0.60):
    brief(f"classic discone, cable inside cone + {Lc*100:.0f} cm below", D.discone(0.27, 30, 0.095, 3e-3, cable=0.234 + Lc))
brief("inverted, no cable", D.cone_over_ground(0.27, 30, 3e-3, 0.095))
for Lc in (0.15, 0.30, 0.60):
    brief(f"inverted, cable {Lc*100:.0f} cm", D.cone_over_ground(0.27, 30, 3e-3, 0.095, cable=Lc))
    brief(f"inverted, cable {Lc*100:.0f} cm + 200R ferrite @3cm", D.cone_over_ground(0.27, 30, 3e-3, 0.095, cable=Lc, choke=(-0.03, 200.0)))
