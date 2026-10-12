"""FDTD vs MoM for a family design: Z sweep + elevation patterns.  python fdtd_verify.py <family> <json-file> <cable_m> <out.json>"""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "4")
import sys, json, math, importlib
import numpy as np
import fdtd_run as FR, bor, designs as D

fam = importlib.import_module(sys.argv[1]); p = json.load(open(sys.argv[2])); Lc = float(sys.argv[3])
F_LO = float(os.environ.get("F_LO", "300e6"))
fs = list(D.logf(36, F_LO, 6.4e9))
nff = [f for f in [433e6, 915e6, 1.25e9, 2.44e9, 3.3e9, 5.8e9] if f >= F_LO]
shells = json.loads(os.environ["SHELLS"]) if os.environ.get("SHELLS") else ()
Z, info = FR.run(p, Lc, fs + nff, nf_freqs=nff, fam=fam, margin=float(os.environ.get("MARGIN", "0.25")), shells=shells)
res = dict(info={k: (v if not isinstance(v, np.ndarray) else v.tolist()) for k, v in info.items() if k not in ("gain", "theta")}, rows=[], pat=[])
print({k: v for k, v in info.items() if k not in ("gain", "theta")})
print("  f MHz |  FDTD R     X    SWR |   MoM R     X    SWR")
for f, z in zip(fs, Z[:len(fs)]):
    me = bor.build_mesh(fam.geometry(p, cable=Lc), f, per_lambda=24); s = bor.solve(me)
    res["rows"].append(dict(f=f, fdtd=[z.real, z.imag], mom=[s.Z.real, s.Z.imag]))
    print(f"{f/1e6:7.1f} | {z.real:6.1f} {z.imag:6.1f} {bor.swr(z):5.2f} | {s.Z.real:6.1f} {s.Z.imag:6.1f} {bor.swr(s.Z):5.2f}")
els = np.array([0, 15, 30, 50, 70])
for q, f in enumerate(nff):
    me = bor.build_mesh(fam.geometry(p, cable=Lc), f, per_lambda=24); s = bor.solve(me)
    gm = bor.gain_dbi(s, np.radians(90 - els))
    gf = np.interp(90 - els, np.degrees(info["theta"]), info["gain"][q])
    res["pat"].append(dict(f=f, els=els.tolist(), fdtd=gf.tolist(), mom=gm.tolist(), prad=float(info["prad_ratio"][q])))
    print(f"{f/1e6:7.0f} MHz el {els.tolist()}  FDTD {np.round(gf,1).tolist()}  MoM {np.round(gm,1).tolist()}  FDTD Prad/Pacc {info['prad_ratio'][q]:.3f}")
json.dump(res, open(sys.argv[4], "w"), indent=1)
