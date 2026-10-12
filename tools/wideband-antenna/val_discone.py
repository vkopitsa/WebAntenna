"""Validation 2: discone, BoR (solid) vs NEC-2 cage of radial rods (m = 0 currents are radial)."""
import math, time, sys
import numpy as np
import bor
from PyNEC import nec_context

L, half, Dd, g, a = 0.25, math.radians(30), 0.175, 5e-3, 1e-3
Rc, Hc = L * math.sin(half), L * math.cos(half)
geo = bor.Geometry([
    ("cone", [(Rc, -Hc), (a, 0.0)]),
    ("pinlo", [(a, 0.0), (a, g / 2)]),
    ("pinhi", [(a, g / 2), (a, g)]),
    ("disc", [(a, g), (Dd / 2, g)]),
], dict(kind="gap", at=(a, g / 2)))

def nec_discone(f, n=64, r=0.8e-3, per=30):
    c = nec_context()
    G = c.get_geometry()
    lam = 3e8 / f
    nc = max(5, int(math.ceil(L / (lam / per))))
    nd = max(3, int(math.ceil(Dd / 2 / (lam / per))))
    G.wire(1, 3, 0, 0, 0, 0, 0, g, a, 1, 1)
    for i in range(n):
        t = 2 * math.pi * i / n
        G.wire(2 + i, nc, 0, 0, 0, Rc * math.cos(t), Rc * math.sin(t), -Hc, r, 1, 1)
        G.wire(2 + n + i, nd, 0, 0, g, Dd / 2 * math.cos(t), Dd / 2 * math.sin(t), g, r, 1, 1)
    c.geometry_complete(0)
    c.ex_card(0, 1, 2, 0, 1.0, 0, 0, 0, 0, 0)
    c.fr_card(0, 1, f / 1e6, 0)
    c.rp_card(0, 19, 1, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0)     # PyNEC order: theta0, phi0, dtheta, dphi
    z = c.get_input_parameters(0).get_impedance()[0]
    gg = np.array(c.get_radiation_pattern(0).get_gain()).ravel()
    return z, gg

fs = [float(x) for x in sys.argv[1:]] or [250e6, 300e6, 400e6, 600e6, 900e6, 1200e6]
for f in fs:
    t = time.time()
    me = bor.build_mesh(geo, f, per_lambda=30, h_feed=0.5e-3, grow=0.25)
    s = bor.solve(me)
    th = np.radians(np.arange(0, 181, 10))
    gb = bor.gain_dbi(s, th)
    tb = time.time() - t
    zn, gn = nec_discone(f)
    print(f"{f/1e6:6.0f} MHz BoR Z={s.Z.real:7.2f}{s.Z.imag:+8.2f}j SWR={bor.swr(s.Z):5.2f} P={bor.prad_check(s):.4f} N={me.nb} t={tb:.1f}s | NEC Z={zn.real:7.2f}{zn.imag:+8.2f}j SWR={bor.swr(zn):5.2f}")
    print("   el(+90..-90 by 10) BoR:", " ".join(f"{x:5.1f}" for x in gb))
    print("                      NEC:", " ".join(f"{x:5.1f}" for x in gn))
