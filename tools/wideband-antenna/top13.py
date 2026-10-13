"""Top candidates of a family-13 search log (eval_<tag>.jsonl from opt_cma.py or rand_<tag>.jsonl from random13.py):
  python top13.py results/rand_rt40.jsonl 5 [name ...]
prints the k best costs with the named parameters (default: the ones that are not at a family default), and how
many of the samples were rejected by the geometry rules (cost >= 30) or stopped by ABORT (cost > ABORT: two
frequencies only)."""
import json
import sys
import family13 as F

PROFILE = ("ru", "kx", "ky", "ht", "hc", "capu", "gd", "rl", "gkx", "gky", "gs", "shr")
rows = [json.loads(l) for l in open(sys.argv[1])]
k = int(sys.argv[2]) if len(sys.argv) > 2 else 5
names = sys.argv[3:]
rows.sort(key=lambda r: r["c"])
n = len(rows)
rej = sum(F.REJECT <= r["c"] < F.FAIL for r in rows)
fail = sum(r["c"] >= F.FAIL for r in rows)
print(f"{n} samples ({rej} rejected by the geometry rules, {fail} NEC failures / timeouts), best {rows[0]['c']:.3f}, "
      f"median {rows[n // 2]['c']:.2f}")
SPRING = {"th": ("th", "ch", "ah0", "ah1"), "tg": ("tg", "cg", "ag0", "ag1"), "ts": ("ts", "cs")}
for r in rows[:k]:
    q = {m: F.DEFAULTS.get(m, 0.0) for m in F.NAMES}      # a log from before a parameter was added
    q.update(F.unpack(r["x"]))
    coil = [m for t, ms in SPRING.items() if q[t] >= 0.5 for m in ms]
    show = names or [m for m in F.NAMES if m not in ("g", "r0u", "sh") and (m in PROFILE or m in coil or (
        m not in sum(SPRING.values(), ()) and abs(q[m] - F.DEFAULTS.get(m, 0.0)) > 1e-9))]
    print(f"{r['c']:8.3f}  " + " ".join(f"{m}={q[m]:.3g}" for m in show))
