"""Family v10: a SHAPED wire cage (NEC-2): the family-6 profile with frames that are free to twist, fold and
spiral so the cage fits a smaller box, and extra wires between the sides. On top of the v6 profile parameters:
  Hf, ah   fold-down brim on the hot rim (m, deg from vertical, + = flares out): a mushroom brim
  tw_h     twist of the hot frames (deg) from radius tws_h * Ru to the rim: conical spirals
  tw_f     twist along the fold-down brim (deg): a helical brim
  Sg       signed ground skirt (m): + hangs down (as v6), - folds up toward the hot cone
  tw_g     twist of the ground frames (deg) from radius tws_g * Rl: spiral radials
  tw_k     twist along the ground skirt (deg)
  mh/nh/mhs, mg/ng/mgs   zigzag of the hot / ground frames in their own plane: amplitude (m), half-waves, start
  leg, tw_l    0/2/4/8 frames continued as legs from the hot rim (or brim) to the ground rim, twisted by tw_l
  sh, shr      0/1/2/4 straight shunt wires from a hot frame to the ground frame under it, at radius
               SH_R0 + shr * (min(Ru, Rl) - SH_R0 - 2 mm): design W65 is v6 + one of them (designs/W65.json)
Hoops sit at the profile kinks (and at the skirt ends), so the frames are still held by rings; between two hoops
a twisted span runs as a helical sheath. All extras zero = the v9 wire cage (wirecage.py).
Environment: NCAGE (16), RWIRE (m, 0.5e-3), FLO (912e6), SIZE (m, max height and diameter), NFREQ (18),
ABORT (4.0: a candidate whose SWR at one of the two lowest frequencies is worse is not swept further),
SEG (m: fixed NEC segment length; 2e-3 is within ~0.1 of the converged SWR everywhere, lambda / 20 is 0.4 off at
the bottom of the band once a shorting wire carries the match there), TIMEOUT (s per candidate, 120).
Search it through family11.py (box-normalised parameters) with opt_cma.py."""
import json
import math
import os
import subprocess
import sys
import numpy as np
import designs as D
import family2 as F2

NCAGE = int(os.environ.get("NCAGE", "16"))
RWIRE = float(os.environ.get("RWIRE", "0.5e-3"))
FLO = float(os.environ.get("FLO", "912e6"))
SIZE = float(os.environ.get("SIZE", "0.075"))
HMAX = DMAX = SIZE
FS_MAIN = D.logf(int(os.environ.get("NFREQ", "18")), FLO, 6.6e9)
ELS = (15, 20, 25, 30, 35, 40, 45, 50)
HUB_R = 3.0e-3
GAP_MIN = 2.5e-3            # hot and ground parts closer than this (in rho, z) are rejected
SPACE_MIN = 2.0e-3          # neighbouring frames closer than this (3D, centre to centre) are rejected
TW_R0 = 8e-3                # twists start at least this far from the axis (the frames crowd near the hub)
LEGS = (0, 2, 4, 8)         # "leg" picks how many frames are extended into hot-to-ground shorting legs
SHUNTS = (0, 1, 2, 4)       # "sh" picks how many frames get a hot-to-ground shunt stub at radius r_sh
SH_R0 = 5e-3                # innermost shunt radius
s = SIZE / 0.30
PARAMS = [
    ("g", 0.5e-3, 4e-3),
    ("r0u", 1.5e-3, 6e-3),
    ("au1", 20.0, 88.0),
    ("L1", 0.0, 0.08 * s),
    ("au2", 10.0, 80.0),
    ("Ru", 0.04 * s, SIZE / 2),
    ("Hcu", 0.0, 0.20 * s),
    ("capu", 0.0, 1.0),
    ("al1", 20.0, 90.0),
    ("Ll1", 0.0, 0.08 * s),
    ("al2", 20.0, 90.0),
    ("Rl", 0.02 * s, SIZE / 2),
    ("Sg", -0.6 * SIZE, 0.4 * SIZE),
    ("Hf", 0.0, 0.8 * SIZE),
    ("ah", -30.0, 30.0),
    ("tw_h", -150.0, 150.0),
    ("tws_h", 0.1, 0.9),
    ("tw_f", -360.0, 360.0),
    ("tw_g", -150.0, 150.0),
    ("tws_g", 0.1, 0.9),
    ("tw_k", -360.0, 360.0),
    ("leg", 0.0, 3.999),
    ("tw_l", -180.0, 180.0),
    ("sh", 0.0, 3.999),
    ("shr", 0.0, 1.0),
    ("mh", 0.0, 6e-3),
    ("nh", 1.0, 12.0),
    ("mhs", 0.2, 0.9),
    ("mg", 0.0, 4e-3),
    ("ng", 1.0, 12.0),
    ("mgs", 0.2, 0.9),
]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])
DEFAULTS = dict(Sg=0.0, Hf=0.0, ah=0.0, tw_h=0.0, tws_h=0.5, tw_f=0.0, tw_g=0.0, tws_g=0.5, tw_k=0.0, leg=0.0, tw_l=0.0, sh=0.0, shr=0.3,
                mh=0.0, nh=6.0, mhs=0.4, mg=0.0, ng=6.0, mgs=0.4)


def unpack(x):
    return dict(zip(NAMES, map(float, x)))


def full(p):
    q = dict(DEFAULTS)
    q.update(p)
    if "Sg" not in p and "Sl" in p:             # a v6 design: its skirt hangs down
        q["Sg"] = p["Sl"]
    return q


def _s(u):
    """Twist profile: 0 -> 1 with zero slope at both ends, so the frames cross the hoops at the ends square on."""
    u = min(1.0, max(0.0, u))
    return u - math.sin(2 * math.pi * u) / (2 * math.pi)


PIECE = 2.5e-3              # twisted spans are cut into chords of about this length (>= PIECE_MIN, <= 10 deg)
PIECE_MIN = 1.5e-3          # NEC rejects or stalls on shorter chords bent against their neighbours (r = 0.5 mm)


def _resample(curve, twisted):
    """Points along curve(t), t in [0, 1] -> (rho, z, phi): the end points, plus (when twisted) cuts at equal
    3D arc length, ~PIECE apart, never shorter than PIECE_MIN, at most 10 deg of turn each."""
    if not twisted:
        return [curve(0.0), curve(1.0)]
    t = np.linspace(0, 1, 129)
    pts = [curve(v) for v in t]
    xyz = np.array([(r * math.cos(ph), r * math.sin(ph), z) for r, z, ph in pts])
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(xyz, axis=0), axis=1))])
    turn = math.degrees(abs(pts[-1][2] - pts[0][2]))
    m = max(1, int(round(s[-1] / PIECE)), int(math.ceil(turn / 10.0)))
    m = max(1, min(m, int(s[-1] / PIECE_MIN)))
    return [curve(float(np.interp(s[-1] * i / m, s, t))) for i in range(m + 1)]


def _arc(path):
    return np.concatenate([[0.0], np.cumsum([math.dist(a, b) for a, b in zip(path, path[1:])])])


def _twist(path, tw, rs):
    """(rho, z) path -> (rho, z, phi): phi turns tw (deg) along _s() of the arc length, from where the path first
    reaches radius rs to its end; the vertices stay vertices (hoops and junctions sit there)."""
    if tw != 0:                                  # a vertex where the twist starts, so only the spiral is cut up
        path = _insert_first(path, rs)
    s = _arc(path)
    i0 = next((i for i, q in enumerate(path) if q[0] >= rs - 1e-9), len(path) - 1)
    s0, s1 = s[i0], s[-1]
    phi = lambda v: 0.0 if tw == 0 or s1 - s0 < 1e-9 else math.radians(tw) * _s((v - s0) / (s1 - s0))
    out = [(path[0][0], path[0][1], phi(0.0))]
    for k, (a, b) in enumerate(zip(path, path[1:])):
        sa, sb = s[k], s[k + 1]
        seg = lambda t, a=a, b=b, sa=sa, sb=sb: (a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, phi(sa + (sb - sa) * t))
        out += _resample(seg, tw != 0 and sb > s0 + 1e-9)[1:]
    return out


def _tri(u):
    """Triangle wave: 0 at integers, +1 / -1 at alternate half-integers."""
    k = math.floor(u)
    return (-1) ** k * (1 - abs(2 * (u - k) - 1))


def _meander(path, r0, A, N):
    """Zigzag the (rho, z) path in its own plane beyond radius r0: N half-waves of amplitude A across the path,
    ending on the original end point. Returns (path, kinks): kinks are the original vertices where they moved to."""
    if A < 0.3e-3 or N < 1:
        return path, list(path)
    path = _insert_first(path, r0)
    s = _arc(path)
    i0 = next((i for i, q in enumerate(path) if q[0] >= r0 - 1e-9), len(path) - 1)
    s0, s1 = s[i0], s[-1]
    if s1 - s0 < 4 * PIECE_MIN:
        return path, list(path)
    L = (s1 - s0) / N
    def at(v):
        k = min(max(int(np.searchsorted(s, v, side="right")) - 1, 0), len(path) - 2)
        a, b = path[k], path[k + 1]
        t = (v - s[k]) / max(1e-12, s[k + 1] - s[k])
        d = np.subtract(b, a) / max(1e-12, math.dist(a, b))
        if abs(v - s[k + 1]) < 1e-9 and k + 2 < len(path):          # at a kink: bisect the two normals
            d2 = np.subtract(path[k + 2], b) / max(1e-12, math.dist(b, path[k + 2]))
            d = (d + d2) / max(1e-12, np.linalg.norm(d + d2))
        n = (d[1], -d[0])
        o = A * _tri((v - s0) / L)
        return (a[0] + (b[0] - a[0]) * t + o * n[0], a[1] + (b[1] - a[1]) * t + o * n[1])
    ev = sorted([(s[i], 0) for i in range(i0 + 1, len(path))] + [(s0 + (k + 0.5) * L, 1) for k in range(N)])
    out = list(path[:i0 + 1])
    kinks = list(path[:i0 + 1])
    for v, kind in ev:
        q = at(v)
        if math.dist(q, out[-1]) < PIECE_MIN:                     # a peak right at a kink: keep the kink only
            if kind == 0:
                out[-1] = q
                kinks.append(q)
            continue
        out.append(q)
        if kind == 0:
            kinks.append(q)
    out[-1] = path[-1]
    kinks[-1] = path[-1]
    return out, kinks


def _helix(p0, p1, tw):
    """Straight (rho, z) segment p0 -> p1 starting at angle p0[2], turning tw (deg) along it (_s profile);
    too short to twist (< 2 PIECE_MIN) -> straight."""
    if math.hypot(math.dist(p0[:2], p1[:2]), math.radians(tw) * max(p0[0], p1[0])) < 2 * PIECE_MIN:
        tw = 0.0
    seg = lambda t: (p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t, p0[2] + math.radians(tw) * _s(t))
    return _resample(seg, tw != 0)


def _snap(path, r, lmin=PIECE_MIN):
    """Radius r moved onto a vertex of the (rho, z) path when a cut there would leave a piece < lmin."""
    for a, b in zip(path, path[1:]):
        if a[0] <= r <= b[0] and b[0] > a[0]:
            t = (r - a[0]) / (b[0] - a[0])
            L = math.dist(a, b)
            if t * L < lmin:
                return a[0]
            if (1 - t) * L < lmin:
                return b[0]
            return r
    return r


def _insert(path, r):
    """(rho, z) path with rho rising: a vertex at radius r (if inside a segment)."""
    out = [path[0]]
    for a, b in zip(path, path[1:]):
        if a[0] < r - 1e-6 and b[0] > r + 1e-6:
            t = (r - a[0]) / (b[0] - a[0])
            out.append((r, a[1] + t * (b[1] - a[1])))
        out.append(b)
    return out


def _insert_first(path, r):
    """A vertex where the (rho, z) path first reaches radius r (snapped to a vertex closer than PIECE_MIN)."""
    for i, (a, b) in enumerate(zip(path, path[1:])):
        if a[0] < r <= b[0] or (i == 0 and r <= a[0]):
            if r <= a[0]:
                return list(path)
            t = (r - a[0]) / (b[0] - a[0])
            q = (r, a[1] + t * (b[1] - a[1]))
            if math.dist(q, a) < PIECE_MIN or math.dist(q, b) < PIECE_MIN:
                return list(path)
            return list(path[:i + 1]) + [q] + list(path[i + 1:])
    return list(path)


def _kink_hoops(kinks, twisted, tw):
    """Hoops at the profile kinks (>= 4 mm from the axis), except inside a twisted span (only at its ends)."""
    keys = {(round(c[0], 7), round(c[1], 7)) for c in kinks}
    end = math.radians(tw)
    return [pt for pt in twisted if (round(pt[0], 7), round(pt[1], 7)) in keys and pt[0] >= 4e-3
            and (tw == 0 or abs(pt[2]) < 1e-9 or abs(pt[2] - end) < 1e-9)]


def build(p):
    """Frame-0 polylines [(rho, z, phi)] and hoop points (rho, z, phi); the hub (axis -> ring) is added by model().
    Returns dict(hot=[...], gnd=[...], hoops=[...], hubs=[(axis z, ring pt)], axis_lid=z or None, top, bot, rmax)."""
    p = full(p)
    for k in ("L1", "Ll1", "Hcu", "Hf"):                      # pieces too short for NEC (and for a bender)
        if p[k] < PIECE_MIN:
            p[k] = 0.0
    if abs(p["Sg"]) < PIECE_MIN:
        p["Sg"] = 0.0
    if p["capu"] * p["Ru"] < PIECE_MIN:
        p["capu"] = 0.0
    q = dict(p)
    q["Sl"] = 0.0
    upper, lower, ztop, zbot, rmax = F2.profile(q)
    g = p["g"]
    # hot main path: axis at g -> cones -> rim (-> cylinder up)
    ci = 1 if max(q["r0u"], D.A_PIN) > D.A_PIN + 1e-5 else 0      # upper[0] is the washer when r0u > pin
    cone = [(0.0, g)] + [(float(x), float(y)) for x, y in upper[ci]]
    cone = [pt for i, pt in enumerate(cone) if i == 0 or math.dist(pt, cone[i - 1]) > 1e-5]
    hot, gnd, hoops, hubs = [], [], [], []
    # cut the axis end back to the hub ring
    def hub_cut(path, z_axis):
        nb = path[1]
        if nb[0] > HUB_R:
            t = HUB_R / nb[0]
            ring = (HUB_R, z_axis + t * (nb[1] - z_axis))
            path = [ring] + path[1:]
        else:
            path = path[1:]
        hubs.append((z_axis, path[0]))
        return path
    cone = hub_cut(cone, g)
    nsh = SHUNTS[min(len(SHUNTS) - 1, max(0, int(p["sh"])))]
    gl = [(float(x), float(y)) for x, y in lower[0] if x > 2.5e-3]
    r_sh = SH_R0 + p["shr"] * max(0.0, min(cone[-1][0], gl[-1][0] if gl else 0.0) - SH_R0 - 2e-3)
    cone, kinks = _meander(cone, max(TW_R0, p["mhs"] * cone[-1][0]), p["mh"], int(round(p["nh"])))
    r_sh = _snap(cone, r_sh)
    r_g = _snap([(0.0, 0.0)] + gl, r_sh, 1e-3)        # nor a piece < 1 mm off the ground frame (NEC: touching wires)
    r_sh = _snap(cone, r_g) if r_g != r_sh else r_sh
    rs_h = _snap(cone, max(TW_R0, p["tws_h"] * cone[-1][0]))
    tw = _twist(_insert(cone, r_sh) if nsh else cone, p["tw_h"], rs_h)
    hot.append(tw)
    hoops += _kink_hoops(kinks, tw, p["tw_h"])
    rim = tw[-1]
    zt = rim[1]
    rest = upper[ci + 1:]
    # cylinder up and cap inward keep the rim angle (straight, untwisted); a lid closed to the axis ends on it
    axis_lid = None
    path = [rim]
    for a in rest:
        for x, y in a[1:]:
            path.append((float(x), float(y), rim[2]))
    if len(path) > 1:
        if path[-1][0] < 1.5e-3:
            axis_lid = path[-1][1]
            cut = [(x, y) for x, y, _ in path]
            cut = cut[::-1]
            cut[0] = (0.0, cut[0][1])
            cut = hub_cut(cut, axis_lid)[::-1]
            path = [(x, y, rim[2]) for x, y in cut]
        hot.append(path)
        hoops += [pt for pt in path[1:] if pt[0] >= 4e-3]
        zt = max(zt, max(pt[1] for pt in path))
    # fold-down brim from the rim
    hot_end = rim
    if p["Hf"] > 1e-3:
        b = (min(SIZE / 2, max(4e-3, rim[0] + p["Hf"] * math.tan(math.radians(p["ah"])))), rim[1] - p["Hf"], 0.0)
        br = _helix(rim, b, p["tw_f"])
        hot.append(br)
        hoops.append(br[-1])
        hot_end = br[-1]
    else:
        hot_end = rim
    # ground: axis at z = 0 -> cones -> rim (-> signed skirt)
    gp = [(0.0, 0.0)] + [(float(x), float(y)) for x, y in lower[0] if x > 2.5e-3]
    gp = hub_cut(gp, 0.0)
    gp, gkinks = _meander(gp, max(TW_R0, p["mgs"] * gp[-1][0]), p["mg"], int(round(p["ng"])))
    rs_g = _snap(gp, max(TW_R0, p["tws_g"] * gp[-1][0]))
    tg = _twist(_insert(gp, r_sh) if nsh else gp, p["tw_g"], rs_g)
    gnd.append(tg)
    hoops += _kink_hoops(gkinks, tg, p["tw_g"])
    grim = tg[-1]
    zb = min(pt[1] for pt in tg)
    if abs(p["Sg"]) > 1e-3:
        sk = _helix(grim, (grim[0], grim[1] - p["Sg"], 0.0), p["tw_k"])
        gnd.append(sk)
        hoops.append(sk[-1])
        zb = min(zb, sk[-1][1])
    gnd_end = gnd[-1][-1] if p["Sg"] < -1e-3 else grim       # a folded-up skirt ends nearer the hot rim
    # shorting legs: hot rim (or brim end) -> ground rim (or folded-up skirt end), on nleg of the frames
    # shunt stubs: hot cone -> ground cone at radius r_sh, near the feed: shunt inductors across the port
    shunt = []
    if nsh:
        hp = [pt for pt in tw if abs(pt[0] - r_sh) < 1e-7]
        gq = [pt for pt in tg if abs(pt[0] - r_sh) < 1e-7]
        if hp and gq and math.dist(hp[0][:2], gq[0][:2]) > 2e-3:
            shunt = [hp[0], gq[0]]
    nsh = nsh if shunt else 0
    nleg = LEGS[min(len(LEGS) - 1, max(0, int(p["leg"])))]
    legs = _helix(hot_end, gnd_end, p["tw_l"]) if nleg else []
    if legs:                                                 # the leg's own angle path: start at the hot end's
        d0 = gnd_end[2] - hot_end[2]                         # angle, arrive at the ground end's
        legs = [(r, z, ph + d0 * _s(i / (len(legs) - 1))) for i, (r, z, ph) in enumerate(legs)]
    top = max(pt[1] for pl in hot for pt in pl)
    rmax = max(pt[0] for pl in hot + gnd for pt in pl)
    if legs and len(legs) < 3:                               # cut a straight leg so its middle can be checked
        a, c = legs
        legs = [tuple(a[k] + (c[k] - a[k]) * i / 8 for k in range(3)) for i in range(9)]
    return dict(hot=hot, gnd=gnd, hoops=hoops, hubs=hubs, axis_lid=axis_lid, top=top, bot=zb, rmax=rmax, g=g,
                legs=legs, nleg=nleg, shunt=shunt, nsh=nsh)


def size(p):
    b = build(p)
    return b["top"] - b["bot"], 2 * b["rmax"]


def clearance(b, r_min=6e-3):
    """Smallest (rho, z) distance between hot and ground polylines beyond r_min from the axis (ignores phi:
    conservative; nearer the axis the feed gap g sets it)."""
    def pts(pls):
        out = []
        for pl in pls:
            for a, c in zip(pl, pl[1:]):
                for t in np.linspace(0, 1, 6):
                    q = (a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)
                    if q[0] >= r_min:
                        out.append(q)
        return np.array(out).reshape(-1, 2)
    h, gg = pts(b["hot"]), pts(b["gnd"])
    if not len(h) or not len(gg):
        return 1.0
    d = np.sqrt(((h[:, None, :] - gg[None, :, :]) ** 2).sum(-1))
    return float(d.min())


def leg_clearance(b):
    """Smallest (rho, z) distance from the middle of a leg (its ends attach to the rims) to the hot and ground
    polylines; 1 m when there are no legs."""
    if not b["nleg"]:
        return 1.0
    L = np.array([(r, z) for r, z, _ in b["legs"]])
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(L, axis=0).T))])
    mid = L[(s > 0.15 * s[-1] + 2e-3) & (s < 0.85 * s[-1] - 2e-3)]
    if not len(mid):
        return 1.0
    pts = []
    for pl in b["hot"] + b["gnd"]:
        for a, c in zip(pl, pl[1:]):
            for t in np.linspace(0, 1, 6):
                pts.append((a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t))
    pts = np.array(pts)
    return float(np.sqrt(((mid[:, None, :] - pts[None, :, :]) ** 2).sum(-1)).min())


def spacing(b, n=NCAGE, r_min=6e-3):
    """Smallest 3D centre distance between frame 0 and its neighbour (beyond r_min from the axis): twisted frames
    and helical skirts must not crowd or cross each other."""
    def pts(pls, rot):
        out = []
        for pl in pls:
            for a, c in zip(pl, pl[1:]):
                for t in np.linspace(0, 1, 6):
                    r, z, ph = (a[k] + (c[k] - a[k]) * t for k in range(3))
                    if r >= r_min:
                        out.append((r * math.cos(ph + rot), r * math.sin(ph + rot), z))
        return np.array(out).reshape(-1, 3)
    best = 1.0
    for part in ("hot", "gnd"):
        a, c = pts(b[part], 0.0), pts(b[part], 2 * math.pi / n)
        if len(a) and len(c):
            best = min(best, float(np.sqrt(((a[:, None, :] - c[None, :, :]) ** 2).sum(-1)).min()))
    return best


def wire_list(b, n=NCAGE, r=RWIRE):
    """All wires of the cage after build(): [(kind, a xyz, b xyz, radius)], the pin-gap wire first; frame 0's
    wires carry kind "frame0" (the Radiation-view currents are read from them)."""
    wires = [("feed", (0.0, 0.0, 0.0), (0.0, 0.0, b["g"]), 0.46e-3)]
    ang = [2 * math.pi * k / n for k in range(n)]
    xyz = lambda q, t: (q[0] * math.cos(t + q[2]), q[0] * math.sin(t + q[2]), q[1])
    for pl in b["hot"] + b["gnd"]:
        for t in ang:
            for a, bb in zip(pl, pl[1:]):
                wires.append(("frame0" if t == 0 else "frame", xyz(a, t), xyz(bb, t), r))
    if b["nleg"]:
        for t in ang[::n // b["nleg"]]:
            for a, bb in zip(b["legs"], b["legs"][1:]):
                wires.append(("leg", xyz(a, t), xyz(bb, t), r))
    if b["nsh"]:
        for t in ang[n // b["nsh"] // 2::n // b["nsh"]]:       # between the legs' frames
            wires.append(("shunt", xyz(b["shunt"][0], t), xyz(b["shunt"][1], t), r))
    seen = set()
    for q in b["hoops"] + [hp for _, hp in b["hubs"]]:
        key = (round(q[0], 6), round(q[1], 6))
        if key in seen:
            continue
        seen.add(key)
        q = q if len(q) == 3 else (q[0], q[1], 0.0)
        chord = 2 * q[0] * math.sin(math.pi / n)
        for k in range(n):
            wires.append(("ring", xyz(q, ang[k]), xyz(q, ang[(k + 1) % n]), min(r, chord / 4)))
    for z_axis, ring in b["hubs"]:
        ring = ring if len(ring) == 3 else (ring[0], ring[1], 0.0)
        for k in range(0, n, max(1, n // 4)):
            wires.append(("spoke", (0.0, 0.0, z_axis), xyz(ring, ang[k]), min(r, 0.5e-3)))
    if b["axis_lid"] is not None:
        wires.append(("axis", (0, 0, b["g"]), (0, 0, b["axis_lid"]), r))
    return wires


def collisions(wires, k=7, r_hub=5e-3):
    """Pairs of wires that are not joined at an end but come closer than the sum of their radii (NEC-2++ rejects
    those): [(distance, i, j)]. Sampled at k points per wire; the hub (both wires within r_hub of the axis, as in
    every cage so far: hub rings, spokes) is left out."""
    A = np.array([w[1] for w in wires], float)
    B = np.array([w[2] for w in wires], float)
    R = np.array([w[3] for w in wires])
    t = np.linspace(0, 1, k)
    P = A[:, None, :] + (B - A)[:, None, :] * t[None, :, None]
    lo, hi = np.minimum(A, B) - 1.5e-3, np.maximum(A, B) + 1.5e-3
    out = []
    for i in range(len(wires)):
        near = np.where(np.all((lo <= hi[i]) & (hi >= lo[i]), axis=1))[0]
        near = near[near > i]
        if not len(near):
            continue
        d = np.sqrt(((P[i][None, :, None, :] - P[near][:, None, :, :]) ** 2).sum(-1)).min(axis=(1, 2))
        for j, dj in zip(near, d):
            if dj < R[i] + R[j]:
                if min(max(np.hypot(*A[i][:2]), np.hypot(*B[i][:2])), max(np.hypot(*A[j][:2]), np.hypot(*B[j][:2]))) < r_hub:
                    continue
                e = min(np.linalg.norm(x - y) for x in (A[i], B[i]) for y in (A[j], B[j]))
                if e > 1e-6:
                    out.append((float(dj), int(i), int(j)))
    return out


COAX_R = 1.79e-3            # UT-141 jacket


def model(p, f, n=NCAGE, r=RWIRE, per=20, els=None, info=None, seg=None, nphi=None, cable=0.0, beads=()):
    """NEC-2 at f: (Z at the pin gap, gain array). els (ascending, evenly spaced): pattern at those elevations, at
    phi 0, 90/n and 180/n deg, or at nphi cuts round the full circle (a cage with a shunt is not n-fold symmetric);
    default the cost's ELS at phi 0 and 180/n. info (dict) gets the NEC context, the wires and frame 0's tags.
    cable (m): the coax jacket hanging down the axis from the coax end (common-mode path), 5 mm segments;
    beads: [(depth below the coax end m, R ohm)] ferrite beads as series resistances on it."""
    from PyNEC import nec_context
    b = build(p)
    lam = 3e8 / f
    c = nec_context()
    G = c.get_geometry()
    wires = wire_list(b, n, r)
    frame0 = []
    for tag, (kind, a, bb, rad) in enumerate(wires, 1):
        ns = 1 if kind == "feed" else max(1, int(math.ceil(math.dist(a, bb) / (seg or lam / per))))
        G.wire(tag, ns, *a, *bb, rad, 1, 1)
        if kind == "frame0":
            frame0.append(tag)
    if cable > 0:
        ct = len(wires) + 1
        ncs = max(1, int(math.ceil(cable / 5e-3)))
        G.wire(ct, ncs, 0, 0, 0, 0, 0, -cable, COAX_R, 1, 1)
    c.geometry_complete(0)
    for depth, R in (beads if cable > 0 else ()):
        k = min(ncs, int(depth / (cable / ncs)) + 1)
        c.ld_card(4, ct, k, k, R, 0.0, 0.0)
    if p.get("cser", 0.0) > 0.05:            # series capacitor (pF) in the pin: a second matching element next to
        c.ld_card(0, 1, 1, 1, 0.0, 0.0, p["cser"] * 1e-12)      # the shunt wire's inductance (family 13, 40 mm)
    c.ex_card(0, 1, 1, 0, 1.0, 0, 0, 0, 0, 0)
    c.fr_card(0, 1, f / 1e6, 0)
    if els is None:
        c.rp_card(0, len(ELS), 2, 0, 0, 0, 0, 90 - ELS[-1], 0, 5, 180 / n, 0, 0)
        shape = (len(ELS), 2)
    elif nphi:
        d = els[1] - els[0]
        c.rp_card(0, len(els), nphi, 0, 0, 0, 0, 90 - els[-1], 0, d, 360 / nphi, 0, 0)
        shape = (len(els), nphi)
    else:
        d = els[1] - els[0]
        c.rp_card(0, len(els), 3, 0, 0, 0, 0, 90 - els[-1], 0, d, 90 / n, 0, 0)
        shape = (len(els), 3)
    z = c.get_input_parameters(0).get_impedance()[0]
    gg = np.array(c.get_radiation_pattern(0).get_gain()).reshape(shape)
    if info is not None:
        info.update(ctx=c, frame0=frame0, wires=wires, build=b)
    return z, gg


def swr(z, z0=50.0):
    gm = abs((z - z0) / (z + z0))
    return (1 + gm) / (1 - gm)


SEG = float(os.environ.get("SEG", "0")) or None     # fixed segment length (m) instead of lambda / per


def evaluate(p, fs=None, per=20, abort=None, seg=SEG):
    """NEC sweep. abort (SWR): solve the two lowest frequencies first (the hard ones for a small cage) and stop
    there when either is worse; the partial result's cost is then a lower bound."""
    H, Dm = size(p)
    fs = list(FS_MAIN if fs is None else fs)
    order = sorted(fs)
    rows = []
    for i, f in enumerate(order):
        z, gg = model(p, f, per=per, seg=seg)
        g = 10 * np.log10(np.mean(10 ** (gg / 10), axis=1))
        rows.append(dict(f=f, z=z, swr=swr(z), g=g.tolist()))
        if abort is not None and i == 1 and max(r["swr"] for r in rows) > abort:
            break
    rows.sort(key=lambda r: r["f"])
    return dict(H=H, D=Dm, main=rows, swr_main=max(r["swr"] for r in rows))


COST = os.environ.get("COST", "minimax")        # "loss": mean mismatch loss (dB) over the log grid instead of the
                                                 # worst SWR: for a cage too small to reach SWR 2 at the bottom


def cost_of(res):
    swrs = np.array([r["swr"] for r in res["main"]])
    if COST == "loss":
        gm = (swrs - 1) / (swrs + 1)
        c = float(np.mean(-10 * np.log10(np.maximum(1e-6, 1 - gm ** 2))))
    else:
        c = max(res["swr_main"], 1.85) + 0.5 * np.mean(np.maximum(0, swrs - 1.8))
    G = np.array([r["g"] for r in res["main"]])
    gavg = 10 * np.log10(np.mean(10 ** (G / 10), axis=1))
    gmin = G.min(axis=1)
    c += 0.1 * (np.mean(np.maximum(0, 1.0 - gavg)) + 0.5 * np.mean(np.maximum(0, -2.0 - gmin)) + 0.5 * max(0.0, -1.0 - gavg.min()))
    c += 20 * max(0.0, res["H"] - HMAX) / 0.01 + 20 * max(0.0, res["D"] - DMAX) / 0.01
    return float(c)


def cost(x):
    p = unpack(x)
    try:
        b = build(p)
    except Exception:
        return 100.0
    H, Dm = b["top"] - b["bot"], 2 * b["rmax"]
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    cl = clearance(b)
    if cl < GAP_MIN:
        return 40.0 + 1000 * (GAP_MIN - cl)
    cl = leg_clearance(b)
    if cl < GAP_MIN:
        return 40.0 + 1000 * (GAP_MIN - cl)
    sp = spacing(b)
    if sp < SPACE_MIN:
        return 30.0 + 1000 * (SPACE_MIN - sp)
    hit = collisions(wire_list(b))
    if hit:
        return 30.0 + len(hit)
    try:            # NEC in its own process with a hard timeout: a degenerate geometry can stall it inside C++
        r = subprocess.run([sys.executable, os.path.abspath(__file__), json.dumps(p)], capture_output=True, text=True,
                           timeout=int(os.environ.get("TIMEOUT", "120")), env=os.environ, cwd=os.path.dirname(os.path.abspath(__file__)))
        return float(r.stdout.strip().splitlines()[-1])
    except Exception:
        return 100.0


if __name__ == "__main__":
    try:
        print(cost_of(evaluate(json.loads(sys.argv[1]), abort=float(os.environ.get("ABORT", "4.0")))))
    except Exception:
        print(100.0)
