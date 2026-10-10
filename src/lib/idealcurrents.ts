// Assumed current distributions for the antennas the wire solver cannot model (Radiation view only): the patch's
// TM10 sheet current, the coaxial collinear's in-phase half-wave sections and the small loop's uniform current.
// Same element basis as the MoM currents, so the near-field code and the current glow use them unchanged.
import type { Design, Vec3 } from "./types";
import type { CurrentElement } from "./mom";

export interface IdealCurrents { els: CurrentElement[]; segs: Float64Array; ir: Float64Array; ii: Float64Array }

/** Path a → b in n pieces carrying current I(t), t ∈ [0, 1] along the path. */
function path(a: Vec3, b: Vec3, n: number, I: (t: number) => number, r: number, out: { els: CurrentElement[]; segs: number[]; ir: number[] }): void {
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, tm = (t0 + t1) / 2;
    const p: Vec3 = [a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0, a[2] + (b[2] - a[2]) * t0];
    const q: Vec3 = [a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1, a[2] + (b[2] - a[2]) * t1];
    const c = I(tm);
    out.els.push({ dl: [q[0] - p[0], q[1] - p[1], q[2] - p[2]], mid: [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], cr: c, ci: 0, r });
    out.segs.push(...p, ...q);
    out.ir.push(c);
  }
}

/** Assumed currents for patch, collinear and pcbloop; null for every other type. */
export function idealCurrents(defId: string, d: Design): IdealCurrents | null {
  const out = { els: [] as CurrentElement[], segs: [] as number[], ir: [] as number[] };
  if (defId === "patch" && d.pcb) {
    // TM10 current along x over the patch copper, cos(πx/L) about its centre
    const p = d.pcb.rects.filter((q) => q.label === "Patch");
    if (!p.length) return null;
    const x0 = Math.min(...p.map((q) => q.x0)), x1 = Math.max(...p.map((q) => q.x1)), y0 = Math.min(...p.map((q) => q.y0)), y1 = Math.max(...p.map((q) => q.y1));
    const ny = 5, z = d.pcb.h;
    for (let j = 0; j < ny; j++) {
      const y = y0 + ((y1 - y0) * (j + 0.5)) / ny;
      path([x0, y, z], [x1, y, z], 16, (t) => Math.sin(Math.PI * t), (y1 - y0) / ny / 4, out);
    }
  } else if (defId === "collinear") {
    // sections in phase: each a half-sine standing wave; the top whip a quarter-sine to zero at its tip
    for (const w of d.wires) {
      const isWhip = w.tag === "W";
      path(w.a, w.b, 16, isWhip ? (t) => Math.cos((Math.PI / 2) * t) * 0.7 : (t) => Math.sin(Math.PI * t), w.r, out);
    }
  } else if (defId === "pcbloop") {
    // small loop: uniform current around the rectangle at the trace centre (from the drawn loop strips)
    const loop = d.plates.filter((q) => q.label === "Loop");
    if (!loop.length) return null;
    const xs = loop.flatMap((q) => q.pts.map((t) => t[0])), ys = loop.flatMap((q) => q.pts.map((t) => t[1]));
    const w = Math.max(...loop[0].pts.map((t) => t[0])) - Math.min(...loop[0].pts.map((t) => t[0])), z = loop[0].pts[0][2];
    const xa = Math.min(...xs) + w / 2, xb = Math.max(...xs) - w / 2, ya = Math.min(...ys) + w / 2, yb = Math.max(...ys) - w / 2;
    const c: Vec3[] = [[xa, ya, z], [xb, ya, z], [xb, yb, z], [xa, yb, z]];
    for (let i = 0; i < 4; i++) path(c[i], c[(i + 1) % 4], 12, () => 1, w / 4, out);
  } else return null;
  if (!out.els.length) return null;
  return { els: out.els, segs: Float64Array.from(out.segs), ir: Float64Array.from(out.ir), ii: new Float64Array(out.ir.length) };
}
