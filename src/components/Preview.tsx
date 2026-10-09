import { useMemo, useRef } from "react";
import type { Design, Vec3, Wire } from "../lib/types";
import { niceStep } from "../lib/units";
import { set, useStore, type ViewMode } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { Select } from "./inputs";

/** [yaw, pitch]: top = x right / y up; front = looking along −x (y right); side = looking along +y (x right). */
const VIEWS: Record<Exclude<ViewMode, "3d">, [number, number]> = { top: [90, 90], front: [180, 0], side: [90, 0] };
const W = 800, H = 540, PAD = 48;

/**
 * Orthographic right-handed camera: looks along d = (cos ψ, sin ψ) tilted down by θ; screen-right = d × ẑ.
 * Returns [screen x, screen y (down), depth (far = larger)].
 */
function camera(yawDeg: number, pitchDeg: number) {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  return (q: Vec3): [number, number, number] => {
    const u = q[0] * sy - q[1] * cy;
    const d = q[0] * cy + q[1] * sy;
    return [u, -(q[2] * cp + d * sp), d * cp - q[2] * sp];
  };
}

function feedPoint(d: Design): Vec3 | null {
  if (d.pcb) { const { start: a, stop: b } = d.pcb.port; return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.max(a[2], b[2])]; }
  if (!d.feed) return null;
  const w = d.wires[d.feed.wire];
  if (!w) return null;
  if (d.feed.at === "start") return w.a;
  if (d.feed.at === "end") return w.b;
  return [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, (w.a[2] + w.b[2]) / 2];
}

export function Preview({ design, svgRef }: { design: Design; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const t = useT();
  const isPcb = !!design.pcb;
  const view = useStore((s) => (isPcb ? s.pcbView : s.view));
  const setView = (v: ViewMode, extra: Partial<{ yaw: number; pitch: number }> = {}) => set(isPcb ? { pcbView: v, ...extra } : { view: v, ...extra });
  const unit = useStore((s) => s.unit);
  const yaw = useStore((s) => s.yaw), pitch = useStore((s) => s.pitch);
  const [cy, cp] = view === "3d" ? [yaw, pitch] : VIEWS[view];
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const scene = useMemo(() => {
    const P = camera(cy, cp);
    const wires = design.wires.filter((w) => !w.necOnly);
    const pts: [number, number][] = [];
    const pw = wires.map((w) => { const a = P(w.a), b = P(w.b); pts.push([a[0], a[1]], [b[0], b[1]]); return { w, a, b, z: (a[2] + b[2]) / 2 }; });
    const pp = design.plates.map((p) => {
      const q = p.pts.map(P);
      q.forEach((x) => pts.push([x[0], x[1]]));
      return { p, q, z: q.reduce((s, x) => s + x[2], 0) / q.length };
    });
    const fp = feedPoint(design);
    const xs = pts.map((x) => x[0]), ys = pts.map((x) => x[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const k = Math.min((W - 2 * PAD) / Math.max(maxX - minX, span * 0.05), (H - 2 * PAD) / Math.max(maxY - minY, span * 0.05));
    const ox = W / 2 - ((minX + maxX) / 2) * k, oy = H / 2 - ((minY + maxY) / 2) * k;
    const S = (x: number, y: number): [number, number] => [ox + x * k, oy + y * k];
    pw.sort((a, b) => b.z - a.z);
    pp.sort((a, b) => b.z - a.z);
    return { pw, pp, S, k, P, fp: fp ? P(fp) : null };
  }, [design, cy, cp]);

  const { pw, pp, S, k, P, fp } = scene;
  // Scale bar: a nice length near 1/5 of the drawing width, in the display unit.
  const unitM = unit === "in" ? 0.0254 : 0.001;
  const barUnits = niceStep((W / 5 / k) / unitM);
  const barPx = barUnits * unitM * k;
  const axes = (["x", "y", "z"] as const).map((name, i) => {
    const e: Vec3 = [0, 0, 0]; e[i] = 1;
    const o = P([0, 0, 0]), q = P(e);
    return { name, dx: (q[0] - o[0]) * 26, dy: (q[1] - o[1]) * 26 };
  });
  const tagged = new Set<string>();

  return (
    <div className="preview">
      <div className="preview-tools">
        <Select value={view} ariaLabel="View" options={[["3d", "3D (drag to rotate)"], ["top", "Top"], ["front", "Front"], ["side", "Side"]]} onChange={(v) => setView(v)} />
      </div>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Antenna drawing")}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, yaw: cy, pitch: cp }; if (view !== "3d") setView("3d", { yaw: cy, pitch: cp }); }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          set({ yaw: d.yaw + (e.clientX - d.x) * 0.5, pitch: Math.max(-89, Math.min(89, d.pitch + (e.clientY - d.y) * 0.5)) });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <rect x="0" y="0" width={W} height={H} className="svg-bg" />
        {pp.map(({ p, q }, i) => (
          <polygon key={`p${i}`} points={q.map((x) => S(x[0], x[1]).join(",")).join(" ")} className={`plate plate-${p.material}`}>
            <title>{t(p.label)}</title>
          </polygon>
        ))}
        {pw.map(({ w, a, b }, i) => {
          const [x1, y1] = S(a[0], a[1]), [x2, y2] = S(b[0], b[1]);
          return <line key={`w${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className={`wire wire-${w.group ?? "driven"}`}
            strokeWidth={Math.min(16, Math.max(1.6, 2 * w.r * k))} strokeLinecap="round" />;
        })}
        {pw.map(({ w, a, b }: { w: Wire; a: number[]; b: number[] }, i) => {
          if (!w.tag) return null;
          const key = `${w.tag}`;
          if (tagged.has(key) && w.group !== "driven") return null;
          tagged.add(key);
          const [x, y] = S((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          return <text key={`t${i}`} x={x + 6} y={y - 6} className="tag">{w.tag}</text>;
        })}
        {fp && (() => { const [x, y] = S(fp[0], fp[1]); return <g><circle cx={x} cy={y} r={6} className="feed-dot" /><text x={x + 9} y={y + 16} className="feed-label">{t("feed")}</text></g>; })()}
        <g transform={`translate(${PAD - 16}, ${H - 22})`}>
          <line x1={0} y1={0} x2={barPx} y2={0} className="scalebar" />
          <line x1={0} y1={-5} x2={0} y2={5} className="scalebar" />
          <line x1={barPx} y1={-5} x2={barPx} y2={5} className="scalebar" />
          <text x={barPx / 2} y={-8} textAnchor="middle" className="scale-text">{fmtLen(barUnits * unitM, unit).replace(/\.0+ /, " ")}</text>
        </g>
        <g transform={`translate(${W - 44}, ${H - 40})`}>
          {axes.map((a) => (
            <g key={a.name}>
              <line x1={0} y1={0} x2={a.dx} y2={a.dy} className={`axis axis-${a.name}`} />
              {Math.hypot(a.dx, a.dy) > 4 && <text x={a.dx * 1.3} y={a.dy * 1.3 + 4} textAnchor="middle" className={`axis-text axis-${a.name}`}>{a.name}</text>}
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
