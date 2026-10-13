"""App table for a family-10 wire cage with a shorting wire (NEC-2), same JSON as export_cage_table.py:
python export_shaped_table.py <design.json> <f_lo> <f_hi> <n_freq> <out.json>
design.json: a family-10 dict (absolute units; a family-11 best_*.json is converted with SIZE from the environment).
Straight frames only (no twist, zigzag, legs or brim: the app's cage builder draws profile frames), plus `sh` shunts.
R/X at the coax end and gain (dBi, mean over 8 azimuth cuts: the shunt breaks the n-fold symmetry) at elevations
-90..90 step 5, frequencies log-spaced over [0.9 f_lo, 1.1 f_hi], NEC segments 1.5 mm (lambda / 30 at 6.7 GHz; the
shorting wire needs it at the bottom of the band, where lambda / 30 is 0.15 off in SWR). Radiation-view currents: frame 0
times n per frame segment, then the shunt's own segments (cage.short.k of them, single wires at cage.short.phi)."""
import sys, json, math
import numpy as np
import designs as D
import family2 as F2
import family10 as F10

d = json.load(open(sys.argv[1]))
p = d.get("p", d)
if "ru" in p:
    import family11 as F11
    p = F11.to_abs(p)
p = F10.full(p)
for k in ("tw_h", "tw_f", "tw_g", "tw_k", "mh", "mg", "Hf"):
    assert abs(p[k]) < 1e-9 or (k in ("mh", "mg") and p[k] < 0.3e-3), f"{k} = {p[k]}: the app draws straight frames"
assert int(p["leg"]) == 0, "legs are not drawn by the app"
f_lo, f_hi, nf = float(sys.argv[2]), float(sys.argv[3]), int(sys.argv[4])
n, r = F10.NCAGE, F10.RWIRE
b = F10.build(p)
els = np.arange(-90, 91, 5.0)
q = dict(p)
q["Sl"] = max(0.0, p["Sg"])
up, lo, zt, zb, rm = F2.profile(q)
short = None
if b["nsh"]:
    (r0, z0, _), (r1, z1, _) = b["shunt"]
    k_frame = n // b["nsh"] // 2
    short = dict(n=b["nsh"], rho=round(r0, 6), zHot=round(z0, 6), zGnd=round(z1, 6), frame=k_frame)
out = dict(fLo=f_lo, fHi=f_hi, gap=p["g"], upper=[np.round(a, 6).tolist() for a in up],
           lower=[np.round(a, 6).tolist() for a in lo], els=els.tolist(), f=[], r=[], x=[], g=[],
           cage=dict(n=n, r=r, hub=F10.HUB_R, **({"short": short} if short else {})))
for f in D.logf(nf, 0.9 * f_lo, 1.1 * f_hi):
    z, gg = F10.model(p, f, seg=1.5e-3, els=els, nphi=8)
    g = 10 * np.log10(np.mean(10 ** (gg / 10), axis=1))[::-1]        # rows come theta-ascending = elevation descending
    out["f"].append(round(f / f_lo, 5)); out["r"].append(round(z.real, 2)); out["x"].append(round(z.imag, 2))
    out["g"].append(np.round(g, 2).tolist())
    print(f"{f/1e6:8.1f} MHz  Z {z.real:6.1f}{z.imag:+6.1f}j  swr {F10.swr(z):.2f}  el 30 {g[24]:+.1f} dBi", flush=True)
seg = 3e8 / (1.1 * f_hi) / 12
out["cur"] = dict(seg=None, f=[], i=[])
for f in D.logf(16, 0.95 * f_lo, 1.05 * f_hi):
    info = {}
    F10.model(p, f, seg=seg, els=els, info=info)
    c = info["ctx"]
    c.xq_card(0)
    sc = c.get_structure_currents(0)
    tags, cur = np.array(sc.get_current_segment_tag()), np.array(sc.get_current())
    segs, ii, ks = [], [], 0
    picks = [(t, n) for t in info["frame0"]] + [(t + 1, 1) for t, w in enumerate(info["wires"]) if w[0] == "shunt"][:1]
    for tag, mult in picks:
        kind, a, bb, _ = info["wires"][tag - 1]
        a2 = (math.hypot(a[0], a[1]), a[2])
        b2 = (math.hypot(bb[0], bb[1]), bb[2])
        idx = np.where(tags == tag)[0]
        m = len(idx)
        for j, s in enumerate(idx):
            q0 = [a2[t] + (b2[t] - a2[t]) * j / m for t in (0, 1)]
            q1 = [a2[t] + (b2[t] - a2[t]) * (j + 1) / m for t in (0, 1)]
            segs.append([round(v, 6) for v in (*q0, *q1)])
            ii += [float(f"{v:.4g}") for v in (mult * cur[s].real, mult * cur[s].imag)]
            ks += mult == 1
    out["cur"]["seg"] = out["cur"]["seg"] or segs
    out["cur"]["f"].append(round(f / f_lo, 5))
    out["cur"]["i"].append(ii)
if short:
    out["cage"]["short"]["k"] = ks
print("current segments", len(out["cur"]["seg"]), "shunt segments", ks)
json.dump(out, open(sys.argv[5], "w"))
