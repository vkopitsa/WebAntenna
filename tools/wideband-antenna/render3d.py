"""3D renders (cut-away) of body-of-revolution designs: python render3d.py out.png fam:json:label [...]"""
import sys, json, importlib
import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.colors import LightSource
import designs as D

HOT, GND, COAX = np.array([0.80, 0.50, 0.30]), np.array([0.70, 0.72, 0.75]), np.array([0.45, 0.45, 0.47])
ls = LightSource(azdeg=315, altdeg=35)


def polyline_surface(ax, pts, color, phi0, phi1, n=90):
    pts = np.asarray(pts) * 1e3
    # densify along the polyline so shading is smooth
    seg = []
    for i in range(len(pts) - 1):
        t = np.linspace(0, 1, 12)[:-1] if i < len(pts) - 2 else np.linspace(0, 1, 12)
        seg.append(pts[i] + np.outer(t, pts[i + 1] - pts[i]))
    P = np.vstack(seg)
    ph = np.linspace(phi0, phi1, n)
    R, PH = np.meshgrid(P[:, 0], ph)
    Z = np.meshgrid(P[:, 1], ph)[0]
    X, Y = R * np.cos(PH), R * np.sin(PH)
    # simple Lambert-ish shade from surface normals
    nx, ny, nz = np.gradient(X), np.gradient(Y), np.gradient(Z)
    nrm = np.cross(np.stack([nx[0], ny[0], nz[0]], -1), np.stack([nx[1], ny[1], nz[1]], -1))
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True) + 1e-12
    L = np.array([-0.5, -0.6, 0.62]); L /= np.linalg.norm(L)
    sh = 0.35 + 0.65 * np.abs(nrm @ L)
    fc = np.clip(color[None, None, :] * sh[..., None], 0, 1)
    ax.plot_surface(X, Y, Z, facecolors=fc, rstride=1, cstride=1, linewidth=0, antialiased=False, shade=False)


def draw(ax, fam, p, label, cable=0.08):
    upper, lower, ztop, zbot, rmax = fam.profile(p)
    cut0, cut1 = 0.0, 2 * np.pi
    for pl in upper:
        polyline_surface(ax, pl, HOT, cut0, cut1)
    for pl in lower:
        polyline_surface(ax, pl, GND, cut0, cut1)
    a, b, g = D.A_PIN, D.B_COAX, p["g"]
    # pin, coax jacket (outer Ø3.58 mm) running down out of the ground cone
    polyline_surface(ax, [(a, 0), (a, g)], HOT, 0, 2 * np.pi, 24)
    polyline_surface(ax, [(1.79e-3, 0), (1.79e-3, zbot - cable)], COAX, 0, 2 * np.pi, 24)
    H, Dm = (ztop - zbot) * 1e3, 2 * rmax * 1e3
    lim = 150
    ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim); ax.set_zlim(-lim + 25, lim + 25)
    ax.set_box_aspect((1, 1, 1))
    ax.view_init(elev=18, azim=-75)
    ax.set_axis_off()
    ax.set_title(f"{label}\nØ{Dm:.0f} × {H:.0f} mm", fontsize=12, color="#222")


if __name__ == "__main__":
    out = sys.argv[1]
    items = [a.split(":", 2) for a in sys.argv[2:]]
    fig = plt.figure(figsize=(6 * len(items), 6.6), facecolor="#fcfcfb")
    for i, (fam, js, label) in enumerate(items):
        ax = fig.add_subplot(1, len(items), i + 1, projection="3d", facecolor="#fcfcfb")
        draw(ax, importlib.import_module(fam), json.load(open(js)), label)
    fig.text(0.5, 0.03, "Same scale. Copper = hot element (on the coax centre pin), grey = ground cone (on the coax jacket); "
             "the coax (UT-141) leaves downward through the ground cone.", ha="center", fontsize=10, color="#555")
    fig.subplots_adjust(left=0, right=1, top=0.93, bottom=0.06, wspace=0)
    fig.savefig(out, dpi=110, facecolor=fig.get_facecolor())
