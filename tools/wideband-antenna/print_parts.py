"""3D-printable cover, cup, forming and soldering jigs and cutting templates for a family-2 design (mm STL).

python print_parts.py <family> <design.json> <out_dir> [sheet_mm=0.3]

Parts (z = 0 is the coax end, as in the study; the model surfaces are the hot element's INSIDE and the ground
cone's TOP, the sheet lies outside / below them):
  cover          radome: tube from the ground rim to the lid, closed top glued to the lid (FDTD-checked, 1.2 mm PETG)
  cup            base: cradle for the ground cone (also its forming die), a wall the cover slides over, socket for the handle
  handle         tube that plugs into the cup: the coax runs through it, a pocket holds the ferrite bead(s)
  stand          bench stand: holds the handle upright while you solder
  hot_former     mandrel with the hot element's inside shape: roll the feed cone, main cone and rim on it
                 (a relief groove along one side keeps the soldered seam off the plastic)
  support_wedge  x3: hold the hot cone at its height above the ground cone while you solder; pulled out afterwards
  gap_fork       sets the pin gap: the washer rests on it while you solder it to the centre pin
  tpl_*          1.2 mm cutting templates of every flat pattern (scribe round them); the dashed lap of the paper
                 template is the strip beyond the groove
"""
import json, math, os, sys, importlib
import numpy as np
from manifold3d import CrossSection, Manifold

SEG = 256          # circular segments
WALL = 1.2         # cover wall and top (as simulated)
CLR = 0.2          # sliding clearance
LAP = 5.0          # seam lap on the cutting templates


def poly_cs(pts):
    return CrossSection([np.asarray(pts, float)])


def revolve(pts, deg=360.0):
    return Manifold.revolve(poly_cs(pts), SEG, deg)


def write_stl(m: Manifold, path):
    mesh = m.to_mesh()
    v = np.asarray(mesh.vert_properties)[:, :3].astype(np.float32)
    t = np.asarray(mesh.tri_verts)
    tri = v[t]
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-12
    with open(path, "wb") as f:
        f.write(b"antenna-generator print_parts".ljust(80, b" "))
        f.write(np.uint32(len(t)).tobytes())
        rec = np.zeros(len(t), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
        rec["n"], rec["v"] = n, tri
        f.write(rec.tobytes())
    lo, hi = m.bounding_box()[:3], m.bounding_box()[3:]
    return [round(hi[i] - lo[i], 1) for i in range(3)], round(m.volume() / 1000, 1)


def to_bed(m: Manifold) -> Manifold:
    b = m.bounding_box()
    return m.translate([-(b[0] + b[3]) / 2, -(b[1] + b[4]) / 2, -b[2]])


def drawing(hot, gnd, sec, g, path):
    """Section through the axis: metal (copper / grey lines) and the printed parts in place (filled)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import Polygon
    col = {"cover": "#2a78d6", "cup": "#eb6834", "handle": "#1baf7a", "support_wedge": "#eda100"}
    lab = {"cover": "cover", "cup": "cup", "handle": "handle (ferrite pocket inside)", "support_wedge": "support wedge (only while soldering)"}
    fig, ax = plt.subplots(figsize=(8, 8.6), facecolor="#fcfcfb")
    for name, pts in sec.items():
        for sg in (1, -1):
            if name == "support_wedge" and sg < 0:
                continue
            ax.add_patch(Polygon([(sg * r, z) for r, z in pts], closed=True, fc=col[name], ec="none", alpha=0.55 if name != "support_wedge" else 0.8,
                                 label=lab[name] if sg > 0 else None))
    for sg in (1, -1):
        for a in hot:
            ax.plot([sg * r for r, _ in a], [z for _, z in a], color="#b8662f", lw=2.2)
        ax.plot([sg * r for r, _ in gnd], [z for _, z in gnd], color="#52514e", lw=2.2)
        ax.plot([sg * 1.79] * 2, [0, -130], color="#222", lw=0.8)
    ax.plot([0, 0], [0, g], color="#b8662f", lw=1)
    ax.plot([], [], color="#b8662f", lw=2.2, label="hot element (sheet)")
    ax.plot([], [], color="#52514e", lw=2.2, label="ground cone (sheet)")
    ax.set_aspect("equal"); ax.set_xlim(-75, 75); ax.set_ylim(-130, 100)
    ax.grid(color="#efeeea", lw=0.8); ax.set_facecolor("#fcfcfb")
    for sp in ax.spines.values():
        sp.set_visible(False)
    ax.set_xlabel("mm (z = 0: coax end)")
    ax.legend(loc="lower left", frameon=False, fontsize=9)
    ax.set_title("Printed parts in place (section through the axis)")
    fig.tight_layout()
    fig.savefig(path, dpi=110, facecolor=fig.get_facecolor())


def main():
    fam = importlib.import_module(sys.argv[1])
    p = json.load(open(sys.argv[2]))
    out = sys.argv[3]
    T = float(sys.argv[4]) if len(sys.argv) > 4 else 0.3
    os.makedirs(out, exist_ok=True)
    if fam.size(p)[1] > 0.2:
        print("warning: this design is wider than 200 mm; the cover, cup and former will not fit a usual printer bed")
    upper, lower, ztop, zbot, rmax = fam.profile(p)
    mm = lambda a: [(x * 1e3, z * 1e3) for x, z in a]
    hot = [mm(a) for a in upper]
    gnd = [q for a in lower for q in mm(a)]
    # hot element inside profile: washer edge → cones → rim → lid
    walk = [q for a in hot[1:] for q in a]
    walk = [q for i, q in enumerate(walk) if i == 0 or math.dist(q, walk[i - 1]) > 1e-6]
    Ru = max(q[0] for q in walk)
    z_lid = max(q[1] for q in walk)
    Rg = max(q[0] for q in gnd)
    z_grim = min(q[1] for q in gnd)      # ground rim (or skirt bottom)
    zg = lambda r: float(np.interp(r, [q[0] for q in gnd], [q[1] for q in gnd]))
    # hot underside: the polyline as z(r) on the rising part
    k_ru = next(i for i, q in enumerate(walk) if q[0] >= Ru - 1e-6)      # the cones end where the rim starts
    hr = [q[0] for q in walk[:k_ru + 1]]
    hz = [q[1] for q in walk[:k_ru + 1]]
    zh = lambda r: float(np.interp(r, hr, hz))
    rep, sec = {}, {}       # sec: (rho, z) outlines in antenna coordinates, for the assembly drawing

    # ---------------------------------------------------------------- cover
    rin = max(Ru, Rg) + 2.0 + T                    # 2 mm outside the widest rim (the FDTD model: Ø117 for B)
    z_in_top = z_lid + T + 0.1                     # rests on the lid
    z_cov0 = z_grim - 8.0                          # overlaps the cup wall by 8 mm
    sec["cover"] = [(rin, z_cov0), (rin + WALL, z_cov0), (rin + WALL, z_in_top + WALL), (0, z_in_top + WALL), (0, z_in_top), (rin, z_in_top)]
    cover = revolve(sec["cover"])
    cover = to_bed(cover.mirror([0, 0, 1]))       # printed top down
    rep["cover"] = write_stl(cover, f"{out}/cover.stl")

    # ---------------------------------------------------------------- cup
    r_wall_o = rin - CLR                           # the cover slides over it
    r_wall_i = Rg + T + 0.4
    z_cup0 = z_cov0 - 2.0                          # flat bottom
    z_wall_top = z_grim + 0.8
    r_bore = 1.79 + 0.15                           # UT-141 jacket Ø3.58
    r_sock = 8.0 + CLR                             # handle Ø16
    slope = math.atan2(gnd[0][1] - gnd[1][1], gnd[1][0] - gnd[0][0])    # ground cone below the horizontal (rad)
    dz_sheet = T / math.cos(slope) + 0.1                                    # sheet thickness + glue, measured vertically
    rs = sorted({r_bore, r_wall_i, *[q[0] for q in gnd if r_bore < q[0] < r_wall_i]})   # the cones are straight between kinks
    cradle = [(r, zg(r) - dz_sheet) for r in rs]
    cup_pts = [(r_bore, z_cup0 + 12.0), (r_sock, z_cup0 + 12.0), (r_sock, z_cup0), (r_wall_o, z_cup0), (r_wall_o, z_wall_top),
               (r_wall_i, z_wall_top)] + cradle[::-1]
    cup = revolve(cup_pts)
    sec["cup"] = cup_pts
    rep["cup"] = write_stl(to_bed(cup), f"{out}/cup.stl")

    # ---------------------------------------------------------------- handle and stand
    L_h = 90.0
    h_pts = [(5.6, 0), (8.0, 0), (8.0, L_h), (r_bore, L_h), (r_bore, L_h - 6), (5.6, L_h - 6)]
    handle = revolve(h_pts)
    sec["handle"] = [(r, z + z_cup0 + 12.0 - L_h) for r, z in h_pts]
    rep["handle"] = write_stl(handle, f"{out}/handle.stl")      # printed standing; top (bore end) goes into the cup
    stand = revolve([(0, 0), (55, 0), (55, 4), (8.0 + CLR + 3, 4), (8.0 + CLR + 3, 34), (8.0 + CLR, 34), (8.0 + CLR, 4), (0, 4)])
    stand = stand - revolve([(0, -1), (4, -1), (4, 5), (0, 5)])  # cable exit
    stand = stand - Manifold.cube([30, 6, 40]).translate([0, -3, 4])   # slot: the coax leaves sideways
    rep["stand"] = write_stl(stand, f"{out}/stand.stl")

    # ---------------------------------------------------------------- hot former (mandrel)
    hf_pts = [(0, walk[0][1])] + walk + [(0, z_lid)]
    hf = revolve(hf_pts)
    inner = Manifold.revolve(poly_cs(hf_pts).offset(-2.0), SEG)
    groove = (hf - inner) ^ Manifold.cube([Ru + 5, 8.0, z_lid + 5]).translate([4.0, -4.0, -1])   # 8 mm wide, 2 mm deep, along one side
    hf = hf - groove
    hf = to_bed(hf.mirror([0, 0, 1]))              # printed on its flat (lid) end, tip up
    rep["hot_former"] = write_stl(hf, f"{out}/hot_former.stl")

    # ---------------------------------------------------------------- support wedge (extruded side profile)
    r_a, r_b = hr[-2] + 0.15 * (Ru - hr[-2]), hr[-2] + 0.6 * (Ru - hr[-2])   # under the main cone, clear of the feed cone
    sin_h = math.sin(math.atan2(hr[-1] - hr[-2], hz[-1] - hz[-2]))
    rr = sorted({r_a, r_b, *[r for r in hr + [q[0] for q in gnd] if r_a < r < r_b]})
    top = [(r, zh(r) - (T + 0.1) / max(sin_h, 0.2)) for r in rr]
    bot = [(r, zg(r) + 0.1) for r in rr]
    sec["support_wedge"] = bot + top[::-1]
    wedge = CrossSection([np.array(sec["support_wedge"])]).extrude(10.0)   # the r-z profile in x-y, 10 mm thick
    rep["support_wedge (print 3)"] = write_stl(to_bed(wedge), f"{out}/support_wedge.stl")

    # ---------------------------------------------------------------- gap fork
    g = p["g"] * 1e3
    fork = Manifold.cube([40, 14, g]) - Manifold.cube([10, 1.4, g + 2]).translate([-0.01, 7 - 0.7, -1]) \
        - Manifold.cylinder(g + 2, 0.9, 0.9, 24).translate([10, 7, -1])
    fork = fork + Manifold.cube([20, 14, 4]).translate([20, 0, 0])   # thicker grip, clear of the slot
    rep[f"gap_fork ({g:.2f} mm)"] = write_stl(fork, f"{out}/gap_fork.stl")

    # ---------------------------------------------------------------- cutting templates (flat patterns)
    n_tpl = 0
    def sector(r0, r1, ang, name):
        nonlocal n_tpl
        A = math.radians(ang)
        k = max(16, int(ang / 1.5))
        arc = lambda r: [(r * math.cos(A * i / k), r * math.sin(A * i / k)) for i in range(k + 1)]
        outline = arc(r1) + arc(r0)[::-1] + [(r0, -LAP), (r1, -LAP)]    # lap strip below the 0° edge
        plate = CrossSection([np.array(outline)]).extrude(1.2)
        mark = Manifold.cube([r1 - r0 + 2, 0.6, 0.6]).translate([r0 - 1, -0.3, 0.9])   # groove on the seam line
        n_tpl += 1
        rep[f"tpl_{name}"] = write_stl(to_bed(plate - mark), f"{out}/tpl_{name}.stl")

    def disc(d, hole, name):
        plate = Manifold.cylinder(1.2, d / 2, d / 2, SEG) - Manifold.cylinder(3, max(hole / 2, 0.5), max(hole / 2, 0.5), 48).translate([0, 0, -1])
        rep[f"tpl_{name}"] = write_stl(to_bed(plate), f"{out}/tpl_{name}.stl")

    segs = []
    for part, lines in (("hot", hot), ("gnd", [mm(a) for a in lower])):
        for a in lines:
            for i in range(len(a) - 1):
                segs.append((part, a[i], a[i + 1]))
    nc = {"hot": 0, "gnd": 0}
    for part, (ra, za), (rb, zb) in segs:
        L = math.hypot(rb - ra, zb - za)
        if L < 0.2:
            continue
        if abs(zb - za) < 1e-6:
            if not (part == "hot" and max(ra, rb) < 10):     # the washer is too small for a template: punch or drill it
                disc(2 * max(ra, rb), 2 * min(ra, rb), "lid")
        elif abs(rb - ra) < 1e-6:
            pass   # rim / skirt: a plain strip, measured with a ruler (often longer than the bed)
        else:
            s = abs(rb - ra) / L
            nc[part] += 1
            sector(min(ra, rb) / s, max(ra, rb) / s, 360 * s, f"{part}_cone{nc[part]}")
    drawing(hot, gnd, sec, p["g"] * 1e3, f"{out}/assembly.png")
    for k, (size, vol) in rep.items():
        print(f"{k:28s} {size[0]:6.1f} x {size[1]:6.1f} x {size[2]:6.1f} mm  {vol:6.1f} cm3")
    json.dump({k: {"size_mm": v[0], "volume_cm3": v[1]} for k, v in rep.items()}, open(f"{out}/parts.json", "w"), indent=1)


if __name__ == "__main__":
    main()
