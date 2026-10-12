"""Wire-cage version of a family-2 design (NEC-2 via PyNEC): N radial wire frames follow the (rho, z) profile
of the solid design, optionally with hoops at the profile kinks and a wire up the axis.

python wirecage.py <family> <design.json> <n_spokes> <wire_r_mm> [rings=1] [axis=1] [f_lo=960e6] [f_hi=6.4e9]
prints SWR and the 15-50 deg elevation gain (mean over phi) per frequency, then the worst SWR.

Hot frames: axis at the washer height -> washer edge -> cones -> rim -> lid -> back to the axis (closed frames
when the lid is closed). Ground frames: axis at z = 0 -> ground cone -> skirt. Feed: one segment on the axis
from z = 0 to the pin gap (the coax end), 50 ohm."""
import sys, json, math, importlib
import numpy as np
from PyNEC import nec_context

ELS = (15, 20, 25, 30, 35, 40, 45, 50)


def paths(fam, p):
    """Profile paths (rho, z) in metres: hot from the axis at z = g, ground from the axis at z = 0."""
    upper, lower, ztop, zbot, rmax = fam.profile(p)
    g = p["g"]
    hot = [(0.0, g)]
    for a in upper[1:] if len(upper) > 1 else upper:
        for q in a:
            q = (float(q[0]), float(q[1]))
            if math.dist(q, hot[-1]) > 1e-5:
                hot.append(q)
    if hot[-1][0] < 1.5e-3:                     # a closed lid ends near the axis: close it on the axis
        hot[-1] = (0.0, hot[-1][1])
    gnd = [(0.0, 0.0)]
    for a in lower:
        for q in a:
            q = (float(q[0]), float(q[1]))
            if q[0] > 2.5e-3 and math.dist(q, gnd[-1]) > 1e-5:
                gnd.append(q)
    return hot, gnd


HUB_R = 3.0e-3      # hub ring radius where the frames meet near the axis (a washer / soldered collar)


def _hubbed(path, z_axis_ok=True):
    """Cut a path where it touches the axis back to the hub ring: returns (path, hub points on the axis)."""
    out, hubs = list(path), []
    for end in (0, -1):
        q = out[end]
        if q[0] < 1e-9:
            nb = out[1] if end == 0 else out[-2]
            if nb[0] > HUB_R:                    # insert the ring point on the segment toward the neighbour
                t = HUB_R / nb[0]
                ring = (HUB_R, q[1] + t * (nb[1] - q[1]))
                if end == 0:
                    out[0] = ring
                else:
                    out[-1] = ring
            else:                                # the neighbour is itself inside the hub radius (the washer)
                out = out[1:] if end == 0 else out[:-1]
                ring = out[0] if end == 0 else out[-1]
            hubs.append(((0.0, q[1]), ring))
    return out, hubs


def model(fam, p, f, n, r, rings=True, axis=True, per=20, hub=4, hoop=0.0, seg=None, els=None, info=None, feed_ns=1):
    """NEC-2 model at f: n frames of wire radius r; wires that meet near the axis end on a hub ring (polygon of n
    chords, thinner wire) joined to the axis point by `hub` spokes. hoop > 0 (m): extra hoops along every path
    segment, at most that far apart. seg (m): fixed segment length instead of lambda / per. els: elevations (deg)
    for the pattern instead of ELS. info (dict): gets the NEC context, the tags of frame 0 ("frame0": [(tag, a, b)])
    and every wire ("wires": [(kind, a xyz, b xyz, radius)]). feed_ns: segments of the pin-gap wire, source on the
    middle one (the app's NEC export uses 5)."""
    hot, gnd = paths(fam, p)
    lam = 3e8 / f
    c = nec_context()
    G = c.get_geometry()
    tag = [1]
    frame0, wires = [], []
    def wire(a, b, rad, kind="frame"):
        L = math.dist(a, b)
        ns = max(1, int(math.ceil(L / (seg or lam / per))))
        tag[0] += 1
        G.wire(tag[0], ns, *a, *b, rad, 1, 1)
        wires.append((kind, a, b, rad))
        return tag[0]
    g = p["g"]
    G.wire(1, feed_ns, 0, 0, 0, 0, 0, g, 0.46e-3, 1, 1)       # feed: the pin gap
    xyz = lambda q, t: (q[0] * math.cos(t), q[0] * math.sin(t), q[1])
    ang = [2 * math.pi * k / n for k in range(n)]
    hubs = []
    for path in (hot, gnd):
        cut, h = _hubbed(path)
        hubs += h
        if hoop > 0:                             # subdivide long segments: the extra points carry hoops
            fine = [cut[0]]
            for a, b in zip(cut, cut[1:]):
                m = max(1, int(math.ceil(math.dist(a, b) / hoop)))
                fine += [(a[0] + (b[0] - a[0]) * i / m, a[1] + (b[1] - a[1]) * i / m) for i in range(1, m + 1)]
            cut = fine
        for t in ang:
            for a, b in zip(cut, cut[1:]):
                k = wire(xyz(a, t), xyz(b, t), r)
                if t == 0:
                    frame0.append((k, a, b))
        ring_r = [q for q in cut if q[0] >= 4e-3] if rings else []
        for q in ring_r + [hq for _, hq in h]:
            chord = 2 * q[0] * math.sin(math.pi / n)
            for k in range(n):
                wire(xyz(q, ang[k]), xyz(q, ang[(k + 1) % n]), min(r, chord / 4), "ring")
    for axis_pt, ring in hubs:                   # hub spokes from the axis to the ring
        for k in range(0, n, max(1, n // hub)):
            wire(xyz(axis_pt, 0), xyz(ring, ang[k]), min(r, 0.5e-3), "spoke")
    if axis and hot[-1][0] < 1e-9:
        wire((0, 0, g), (0, 0, hot[-1][1]), r, "axis")
    c.geometry_complete(0)
    c.ex_card(0, 1, feed_ns // 2 + 1, 0, 1.0, 0, 0, 0, 0, 0)
    c.fr_card(0, 1, f / 1e6, 0)
    if els is None:
        c.rp_card(0, len(ELS), 2, 0, 0, 0, 0, 90 - ELS[-1], 0, 5, 180 / n, 0, 0)     # theta0, phi0, dtheta, dphi: 40..75 deg, phi 0 and half a frame step
        shape = (len(ELS), 2)
    else:                                        # els ascending, evenly spaced; phi 0, a quarter and half a frame step
        d = els[1] - els[0]
        c.rp_card(0, len(els), 3, 0, 0, 0, 0, 90 - els[-1], 0, d, 90 / n, 0, 0)
        shape = (len(els), 3)
    z = c.get_input_parameters(0).get_impedance()[0]
    gg = np.array(c.get_radiation_pattern(0).get_gain()).reshape(shape)
    if info is not None:
        info.update(ctx=c, frame0=frame0, wires=wires)
    return z, gg


def swr(z, z0=50.0):
    gm = abs((z - z0) / (z + z0))
    return (1 + gm) / (1 - gm)


if __name__ == "__main__":
    fam = importlib.import_module(sys.argv[1])
    p = json.load(open(sys.argv[2]))
    p = p.get("p", p)
    n, r = int(sys.argv[3]), float(sys.argv[4]) * 1e-3
    rings = bool(int(sys.argv[5])) if len(sys.argv) > 5 else True
    axis = bool(int(sys.argv[6])) if len(sys.argv) > 6 else True
    f_lo = float(sys.argv[7]) if len(sys.argv) > 7 else 960e6
    f_hi = float(sys.argv[8]) if len(sys.argv) > 8 else 6.4e9
    worst, gs = 0.0, []
    for f in np.geomspace(f_lo, f_hi, 24):
        z, gg = model(fam, p, f, n, r, rings, axis)
        gavg = 10 * np.log10(np.mean(10 ** (gg / 10)))
        worst = max(worst, swr(z)); gs.append(gavg)
        print(f"{f/1e6:7.0f} MHz  Z {z.real:6.1f}{z.imag:+6.1f}j  SWR {swr(z):5.2f}  gain 15-50 deg mean {gavg:+.1f}, min {gg.min():+.1f} dBi")
    print(f"worst SWR {worst:.2f}, mean sky gain {np.mean(gs):+.2f} dBi")
