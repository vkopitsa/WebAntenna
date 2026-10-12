"""Sheet-metal cut list (flat patterns) for a family design: python cutlist.py <family> '<json>'"""
import sys, json, math, importlib
import numpy as np


def pieces(poly, role):
    out = []
    for (r1, z1), (r2, z2) in zip(poly[:-1], poly[1:]):
        s = math.hypot(r2 - r1, z2 - z1)
        if s < 1e-4:
            continue
        sa = abs(r2 - r1) / s
        ri, ro = min(r1, r2), max(r1, r2)
        if sa > 0.999:
            out.append(dict(role=role, kind="flat annulus", r_in=ri, r_out=ro, z=z1))
        elif sa < 0.001:
            out.append(dict(role=role, kind="cylinder", r=r1, height=s, z0=min(z1, z2), z1=max(z1, z2)))
        else:
            ang = math.degrees(math.asin(sa))
            out.append(dict(role=role, kind="cone frustum", r_small=ri, r_big=ro, slant=s,
                            half_angle_deg=ang, dz=abs(z2 - z1),
                            flat_R_in=ri / sa, flat_R_out=ro / sa, flat_sector_deg=360 * sa,
                            opens="up" if (z2 - z1) * (r2 - r1) > 0 else "down"))
    return out


def cutlist(fam, p):
    upper, lower, ztop, zbot, rmax = fam.profile(p)
    L = []
    for q in upper:
        L += pieces(np.asarray(q), "hot (centre pin)")
    for q in lower:
        L += pieces(np.asarray(q), "ground (coax jacket)")
    return L, ztop, zbot


def fmt(L):
    lines = []
    for c in L:
        if c["kind"] == "cone frustum":
            lines.append(f"{c['role']:21s} cone, opens {c['opens']:4s}: Ø{2e3*c['r_small']:.1f} → Ø{2e3*c['r_big']:.1f} mm, "
                         f"slant {1e3*c['slant']:.1f} mm, half-angle {c['half_angle_deg']:.1f}°, height {1e3*c['dz']:.1f} mm | "
                         f"flat pattern: annular sector R {1e3*c['flat_R_in']:.1f}–{1e3*c['flat_R_out']:.1f} mm, angle {c['flat_sector_deg']:.1f}°")
        elif c["kind"] == "cylinder":
            lines.append(f"{c['role']:21s} cylinder Ø{2e3*c['r']:.1f} mm × {1e3*c['height']:.1f} mm | flat strip {2e3*math.pi*c['r']:.1f} × {1e3*c['height']:.1f} mm")
        else:
            lines.append(f"{c['role']:21s} flat annulus Ø{2e3*c['r_in']:.1f} – Ø{2e3*c['r_out']:.1f} mm at z = {1e3*c['z']:.1f} mm")
    return "\n".join(lines)


if __name__ == "__main__":
    fam = importlib.import_module(sys.argv[1])
    p = json.loads(sys.argv[2])
    L, zt, zb = cutlist(fam, p)
    print(fmt(L))
    print(f"top z = {zt*1e3:.1f} mm, bottom z = {zb*1e3:.1f} mm (z = 0: coax end / aperture)")
