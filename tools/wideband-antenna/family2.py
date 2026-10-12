"""Family v2: two-angle hot cone (feed taper + main flare) with optional cylinder and top cap;
two-angle ground cone with optional skirt.  Same scenarios/cost as family.py."""
import math
import numpy as np
import bor
import designs as D
import family as F1

HMAX, DMAX = 0.30, 0.30
PARAMS = [
    ("g", 0.3e-3, 6e-3),
    ("r0u", D.A_PIN, 10e-3),
    ("au1", 20.0, 88.0),     # inner (feed-taper) hot cone half-angle from +z
    ("L1", 0.0, 0.08),       # slant length of the inner hot section
    ("au2", 10.0, 80.0),     # outer hot cone half-angle
    ("Ru", 0.04, 0.15),
    ("Hcu", 0.0, 0.20),
    ("capu", 0.0, 1.0),
    ("al1", 20.0, 90.0),     # inner ground cone half-angle from -z (90 = flat)
    ("Ll1", 0.0, 0.08),
    ("al2", 20.0, 90.0),
    ("Rl", 0.02, 0.15),
    ("Sl", 0.0, 0.20),
]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])


def unpack(x):
    return dict(zip(NAMES, x))


def _walk(start, segs, rmax, up):
    """segs: [(angle_from_axis_deg, slant)], stop when radius reaches rmax.  up: +1 hot, -1 ground."""
    pts = [start]
    r, z = start
    for ang, L in segs:
        if r >= rmax - 1e-6:
            break
        s, c = math.sin(math.radians(ang)), math.cos(math.radians(ang))
        if s < 1e-6:
            continue
        Lmax = (rmax - r) / s
        L = min(L, Lmax)
        if L <= 1e-6:
            continue
        r, z = r + L * s, z + up * L * c
        pts.append((r, z))
    if r < rmax - 1e-6:   # last angle continues to rmax
        ang = segs[-1][0]
        s, c = math.sin(math.radians(ang)), math.cos(math.radians(ang))
        L = (rmax - r) / s
        r, z = rmax, z + up * L * c
        pts.append((r, z))
    return pts


def profile(p):
    a, b = D.A_PIN, D.B_COAX
    g = p["g"]
    r0u = max(p["r0u"], a)
    Ru = max(p["Ru"], r0u + 2e-3)
    upper = []
    if r0u > a + 1e-5:
        upper.append(np.array([(a, g), (r0u, g)]))
    hot = _walk((r0u, g), [(p["au1"], p["L1"]), (p["au2"], 1.0)], Ru, +1)
    upper.append(np.array(hot))
    ztop = hot[-1][1]
    if p["Hcu"] > 1e-3:
        upper.append(np.array([(Ru, ztop), (Ru, ztop + p["Hcu"])]))
        ztop += p["Hcu"]
        if p["capu"] > 0.02:
            upper.append(np.array([(Ru, ztop), (max(Ru * (1 - p["capu"]), 1e-3), ztop)]))
    Rl = max(p["Rl"], b + 2e-3)
    gnd = _walk((b, 0.0), [(min(p["al1"], 90.0), p["Ll1"]), (min(p["al2"], 90.0), 1.0)], Rl, -1)
    lower = [np.array(gnd)]
    zbot = gnd[-1][1]
    if p["Sl"] > 1e-3:
        lower.append(np.array([(Rl, zbot), (Rl, zbot - p["Sl"])]))
        zbot -= p["Sl"]
    return upper, lower, ztop, zbot, max(Ru, Rl)


def geometry(p, cable=0.0, choke=None):
    upper, lower, ztop, zbot, rmax = profile(p)
    cab = (-zbot + cable) if cable > 0 else 0.0
    ch = (zbot - choke[0], choke[1]) if choke else None
    return D.geo_from(upper, lower, p["g"], cable=cab, choke=ch)


def size(p):
    _, _, ztop, zbot, rmax = profile(p)
    return ztop - zbot, 2 * rmax


def evaluate(p, per_lambda=14):
    H, Dm = size(p)
    res = dict(H=H, D=Dm)
    rows = D.evaluate(geometry(p), F1.FS_MAIN, per_lambda=per_lambda, els=F1.ELS2)
    res["main"] = rows
    res["swr_main"] = max(r["swr"] for r in rows)
    res["gmin"] = np.array([min(r["g"]) for r in rows])
    cab = []
    for Lc in (0.20, 0.35, 0.50):
        rr = bor.run(geometry(p, cable=Lc, choke=(0.02, 150.0)), F1.FS_LOW, per_lambda=per_lambda, pattern=False)
        cab.append(max(r["swr"] for r in rr))
    res["swr_cab"] = max(cab)
    rr = bor.run(geometry(p, cable=0.35), F1.FS_LOW, per_lambda=per_lambda, pattern=False)
    res["swr_nochoke"] = max(r["swr"] for r in rr)
    return res


def cost(x):
    p = unpack(x)
    H, Dm = size(p)
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    try:
        return F1.cost_of(evaluate(p))
    except Exception:
        return 100.0
