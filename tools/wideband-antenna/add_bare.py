"""Put export_bare_table.py results into the app's table file (the free-space tables stay as they are):
python add_bare.py ../../src/lib/antennas/skycone.data.ts SKYCONE_7=bare_S73.json SKYCONE_8=bare_B.json ...
Each NAME=file sets (or replaces) the `bare` block of that entry: {lensLam, f, r, x}."""
import json, re, sys

path = sys.argv[1]
src = open(path).read()
for arg in sys.argv[2:]:
    name, fn = arg.split("=", 1)
    b = json.load(open(fn))
    assert b.get("lensLam"), f"{fn}: fixed LENS_M lengths, not wavelengths: not for the app"
    bare = dict(lensLam=b["lensLam"], f=b["f"], r=b["r"], x=b["x"])
    m = re.search(rf"^export const {name}: SkyconeTable = (\{{.*\}});$", src, re.M)
    assert m, f"{name} not found in {path}"
    obj = json.loads(m.group(1))
    obj["bare"] = bare
    src = src[:m.start(1)] + json.dumps(obj, separators=(",", ":")) + src[m.end(1):]
    print(f"{name}: bare cable {', '.join(str(v) for v in b['lensLam'])} lambda, {len(b['f'])} frequencies")
open(path, "w").write(src)
