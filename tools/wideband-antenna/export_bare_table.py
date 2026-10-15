"""Bare-coax tables for the web app's "no ferrite" option of the sky-tilted bicones: the antenna with its coax jacket
hanging down the axis (no ferrite, no choke sleeve), R/X at the coax end for three cable lengths.
  python export_bare_table.py solid <family> <design.json> <f_lo> <f_hi> <n_freq> <out.json>   (body of revolution)
  python export_bare_table.py cage  -        <design.json> <f_lo> <f_hi> <n_freq> <out.json>   (NEC-2, family 10)
Cable lengths are 0.5, 0.8 and 1.1 wavelengths at f_lo (15, 25 and 35 cm at 960 MHz, the study's cases), so they scale
with the design in the app. LENS_M=0.15,0.25,0.35 uses fixed lengths instead (to compare with the study's logs).
Frequencies are log-spaced over [0.9 f_lo, 1.1 f_hi] like the free-space table. Solid: per_lambda 24, the cable
measured from below the ground cone (family2.geometry). Cage: 1.5 mm segments, the cable from the coax end
(family10.model), cable segments min(5 mm, lambda / 20). Runs on 8 processes; the cage takes ~10 s per point.
Then: python to_ts.py --bare app_X.json bare_X.json (prints the `bare` block to put into that table's entry)."""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "1")
os.environ.setdefault("OMP_NUM_THREADS", "1")
import sys, json, importlib
from multiprocessing import Pool
import designs as D

KIND, FAM, DESIGN = sys.argv[1], sys.argv[2], sys.argv[3]
F_LO, F_HI, NF, OUT = float(sys.argv[4]), float(sys.argv[5]), int(sys.argv[6]), sys.argv[7]
LAMS = (0.5, 0.8, 1.1)
LENS = [float(v) for v in os.environ["LENS_M"].split(",")] if os.environ.get("LENS_M") else [k * 3e8 / F_LO for k in LAMS]
FS = list(D.logf(NF, 0.9 * F_LO, 1.1 * F_HI))


def load():
    p = json.load(open(DESIGN))
    p = p.get("p", p)
    if KIND == "cage":
        import family10 as F10
        if "ru" in p:
            import family11 as F11
            p = F11.to_abs(p)
        p = F10.full(p)
    return p


def job(task):
    L, f = task
    p = load()
    if KIND == "solid":
        import bor
        fam = importlib.import_module(FAM)
        s = bor.solve(bor.build_mesh(fam.geometry(p, cable=L), f, per_lambda=24))
        z = s.Z
    else:
        import family13  # noqa: F401  (coiled shunts, csh / cser of A55)
        import family10 as F10
        z, _ = F10.model(p, f, seg=1.5e-3, cable=L, cable_seg=min(5e-3, 3e8 / f / 20))
    return L, f, complex(z)


if __name__ == "__main__":
    tasks = [(L, f) for L in LENS for f in FS]
    res = {}
    with Pool(8) as pl:
        for L, f, z in pl.imap_unordered(job, tasks):
            res[(L, f)] = z
            print(f"L {L*100:5.1f} cm  {f/1e6:8.1f} MHz  Z {z.real:7.1f}{z.imag:+7.1f}j  ({len(res)}/{len(tasks)})", flush=True)
    out = dict(fLo=F_LO, lensM=[round(L, 5) for L in LENS], lensLam=None if os.environ.get("LENS_M") else list(LAMS),
               f=[round(f / F_LO, 5) for f in FS],
               r=[[round(res[(L, f)].real, 1) for f in FS] for L in LENS],
               x=[[round(res[(L, f)].imag, 1) for f in FS] for L in LENS])
    json.dump(out, open(OUT, "w"))
