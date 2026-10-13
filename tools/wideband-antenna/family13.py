"""Family v13: EVERY bend at once, for a small box. Family 11's box-normalised cage (profile, fold-down brim,
twists of the cone / brim / ground / skirt frames, legs, shunt wires, zigzags) plus family 12's springs, all
searchable together, with the brim and skirt twists widened to a full turn (+-360 deg): a frame wound round the
outer wall is a helical sheath that carries azimuthal current (a loop, TE mode) next to the dipole (TM) current,
the only way past the single-mode Chu bound in a 40 mm box. NCAGE (16; 8 or 12 leave room between the frames
for coils and zigzags, and a 40 mm cage is 0.85 lambda at 6.4 GHz, where 16 frames at 73 mm were 0.3 lambda apart).
  seed: any family-11 / family-12 design (missing extras default to straight frames, no brim, no legs)
  OMP_NUM_THREADS=1 FAMILY=family13 NCAGE=12 SIZE=0.040 FLO=960e6 SEG=2e-3 ABORT=12 X0=seed.json SIGMA=0.1 POP=16 \\
    FREE=ru,kx,ky,ht,hc,capu,gd,rl,gkx,gky,gs,shr,hf,ah,tw_f,tw_k python opt_cma.py t40 40 1
  random13.py samples the whole box (the "random method"): the best samples are seeds for opt_cma.py."""
import json
import os
import subprocess
import sys
import numpy as np
import family10 as F10
import family11 as F11
import family12 as F12

SIZE, HMAX, DMAX = F10.SIZE, F10.HMAX, F10.DMAX
WIDE = dict(tw_h=(-150.0, 150.0), tw_f=(-360.0, 360.0), tw_g=(-150.0, 150.0), tw_k=(-360.0, 360.0))
PARAMS = [(k,) + WIDE.get(k, (lo, hi)) for k, lo, hi in F11.PARAMS] + F12.PARAMS[len(F12.PROFILE):] + [
    ("cser", 0.0, 10.0),      # series capacitor in the pin, pF (0: none); with the shunt wire an L-network
]
NAMES = [p[0] for p in PARAMS]
LO = np.array([p[1] for p in PARAMS])
HI = np.array([p[2] for p in PARAMS])
DEFAULTS = dict(F10.DEFAULTS, hf=0.0, cser=0.0, **F12.SPRING)   # a seed without the extras: straight, no brim, no legs


def unpack(x):
    return dict(zip(NAMES, map(float, x)))


def to_abs(q):
    """Normalised dict -> family-10 dict (metres, degrees) + the spring parameters (sp_*)."""
    qq = {k: q.get(k, DEFAULTS.get(k, 0.0)) for k in F11.NAMES}
    p = F11.to_abs(qq)
    for k in F12.SPRING:
        p["sp_" + k] = q.get(k, F12.SPRING[k])
    p["cser"] = q.get("cser", 0.0)
    return p


build, wire_list, size = F12.build, F12.wire_list, F12.size     # family 12 patched them into family 10 at import


REJECT = 1000.0             # geometry penalties start here: a 40 mm cage's real cost (its SWR at 960 MHz) is 5-50,
FAIL = 5000.0               # the same scale as families 10-12's penalties (30-50), and CMA-ES then prefers rejects


def reject(p):
    """Geometry rules without NEC: None when buildable, else the penalty cost (REJECT + the rule's deficit)."""
    try:
        b = build(p)
    except Exception:
        return FAIL
    H, Dm = b["top"] - b["bot"], 2 * b["rmax"]
    if H > HMAX + 0.002 or Dm > DMAX + 0.002:
        return REJECT + 50.0 + 100 * (max(0, H - HMAX) + max(0, Dm - DMAX))
    if b["pitch"] < F12.PITCH_MIN:
        return REJECT + 45.0 + 1000 * (F12.PITCH_MIN - b["pitch"])
    cl = F10.clearance(b)
    if cl < F10.GAP_MIN:
        return REJECT + 40.0 + 1000 * (F10.GAP_MIN - cl)
    cl = F10.leg_clearance(b)
    if cl < F10.GAP_MIN:
        return REJECT + 40.0 + 1000 * (F10.GAP_MIN - cl)
    sp = F10.spacing(b)
    if sp < F10.SPACE_MIN:
        return REJECT + 30.0 + 1000 * (F10.SPACE_MIN - sp)
    hit = F10.collisions(wire_list(b))
    if hit:
        return REJECT + 30.0 + len(hit)
    return None


def feasible(x):
    return reject(to_abs(unpack(x))) is None


def cost_abs(p):
    r = reject(p)
    if r is not None:
        return r
    try:            # NEC in its own process with a hard timeout (a degenerate geometry can stall it inside C++)
        r = subprocess.run([sys.executable, os.path.abspath(__file__), json.dumps(p)], capture_output=True, text=True,
                           timeout=int(os.environ.get("TIMEOUT", "300")), env=os.environ,
                           cwd=os.path.dirname(os.path.abspath(__file__)))
        return float(r.stdout.strip().splitlines()[-1])
    except Exception:
        return FAIL


def cost(x):
    return cost_abs(to_abs(unpack(x)))


if __name__ == "__main__":
    try:
        print(F10.cost_of(F10.evaluate(json.loads(sys.argv[1]), abort=float(os.environ.get("ABORT", "4.0")))))
    except Exception:
        print(FAIL)
