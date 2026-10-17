import { useMemo } from "react";

const YAW = 35, PITCH = 25, SIZE = 260;

/** Flat-shaded isometric view of a triangle mesh (9 floats per triangle, mm), drawn as SVG polygons. */
export function MeshView({ tris }: { tris: Float32Array }) {
  const polys = useMemo(() => {
    const cy = Math.cos((YAW * Math.PI) / 180), sy = Math.sin((YAW * Math.PI) / 180);
    const cp = Math.cos((PITCH * Math.PI) / 180), sp = Math.sin((PITCH * Math.PI) / 180);
    const P = (x: number, y: number, z: number) => { const X = x * cy - y * sy, Y = x * sy + y * cy; return [X, -(z * cp - Y * sp), Y * cp + z * sp]; };
    const fs: { q: number[][]; d: number; s: number }[] = [];
    for (let i = 0; i < tris.length; i += 9) {
      const q = [0, 1, 2].map((k) => P(tris[i + 3 * k], tris[i + 3 * k + 1], tris[i + 3 * k + 2]));
      if ((q[1][0] - q[0][0]) * (q[2][1] - q[0][1]) - (q[1][1] - q[0][1]) * (q[2][0] - q[0][0]) <= 0) continue;   // back face
      const a = [tris[i + 3] - tris[i], tris[i + 4] - tris[i + 1], tris[i + 5] - tris[i + 2]];
      const b = [tris[i + 6] - tris[i], tris[i + 7] - tris[i + 1], tris[i + 8] - tris[i + 2]];
      const n = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const s = 0.35 + 0.65 * Math.max(0, (0.3 * n[0] - 0.5 * n[1] + 0.8 * n[2]) / (Math.hypot(...n) || 1));
      fs.push({ q, d: q[0][2] + q[1][2] + q[2][2], s });
    }
    fs.sort((u, v) => u.d - v.d);
    // a loop, not Math.min(...xs): a spread of a few hundred thousand points overflows the call stack
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const f of fs) for (const p of f.q) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const k = (SIZE - 20) / Math.max(x1 - x0, y1 - y0, 1e-9);
    return fs.map((f) => ({ pts: f.q.map((p) => `${((p[0] - x0) * k + 10).toFixed(1)},${((p[1] - y0) * k + 10).toFixed(1)}`).join(" "), op: f.s }));
  }, [tris]);
  return (
    <svg className="mesh-view" viewBox={`0 0 ${SIZE} ${SIZE}`} width={SIZE} height={SIZE} role="img">
      {polys.map((p, i) => { const c = `color-mix(in srgb, var(--accent) ${Math.round(30 + 70 * p.op)}%, var(--panel))`; return <polygon key={i} points={p.pts} fill={c} stroke={c} strokeWidth={0.6} strokeLinejoin="round" />; })}
    </svg>
  );
}
