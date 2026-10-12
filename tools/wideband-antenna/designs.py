"""Antenna geometries (rho, z) for the BoR solver.  z = 0 is the coax aperture plane (feed),
the pin (coax centre, radius a) rises to z = g where the upper (hot) element starts; the lower
(ground) element is attached to the coax outer conductor at (b, 0)."""
import math
import numpy as np
import bor

# Feed: 0.141" semi-rigid / hand-formable coax (UT-141, RG-402): centre conductor 0.92 mm, PTFE 2.98 mm,
# jacket 3.58 mm.  The ground cone is soldered around the jacket at the apex; the bare centre conductor
# bridges the gap g to the hot element.  (Runs before this change used SMA-pin sizes 0.635/2.05 mm.)
A_PIN = 0.46e-3
B_COAX = 1.49e-3


def bezier(p0, p1, p2, p3, n=200):
    t = np.linspace(0, 1, n)[:, None]
    P = [np.asarray(p, float) for p in (p0, p1, p2, p3)]
    return ((1 - t) ** 3) * P[0] + 3 * ((1 - t) ** 2) * t * P[1] + 3 * (1 - t) * t * t * P[2] + t ** 3 * P[3]


def base_parts(g, a=A_PIN, b=B_COAX, cable=0.0, cable_r=None):
    parts = [("feed", [(a, 0.0), (b, 0.0)]), ("pin", [(a, 0.0), (a, g)])]
    if cable > 0:
        parts.append(("cable", [(b, 0.0), (b, -cable)]))
    return parts


def geo_from(upper, lower, g, a=A_PIN, b=B_COAX, cable=0.0, choke=None):
    """upper: list of polylines starting at (a, g); lower: list of polylines starting at (b, 0).
    cable: length of coax hanging below z = 0 along the axis; choke: (z, Z) series load on it."""
    parts = base_parts(g, a, b, cable)
    for i, p in enumerate(upper):
        parts.append((f"up{i}", p))
    for i, p in enumerate(lower):
        parts.append((f"lo{i}", p))
    loads = [((b, choke[0]), choke[1])] if choke else []
    return bor.Geometry(parts, dict(kind="frill", a=a, b=b, z=0.0), loads=loads)


def discone(L, half_deg, Rd, g, a=A_PIN, b=B_COAX, skirt=0.0, cable=0.0, choke=None):
    """Classic discone: flat disc (hot) above a cone (ground), optional cylindrical skirt."""
    al = math.radians(half_deg)
    Rc, Hc = b + L * math.sin(al), L * math.cos(al)
    lower = [np.array([(b, 0.0), (Rc, -Hc)])]
    if skirt > 0:
        lower.append(np.array([(Rc, -Hc), (Rc, -Hc - skirt)]))
    upper = [np.array([(a, g), (Rd, g)])]
    return geo_from(upper, lower, g, a, b, cable, choke)


def size_of(geo):
    P = np.vstack([p for _, p in geo.parts if _ != "cable"])
    return 2 * P[:, 0].max(), P[:, 1].max() - P[:, 1].min()


def evaluate(geo, freqs, flip=False, per_lambda=20, h_feed=0.3e-3, grow=0.25, els=(0, 15, 30, 50)):
    """flip: the antenna is mounted upside down (pattern mirrored in elevation)."""
    e = np.asarray(els, float)
    if flip:
        e = -e
    rows = bor.run(geo, freqs, per_lambda=per_lambda, h_feed=h_feed, grow=grow, el_deg=tuple(e))
    if flip:
        for r in rows:
            r["el_max"] = -r["el_max"]
    return rows


def logf(n, a=300e6, b=6.4e9):
    return a * (b / a) ** (np.arange(n) / (n - 1))


def show(rows, els=(0, 15, 30, 50)):
    print("   f MHz      R       X    SWR   N  " + " ".join(f"g{e:>3d}" for e in els) + "  gmax @el")
    for r in rows:
        print(f"{r['f']/1e6:8.1f} {r['Z'].real:7.1f} {r['Z'].imag:7.1f} {r['swr']:5.2f} {r['n']:4d} " + " ".join(f"{x:5.1f}" for x in r["g"]) + f"  {r['gmax']:5.1f} @{r['el_max']:4.0f}")


def cone_over_ground(Lu, au_deg, g, Rg, skirt=0.0, cable=0.0, a=A_PIN, b=B_COAX, top=None, choke=None):
    """Hot cone on the pin (opening upward, half-angle au from +z), ground disc of radius Rg on the
    coax shield at z = 0 with an optional downward cylindrical skirt; cable hangs below from (b, 0).
    top: optional (dz) cylinder continuing upward from the cone rim (cone-cylinder 'cup')."""
    au = math.radians(au_deg)
    Ru, Hu = a + Lu * math.sin(au), g + Lu * math.cos(au)
    upper = [np.array([(a, g), (Ru, Hu)])]
    if top:
        upper.append(np.array([(Ru, Hu), (Ru, Hu + top)]))
    lower = [np.array([(b, 0.0), (Rg, 0.0)])]
    if skirt > 0:
        lower.append(np.array([(Rg, 0.0), (Rg, -skirt)]))
    return geo_from(upper, lower, g, a, b, cable, choke)
