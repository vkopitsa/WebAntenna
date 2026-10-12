"""Cross-sections at one scale: python section.py out.png fam:json:label [...]"""
import sys, json, importlib
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import designs as D

items = [a.split(":", 2) for a in sys.argv[2:]]
fig, axs = plt.subplots(1, len(items), figsize=(6 * len(items), 6.4), facecolor="#fcfcfb",
                        gridspec_kw=dict(width_ratios=[1] * len(items)))
for ax, (fam, js, label) in zip(np.atleast_1d(axs), items):
    f = importlib.import_module(fam); p = json.load(open(js))
    up, lo, zt, zb, rm = f.profile(p)
    for sgn in (1, -1):
        for pl in up:
            ax.plot(sgn * pl[:, 0] * 1e3, pl[:, 1] * 1e3, color="#b8662f", lw=2.5, solid_capstyle="round")
        for pl in lo:
            ax.plot(sgn * pl[:, 0] * 1e3, pl[:, 1] * 1e3, color="#6b7078", lw=2.5, solid_capstyle="round")
        ax.plot([sgn * 1.79, sgn * 1.79], [0, zb * 1e3 - 40], color="#444", lw=1.2)
    ax.plot([0, 0], [0, p["g"] * 1e3], color="#b8662f", lw=1.2)
    ax.axhline(0, color="#ddd", lw=0.8, zorder=0)
    H, Dm = (zt - zb) * 1e3, 2 * rm * 1e3
    ax.set_title(f"{label}\nØ{Dm:.0f} × {H:.0f} mm", fontsize=12, color="#222")
    ax.set_xlim(-150, 150); ax.set_ylim(-150, 220); ax.set_aspect("equal")
    ax.grid(color="#efeeea", lw=0.8); ax.set_facecolor("#fcfcfb")
    for s in ax.spines.values(): s.set_visible(False)
    ax.tick_params(colors="#666", labelsize=9); ax.set_xlabel("mm", color="#666")
fig.text(0.5, 0.015, "Section through the axis, same scale. Copper line = hot element (coax centre pin), "
         "grey = ground (coax jacket), thin lines = UT-141 coax.", ha="center", fontsize=10, color="#555")
fig.subplots_adjust(left=0.04, right=0.99, top=0.9, bottom=0.1, wspace=0.12)
fig.savefig(sys.argv[1], dpi=110, facecolor=fig.get_facecolor())
