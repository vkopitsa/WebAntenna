"""Family v11: family 10 (shaped wire cage) in box-normalised parameters, so every candidate fits SIZE x SIZE by
construction and a random start is mostly buildable (family 10's absolute v6 angles put ~90 % of a Sobol start
outside the box or into the hot/ground clearance):
  gd       ground depth below the coax end (fraction of SIZE); the hot side gets the rest of the height
  ru, rl   hot / ground radius (fraction of SIZE / 2)
  ht, hc   hot rim height (fraction of the hot height), cylinder up from the rim (fraction of what is left)
  kx, ky   hot cone kink (fractions of the radius / height span from the washer to the rim)
  gkx, gky ground cone kink (same, from the coax jacket to the ground rim)
  gs       ground skirt: + hangs down (fraction of gd), - folds up (fraction of the hot rim height)
  hf       fold-down brim (fraction of the hot rim height above the ground rim)
  the rest (g, r0u, capu, ah, twists, legs) as family 10.
to_abs() maps them to a family-10 dict (the NEC model and the cost are family 10's); from_abs() is the inverse.
  NCAGE=16 FLO=912e6 SIZE=0.06 FAMILY=family11 X0=seed.json POP=8 python opt.py s60 40 1"""
import math
import numpy as np
import designs as D
import family2 as F2
import family10 as F10

SIZE, HMAX, DMAX, FS_MAIN = F10.SIZE, F10.HMAX, F10.DMAX, F10.FS_MAIN
PARAMS = [
    ("g", 0.5e-3, 4e-3),
    ("r0u", 3.0e-3, 6e-3),    # >= the hub ring radius: frames closer than that touch
    ("ru", 0.35, 1.0),
    ("kx", 0.05, 0.95),
    ("ky", 0.05, 0.95),
    ("ht", 0.3, 1.0),
    ("hc", 0.0, 1.0),
    ("capu", 0.0, 1.0),
    ("gd", 0.02, 0.45),
    ("rl", 0.35, 1.0),
    ("gkx", 0.05, 0.95),
    ("gky", 0.0, 0.95),
    ("gs", -0.8, 0.9),
    ("hf", 0.0, 0.9),
    ("ah", -40.0, 40.0),
    ("tw_h", -100.0, 100.0),
    ("tws_h", 0.1, 0.9),
    ("tw_f", -150.0, 150.0),
    ("tw_g", -100.0, 100.0),
    ("tws_g", 0.1, 0.9),
    ("tw_k", -150.0, 150.0),
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
PASS = ("g", "r0u", "capu", "ah", "tw_h", "tws_h", "tw_f", "tw_g", "tws_g", "tw_k", "leg", "tw_l", "sh", "shr",
        "mh", "nh", "mhs", "mg", "ng", "mgs")


def unpack(x):
    return dict(zip(NAMES, map(float, x)))


def to_abs(q):
    """Normalised dict -> family-10 dict (metres, degrees)."""
    R = SIZE / 2
    b = D.B_COAX
    g, r0u = q["g"], q["r0u"]
    gd = q["gd"] * SIZE
    zmax = SIZE - gd
    Ru = max(q["ru"] * R, r0u + 3e-3)
    z_rim = g + q["ht"] * (zmax - g)
    Hcu = q["hc"] * (zmax - z_rim)
    rk, zk = r0u + q["kx"] * (Ru - r0u), g + q["ky"] * (z_rim - g)
    p = {k: q[k] for k in PASS}
    p.update(Ru=Ru, Hcu=Hcu,
             au1=math.degrees(math.atan2(rk - r0u, zk - g)), L1=math.hypot(rk - r0u, zk - g),
             au2=math.degrees(math.atan2(Ru - rk, z_rim - zk)))
    Rl = max(q["rl"] * R, b + 3e-3)
    zr = gd * (1 - max(0.0, q["gs"]))                       # ground rim depth
    rgk, dgk = max(4e-3, b + q["gkx"] * (Rl - b)), q["gky"] * zr       # kink outside the hub ring
    p.update(Rl=Rl, al1=math.degrees(math.atan2(rgk - b, dgk)), Ll1=math.hypot(rgk - b, dgk),
             al2=math.degrees(math.atan2(Rl - rgk, zr - dgk)))
    p["Sg"] = q["gs"] * gd if q["gs"] >= 0 else q["gs"] * z_rim
    p["Hf"] = q["hf"] * (z_rim + zr)
    return p


def from_abs(p):
    """Family-10 (or v6) dict -> normalised dict for this SIZE (its profile must fit the box)."""
    p = F10.full(p)
    pp = dict(p)
    pp["Sl"] = 0.0
    upper, lower, ztop, zbot, rmax = F2.profile(pp)
    ci = 1 if max(p["r0u"], D.A_PIN) > D.A_PIN + 1e-5 else 0
    cone = [tuple(map(float, c)) for c in upper[ci]]
    g, r0u = p["g"], p["r0u"]
    (r1, z1), (rk, zk), (Ru, z_rim) = cone[0], cone[1] if len(cone) > 2 else cone[0], cone[-1]
    gnd = [tuple(map(float, c)) for c in lower[0]]
    (rgk, zgk), (Rl, zgr) = gnd[1] if len(gnd) > 2 else gnd[0], gnd[-1]
    sg = p["Sg"]
    gd = -zgr + max(0.0, sg)
    zmax = SIZE - gd
    q = {k: p[k] for k in PASS}
    q.update(ru=Ru / (SIZE / 2), kx=(rk - r0u) / (Ru - r0u), ky=(zk - g) / (z_rim - g), ht=(z_rim - g) / (zmax - g),
             hc=p["Hcu"] / max(1e-9, zmax - z_rim), gd=gd / SIZE, rl=Rl / (SIZE / 2),
             gkx=(rgk - D.B_COAX) / (Rl - D.B_COAX), gky=-zgk / -zgr,
             gs=(sg / gd if sg >= 0 else sg / z_rim), hf=p["Hf"] / (z_rim - zgr))
    return q


def size(q):
    return F10.size(to_abs(q))


def cost(x):
    return F10.cost(np.array([to_abs(unpack(x))[n] for n in F10.NAMES]))


def feasible(x):
    """Cheap geometry checks of family 10's cost (box, clearances, frame spacing) without NEC."""
    try:
        b = F10.build(to_abs(unpack(x)))
    except Exception:
        return False
    return (b["top"] - b["bot"] <= HMAX + 0.002 and 2 * b["rmax"] <= DMAX + 0.002 and F10.clearance(b) >= F10.GAP_MIN
            and F10.leg_clearance(b) >= F10.GAP_MIN and F10.spacing(b) >= F10.SPACE_MIN
            and not F10.collisions(F10.wire_list(b)))
