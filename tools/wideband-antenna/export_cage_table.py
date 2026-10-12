"""Table for the web app's wire-cage type, same format as export_app_table.py but solved with NEC-2 (wirecage.py):
python export_cage_table.py <family> <design.json> <n_frames> <wire_r_mm> <f_lo> <f_hi> <n_freq> <out.json>
R/X (ohm) at the coax end and gain (dBi, mean over phi) at elevations -90..90 step 5 for frequencies log-spaced over
[0.9 f_lo, 1.1 f_hi]. Radiation-view currents: the total axial current of the n frames per frame segment (frame 0
times n, V = 1 at the port) on one fixed mesh (lambda / 12 at 1.1 f_hi), at 16 log-spaced frequencies."""
import sys, json, importlib
import numpy as np
import designs as D
import wirecage as W

fam = importlib.import_module(sys.argv[1])
p = json.load(open(sys.argv[2]))
p = p.get("p", p)
n, r = int(sys.argv[3]), float(sys.argv[4]) * 1e-3
f_lo, f_hi, nf = float(sys.argv[5]), float(sys.argv[6]), int(sys.argv[7])
els = np.arange(-90, 91, 5.0)
up, lo, zt, zb, rm = fam.profile(p)
out = dict(fLo=f_lo, fHi=f_hi, gap=p["g"], upper=[np.round(a, 6).tolist() for a in up],
           lower=[np.round(a, 6).tolist() for a in lo], els=els.tolist(), f=[], r=[], x=[], g=[],
           cage=dict(n=n, r=r, hub=W.HUB_R))
for f in D.logf(nf, 0.9 * f_lo, 1.1 * f_hi):
    z, gg = W.model(fam, p, f, n, r, per=30, els=els)
    g = 10 * np.log10(np.mean(10 ** (gg / 10), axis=1))[::-1]        # rows come theta-ascending = elevation descending
    out["f"].append(round(f / f_lo, 5)); out["r"].append(round(z.real, 2)); out["x"].append(round(z.imag, 2))
    out["g"].append(np.round(g, 2).tolist())
    print(f"{f/1e6:8.1f} MHz  Z {z.real:6.1f}{z.imag:+6.1f}j  swr {W.swr(z):.2f}  el 30 {g[24]:+.1f} dBi", flush=True)
seg = 3e8 / (1.1 * f_hi) / 12
out["cur"] = dict(seg=None, f=[], i=[])
for f in D.logf(16, 0.95 * f_lo, 1.05 * f_hi):
    info = {}
    W.model(fam, p, f, n, r, seg=seg, els=els, info=info)
    c = info["ctx"]
    c.xq_card(0)
    sc = c.get_structure_currents(0)
    tags, cur = np.array(sc.get_current_segment_tag()), np.array(sc.get_current())
    segs, ii = [], []
    for k, a, b in info["frame0"]:                 # NEC segments of each frame wire, from a to b
        idx = np.where(tags == k)[0]
        m = len(idx)
        for j, s in enumerate(idx):
            q0 = [a[t] + (b[t] - a[t]) * j / m for t in (0, 1)]
            q1 = [a[t] + (b[t] - a[t]) * (j + 1) / m for t in (0, 1)]
            segs.append([round(v, 6) for v in (*q0, *q1)])
            ii += [float(f"{v:.4g}") for v in (n * cur[s].real, n * cur[s].imag)]
    out["cur"]["seg"] = out["cur"]["seg"] or segs
    out["cur"]["f"].append(round(f / f_lo, 5))
    out["cur"]["i"].append(ii)
print("current segments", len(out["cur"]["seg"]))
json.dump(out, open(sys.argv[8], "w"))
