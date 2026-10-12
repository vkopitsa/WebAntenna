"""Overview picture of the printed parts: python render_parts.py <stl_dir> out.png"""
import sys, glob, os
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from mpl_toolkits.mplot3d.art3d import Poly3DCollection

ORDER = ["cover", "cup", "handle", "stand", "hot_former", "support_wedge", "gap_fork", "tpl_hot_cone1", "tpl_hot_cone2", "tpl_gnd_cone1", "tpl_lid"]
TITLE = {"cover": "cover", "cup": "cup (ground die + base)", "handle": "handle", "stand": "bench stand", "hot_former": "hot-element former",
         "support_wedge": "support wedge (×3)", "gap_fork": "pin-gap fork", "tpl_hot_cone1": "template: feed cone", "tpl_hot_cone2": "template: main cone",
         "tpl_gnd_cone1": "template: ground cone", "tpl_lid": "template: lid"}


def read_stl(path):
    d = np.fromfile(path, dtype=np.uint8)[84:]
    rec = np.frombuffer(d.tobytes(), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    return rec["v"], rec["n"]


names = [n for n in ORDER if os.path.exists(f"{sys.argv[1]}/{n}.stl")]
cols = 4
rows = (len(names) + cols - 1) // cols
fig = plt.figure(figsize=(4 * cols, 3.8 * rows), facecolor="#fcfcfb")
L = np.array([-0.4, -0.6, 0.7]); L /= np.linalg.norm(L)
for i, n in enumerate(names):
    v, nr = read_stl(f"{sys.argv[1]}/{n}.stl")
    ax = fig.add_subplot(rows, cols, i + 1, projection="3d", facecolor="#fcfcfb")
    sh = 0.35 + 0.65 * np.clip(nr @ L, 0, 1)
    base = np.array([0.92, 0.41, 0.20]) if not n.startswith("tpl") else np.array([0.16, 0.47, 0.84])
    ax.add_collection3d(Poly3DCollection(v, facecolors=np.clip(base[None] * sh[:, None], 0, 1), linewidths=0))
    lo, hi = v.reshape(-1, 3).min(0), v.reshape(-1, 3).max(0)
    c, s = (lo + hi) / 2, (hi - lo).max() / 2
    ax.set_xlim(c[0] - s, c[0] + s); ax.set_ylim(c[1] - s, c[1] + s); ax.set_zlim(c[2] - s, c[2] + s)
    ax.set_box_aspect((1, 1, 1)); ax.view_init(24, -60); ax.set_axis_off()
    ax.set_title(f"{TITLE.get(n, n)}\n{hi[0]-lo[0]:.0f} × {hi[1]-lo[1]:.0f} × {hi[2]-lo[2]:.0f} mm", fontsize=10)
fig.subplots_adjust(left=0, right=1, top=0.95, bottom=0, wspace=0, hspace=0.12)
fig.savefig(sys.argv[2], dpi=90, facecolor=fig.get_facecolor())
