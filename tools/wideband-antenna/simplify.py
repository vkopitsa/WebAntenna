import os, sys, json, math
import numpy as np
import family6 as F, bor, designs as D
B = json.load(open(sys.argv[1]))
fs = D.logf(30, 760e6, 6.6e9)
def score(p, label):
    rows = D.evaluate(F.geometry(p), fs, per_lambda=14, els=F.ELS)
    sw = max(r["swr"] for r in rows if 799e6 <= r["f"] <= 6.41e9)
    G = np.array([r["g"] for r in rows if 799e6 <= r["f"] <= 6.41e9])
    gavg = 10 * np.log10(np.mean(10 ** (G / 10), axis=1))
    cab = []
    for Lc, ch in ((0.1, None), (0.2, None), (0.35, None), (0.1, (0.01, 150.0)), (0.35, (0.01, 150.0))):
        rr = bor.run(F.geometry(p, cable=Lc, choke=ch), D.logf(10, 800e6, 2e9), per_lambda=14, pattern=False)
        cab.append(max(r["swr"] for r in rr))
    H, Dm = F.size(p)
    print(f"{label:34s} H {H*1e3:5.1f} D {Dm*1e3:5.1f} | SWR max {sw:4.2f} | sky 15-50: worst {G.min():5.1f} dBi, avg-min {gavg.min():4.1f} dBi | cable no-fer 10/20/35 {cab[0]:.2f}/{cab[1]:.2f}/{cab[2]:.2f}  fer 10/35 {cab[3]:.2f}/{cab[4]:.2f}")
score(B, "B as optimised")
v1 = dict(B, capu=1.0); score(v1, "v1: closed lid")
zg = -(math.cos(math.radians(B["al1"])) * B["Ll1"] + (B["Rl"] - D.B_COAX - math.sin(math.radians(B["al1"])) * B["Ll1"]) / math.tan(math.radians(B["al2"])))
ang = math.degrees(math.atan((B["Rl"] - D.B_COAX) / -zg))
v2 = dict(v1, al1=ang, al2=ang, Ll1=0.0, Sl=0.0); score(v2, f"v2: v1 + one ground cone {ang:.1f} deg")
def rnd(p):
    q = {}
    for k, v in p.items():
        if k in ("au1", "au2", "al1", "al2"): q[k] = round(v * 2) / 2
        elif k == "capu": q[k] = v
        elif k == "g": q[k] = round(v * 1e4) / 1e4   # 0.1 mm
        else: q[k] = round(v * 2e3) / 2e3            # 0.5 mm
    return q
score(rnd(v2), "v3: v2 rounded (0.5 mm, 0.5 deg)")
json.dump(rnd(v2), open(sys.argv[2], "w"), indent=1)
json.dump(rnd(B), open(sys.argv[3], "w"), indent=1)
score(rnd(B), "B rounded (no simplification)")
