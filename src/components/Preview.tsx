import { useCallback, useMemo, useRef, useState } from "react";
import type { Design, Params, Vec3, Wire } from "../lib/types";
import { niceStep } from "../lib/units";
import { set, useStore, type ViewMode } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { Select } from "./inputs";
import { cameraBasis, screenPlane } from "./plane";
import { RadiationLayer } from "./RadiationLayer";
import { useNearField } from "../useNearField";
import { radiationEligible } from "../lib/simulate";
import { C0 } from "../lib/rf";
import { setHover, useHover } from "../hover";

/** [yaw, pitch]: top = x right / y up; front = looking along −x (y right); side = looking along +y (x right). */
const VIEWS: Record<Exclude<ViewMode, "3d">, [number, number]> = { top: [90, 90], front: [180, 0], side: [90, 0] };
const W = 800, H = 540, PAD = 48;
const RAD_SPAN = 3, RAD_PAD = 2;
/** Field grid columns: 160 keeps a view change on a 9-element Yagi near 1 s in the worker. */
const FIELD_NX = 160;

/**
 * Orthographic right-handed camera: looks along d = (cos ψ, sin ψ) tilted down by θ; screen-right = d × ẑ.
 * Returns [screen x, screen y (down), depth (far = larger)].
 */
function camera(yawDeg: number, pitchDeg: number) {
  const { right, down, depth } = cameraBasis(yawDeg, pitchDeg);
  const dot = (a: Vec3, q: Vec3) => a[0] * q[0] + a[1] * q[1] + a[2] * q[2];
  return (q: Vec3): [number, number, number] => [dot(right, q), dot(down, q), dot(depth, q)];
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

/**
 * Dimension line for a span seen on screen: extension lines out to an arrowed line offset by OFF px on the side away
 * from the drawing centre, and the label beside it. A span seen end-on (shorter than 6 px) gets only the label.
 */
function dimensionLine([a, b]: [[number, number], [number, number]]) {
  const OFF = 18;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy);
  if (len < 6) return { ext: [] as number[][], arrow: null, label: [a[0] + 14, a[1] - 14] };
  let nx = -dy / len, ny = dx / len;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
  if ((mx - W / 2) * nx + (my - H / 2) * ny < 0) { nx = -nx; ny = -ny; }
  const o = (p: [number, number], d: number) => [p[0] + nx * d, p[1] + ny * d];
  const [a1, a2] = [o(a, 4), o(a, OFF + 5)], [b1, b2] = [o(b, 4), o(b, OFF + 5)];
  const [ax, ay] = o(a, OFF), [bx, by] = o(b, OFF);
  // label above the arrow, kept inside the drawing
  const lx = Math.max(40, Math.min(W - 40, mx + nx * (OFF + 14))), ly = Math.max(14, Math.min(H - 14, my + ny * (OFF + 14)));
  return { ext: [[...a1, ...a2], [...b1, ...b2]], arrow: [ax, ay, bx, by], label: [lx, ly] };
}

export function Preview({ design, svgRef, type, params }: { design: Design; svgRef: React.RefObject<SVGSVGElement | null>; type: string; params: Params }) {
  const t = useT();
  const isPcb = !!design.pcb;
  const view = useStore((s) => (isPcb ? s.pcbView : s.view));
  const setView = (v: ViewMode, extra: Partial<{ yaw: number; pitch: number }> = {}) => set(isPcb ? { pcbView: v, ...extra } : { view: v, ...extra });
  const unit = useStore((s) => s.unit);
  const yaw = useStore((s) => s.yaw), pitch = useStore((s) => s.pitch);
  const [cy, cp] = view === "3d" ? [yaw, pitch] : VIEWS[view];
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);

  const [radiation, setRadiation] = useState(false);
  const eligible = radiationEligible(type, design);
  const on = radiation && eligible;
  // Radiation view: at least RAD_SPAN wavelengths, and RAD_PAD/2 wavelengths around the antenna, so the wavefronts are visible.
  const minSpan = on ? RAD_SPAN * (C0 / design.f) : 0, radPad = on ? RAD_PAD * (C0 / design.f) : 0;

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
    const k = Math.min((W - 2 * PAD) / Math.max(maxX - minX, span * 0.05, minSpan, maxX - minX + radPad), (H - 2 * PAD) / Math.max(maxY - minY, span * 0.05, (minSpan * H) / W, maxY - minY + radPad));
    const ox = W / 2 - ((minX + maxX) / 2) * k, oy = H / 2 - ((minY + maxY) / 2) * k;
    const S = (x: number, y: number): [number, number] => [ox + x * k, oy + y * k];
    pw.sort((a, b) => b.z - a.z);
    pp.sort((a, b) => b.z - a.z);
    // world point the field plane passes through and r is measured from: the feed, else the middle of the drawing
    const mid = wires.length ? wires.reduce<Vec3>((s, w) => [s[0] + (w.a[0] + w.b[0]) / (2 * wires.length), s[1] + (w.a[1] + w.b[1]) / (2 * wires.length), s[2] + (w.a[2] + w.b[2]) / (2 * wires.length)], [0, 0, 0]) : [0, 0, 0] as Vec3;
    return { pw, pp, S, k, P, ox, oy, fp: fp ? P(fp) : null, fpw: fp ?? mid };
  }, [design, cy, cp, minSpan, radPad]);

  const { pw, pp, S, k, P, ox, oy, fp, fpw } = scene;
  const [playing, setPlaying] = useState(true);
  const theme = useStore((s) => s.theme);
  const plane = useMemo(() => (on ? screenPlane(cy, cp, { ox, oy, k, W, H }, fpw, FIELD_NX) : null), [on, cy, cp, ox, oy, k, fpw]);
  const field = useNearField(type, params, plane, on);
  const fieldKey = JSON.stringify([type, params, plane]);
  const fresh = field.status === "done" && field.key === fieldKey ? field.data : null;
  const toScreen = useCallback((q: Vec3) => { const p = P(q); return S(p[0], p[1]); }, [P, S]);
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
  const hover = useHover();
  const lit = hover && !hover.fromDrawing && hover.tags.length ? new Set(hover.tags) : null;
  const dimLine = hover?.span ? dimensionLine(hover.span.at.map((q) => { const p = P(q); return S(p[0], p[1]); }) as [[number, number], [number, number]]) : null;

  return (
    <div className="preview">
      <div className="preview-tools">
        <Select value={view} ariaLabel="View" options={[["3d", "3D (drag to rotate)"], ["top", "Top"], ["front", "Front"], ["side", "Side"]]} onChange={(v) => setView(v)} />
        <button className={on ? "on" : ""} aria-pressed={on} disabled={!eligible} title={eligible ? undefined : t("No field model for this antenna")} onClick={() => setRadiation((r) => !r)}>{t("Radiation")}</button>
        {on && <button onClick={() => setPlaying((p) => !p)}>{playing ? t("Pause") : t("Play")}</button>}
      </div>
      {fresh && <RadiationLayer data={fresh} toScreen={toScreen} W={W} H={H} theme={theme} playing={playing} />}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Antenna drawing")}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, yaw: cy, pitch: cp }; if (view !== "3d") setView("3d", { yaw: cy, pitch: cp }); }}
        onPointerMove={(e) => {
          const d = drag.current; if (!d) return;
          set({ yaw: d.yaw + (e.clientX - d.x) * 0.5, pitch: Math.max(-89, Math.min(89, d.pitch + (e.clientY - d.y) * 0.5)) });
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <defs><marker id="dim-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" className="dim-head" /></marker></defs>
        <rect x="0" y="0" width={W} height={H} className={fresh ? "svg-bg clear" : "svg-bg"} />
        {pp.map(({ p, q }, i) => (
          <polygon key={`p${i}`} points={q.map((x) => S(x[0], x[1]).join(",")).join(" ")} className={`plate plate-${p.material}`}>
            <title>{t(p.label)}</title>
          </polygon>
        ))}
        {pw.map(({ w, a, b }, i) => {
          const [x1, y1] = S(a[0], a[1]), [x2, y2] = S(b[0], b[1]);
          const cls = lit ? (w.tag && lit.has(w.tag) ? " lit" : " faded") : hover?.fromDrawing && w.tag && hover.tags.includes(w.tag) ? " lit" : "";
          return <line key={`w${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className={`wire wire-${w.group ?? "driven"}${cls}`}
            strokeWidth={Math.min(16, Math.max(1.6, 2 * w.r * k))} strokeLinecap="round"
            onPointerEnter={w.tag ? () => { if (!drag.current) setHover({ tags: [w.tag!], fromDrawing: true }); } : undefined}
            onPointerLeave={w.tag ? () => setHover(null) : undefined} />;
        })}
        {pw.map(({ w, a, b }: { w: Wire; a: number[]; b: number[] }, i) => {
          if (!w.tag) return null;
          const key = `${w.tag}`;
          if (tagged.has(key) && w.group !== "driven") return null;
          tagged.add(key);
          const [x, y] = S((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          return <text key={`t${i}`} x={x + 6} y={y - 6} className="tag">{w.tag}</text>;
        })}
        {dimLine && hover?.span && (
          <g className="dimline" pointerEvents="none">
            {dimLine.ext.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="dim-ext" />)}
            {dimLine.arrow && <line x1={dimLine.arrow[0]} y1={dimLine.arrow[1]} x2={dimLine.arrow[2]} y2={dimLine.arrow[3]} className="dim-arrow" markerStart="url(#dim-head)" markerEnd="url(#dim-head)" />}
            <text x={dimLine.label[0]} y={dimLine.label[1]} textAnchor="middle" dominantBaseline="middle" className="dim-text">{fmtLen(hover.span.value, unit)}</text>
          </g>
        )}
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
      {on && (
        <div className="radiation-legend">
          {field.status === "running" || (field.status === "done" && field.key !== fieldKey) ? <span>{t("Computing field…")}</span>
            : field.status === "error" ? <span>{field.error}</span>
            : field.status === "done" && !field.data ? <span>{t("No field model for this antenna")}</span>
            : fresh ? <><span className="ramp" />{t("Electric field (instantaneous, × distance)")}<span className="glow" />{t("Current on the wire")}{fresh.model === "standin" ? <em>{t("Approximate: wire model of the copper, substrate as a frequency scale")}</em> : fresh.model === "ideal" ? <em>{t("Assumed current distribution")}</em> : null}</> : null}
        </div>
      )}
    </div>
  );
}
