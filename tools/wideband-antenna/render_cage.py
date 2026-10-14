"""3D view and side profile of a family-10 (shaped) wire cage, from the NEC wire list:
python render_cage.py <design.json> <out.png> [title]"""
import sys, json, math
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import family10 as F
import family13  # noqa: F401  (shunt coils, csh / cser of the split-study designs)

p = json.load(open(sys.argv[1]))
p = F.full(p.get("p", p))
info = {}
F.model(p, 1e9, info=info)
H, Dm = F.size(p)
fig = plt.figure(figsize=(11, 5.2))
ax = fig.add_subplot(1, 2, 1, projection="3d")
col = dict(frame="#1f6fb4", frame0="#1f6fb4", ring="#d9822b", spoke="#888888", axis="#1f6fb4", leg="#c2185b", shunt="#c2185b", feed="k")
for kind, a, b, r in info["wires"]:
    ax.plot(*[(a[k] * 1e3, b[k] * 1e3) for k in range(3)], color=col.get(kind, "k"), lw=2.2 if kind in ("shunt", "shuntc") else 0.9)
ax.plot([0, 0], [0, 0], [0, p["g"] * 1e3], color="k", lw=2)
m = max(H, Dm) * 1e3 / 2
zc = (F.build(p)["top"] + F.build(p)["bot"]) * 1e3 / 2
ax.set_xlim(-m, m); ax.set_ylim(-m, m); ax.set_zlim(zc - m, zc + m)
ax.set_box_aspect((1, 1, 1))
ax.view_init(elev=18, azim=-60)
ax.set_xlabel("x, mm"); ax.set_ylabel("y, mm"); ax.set_zlabel("z, mm")
ax2 = fig.add_subplot(1, 2, 2)
b = F.build(p)
for part, c in (("hot", "#1f6fb4"), ("gnd", "#2e7d32")):
    for pl in b[part]:
        ax2.plot([q[0] * 1e3 for q in pl], [q[1] * 1e3 for q in pl], color=c, lw=1.5)
        ax2.plot([-q[0] * 1e3 for q in pl], [q[1] * 1e3 for q in pl], color=c, lw=1.5)
if b["nleg"]:
    ax2.plot([q[0] * 1e3 for q in b["legs"]], [q[1] * 1e3 for q in b["legs"]], color="#c2185b", lw=1.5)
if b["nsh"]:
    ax2.plot([q[0] * 1e3 for q in b["shunt"]], [q[1] * 1e3 for q in b["shunt"]], color="#c2185b", lw=2.2, label="shorting wire")
    ax2.legend(loc="center right", fontsize=8)
for q in b["hoops"]:
    ax2.plot([q[0] * 1e3, -q[0] * 1e3], [q[1] * 1e3] * 2, color="#d9822b", lw=0.6, alpha=0.6)
ax2.set_aspect("equal")
ax2.grid(alpha=0.3)
ax2.set_xlabel("rho, mm (profile, frames unrolled)"); ax2.set_ylabel("z, mm")
ax2.set_title(f"D {Dm*1e3:.1f} x H {H*1e3:.1f} mm")
fig.suptitle(sys.argv[3] if len(sys.argv) > 3 else sys.argv[1])
fig.tight_layout()
fig.savefig(sys.argv[2], dpi=110)
