"""Table for the web app (src/lib/antennas/cappedbicone.data.ts):
python export_app_table.py <family> <design.json> <f_lo> <f_hi> <n_freq> <out.json>
Writes the (rho, z) profile (m), R/X (ohm) and gain (dBi) at elevations -90..90 step 5 for frequencies
log-spaced over [0.9 f_lo, 1.1 f_hi]; the app scales everything by f_lo / its band's lowest frequency."""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "8")
import sys, json, importlib
import numpy as np
import bor, designs as D

fam = importlib.import_module(sys.argv[1])
p = json.load(open(sys.argv[2]))
f_lo, f_hi, n = float(sys.argv[3]), float(sys.argv[4]), int(sys.argv[5])
els = np.arange(-90, 91, 5.0)
fs = D.logf(n, 0.9 * f_lo, 1.1 * f_hi)
up, lo, zt, zb, rm = fam.profile(p)
out = dict(fLo=f_lo, fHi=f_hi, gap=p["g"], upper=[np.round(a, 6).tolist() for a in up],
           lower=[np.round(a, 6).tolist() for a in lo], els=els.tolist(), f=[], r=[], x=[], g=[])
for f in fs:
    s = bor.solve(bor.build_mesh(fam.geometry(p), f, per_lambda=24))
    out["f"].append(round(f / f_lo, 5)); out["r"].append(round(s.Z.real, 2)); out["x"].append(round(s.Z.imag, 2))
    out["g"].append(np.round(bor.gain_dbi(s, np.radians(90 - els)), 2).tolist())
    print(f"{f/1e6:8.1f} MHz  Z {s.Z.real:6.1f}{s.Z.imag:+6.1f}j  swr {bor.swr(s.Z):.2f}", flush=True)
# surface currents for the Radiation view: one fixed mesh (λ/12 at the top), solved at 16 log-spaced frequencies;
# per segment (ρ0, z0, ρ1, z1) and the total axial current at its middle (V = 1 at the port), aperture excluded
me = bor.build_mesh(fam.geometry(p), 1.1 * f_hi, per_lambda=12)
keep = [s for s in range(len(me.L)) if me.tags[s] != "feed"]
out["cur"] = dict(seg=[[round(float(v), 6) for v in (me.r0[s], me.z0[s], me.r1[s], me.z1[s])] for s in keep], f=[], i=[])
for f in D.logf(16, 0.95 * f_lo, 1.05 * f_hi):
    me.f = f
    sol = bor.solve(me)
    c0, c1 = bor.seg_currents(sol)
    im = c0 + 0.5 * c1
    out["cur"]["f"].append(round(f / f_lo, 5))
    out["cur"]["i"].append([float(f"{v:.4g}") for s in keep for v in (im[s].real, im[s].imag)])
print("current segments", len(keep))
json.dump(out, open(sys.argv[6], "w"))
