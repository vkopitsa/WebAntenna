"""Final numbers + charts for the md:
python final_report.py <family> '<json>' <outdir> [f_lo_Hz f_hi_Hz]   (band edges, default 800e6 6.4e9)"""
import os
os.environ.setdefault("NUMBA_NUM_THREADS", "8")
import sys, json, importlib, math
import numpy as np
import bor, designs as D
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

fam = importlib.import_module(sys.argv[1])
p = json.loads(sys.argv[2])
out = sys.argv[3]
F_LO = float(sys.argv[4]) if len(sys.argv) > 4 else 800e6
F_HI = float(sys.argv[5]) if len(sys.argv) > 5 else 6.4e9
os.makedirs(out, exist_ok=True)

SURF, INK, INK2, GRID = "#fcfcfb", "#0b0b0b", "#52514e", "#e4e3df"
S1, S2, S3, S4 = "#2a78d6", "#eb6834", "#1baf7a", "#eda100"
BAND = "#efeeea"
plt.rcParams.update({"font.size": 10, "axes.edgecolor": INK2, "axes.labelcolor": INK, "xtick.color": INK2,
                     "ytick.color": INK2, "axes.facecolor": SURF, "figure.facecolor": SURF, "axes.grid": True,
                     "grid.color": GRID, "grid.linewidth": 0.8, "axes.spines.top": False, "axes.spines.right": False,
                     "legend.frameon": False})
FPV = [("433", 425e6, 445e6), ("868/915", 860e6, 930e6), ("1.2", 1.08e9, 1.36e9), ("2.4", 2.40e9, 2.48e9),
       ("3.3", 3.17e9, 3.47e9), ("5.8", 5.645e9, 5.945e9)]
FPV = [b for b in FPV if b[1] >= F_LO * 0.99]

H, Dm = fam.size(p)
fs = D.logf(140, F_LO * 0.95, F_HI * 1.03)
els_dense = np.arange(-90, 91, 1.0)
rows = []
for f in fs:
    me = bor.build_mesh(fam.geometry(p), f, per_lambda=24)
    s = bor.solve(me)
    g = bor.gain_dbi(s, np.radians(90 - els_dense))
    rows.append(dict(f=f, Z=s.Z, swr=bor.swr(s.Z), g=g, n=me.nb, prad=bor.prad_check(s, 361)))
swr = np.array([r["swr"] for r in rows])
G = np.array([r["g"] for r in rows])          # [f, el]
inb = (fs >= F_LO * 0.999) & (fs <= F_HI * 1.001)
summary = dict(H=H, D=Dm, worst_swr=float(swr[inb].max()), f_worst=float(fs[inb][np.argmax(swr[inb])]),
               prad_min=float(min(r["prad"] for r in rows)), prad_max=float(max(r["prad"] for r in rows)))


def gel(el):
    return G[:, int(round(el + 90))]


win = (els_dense >= 15) & (els_dense <= 50)
summary["gmin_15_50"] = float(G[inb][:, win].min())
summary["gmean_15_50"] = float(10 * np.log10(np.mean(10 ** (G[inb][:, win] / 10))))
# FPV band table
tab = []
for name, a, b in FPV:
    ff = np.linspace(a, b, 5)
    rr = []
    for f in ff:
        me = bor.build_mesh(fam.geometry(p), f, per_lambda=24)
        s = bor.solve(me)
        gg = bor.gain_dbi(s, np.radians(90 - np.array([0, 15, 30, 50.0])))
        thf = np.radians(np.arange(0, 181, 1.0))
        gf = bor.gain_dbi(s, thf)
        rr.append((bor.swr(s.Z), gg, gf.max(), 90 - np.degrees(thf[np.argmax(gf)])))
    tab.append(dict(band=name, swr_max=max(x[0] for x in rr), g0=float(np.mean([x[1][0] for x in rr])),
                    g15=float(np.mean([x[1][1] for x in rr])), g30=float(np.mean([x[1][2] for x in rr])),
                    g50=float(np.mean([x[1][3] for x in rr])), gmax=float(np.mean([x[2] for x in rr])),
                    elmax=float(np.mean([x[3] for x in rr]))))
summary["fpv"] = tab
# cable scenarios
fl = D.logf(60, F_LO * 0.95, 4 * F_LO)
cab = {}
for Lc in (0.05, 0.1, 0.15, 0.2, 0.35, 0.5, 1.0):
    for ch in (None, (0.01, 150.0)):
        rr = bor.run(fam.geometry(p, cable=Lc, choke=ch), fl, per_lambda=24, pattern=False)
        s_ = np.array([r["swr"] for r in rr])
        cab[f"{Lc*100:.0f}cm{'+ferrite' if ch else ''}"] = float(s_[fl >= F_LO * 0.999].max())
summary["cable"] = cab
json.dump(summary, open(f"{out}/summary.json", "w"), indent=1)
with open(f"{out}/sweep.csv", "w") as fh:
    fh.write("f_MHz,R_ohm,X_ohm,SWR50," + ",".join(f"G_el{e}_dBi" for e in (0, 15, 30, 50)) + "\n")
    for r in rows:
        fh.write(f"{r['f']/1e6:.1f},{r['Z'].real:.2f},{r['Z'].imag:.2f},{r['swr']:.3f}," +
                 ",".join(f"{r['g'][int(e + 90)]:.2f}" for e in (0, 15, 30, 50)) + "\n")
print(json.dumps(summary, indent=1))


def shade(ax):
    for name, a, b in FPV:
        ax.axvspan(a / 1e9, b / 1e9, color=BAND, zorder=0, lw=0)


def logx(ax):
    ax.set_xscale("log")
    ax.set_xlim(F_LO * 0.95 / 1e9, F_HI * 1.03 / 1e9)
    ticks = [t for t in [0.3, 0.433, 0.9, 1.2, 2.4, 3.3, 5.8] if t >= F_LO * 0.95 / 1e9]
    ax.set_xticks(ticks)
    ax.set_xticklabels([f"{t:g}" for t in ticks])
    ax.minorticks_off()
    ax.set_xlabel("Frequency, GHz (log scale; shaded: drone bands)")


# 1. SWR
fig, ax = plt.subplots(figsize=(8, 3.6))
shade(ax)
ax.axhline(2.0, color=INK2, lw=1, ls=(0, (4, 3)))
ax.text(F_LO * 0.96 / 1e9, 2.03, "SWR 2", color=INK2, fontsize=9, va="bottom")
ax.plot(fs / 1e9, swr, color=S1, lw=2)
logx(ax)
ax.set_ylim(1, 3)
ax.set_ylabel("SWR (50 Ω)")
ax.set_title(f"SWR (50 Ω), {F_LO*0.95/1e6:.0f} MHz – {F_HI*1.03/1e9:.1f} GHz, BoR MoM", loc="left", color=INK, fontsize=11)
fig.tight_layout()
fig.savefig(f"{out}/swr.png", dpi=140)
plt.close(fig)

# 2. gain at elevations
fig, ax = plt.subplots(figsize=(8, 3.8))
shade(ax)
for el, c in ((0, S4), (15, S1), (30, S2), (50, S3)):
    y = gel(el)
    ax.plot(fs / 1e9, y, color=c, lw=2, label=f"{el}° elevation")
logx(ax)
ax.set_ylim(-12, 8)
ax.set_ylabel("Gain, dBi")
ax.legend(loc="lower left", ncol=4, fontsize=9)
ax.set_title("Gain toward the sky vs frequency (vertical polarisation, omni in azimuth)", loc="left", color=INK, fontsize=11)
fig.tight_layout()
fig.savefig(f"{out}/gain_elev.png", dpi=140)
plt.close(fig)

# 3. elevation cuts, small multiples
cuts = [f for f in [0.433e9, 0.9e9, 1.25e9, 2.44e9, 3.3e9, 5.8e9] if f >= F_LO * 0.99]
if len(cuts) < 6:
    cuts = [0.9e9, 1.25e9, 1.8e9, 2.44e9, 3.3e9, 5.8e9]
fig, axs = plt.subplots(2, 3, figsize=(9, 6.2), subplot_kw=dict(projection="polar"))
for ax, f in zip(axs.ravel(), cuts):
    me = bor.build_mesh(fam.geometry(p), f, per_lambda=24)
    s = bor.solve(me)
    el = np.arange(-90, 270.5, 1.0)
    th = np.radians(90 - el)
    th = np.where(el <= 90, th, np.radians(el - 90))     # mirror for the other side (rotational symmetry)
    gg = bor.gain_dbi(s, np.abs(th))
    r = np.clip(gg + 20, 0, None)
    ax.set_theta_zero_location("E")
    ax.plot(np.radians(el), r, color=S1, lw=2)
    ax.fill_between(np.radians(np.arange(15, 50.5, 1)), 0, 30, color=BAND, zorder=0)
    ax.fill_between(np.radians(np.arange(130, 165.5, 1)), 0, 30, color=BAND, zorder=0)
    ax.set_ylim(0, 30)
    ax.set_yticks([10, 20, 30])
    ax.set_yticklabels(["−10", "0", "+10 dBi"], fontsize=7, color=INK2)
    ax.set_rlabel_position(-40)
    ax.set_xticks(np.radians([0, 15, 30, 50, 90, 180, 270]))
    ax.set_xticklabels(["0°", "15°", "30°", "50°", "up", "", "down"], fontsize=7, color=INK2)
    ax.set_title(f"{f/1e9:g} GHz", fontsize=10, color=INK)
fig.suptitle("Elevation cuts (shaded: 15–50° sky sector; same in every azimuth)", x=0.02, ha="left", color=INK, fontsize=11)
fig.tight_layout()
fig.savefig(f"{out}/elev_cuts.png", dpi=140)
plt.close(fig)

# 4. profile drawing
upper, lower, ztop, zbot, rmax = fam.profile(p)
fig, ax = plt.subplots(figsize=(6.5, 6.5))
for poly, c in [(q, S2) for q in upper] + [(q, S1) for q in lower]:
    q = np.asarray(poly) * 1000
    ax.plot(q[:, 0], q[:, 1], color=c, lw=2)
    ax.plot(-q[:, 0], q[:, 1], color=c, lw=2, alpha=0.35)
ax.plot([D.A_PIN * 1000] * 2, [0, p["g"] * 1000], color=S2, lw=2)
ax.plot([0, 0], [zbot * 1000 - 0.15 * (ztop - zbot) * 1000, 0], color=INK2, lw=1.5, ls=(0, (2, 2)))
ax.text(2, zbot * 1000 - 0.12 * (ztop - zbot) * 1000, "coax to the detector\n(ferrite clip here)", fontsize=8, color=INK2)
ax.set_aspect("equal")
ax.set_xlabel("radius, mm")
ax.set_ylabel("height above the coax end (feed point), mm")
ax.set_title("Cross-section (orange: hot element on the centre pin; blue: ground on the coax jacket)", loc="left", fontsize=9, color=INK)
fig.tight_layout()
fig.savefig(f"{out}/profile.png", dpi=140)
plt.close(fig)
