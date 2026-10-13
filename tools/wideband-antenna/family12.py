"""Family v12: the family-11 cage (box-normalised profile + shunt wires) with SPRINGS: any frame span and the shunt
wire can be wound into a coil around its own centre line (an inductor made of the frame itself):
  th, ch, ah0, ah1   hot frames: turns (0 = straight), coil radius (m), window from ah0 * Ru to ah0 + ah1 * (1 - ah0)
                     of the way to the rim
  tg, cg, ag0, ag1   ground frames: the same along the ground frame (fractions of Rl)
  ts, cs             shunt wire: turns, coil radius (m)
The coil's envelope is zero at every vertex of the frame (hub ring, kinks, the shunt's attachment, the rim), so hoops
and joints stay on the centre line; turns are shared between the spans of the window in proportion to their length.
Twists, zigzags, brims and legs (family 10) are off: they were tried and did not help (README, lessons).
  OMP_NUM_THREADS=1 FAMILY=family12 SIZE=0.058 SEG=2.5e-3 X0=seed.json python opt_cma.py s58sp 120 1"""
import json
import math
import os
import subprocess
import sys
import numpy as np
import family10 as F10
import family11 as F11

SIZE, HMAX, DMAX = F10.SIZE, F10.HMAX, F10.DMAX
RAMP = 0.2                  # the coil reaches its full radius this far (fraction) into a span
CHORD_MIN = 1.2e-3          # shortest chord of a coil (NEC: one segment, >= 2.4 wire radii)
PITCH_MIN = 2.4e-3          # turn-to-turn pitch of a coil (Ø1 mm wire + 1.4 mm gap)
PROFILE = ["g", "r0u", "ru", "kx", "ky", "ht", "hc", "capu", "gd", "rl", "gkx", "gky", "gs", "sh", "shr"]
PARAMS = [p for p in F11.PARAMS if p[0] in PROFILE] + [
    ("th", 0.0, 12.0),
    ("ch", 1.2e-3, 3.5e-3),
    ("ah0", 0.1, 0.95),
    ("ah1", 0.1, 1.0),
    ("tg", 0.0, 12.0),
    ("cg", 1.2e-3, 3.5e-3),
    ("ag0", 0.1, 0.95),
    ("ag1", 0.1, 1.0),
    ("ts", 0.0, 6.0),
    ("cs", 1.2e-3, 3.5e-3),
]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])
SPRING = dict(th=0.0, ch=1.5e-3, ah0=0.5, ah1=1.0, tg=0.0, cg=1.5e-3, ag0=0.5, ag1=1.0, ts=0.0, cs=1.5e-3)
OFF10 = dict(Hf=0.0, ah=0.0, tw_h=0.0, tw_f=0.0, tw_g=0.0, tw_k=0.0, leg=0.0, tw_l=0.0, mh=0.0, mg=0.0)


def unpack(x):
    return dict(zip(NAMES, map(float, x)))


def to_abs(q):
    """Normalised dict -> absolute dict: family-10 parameters + the spring ones (passed through)."""
    qq = {k: q[k] for k in PROFILE}
    for k, lo, hi in F11.PARAMS:                      # family-11 extras not searched here: off (family-10 defaults)
        qq.setdefault(k, F10.DEFAULTS.get(k, 0.0))
    p = F11.to_abs(qq)
    p.update(OFF10)
    for k in SPRING:
        p["sp_" + k] = q.get(k, SPRING[k])
    return p


def _xyz(q):
    return np.array([q[0] * math.cos(q[2]), q[0] * math.sin(q[2]), q[1]])


def _rzp(v, ph_ref):
    ph = math.atan2(v[1], v[0])
    ph += 2 * math.pi * round((ph_ref - ph) / (2 * math.pi))
    return (float(math.hypot(v[0], v[1])), float(v[2]), ph)


def _coil(a, b, turns, rc, axial=None):
    """(rho, z, phi) points a -> b wound into `turns` turns of radius rc round the straight line, envelope
    sin(pi s) / sin(pi RAMP) clipped at 1 over the coiled part, straight leads of max(2.5 mm, 2 rc + 1.5 mm) at the ends. axial: the coil's first normal (default: in the frame's rz plane)."""
    A, B = _xyz(a), _xyz(b)
    L = float(np.linalg.norm(B - A))
    t = (B - A) / L
    if axial is None:                                 # azimuthal direction at the midpoint: the second normal
        mid = (A + B) / 2
        az = np.array([-mid[1], mid[0], 0.0])
        if np.linalg.norm(az) < 1e-9:
            az = np.array([0.0, 1.0, 0.0])
        n2 = az - t * (az @ t)
        n2 /= np.linalg.norm(n2)
        n1 = np.cross(n2, t)
    else:
        n1 = axial - t * (axial @ t)
        n1 /= np.linalg.norm(n1)
        n2 = np.cross(t, n1)
    lead = _lead(L, rc)
    per = max(5, min(12, int(2 * math.pi * rc / 1.4e-3)))  # chords per turn
    m = max(2, int(math.ceil(turns * per)))
    out = [a]
    for i in range(m + 1):
        s = i / m
        u = lead + (1 - 2 * lead) * s
        w = min(1.0, math.sin(math.pi * s) / math.sin(math.pi * RAMP))
        th = 2 * math.pi * turns * s
        v = A + (B - A) * u + rc * w * (math.cos(th) * n1 + math.sin(th) * n2)
        q = _rzp(v, a[2] + (b[2] - a[2]) * u)
        if math.dist(_xyz(q), _xyz(out[-1])) >= CHORD_MIN:
            out.append(q)
    if math.dist(_xyz(out[-1]), B) < CHORD_MIN and len(out) > 1:
        out.pop()
    out.append(b)
    return out


def _lead(L, rc):
    """Straight lead at each end of a coil (fraction of the span): the turns stay clear of the joint."""
    return min(0.3, max(2.5e-3, 2 * rc + 1.5e-3) / L)


def coil_pitch(L, turns, rc):
    return L * (1 - 2 * _lead(L, rc)) / turns


def _spring_path(path, r0, r1, turns, rc):
    """Wind the spans of the (rho, z, phi) polyline lying between radii r0 and r1 (by their midpoints) into a coil of
    `turns` turns in total, shared by length; a span gets round(share) turns (0: stays straight)."""
    if turns < 0.5:
        return path, 1.0
    spans = [(i, math.dist(_xyz(path[i]), _xyz(path[i + 1]))) for i in range(len(path) - 1)
             if r0 <= 0.5 * (path[i][0] + path[i + 1][0]) <= r1]
    Ltot = sum(L for _, L in spans)
    if Ltot < 1e-6:
        return path, 1.0
    pitch = 1.0
    out = [path[0]]
    for i in range(len(path) - 1):
        hit = [L for j, L in spans if j == i]
        n = int(round(turns * hit[0] / Ltot)) if hit else 0
        if n >= 1:
            pitch = min(pitch, coil_pitch(hit[0], n, rc))
            out += _coil(path[i], path[i + 1], n, rc)[1:]
        else:
            out.append(path[i + 1])
    return out, pitch


def build(p):
    b = _build10(p)
    sp = {k: p.get("sp_" + k, SPRING[k]) for k in SPRING}
    pitch = 1.0
    Ru = max(pt[0] for pt in b["hot"][0])
    Rl = max(pt[0] for pt in b["gnd"][0])
    r0 = sp["ah0"] * Ru
    hot, ph = _spring_path(b["hot"][0], r0, r0 + sp["ah1"] * (Ru - r0) + 1e-6, sp["th"], sp["ch"])
    r0 = sp["ag0"] * Rl
    gnd, pg = _spring_path(b["gnd"][0], r0, r0 + sp["ag1"] * (Rl - r0) + 1e-6, sp["tg"], sp["cg"])
    b["hot"][0], b["gnd"][0] = hot, gnd
    pitch = min(ph, pg)
    if b["shunt"]:
        a, c = b["shunt"]
        n = int(round(sp["ts"]))
        if n >= 1:
            L = math.dist(_xyz(a), _xyz(c))
            pitch = min(pitch, coil_pitch(L, n, sp["cs"]))
            b["shunt"] = _coil(a, c, n, sp["cs"], axial=np.array([-math.sin(a[2]), math.cos(a[2]), 0.0]))
        else:
            b["shunt"] = [a, c]
    b["pitch"] = pitch
    b["rmax"] = max(pt[0] for pl in b["hot"] + b["gnd"] + [b["shunt"]] for pt in pl) if b["shunt"] else \
        max(pt[0] for pl in b["hot"] + b["gnd"] for pt in pl)
    b["top"] = max(b["top"], max(pt[1] for pt in b["hot"][0]))
    b["bot"] = min(b["bot"], min(pt[1] for pt in b["gnd"][0]))
    return b


def wire_list(b, n=F10.NCAGE, r=F10.RWIRE):
    """family10.wire_list with the shunt as a polyline (a coil)."""
    sh = b["shunt"]
    bb = dict(b)
    bb["nsh"] = 0
    wires = _wire_list10(bb, n, r)
    if b["nsh"] and sh:
        ang = [2 * math.pi * k / n for k in range(n)]
        xyz = lambda q, t: (q[0] * math.cos(t + q[2]), q[0] * math.sin(t + q[2]), q[1])
        extra = []
        for t in ang[n // b["nsh"] // 2::n // b["nsh"]]:
            for a, c in zip(sh, sh[1:]):
                extra.append(("shunt", xyz(a, t), xyz(c, t), r))
        k = next(i for i, w in enumerate(wires) if w[0] == "ring") if any(w[0] == "ring" for w in wires) else len(wires)
        wires = wires[:k] + extra + wires[k:]
    return wires


_build10, _wire_list10 = F10.build, F10.wire_list
F10.build, F10.wire_list = build, wire_list      # family10.model / evaluate / size now see the springs


def size(p):
    b = build(p)
    return b["top"] - b["bot"], 2 * b["rmax"]


def cost_abs(p):
    try:
        b = build(p)
    except Exception:
        return 100.0
    H, Dm = b["top"] - b["bot"], 2 * b["rmax"]
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    if b["pitch"] < PITCH_MIN:
        return 45.0 + 1000 * (PITCH_MIN - b["pitch"])
    cl = F10.clearance(b)
    if cl < F10.GAP_MIN:
        return 40.0 + 1000 * (F10.GAP_MIN - cl)
    sp = F10.spacing(b)
    if sp < F10.SPACE_MIN:
        return 30.0 + 1000 * (F10.SPACE_MIN - sp)
    hit = F10.collisions(wire_list(b))
    if hit:
        return 30.0 + len(hit)
    try:
        r = subprocess.run([sys.executable, os.path.abspath(__file__), json.dumps(p)], capture_output=True, text=True,
                           timeout=int(os.environ.get("TIMEOUT", "150")), env=os.environ,
                           cwd=os.path.dirname(os.path.abspath(__file__)))
        return float(r.stdout.strip().splitlines()[-1])
    except Exception:
        return 100.0


def cost(x):
    return cost_abs(to_abs(unpack(x)))


if __name__ == "__main__":
    try:
        print(F10.cost_of(F10.evaluate(json.loads(sys.argv[1]), abort=float(os.environ.get("ABORT", "4.0")))))
    except Exception:
        print(100.0)
