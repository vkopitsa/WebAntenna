"""Axisymmetric (m = 0) FDTD: E_rho, E_z, H_phi on a graded (rho, z) Yee grid, CPML on the outer
boundaries, PEC sheets staircased, coax feed modelled physically: PTFE-filled coax (a < rho < b)
running down from the aperture at z = 0, soft TEM source inside, matched lossy termination at its
bottom.  Port V and I are sampled in the coax and de-embedded to the aperture plane.

Independent of the MoM code (different method, different feed model, staircased geometry)."""
import math
import numpy as np
from numba import njit, prange

C0 = 299792458.0
MU0 = 4e-7 * math.pi
EPS0 = 1.0 / (MU0 * C0 * C0)
ETA0 = MU0 * C0


def graded(keys, x0, x1, hmax, ratio=1.12):
    """Grid lines on [x0, x1] containing every key x with local spacing h; spacing grows
    geometrically (ratio) away from keys, capped at hmax.  keys: list of (x, h)."""
    keys = sorted([(x, h) for x, h in keys if x0 - 1e-12 <= x <= x1 + 1e-12])
    xs = np.linspace(x0, x1, int((x1 - x0) / 1e-5) + 1)
    h = np.full_like(xs, hmax)
    for x, hk in keys:
        h = np.minimum(h, hk + (ratio - 1.0) * np.abs(xs - x))
    pins = sorted(set([x0, x1] + [x for x, _ in keys]))
    lines = [pins[0]]
    for p, q in zip(pins[:-1], pins[1:]):
        m = (xs >= p) & (xs <= q)
        xx, hh = xs[m], h[m]
        if len(xx) < 2:
            lines.append(q)
            continue
        cum = np.concatenate([[0], np.cumsum(0.5 * (1 / hh[1:] + 1 / hh[:-1]) * np.diff(xx))])
        n = max(1, int(math.ceil(cum[-1] - 1e-9)))
        t = np.linspace(0, cum[-1], n + 1)[1:]
        lines.extend(np.interp(t, cum, xx).tolist())
    return np.array(lines)


@njit(parallel=True, cache=True)
def step_H(Hp, Er, Ez, chh, chc, dr, dz, kr_h, kz_h, br_h, ar_h, bz_h, az_h, psi_hr, psi_hz, ir0, jz0, jz1):
    Nr, Nz = Hp.shape
    for i in prange(Nr):
        for j in range(Nz):
            dEz = (Ez[i + 1, j] - Ez[i, j]) / dr[i]
            dEr = (Er[i, j + 1] - Er[i, j]) / dz[j]
            if i >= ir0:
                psi_hr[i, j] = br_h[i] * psi_hr[i, j] + ar_h[i] * dEz
                dEz = dEz / kr_h[i] + psi_hr[i, j]
            if j < jz0 or j >= jz1:
                psi_hz[i, j] = bz_h[j] * psi_hz[i, j] + az_h[j] * dEr
                dEr = dEr / kz_h[j] + psi_hz[i, j]
            Hp[i, j] = chh[i, j] * Hp[i, j] + chc[i, j] * (dEz - dEr)


@njit(parallel=True, cache=True)
def step_E(Hp, Er, Ez, cra, crb, cza, czb, rn, rc, dzd, drd, kz_e, bz_e, az_e, kr_e, br_e, ar_e, psi_ez, psi_er, ir0, jz0, jz1):
    Nr, Nz = Hp.shape
    # E_rho at (rc[i], zn[j]), j = 1 .. Nz-1
    for i in prange(Nr):
        for j in range(1, Nz):
            dH = (Hp[i, j] - Hp[i, j - 1]) / dzd[j]
            if j <= jz0 or j >= jz1:
                psi_ez[i, j] = bz_e[j] * psi_ez[i, j] + az_e[j] * dH
                dH = dH / kz_e[j] + psi_ez[i, j]
            Er[i, j] = cra[i, j] * Er[i, j] - crb[i, j] * dH
    # E_z at (rn[i], zc[j]), i = 0 .. Nr-1
    for j in prange(Nz):
        Ez[0, j] = cza[0, j] * Ez[0, j] + czb[0, j] * (2.0 * Hp[0, j] / rc[0])
        for i in range(1, Nr):
            if i >= ir0:
                dH = (Hp[i, j] - Hp[i - 1, j]) / drd[i]
                psi_er[i, j] = br_e[i] * psi_er[i, j] + ar_e[i] * dH
                curl = dH / kr_e[i] + psi_er[i, j] + 0.5 * (Hp[i, j] + Hp[i - 1, j]) / rn[i]
            else:
                curl = 2.0 * (rc[i] * Hp[i, j] - rc[i - 1] * Hp[i - 1, j]) / (rc[i] * rc[i] - rc[i - 1] * rc[i - 1])
            Ez[i, j] = cza[i, j] * Ez[i, j] + czb[i, j] * curl


def cpml_profile(x, x_in, x_out, dt, m=3, kmax=3.0, amax=0.003, rfac=1.0):
    """CPML coefficients at positions x for a layer from x_in (inner face) to x_out."""
    d = abs(x_out - x_in)
    s = np.clip((x - x_in) / (x_out - x_in), 0, 1)
    h = d / 20.0
    smax = rfac * 0.8 * (m + 1) / (ETA0 * h)
    sig = smax * s ** m
    kap = 1 + (kmax - 1) * s ** m
    alp = amax * (1 - s)
    b = np.exp(-(sig / kap + alp) * dt / EPS0)
    with np.errstate(invalid="ignore", divide="ignore"):
        a = np.where(sig > 0, sig / (sig * kap + kap * kap * alp) * (b - 1), 0.0)
    return kap, b, a


class Sim:
    def __init__(self, rn, zn, npml=20):
        self.rn, self.zn = rn, zn
        Nr, Nz = len(rn) - 1, len(zn) - 1
        self.Nr, self.Nz = Nr, Nz
        self.rc = 0.5 * (rn[1:] + rn[:-1])
        self.zc = 0.5 * (zn[1:] + zn[:-1])
        self.dr = np.diff(rn)
        self.dz = np.diff(zn)
        self.drd = np.zeros(Nr + 1)
        self.drd[1:Nr] = self.rc[1:] - self.rc[:-1]
        self.dzd = np.zeros(Nz + 1)
        self.dzd[1:Nz] = self.zc[1:] - self.zc[:-1]
        self.epsr_r = np.ones((Nr, Nz + 1))
        self.epsr_z = np.ones((Nr + 1, Nz))
        self.sig_r = np.zeros((Nr, Nz + 1))
        self.sig_z = np.zeros((Nr + 1, Nz))
        self.sigm = np.zeros((Nr, Nz))
        self.pec_r = np.zeros((Nr, Nz + 1), bool)
        self.pec_z = np.zeros((Nr + 1, Nz), bool)
        self.npml = npml
        hmin = min(self.dr.min(), self.dz.min())
        self.dt = 0.95 / (C0 * math.sqrt(1 / self.dr.min() ** 2 + 1 / self.dz.min() ** 2))

    # --- geometry helpers --------------------------------------------------------------
    def ir(self, r):
        return int(np.argmin(np.abs(self.rn - r)))

    def jz(self, z):
        return int(np.argmin(np.abs(self.zn - z)))

    def pec_hseg(self, z, r0, r1):
        j = self.jz(z)
        m = (self.rc > min(r0, r1)) & (self.rc < max(r0, r1))
        self.pec_r[m, j] = True

    def pec_vseg(self, r, z0, z1):
        i = self.ir(r)
        m = (self.zc > min(z0, z1)) & (self.zc < max(z0, z1))
        self.pec_z[i, m] = True

    def pec_poly(self, pts):
        """Staircase a polyline: walk node to node, one grid edge at a time."""
        pts = np.asarray(pts, float)
        dense = []
        for p, q in zip(pts[:-1], pts[1:]):
            n = int(np.hypot(*(q - p)) / 5e-5) + 2
            dense.append(np.column_stack([np.linspace(p[0], q[0], n), np.linspace(p[1], q[1], n)]))
        dense = np.vstack(dense)
        nodes = [(self.ir(x), self.jz(y)) for x, y in dense]
        path = [nodes[0]]
        for nd in nodes[1:]:
            if nd != path[-1]:
                path.append(nd)
        for (i0, j0), (i1, j1) in zip(path[:-1], path[1:]):
            while (i0, j0) != (i1, j1):
                if i0 != i1 and (j0 == j1 or abs(i1 - i0) >= abs(j1 - j0)):
                    s = 1 if i1 > i0 else -1
                    self.pec_r[min(i0, i0 + s), j0] = True
                    i0 += s
                else:
                    s = 1 if j1 > j0 else -1
                    self.pec_z[i0, min(j0, j0 + s)] = True
                    j0 += s

    # --- run -------------------------------------------------------------------------
    def run(self, port, nsteps, src_tau, record_every=1, stop_rel=1e-5, min_steps=2000, nf=None):
        """nf: dict(r=side radius, zb=bottom z, zt=top z, freqs=[...]) -> running DFTs on that box."""
        Nr, Nz = self.Nr, self.Nz
        dt = self.dt
        epsr, epsz = self.epsr_r * EPS0, self.epsr_z * EPS0
        def coef(eps, sig, pec):
            f = sig * dt / (2 * eps)
            a = (1 - f) / (1 + f)
            b = (dt / eps) / (1 + f)
            a[pec] = 0
            b[pec] = 0
            return a, b
        cra, crb = coef(epsr, self.sig_r, self.pec_r)
        cza, czb = coef(epsz, self.sig_z, self.pec_z)
        fm = self.sigm * dt / (2 * MU0)
        chh = (1 - fm) / (1 + fm)
        chc = (dt / MU0) / (1 + fm)
        # outer boundaries: PEC behind the CPML
        cza[-1, :] = 0
        czb[-1, :] = 0
        cra[:, 0] = cra[:, -1] = 0
        crb[:, 0] = crb[:, -1] = 0
        npml = self.npml
        ir0 = Nr - npml
        jz0, jz1 = npml, Nz - npml
        rin, rout = self.rn[ir0], self.rn[-1]
        kr_h, br_h, ar_h = cpml_profile(self.rc, rin, rout, dt)
        kr_e, br_e, ar_e = cpml_profile(self.rn, rin, rout, dt)
        zlo_in, zlo_out = self.zn[jz0], self.zn[0]
        zhi_in, zhi_out = self.zn[jz1], self.zn[-1]
        def zprof(x):
            k1, b1, a1 = cpml_profile(x, zlo_in, zlo_out, dt)
            k2, b2, a2 = cpml_profile(x, zhi_in, zhi_out, dt)
            lo = x < zlo_in
            return np.where(lo, k1, k2), np.where(lo, b1, b2), np.where(lo, a1, a2)
        kz_h, bz_h, az_h = zprof(self.zc)
        kz_e, bz_e, az_e = zprof(self.zn)
        Hp = np.zeros((Nr, Nz))
        Er = np.zeros((Nr, Nz + 1))
        Ez = np.zeros((Nr + 1, Nz))
        psi_hr = np.zeros((Nr, Nz))
        psi_hz = np.zeros((Nr, Nz))
        psi_ez = np.zeros((Nr, Nz + 1))
        psi_er = np.zeros((Nr + 1, Nz))
        # port
        a, b = port["a"], port["b"]
        ia, ib = self.ir(a), self.ir(b)
        js, jm = self.jz(port["z_src"]), self.jz(port["z_meas"])
        rr = self.rc[ia:ib]
        shape = 1.0 / (rr * math.log(b / a))
        drs = self.dr[ia:ib]
        t0 = 5 * src_tau
        V, I = [], []
        peak = 0.0
        if nf is not None:
            i_s, jb, jt = self.ir(nf["r"]), self.jz(nf["zb"]), self.jz(nf["zt"])
            nfw = 2 * math.pi * np.asarray(nf["freqs"], float)
            K = len(nfw)
            acc = {k: None for k in ("Ez_s", "H_s", "Er_t", "H_t", "Er_b", "H_b")}
            def add(key, arr, ph):
                v = ph[:, None] * arr[None, :]
                if acc[key] is None:
                    acc[key] = v
                else:
                    acc[key] += v
            self.nfbox = (i_s, jb, jt)
        for n in range(nsteps):
            step_H(Hp, Er, Ez, chh, chc, self.dr, self.dz, kr_h, kz_h, br_h, ar_h, bz_h, az_h, psi_hr, psi_hz, ir0, jz0, jz1)
            step_E(Hp, Er, Ez, cra, crb, cza, czb, self.rn, self.rc, self.dzd, self.drd, kz_e, bz_e, az_e, kr_e, br_e, ar_e, psi_ez, psi_er, ir0, jz0, jz1)
            t = (n + 1) * dt
            x = (t - t0) / src_tau
            Er[ia:ib, js] += -2 * x * math.exp(-x * x) * shape
            # V at t=(n+1)dt on plane jm;  I at (n+1/2)dt from H on both sides of the plane (averaged)
            v = float(np.sum(Er[ia:ib, jm] * drs))
            hh = 0.5 * (Hp[ia:ib, jm] + Hp[ia:ib, jm - 1])
            cur = float(np.mean(2 * math.pi * rr * hh))
            V.append(v)
            I.append(cur)
            if nf is not None:
                phE = np.exp(-1j * nfw * (n + 1) * dt)
                phH = np.exp(-1j * nfw * (n + 0.5) * dt)
                add("Ez_s", Ez[i_s, jb:jt], phE)
                add("H_s", 0.5 * (Hp[i_s - 1, jb:jt] + Hp[i_s, jb:jt]), phH)
                add("Er_t", Er[:i_s, jt], phE)
                add("H_t", 0.5 * (Hp[:i_s, jt - 1] + Hp[:i_s, jt]), phH)
                add("Er_b", Er[:i_s, jb], phE)
                add("H_b", 0.5 * (Hp[:i_s, jb - 1] + Hp[:i_s, jb]), phH)
            peak = max(peak, abs(v))
            if n > min_steps and n % 500 == 0:
                tail = np.max(np.abs(V[-500:]))
                if tail < stop_rel * peak and t > 3 * t0:
                    break
        if nf is not None:
            self.nfacc = acc
            self.nffreqs = np.asarray(nf["freqs"], float)
        return np.array(V), np.array(I), dt

    def far_gain(self, V, I, dt, port, theta):
        """Gain (dBi, relative to accepted power at the port) vs theta for each NF2FF frequency.
        Returns (gain[nf, ntheta], Prad/Pacc[nf])."""
        from scipy.special import j0, j1
        i_s, jb, jt = self.nfbox
        acc = self.nfacc
        n = np.arange(len(V))
        out, ratio = [], []
        for q, f in enumerate(self.nffreqs):
            w = 2 * math.pi * f
            k = w / C0
            Vf = np.sum(V * np.exp(-1j * w * (n + 1) * dt))
            If = np.sum(I * np.exp(-1j * w * (n + 0.5) * dt))
            Pacc = 0.5 * np.real(Vf * np.conj(If))
            th = np.asarray(theta)[:, None]
            # side rho = R: J_z = H, M_phi = E_z ; points zc[jb:jt], dl = dz
            R = self.rn[i_s]
            zs, dls = self.zc[jb:jt], self.dz[jb:jt]
            x = k * R * np.sin(th)
            ph = np.exp(1j * k * zs[None, :] * np.cos(th))
            Jz, Mp = acc["H_s"][q], acc["Ez_s"][q]
            Nth = np.sum(R * dls * ph * (-Jz * np.sin(th) * 2 * math.pi * j0(x)), axis=1)
            Lph = np.sum(R * dls * ph * (Mp * 2j * math.pi * j1(x)), axis=1)
            for key_e, key_h, z, sgn in (("Er_t", "H_t", self.zn[jt], 1.0), ("Er_b", "H_b", self.zn[jb], -1.0)):
                rr, dl = self.rc[:i_s], self.dr[:i_s]
                x = k * rr[None, :] * np.sin(th)
                ph = np.exp(1j * k * z * np.cos(th))
                Jr = -sgn * acc[key_h][q]
                Mp = -sgn * acc[key_e][q]
                Nth = Nth + np.sum(rr * dl * ph * (Jr * np.cos(th) * 2j * math.pi * j1(x)), axis=1)
                Lph = Lph + np.sum(rr * dl * ph * (Mp * 2j * math.pi * j1(x)), axis=1)
            U = k * k / (32 * math.pi ** 2 * ETA0) * np.abs(ETA0 * Nth + Lph) ** 2
            thv = np.asarray(theta)
            Prad = 2 * math.pi * np.trapz(U * np.sin(thv), thv)
            out.append(10 * np.log10(np.maximum(4 * math.pi * U / Pacc, 1e-30)))
            ratio.append(Prad / Pacc)
        return np.array(out), np.array(ratio)

    def impedance(self, V, I, dt, freqs, port):
        n = np.arange(len(V))
        out = []
        epsr = port.get("epsr", 2.1)
        Z0 = 60 / math.sqrt(epsr) * math.log(port["b"] / port["a"])
        zm = self.zn[self.jz(port["z_meas"])]
        l = -zm
        for f in freqs:
            w = 2 * math.pi * f
            ev = np.exp(-1j * w * (n + 1) * dt)
            Vf = np.sum(V * ev)
            If = np.sum(I * np.exp(-1j * w * (n + 0.5) * dt))
            Zm = Vf / If
            beta = w * math.sqrt(epsr) / C0
            tn = math.tan(beta * l)
            ZL = Z0 * (Zm - 1j * Z0 * tn) / (Z0 - 1j * Zm * tn)
            out.append(ZL)
        return np.array(out), Z0
