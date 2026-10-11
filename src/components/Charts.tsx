// openEMS-style result plots, hand-built SVG: S11 / SWR / Zin vs frequency, Smith chart,
// polar far-field cuts and a rotatable 3D gain surface. Colours come from CSS tokens (index.css).
import { useMemo, useRef, useState, type ReactNode } from "react";
import { interpZ, type Cut, type Pattern, type ZPoint } from "../lib/simulate";
import { s11 } from "../lib/simulate";
import { fmtHz, fmtHzShort, niceStep } from "../lib/units";
import { useT } from "../i18n";
import { set, useStore } from "../store";

const fmt = (v: number, d = 1) => (Number.isFinite(v) ? v.toFixed(d) : "∞");

function ticks(lo: number, hi: number, n = 5): number[] {
  const st = niceStep((hi - lo) / n);
  const out: number[] = [];
  // by index, not v += st: a step below the float spacing of lo (1 GHz ± mHz) never advanced v
  const k0 = Math.ceil(lo / st);
  for (let k = k0; k * st <= hi + st * 1e-9 && k - k0 < 50; k++) out.push(+(k * st).toPrecision(12));
  return [...new Set(out)];
}

/** Shared frame: title, optional legend (≥ 2 series), the plot, and an HTML tooltip layer. */
function Frame({ title, legend, children, tip, foot }: { title: string; legend?: { name: string; cls: string }[]; children: ReactNode; tip: { x: number; y: number; rows: ReactNode } | null; foot?: string }) {
  const t = useT();
  return (
    <figure className="chart-card">
      <figcaption>
        <span className="chart-title">{t(title)}</span>
        {legend && legend.length > 1 && (
          <span className="legend">{legend.map((l) => <span key={l.name} className="legend-item"><span className={`key ${l.cls}`} />{t(l.name)}</span>)}</span>
        )}
      </figcaption>
      <div className="chart-body">
        {children}
        {tip && <div className="tip" style={{ left: `${tip.x}%`, top: `${tip.y}%` }}>{tip.rows}</div>}
      </div>
      {foot && <div className="chart-foot">{foot}</div>}
    </figure>
  );
}

/** Shared frequency cursor (hover or pinned) driven by SimPanel. */
export interface FCursor { f: number | null; pinned: boolean; hover: (f: number | null) => void; toggle: () => void }

export interface Series { name: string; cls: string; f: number[]; values: number[] }

/** Value vs frequency with crosshair tooltip. One y-axis only. */
export function FreqChart({ title, unit, series, bands, yMin, yMax, refLine, digits = 1, cursor }: {
  title: string; unit: string; series: Series[]; bands: [number, number][];
  yMin?: number; yMax?: number; refLine?: number; digits?: number; cursor?: FCursor;
}) {
  const t = useT();
  const W = 400, H = 240, L = 44, R = 10, T = 10, B = 30;
  const [localHover, setHover] = useState<number | null>(null); // hovered frequency (when not linked)
  const hover = cursor ? cursor.f : localHover;
  const allF = series.flatMap((x) => x.f);
  const f0 = Math.min(...allF), f1 = Math.max(...allF);
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let lo = yMin ?? Math.min(...all), hi = yMax ?? Math.max(...all);
  if (yMin == null && yMax != null) lo = Math.min(...all);
  if (!(hi > lo)) { hi = lo + 1; lo -= 1; }
  const pad = (hi - lo) * 0.06;
  if (yMin == null) lo -= pad;
  if (yMax == null) hi += pad;
  const X = (f: number) => L + ((f - f0) / (f1 - f0 || 1)) * (W - L - R);
  const Y = (v: number) => T + (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (H - T - B);
  const yt = ticks(lo, hi), xt = ticks(f0, f1, 5);
  const path = (s: Series) => {
    let d = "", pen = false;
    s.values.forEach((v, i) => { if (!Number.isFinite(v) || s.f[i] < f0 || s.f[i] > f1) { pen = false; return; } d += `${pen ? "L" : "M"}${X(s.f[i]).toFixed(1)},${Y(v).toFixed(1)}`; pen = true; });
    return d;
  };
  /** Index of the sample of series s nearest to frequency fx (null if fx is outside its range). */
  const near = (s: Series, fx: number) => {
    if (!s.f.length || fx < s.f[0] - (f1 - f0) * 0.01 || fx > s.f[s.f.length - 1] + (f1 - f0) * 0.01) return null;
    let best = 0;
    s.f.forEach((f, i) => { if (Math.abs(f - fx) < Math.abs(s.f[best] - fx)) best = i; });
    return best;
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const fx = f0 + (((e.clientX - r.left) / r.width) * W - L) / (W - L - R) * (f1 - f0);
    const s0 = series[0], i = near(s0, fx);
    const f = i != null ? s0.f[i] : fx;
    if (cursor) cursor.hover(f); else setHover(f);
  };
  const onLeave = () => { if (cursor) cursor.hover(null); else setHover(null); };
  const tip = hover == null || hover < f0 || hover > f1 ? null : {
    x: (X(hover) / W) * 100, y: 4,
    rows: <>
      <div className="tip-h">{fmtHz(hover, 3)}{cursor?.pinned ? ` · ${t("Pinned")}` : ""}</div>
      {series.map((s) => { const i = near(s, hover); return i == null ? null : <div key={s.name} className="tip-r"><span className={`key ${s.cls}`} /><b>{fmt(s.values[i], digits)} {unit}</b> <span className="muted">{t(s.name)}</span></div>; })}
    </>,
  };
  return (
    <Frame title={title} legend={series.map(({ name, cls }) => ({ name, cls }))} tip={tip}>
      <svg viewBox={`0 0 ${W} ${H}`} className={"plot" + (cursor ? " linked" : "")} onPointerMove={onMove} onPointerLeave={onLeave} onClick={cursor?.toggle} role="img" aria-label={t(title)}>
        {bands.map(([a, b], i) => b >= f0 && a <= f1 && (
          <rect key={i} className="band-fill" x={X(Math.max(a, f0))} y={T} width={Math.max(1, X(Math.min(b, f1)) - X(Math.max(a, f0)))} height={H - T - B} />
        ))}
        {yt.map((v) => <g key={v}><line className="grid" x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} /><text className="axis-label" x={L - 6} y={Y(v) + 4} textAnchor="end">{+v.toFixed(3)}</text></g>)}
        {xt.map((f) => <g key={f}><line className="grid" x1={X(f)} x2={X(f)} y1={T} y2={H - B} /><text className="axis-label" x={X(f)} y={H - B + 16} textAnchor="middle">{fmtHzShort(f)}</text></g>)}
        <line className="axis" x1={L} x2={W - R} y1={H - B} y2={H - B} />
        <text className="axis-label" x={W - R} y={H - 4} textAnchor="end">Hz</text>
        <text className="axis-label" x={6} y={T + 4}>{unit}</text>
        {refLine != null && refLine > lo && refLine < hi && <line className="ref" x1={L} x2={W - R} y1={Y(refLine)} y2={Y(refLine)} />}
        {series.map((s) => <path key={s.name} className={`line ${s.cls}`} d={path(s)} />)}
        {hover != null && hover >= f0 && hover <= f1 && <line className={"crosshair" + (cursor?.pinned ? " pinned" : "")} x1={X(hover)} x2={X(hover)} y1={T} y2={H - B} />}
        {hover != null && hover >= f0 && hover <= f1 && series.map((s) => { const i = near(s, hover); return i != null && Number.isFinite(s.values[i]) && <circle key={s.name} className={`dot ${s.cls}`} cx={X(s.f[i])} cy={Y(s.values[i])} r={4} />; })}
      </svg>
    </Frame>
  );
}

/** Smith chart of the input impedance, normalised to z0, with the SWR 2 circle. */
export function SmithChart({ z, z0, bands, overlay, cursor }: { z: ZPoint[]; z0: number; bands: [number, number][]; overlay?: { name: string; z: ZPoint[] }; cursor?: FCursor }) {
  const t = useT();
  const S = 300, c = S / 2, Rr = S / 2 - 14;
  const [localHover, setHover] = useState<number | null>(null);
  const P = (gr: number, gi: number) => [c + gr * Rr, c - gi * Rr] as const;
  const g = z.map((p) => s11(p, z0));
  const inBand = (f: number) => bands.some(([a, b]) => f >= a && f <= b);
  const pts = g.map((s) => P(s.gr, s.gi).join(",")).join(" ");
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * S, y = ((e.clientY - r.top) / r.height) * S;
    let best = -1, bd = Infinity;
    g.forEach((s, i) => { const [px, py] = P(s.gr, s.gi); const d = (px - x) ** 2 + (py - y) ** 2; if (d < bd) { bd = d; best = i; } });
    if (cursor) { if (bd < 900) cursor.hover(z[best].f); else cursor.hover(null); } else setHover(bd < 900 ? best : null);
  };
  const onLeave = () => { if (cursor) cursor.hover(null); else setHover(null); };
  const cz = cursor ? (cursor.f != null ? interpZ(z, cursor.f) : null) : localHover != null ? z[localHover] : null;
  const co = cursor && cursor.f != null && overlay ? interpZ(overlay.z, cursor.f) : null;
  const mark = (p: ZPoint) => { const q = s11(p, z0); return P(q.gr, q.gi); };
  const tip = !cz ? null : (() => {
    const [px, py] = mark(cz);
    return { x: (px / S) * 100, y: (py / S) * 100, rows: <>
      <div className="tip-h">{fmtHz(cz.f, 3)}{cursor?.pinned ? ` · ${t("Pinned")}` : ""}</div>
      <div className="tip-r"><b>{fmt(cz.r)} {cz.x >= 0 ? "+" : "−"} j{fmt(Math.abs(cz.x))} Ω</b></div>
      <div className="tip-r"><b>{fmt(s11(cz, z0).swr, 2)}</b> <span className="muted">SWR</span></div>
    </> };
  })();
  return (
    <Frame title="Smith chart" tip={tip} foot={`Z0 = ${z0} Ω`} legend={overlay ? [{ name: z.length ? "Simulated" : overlay.name, cls: "s1" }, { name: overlay.name, cls: "s2" }] : undefined}>
      <svg viewBox={`0 0 ${S} ${S}`} className={"plot smith" + (cursor ? " linked" : "")} onPointerMove={onMove} onPointerLeave={onLeave} onClick={cursor?.toggle} role="img" aria-label={t("Smith chart")}>
        <defs><clipPath id="smith-clip"><circle cx={c} cy={c} r={Rr} /></clipPath></defs>
        <circle className="axis" cx={c} cy={c} r={Rr} fill="none" />
        <g clipPath="url(#smith-clip)">
          {[0.2, 0.5, 1, 2, 5].map((r) => <circle key={`r${r}`} className="grid" cx={c + (r / (1 + r)) * Rr} cy={c} r={Rr / (1 + r)} fill="none" />)}
          {[0.2, 0.5, 1, 2, 5].flatMap((x) => [x, -x]).map((x) => <circle key={`x${x}`} className="grid" cx={c + Rr} cy={c - Rr / x} r={Math.abs(Rr / x)} fill="none" />)}
          <line className="grid" x1={c - Rr} x2={c + Rr} y1={c} y2={c} />
        </g>
        <circle className="ref" cx={c} cy={c} r={Rr / 3} fill="none" />
        <text className="axis-label" x={c + Rr / 3 + 3} y={c - 4}>SWR 2</text>
        <polyline className="line s1" points={pts} fill="none" />
        {overlay && <polyline className="line s2" fill="none" points={overlay.z.map((p) => { const q = s11(p, z0); return P(q.gr, q.gi).join(","); }).join(" ")} />}
        {g.map((s, i) => inBand(z[i].f) && <circle key={i} className="dot s1 small" cx={P(s.gr, s.gi)[0]} cy={P(s.gr, s.gi)[1]} r={2.2} />)}
        {co && <circle className="dot s2" cx={mark(co)[0]} cy={mark(co)[1]} r={5} />}
        {cz && <circle className={"dot s1" + (cursor?.pinned ? " pinned" : "")} cx={mark(cz)[0]} cy={mark(cz)[1]} r={5} />}
      </svg>
    </Frame>
  );
}

const CUT_ZERO: Record<Cut["id"], string> = { xy: "0° = +x, 90° = +y", xz: "0° = +z (up), 90° = +x", yz: "0° = +z (up), 90° = +y" };

/** Polar far-field cut, dBi, 30 dB range below the overall maximum. 0° at the top, clockwise. */
export function PolarChart({ cut, top, overlay, names }: { cut: Cut; top: number; overlay?: Cut; names?: [string, string] }) {
  const t = useT();
  const S = 300, c = S / 2, Rr = S / 2 - 26, range = 30;
  const peak = Math.ceil(top / 5) * 5, floor = peak - range;
  const [hover, setHover] = useState<number | null>(null);
  const rad = (g: number) => (Math.max(floor, Math.min(peak, g)) - floor) / range * Rr;
  const P = (deg: number, g: number) => { const a = (deg * Math.PI) / 180; return [c + rad(g) * Math.sin(a), c - rad(g) * Math.cos(a)] as const; };
  const pts = cut.deg.map((d, i) => P(d, cut.dbi[i]).join(",")).join(" ");
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * S - c, y = ((e.clientY - r.top) / r.height) * S - c;
    if (Math.hypot(x, y) > Rr + 10) { setHover(null); return; }
    const a = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
    setHover(Math.round(a / (cut.deg[1] - cut.deg[0])) % (cut.deg.length - 1));
  };
  const tip = hover == null ? null : (() => {
    const [px, py] = P(cut.deg[hover], cut.dbi[hover]);
    return { x: (px / S) * 100, y: (py / S) * 100, rows: <><div className="tip-h">{cut.deg[hover]}°</div><div className="tip-r"><b>{fmt(cut.dbi[hover])} dBi</b></div></> };
  })();
  return (
    <Frame title={cut.label} tip={tip} foot={`dBi · ${CUT_ZERO[cut.id]}`} legend={overlay && names ? [{ name: names[0], cls: "s1" }, { name: names[1], cls: "s2" }] : undefined}>
      <svg viewBox={`0 0 ${S} ${S}`} className="plot polar" onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={t(cut.label)}>
        {[0, 10, 20, 30].map((k) => <g key={k}>
          <circle className={k === 0 ? "axis" : "grid"} cx={c} cy={c} r={((range - k) / range) * Rr} fill="none" />
          <text className="axis-label" x={c + 3} y={c - ((range - k) / range) * Rr + 11}>{peak - k}</text>
        </g>)}
        {Array.from({ length: 12 }, (_, i) => i * 30).map((a) => {
          const r2 = Rr + 12, x = c + r2 * Math.sin((a * Math.PI) / 180), y = c - r2 * Math.cos((a * Math.PI) / 180);
          return <g key={a}><line className="grid" x1={c} y1={c} x2={c + Rr * Math.sin((a * Math.PI) / 180)} y2={c - Rr * Math.cos((a * Math.PI) / 180)} /><text className="axis-label" x={x} y={y + 4} textAnchor="middle">{a}°</text></g>;
        })}
        <polygon className="area s1" points={pts} />
        {overlay && <polygon className="line s2" fill="none" points={overlay.deg.map((d, i) => P(d, overlay.dbi[i]).join(",")).join(" ")} />}
        {hover != null && <><line className="crosshair" x1={c} y1={c} x2={P(cut.deg[hover], peak)[0]} y2={P(cut.deg[hover], peak)[1]} /><circle className="dot s1" cx={P(cut.deg[hover], cut.dbi[hover])[0]} cy={P(cut.deg[hover], cut.dbi[hover])[1]} r={4} /></>}
      </svg>
    </Frame>
  );
}

/** Sequential blue ramp (palette steps 100 → 650) for the 3D gain surface. */
const RAMP = ["#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#104281"];
const rampColor = (u: number) => RAMP[Math.max(0, Math.min(RAMP.length - 1, Math.floor(u * RAMP.length)))];

/** 3D gain surface (radius ∝ dB above the floor), drag to rotate; shares the camera with the geometry view. */
export function Pattern3D({ pattern }: { pattern: Pattern }) {
  const t = useT();
  const yawS = useStore((s) => s.yaw), pitchS = useStore((s) => s.pitch);
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const S = 320, c = S / 2, Rr = S / 2 - 20, range = 30;
  const peak = Math.ceil(pattern.max.dbi / 5) * 5, floor = peak - range;
  const quads = useMemo(() => {
    const y = (yawS * Math.PI) / 180, p = (pitchS * Math.PI) / 180;
    const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
    const { dTheta, dPhi, dbi } = pattern.grid;
    const pt = (i: number, j: number) => {
      const th = (i * dTheta * Math.PI) / 180, ph = (j * dPhi * Math.PI) / 180;
      const r = (Math.max(floor, Math.min(peak, dbi[i][j])) - floor) / range;
      const X = r * Math.sin(th) * Math.cos(ph), Yv = r * Math.sin(th) * Math.sin(ph), Z = r * Math.cos(th);
      const u = X * sy - Yv * cy, d = X * cy + Yv * sy;
      return { sx: c + u * Rr, sy: c - (Z * cp + d * sp) * Rr, depth: d * cp - Z * sp };
    };
    const out: { pts: string; depth: number; fill: string; v: number }[] = [];
    for (let i = 0; i < dbi.length - 1; i++)
      for (let j = 0; j < dbi[0].length - 1; j++) {
        const q = [pt(i, j), pt(i + 1, j), pt(i + 1, j + 1), pt(i, j + 1)];
        const v = (dbi[i][j] + dbi[i + 1][j] + dbi[i + 1][j + 1] + dbi[i][j + 1]) / 4;
        out.push({ pts: q.map((a) => `${a.sx.toFixed(1)},${a.sy.toFixed(1)}`).join(" "), depth: q.reduce((s, a) => s + a.depth, 0) / 4, fill: rampColor((v - floor) / range), v });
      }
    return out.sort((a, b) => b.depth - a.depth);
  }, [pattern, yawS, pitchS, floor, peak, c, Rr]);
  return (
    <Frame title="3D radiation pattern" tip={null} foot={t("Drag to rotate (same view as the drawing)")}>
      <svg viewBox={`0 0 ${S} ${S + 26}`} className="plot p3d" role="img" aria-label={t("3D radiation pattern")}
        onPointerDown={(e) => { (e.target as Element).setPointerCapture?.(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, yaw: yawS, pitch: pitchS }; set({ view: "3d" }); }}
        onPointerMove={(e) => { const d = drag.current; if (d) set({ yaw: d.yaw + (e.clientX - d.x) * 0.5, pitch: Math.max(-89, Math.min(89, d.pitch + (e.clientY - d.y) * 0.5)) }); }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        {quads.map((q, i) => <polygon key={i} points={q.pts} fill={q.fill} className="facet" />)}
        <g transform={`translate(${S / 2 - 90}, ${S + 6})`}>
          {RAMP.map((col, i) => <rect key={col} x={i * 22.5} y={0} width={22.5} height={8} fill={col} />)}
          <text className="axis-label" x={0} y={20}>{floor} dBi</text>
          <text className="axis-label" x={180} y={20} textAnchor="end">{peak} dBi</text>
        </g>
      </svg>
    </Frame>
  );
}
