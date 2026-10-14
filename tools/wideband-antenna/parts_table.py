"""Parts table of a shaped wire cage (family 10-13 design, absolute units) in the form used in
docs/FPV-DETECTOR-ANTENNA.md: hot frame bend points, ground frame, shorting wires (and their capacitors), hoops,
washer. z = 0 at the coax end, rho / z in mm.
  SIZE=0.044 NCAGE=16 python parts_table.py designs/B44.json"""
import json
import math
import sys
import family13 as F13          # patches the spring / shunt builders into family 10
import family10 as F10

p = json.load(open(sys.argv[1]))
p = F10.full(p.get("p", p))
b = F10.build(p)
n = F10.NCAGE
mm = lambda v: f"{v * 1e3:.1f}"


def frame(polys):
    pts = [q for poly in polys for q in poly]
    out = [pts[0]]
    for q in pts[1:]:
        if math.dist(q[:2], out[-1][:2]) > 1e-6:
            out.append(q)
    length = sum(math.dist(a[:2], c[:2]) for a, c in zip(out, out[1:]))
    return out, length


hot, lh = frame(b["hot"])
gnd, lg = frame(b["gnd"])
print(f"| Part | Qty | Shape |\n|---|---|---|")
print(f"| Hot frame | {n} | washer edge " + " → ".join(f"(ρ {mm(r)}, z {mm(z)})" for r, z, *_ in hot)
      + f"; {mm(lh)} mm, {len(hot) - 2} bends |")
print(f"| Ground frame | {n} | collar " + " → ".join(f"(ρ {mm(r)}, z {mm(z)})" for r, z, *_ in gnd)
      + f"; {mm(lg)} mm, {len(gnd) - 2} bends |")
if b["nsh"]:
    sh = b["shunt"]
    (r0, z0, _), (r1, z1, _) = sh[0], sh[-1]
    xyz = lambda q: (q[0] * math.cos(q[2]), q[0] * math.sin(q[2]), q[1])
    ls = sum(math.dist(xyz(a), xyz(c)) for a, c in zip(sh, sh[1:]))     # the coil's wire, in 3D
    coil = f", wound into {int(round(p.get('sp_ts', 0)))} turns Ø{2 * p.get('sp_cs', 0) * 1e3:.1f} mm" if p.get("sp_ts", 0) >= 0.5 else ""
    cap = f"; every second one with a {p['csh']:.1f} pF series capacitor" if p.get("csh", 0) > 0.05 and b["nsh"] >= 2 else ""
    print(f"| Shorting wire | {b['nsh']} | at ρ {mm(r0)} mm, from the hot frame (z {mm(z0)}) to the ground frame (z {mm(z1)});"
          f" {mm(ls)} mm{coil}{cap} |")
hh = [(r, z) for r, z, *_ in b["hoops"] if z > b["g"] - 1e-6]
gh = [(r, z) for r, z, *_ in b["hoops"] if z <= b["g"] - 1e-6]
print(f"| Hot hoops | {len(hh)} | " + "; ".join(f"Ø{mm(2 * r)} at z {mm(z)}" for r, z in hh) + " |")
print(f"| Ground hoops | {len(gh)} | " + "; ".join(f"Ø{mm(2 * r)} at z {mm(z)}" for r, z in gh) + " |")
print(f"| Hot washer | 1 | Ø{mm(2 * p['r0u'])} on the centre pin, {mm(b['g'])} mm above the coax end |")
if p.get("cser", 0) > 0.05:
    print(f"| Series capacitor | 1 | {p['cser']:.1f} pF in the centre pin, between the coax and the washer |")
print(f"\nsize Ø{mm(2 * b['rmax'])} × {mm(b['top'] - b['bot'])} mm, {n} frames, wire Ø{2 * F10.RWIRE * 1e3:.0f} mm")
