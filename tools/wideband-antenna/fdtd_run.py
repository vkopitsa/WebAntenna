"""Run the axisymmetric FDTD on a family design and compare with the BoR-MoM (same cable)."""
import sys, json, math, time
import numpy as np
import fdtd_bor as FD
import family as F
import designs as D
import bor


def _dist_to_poly(R, Z, poly):
    d = np.full(R.shape, np.inf)
    for (r0, z0), (r1, z1) in zip(poly[:-1], poly[1:]):
        vr, vz = r1 - r0, z1 - z0
        L2 = vr * vr + vz * vz
        t = np.clip(((R - r0) * vr + (Z - z0) * vz) / L2, 0, 1)
        d = np.minimum(d, np.hypot(R - (r0 + t * vr), Z - (z0 + t * vz)))
    return d


def build(p, Lc, hmin=0.15e-3, hmax=2e-3, margin=0.25, eps_ptfe=2.1, shells=()):
    """shells: [(polyline [(rho, z), ...], thickness_m, eps_r)] dielectric sheets (radome, holders)."""
    upper, lower, ztop, zbot, rmax = F.profile(p)
    a, b, g = D.A_PIN, D.B_COAX, p["g"]
    z_cb = zbot - Lc                       # cable (coax) bottom end
    r_keys = [(0.0, 2 * hmin), (a, hmin), (b, hmin)]
    z_keys = [(0.0, hmin), (g, hmin), (ztop, 0.5e-3), (zbot, 0.5e-3), (z_cb, 0.5e-3)]
    for poly in upper + lower:
        for x, y in poly:
            r_keys.append((x, 0.4e-3))
            z_keys.append((y, 0.4e-3))
    for poly, th, _ in shells:
        for x, y in poly:
            for d in (-th / 2, th / 2):
                r_keys.append((x + d, th / 3))
                z_keys.append((y + d, th / 3))
    npml = 20
    r1 = rmax + margin
    rn = FD.graded(r_keys, 0.0, r1, hmax)
    rn = np.concatenate([rn, rn[-1] + hmax * np.arange(1, npml + 1)])
    z0, z1 = z_cb - margin, ztop + margin
    zn = FD.graded(z_keys, z0, z1, hmax)
    zn = np.concatenate([zn[0] - hmax * np.arange(npml, 0, -1), zn, zn[-1] + hmax * np.arange(1, npml + 1)])
    S = FD.Sim(rn, zn, npml=npml)
    # inner conductor rod (coax centre + pin) from the cable bottom to the hot element
    ia = S.ir(a)
    mz = (S.zc > z_cb) & (S.zc < g)
    S.pec_z[: ia + 1, mz] = True
    mzn = (S.zn >= z_cb - 1e-12) & (S.zn <= g + 1e-12)
    S.pec_r[np.ix_(S.rc < a, mzn)] = True
    # coax outer conductor / cable shield and its bottom closure
    S.pec_vseg(b, z_cb, 0.0)
    S.pec_hseg(z_cb, a, b)
    # PTFE fill
    mr = (S.rc > a) & (S.rc < b)
    S.epsr_r[np.ix_(mr, (S.zn > z_cb) & (S.zn < 0))] = eps_ptfe
    S.epsr_r[np.ix_(mr, np.abs(S.zn) < 1e-12)] = 0.5 * (1 + eps_ptfe)
    mrn = (S.rn > a) & (S.rn < b)
    S.epsr_z[np.ix_(mrn, (S.zc > z_cb) & (S.zc < 0))] = eps_ptfe
    # matched lossy termination at the bottom 40 mm of the coax
    L_abs = 0.04
    smax = 3.0 * eps_ptfe * FD.EPS0 * FD.C0 / math.sqrt(eps_ptfe) / L_abs * 4
    def sg(z):
        s = np.clip((z_cb + L_abs - z) / L_abs, 0, 1)
        return smax * s ** 3
    S.sig_r[np.ix_(mr, (S.zn > z_cb) & (S.zn < z_cb + L_abs))] = sg(S.zn[(S.zn > z_cb) & (S.zn < z_cb + L_abs)])[None, :]
    S.sig_z[np.ix_(mrn, (S.zc > z_cb) & (S.zc < z_cb + L_abs))] = sg(S.zc[(S.zc > z_cb) & (S.zc < z_cb + L_abs)])[None, :]
    mh = (S.zc > z_cb) & (S.zc < z_cb + L_abs)
    S.sigm[np.ix_(mr, mh)] = sg(S.zc[mh])[None, :] * FD.MU0 / (eps_ptfe * FD.EPS0)
    # dielectric shells (before the metal so metal wins where they touch)
    for poly, th, er in shells:
        poly = np.asarray(poly, float)
        Rr, Zr = np.meshgrid(S.rc, S.zn, indexing="ij")
        S.epsr_r[_dist_to_poly(Rr, Zr, poly) <= th / 2] = er
        Rz, Zz = np.meshgrid(S.rn, S.zc, indexing="ij")
        S.epsr_z[_dist_to_poly(Rz, Zz, poly) <= th / 2] = er
    # antenna sheets
    for poly in upper + lower:
        S.pec_poly(poly)
    port = dict(a=a, b=b, z_src=-0.015, z_meas=-0.004, epsr=eps_ptfe)
    return S, port, z_cb


def run(p, Lc, freqs, nsteps=400000, nf_freqs=None, fam=None, **kw):
    global F
    if fam is not None:
        F = fam
    S, port, z_cb = build(p, Lc, **kw)
    t = time.time()
    tau = 2.0 / (math.pi * 8e9)
    nf = None
    if nf_freqs is not None:
        upper, lower, ztop, zbot, rmax = F.profile(p)
        nf = dict(r=rmax + 0.06, zb=z_cb - 0.06, zt=ztop + 0.06, freqs=nf_freqs)
    V, I, dt = S.run(port, nsteps, tau, stop_rel=2e-5, nf=nf)
    Z, Z0 = S.impedance(V, I, dt, freqs, port)
    info = dict(cells=S.Nr * S.Nz, steps=len(V), dt=dt, T=len(V) * dt, secs=time.time() - t, Z0=Z0)
    if nf is not None:
        th = np.radians(np.arange(0, 180.1, 1.0))
        G, ratio = S.far_gain(V, I, dt, port, th)
        info["gain"], info["prad_ratio"], info["theta"] = G, ratio, th
    return Z, info


if __name__ == "__main__":
    p = json.loads(sys.argv[1])
    Lc = float(sys.argv[2])
    fs = D.logf(int(sys.argv[3]) if len(sys.argv) > 3 else 25)
    Z, info = run(p, Lc, fs)
    print(info)
    rows = bor.run(F.geometry(p, cable=Lc), fs, per_lambda=24, pattern=False)
    print("  f MHz |  FDTD R    X    SWR |  MoM R     X    SWR")
    for f, z, r in zip(fs, Z, rows):
        print(f"{f/1e6:7.1f} | {z.real:6.1f} {z.imag:6.1f} {bor.swr(z):5.2f} | {r['Z'].real:6.1f} {r['Z'].imag:6.1f} {r['swr']:5.2f}")
