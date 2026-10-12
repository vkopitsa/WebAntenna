"""Validation 1: thin tube dipole, BoR-MoM vs NEC-2 (PyNEC); energy conservation."""
import math, time
import numpy as np
import bor
from PyNEC import nec_context

a, h = 1e-3, 0.25
geo = bor.Geometry([("lo", [(a, -h), (a, 0.0)]), ("hi", [(a, 0.0), (a, h)])], dict(kind="gap", at=(a, 0.0)))

def nec_dipole(f, nseg=101):
    c = nec_context()
    g = c.get_geometry()
    g.wire(1, nseg, 0, 0, -h, 0, 0, h, a, 1, 1)
    c.geometry_complete(0)
    c.ex_card(0, 1, nseg // 2 + 1, 0, 1.0, 0, 0, 0, 0, 0)
    c.fr_card(0, 1, f / 1e6, 0)
    c.rp_card(0, 1, 1, 0, 5, 0, 0, 90, 0, 0, 0, 0, 0)
    ip = c.get_input_parameters(0)
    z = ip.get_impedance()[0]
    gmax = float(np.max(c.get_radiation_pattern(0).get_gain()))
    return z, gmax

t = time.time()
for f in [250e6, 280e6, 300e6, 320e6, 600e6, 900e6]:
    me = bor.build_mesh(geo, f, per_lambda=40, h_feed=2e-3, grow=0.3)
    s = bor.solve(me)
    gb = bor.gain_dbi(s, np.array([math.pi / 2]))[0]
    zn, gn = nec_dipole(f)
    print(f"{f/1e6:6.0f} MHz  BoR Z={s.Z.real:7.2f}{s.Z.imag:+8.2f}j  G={gb:5.2f}  Prad/Pin={bor.prad_check(s):.4f}  N={me.nb} | NEC Z={zn.real:7.2f}{zn.imag:+8.2f}j G={gn:5.2f}")
print("time", time.time() - t)
