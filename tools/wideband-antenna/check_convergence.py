import numpy as np, designs as D, time
geo = D.cone_over_ground(0.27, 30, 3e-3, 0.095, cable=0.3, choke=(-0.03, 200.0))
fs = [300e6, 1000e6, 2400e6, 5800e6, 6400e6]
for pl, hf, gr in [(12, 0.3e-3, 0.25), (16, 0.3e-3, 0.25), (24, 0.3e-3, 0.25), (40, 0.3e-3, 0.25), (24, 0.15e-3, 0.15), (40, 0.1e-3, 0.1)]:
    t = time.time(); rows = D.evaluate(geo, fs, per_lambda=pl, h_feed=hf, grow=gr)
    print(f"pl={pl:3d} hf={hf*1e3:.2f}mm grow={gr}: " + " | ".join(f"{r['Z'].real:6.1f}{r['Z'].imag:+6.1f}j N={r['n']:3d} g30={r['g'][2]:5.2f}" for r in rows), f" t={time.time()-t:.1f}")
