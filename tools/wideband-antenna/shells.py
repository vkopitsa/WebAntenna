"""FDTD plastic shells (cover, cup, handle) for a family-2 design, following print_parts.py's geometry rules.

python shells.py <family> <design.json> [sheet_mm=0.3] [handle_mm=90] > shells.json
then  SHELLS="$(cat shells.json)" python fdtd_verify.py <family> <design.json> <cable_m> <out.json>

Output: [[polyline (rho, z) in metres, thickness m, eps_r], ...] (fdtd_run.py paints eps_r within thickness/2 of each
polyline). PETG eps_r 2.6. The cup is solid (rows 3.2 mm thick at a 3 mm pitch); the rows stop 1.6 mm outside the coax
so its PTFE keeps eps_r 2.1 (the first cover + cup run painted 2.6 into the coax under the ground cone)."""
import json, math, sys, importlib
import numpy as np
import designs as D

ER, WALL, CLR, ROW = 2.6, 1.2, 0.2, 3.2


def shells(fam, p, T=0.3, L_h=90.0):
    upper, lower, ztop, zbot, rmax = fam.profile(p)
    mm = lambda a: [(x * 1e3, z * 1e3) for x, z in a]
    hot = [mm(a) for a in upper]
    gnd = [q for a in lower for q in mm(a)]
    walk = [q for a in hot[1:] for q in a]
    Ru, z_lid = max(q[0] for q in walk), max(q[1] for q in walk)
    Rg, z_grim = max(q[0] for q in gnd), min(q[1] for q in gnd)
    rin = max(Ru, Rg) + 2.0 + T
    z_in_top = z_lid + T + 0.1
    z_cov0 = z_grim - 8.0
    r_wall_o, r_wall_i = rin - CLR, Rg + T + 0.4
    z_cup0, z_wall_top = z_cov0 - 2.0, z_grim + 0.8
    r_sock = 8.0 + CLR
    r_clear = D.B_COAX * 1e3 + ROW / 2 + 0.05                       # keep the plastic out of the coax
    slope = math.atan2(gnd[0][1] - gnd[1][1], gnd[1][0] - gnd[0][0])
    dz = T / math.cos(slope) + 0.1
    rs = np.linspace(0, Rg, 400)
    zc = np.interp(rs, [q[0] for q in gnd], [q[1] for q in gnd]) - dz  # cradle surface (falls with r)
    out = []
    m = lambda pts, th: out.append([[[round(r / 1e3, 6), round(z / 1e3, 6)] for r, z in pts], th / 1e3, ER])
    m([(rin + WALL / 2, z_cov0), (rin + WALL / 2, z_in_top + WALL)], WALL)          # cover wall
    m([(1.0, z_in_top + WALL / 2), (rin + WALL, z_in_top + WALL / 2)], WALL)       # cover top
    z = z_cup0 + ROW / 2
    z_top = zc[rs >= r_clear].max()                                   # the cradle under the cone apex
    while z < z_top:
        below = rs[zc >= z]                                          # cradle above this row out to r_out
        r_out = min(r_wall_o, below.max()) if len(below) else 0.0
        r_in = r_sock if z < z_cup0 + 12.0 else r_clear
        if r_out - r_in > 0.5:
            m([(r_in, z), (r_out, z)], ROW)
        z += 3.0
    if r_wall_o - r_wall_i > 0.3:                                     # the wall the cover slides over
        m([((r_wall_i + r_wall_o) / 2, z_cup0), ((r_wall_i + r_wall_o) / 2, z_wall_top)], r_wall_o - r_wall_i)
    z_h = z_cup0 + 12.0
    m([(6.8, z_h), (6.8, z_h - L_h)], 2.4)                              # handle tube (Ø11.2 – 16)
    return out


if __name__ == "__main__":
    fam = importlib.import_module(sys.argv[1])
    p = json.load(open(sys.argv[2]))
    print(json.dumps(shells(fam, p, *(float(a) for a in sys.argv[3:5]))))
