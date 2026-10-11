// Which wires / plates does a parameter change? Rebuild the design with the parameter nudged and diff.
import type { AntennaDef, Design, Params, Vec3 } from "./types";
import { formatBands, parseBands } from "./bands";

/** `all`: every drawn wire and plate changed (bands, element count…), so a highlight would say nothing. */
export interface Affected { wires: number[]; plates: number[]; all: boolean }

const far = (a: Vec3, b: Vec3, tol: number) => Math.abs(a[0] - b[0]) > tol || Math.abs(a[1] - b[1]) > tol || Math.abs(a[2] - b[2]) > tol;

function nudged(def: AntennaDef, params: Params, key: string): Params | null {
  const pd = def.params.find((x) => x.key === key);
  if (!pd) return null;
  const v = params[key];
  const next: Params = { ...params };
  if (pd.kind === "bands") {
    next[key] = formatBands(parseBands(String(v)).map(([a, b]) => [a * 1.02, b * 1.02]));
  } else if (pd.kind === "select") {
    const other = (pd.options ?? []).find(([o]) => o !== String(v));
    if (!other) return null;
    next[key] = other[0];
  } else {
    const n = typeof v === "number" ? v : parseFloat(String(v));
    if (!Number.isFinite(n)) return null;
    const step = pd.kind === "int" ? 1 : pd.step ?? Math.abs(n) * 0.02;
    let x = n + (step || 0.02);
    if (pd.max != null && x > pd.max) x = n - (step || 0.02);
    if (pd.min != null && x < pd.min) x = pd.min;
    if (x === n) return null;
    next[key] = x;
  }
  return next;
}

function diff(a: Design, b: Design): Affected | null {
  let scale = 0;
  for (const w of a.wires) for (const c of [...w.a, ...w.b]) scale = Math.max(scale, Math.abs(c));
  const tol = Math.max(scale, 1e-3) * 1e-6;
  const wires: number[] = [], plates: number[] = [];
  // A different wire count (elements, radials, turns) reshuffles the indices: light everything.
  if (a.wires.length !== b.wires.length) {
    for (let i = 0; i < a.wires.length; i++) wires.push(i);
    return wires.length ? { wires, plates: a.plates.map((_, i) => i), all: true } : null;
  }
  const nw = Math.min(a.wires.length, b.wires.length);
  for (let i = 0; i < nw; i++) {
    const p = a.wires[i], q = b.wires[i];
    if (far(p.a, q.a, tol) || far(p.b, q.b, tol) || Math.abs(p.r - q.r) > 1e-9 * Math.max(1, p.r * 1e3)) wires.push(i);
  }
  for (let i = nw; i < a.wires.length; i++) wires.push(i);
  const np = Math.min(a.plates.length, b.plates.length);
  for (let i = 0; i < a.plates.length; i++) {
    const p = a.plates[i], q = i < np ? b.plates[i] : null;
    if (!q || p.pts.length !== q.pts.length || p.pts.some((pt, k) => far(pt, q.pts[k], tol)) || Math.abs(p.thickness - q.thickness) > 1e-9) plates.push(i);
  }
  const drawn = a.wires.filter((w) => !w.necOnly).length;
  const all = wires.filter((i) => !a.wires[i].necOnly).length === drawn && plates.length === a.plates.length;
  return wires.length || plates.length ? { wires, plates, all } : null;
}

const cache = new Map<string, Affected | null>();

export function affected(def: AntennaDef, params: Params, key: string): Affected | null {
  const id = `${def.id}|${key}|${JSON.stringify(params)}`;
  if (cache.has(id)) return cache.get(id)!;
  let res: Affected | null = null;
  try {
    const np = nudged(def, params, key);
    if (np) res = diff(def.build(params), def.build(np));
  } catch {
    res = null;
  }
  if (cache.size > 200) cache.clear();
  cache.set(id, res);
  return res;
}
