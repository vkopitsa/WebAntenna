import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Design, Params, Plate, Vec3, Wire } from "../lib/types";
import { niceStep } from "../lib/units";
import { DEFAULT_PITCH, DEFAULT_YAW, set, useStore, type ViewMode } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { Select } from "./inputs";
import { cameraBasis, screenPlane } from "./plane";
import { RadiationLayer } from "./RadiationLayer";
import { useNearField } from "../useNearField";
import { radiationEligible } from "../lib/simulate";
import { C0 } from "../lib/rf";
import { getPin, setHover, setPin, togglePin, useEffectiveHover } from "../hover";
import { FIT, layoutDim, placeDims, plateSize, zoomAt, type Box, type DimGeom, type P2, type ViewXf } from "./dims";

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

const ROLES: [string, string][] = [["driven", "Driven"], ["parasitic", "Parasitic"], ["reflector", "Reflector"], ["ground", "Ground"], ["feed", "Feed"], ["line", "Line"]];
const STEP_KEY = 1.25;
interface Ghost { type: string; wires: Wire[]; plates: Plate[] }
interface Tip { x: number; y: number; flipX: boolean; flipY: boolean; lines: string[] }

export function Preview({ design, svgRef, type, params }: { design: Design; svgRef: React.RefObject<SVGSVGElement | null>; type: string; params: Params }) {
  const t = useT();
  const isPcb = !!design.pcb;
  const view = useStore((s) => (isPcb ? s.pcbView : s.view));
  const setView = (v: ViewMode, extra: Partial<{ yaw: number; pitch: number }> = {}) => set(isPcb ? { pcbView: v, ...extra } : { view: v, ...extra });
  const unit = useStore((s) => s.unit);
  const showDims = useStore((s) => s.showDims);
  const yaw = useStore((s) => s.yaw), pitch = useStore((s) => s.pitch);
  const [cy, cp] = view === "3d" ? [yaw, pitch] : VIEWS[view];
  /** One gesture at a time: rotate, pan (middle button / Shift), or pinch (two touches). `moved` tells a click from a drag. */
  const drag = useRef<{ kind: "rot" | "pan" | "pinch"; x: number; y: number; yaw: number; pitch: number; px: number; py: number; moved: boolean; hit: string | null; dist: number; mx: number; my: number } | null>(null);
  const ptrs = useRef(new Map<number, P2>());
  const boxRef = useRef<HTMLDivElement>(null);

  const [radiation, setRadiation] = useState(false);
  const eligible = radiationEligible(type, design);
  const on = radiation && eligible;
  // Radiation view: at least RAD_SPAN wavelengths, and RAD_PAD/2 wavelengths around the antenna, so the wavefronts are visible.
  const minSpan = on ? RAD_SPAN * (C0 / design.f) : 0, radPad = on ? RAD_PAD * (C0 / design.f) : 0;

  // zoom/pan and the compare ghost belong to one antenna type: a new type starts fitted without a ghost
  const [vzs, setVzs] = useState<{ type: string; v: ViewXf }>({ type, v: FIT });
  const vz = vzs.type === type ? vzs.v : FIT;
  const setVz = (f: ViewXf | ((v: ViewXf) => ViewXf)) => setVzs((s) => { const v = s.type === type ? s.v : FIT; return { type, v: typeof f === "function" ? f(v) : f }; });
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [tip, setTip] = useState<Tip | null>(null);
  const gh = ghost && ghost.type === type ? ghost : null;
  // The field plane is solved for one fixed view, so the Radiation view always shows the fitted drawing (zoom/pan are ignored while it is on).
  const zv = on ? FIT : vz;
  const zoomed = vz.z !== 1 || vz.x !== 0 || vz.y !== 0;

  const scene = useMemo(() => {
    const P = camera(cy, cp);
    const wires = design.wires.filter((w) => !w.necOnly);
    const pts: [number, number][] = [];
    // idx: position in design.wires / design.plates, kept through the depth sort (hover highlights refer to it)
    const pw = design.wires.flatMap((w, idx) => {
      if (w.necOnly) return [];
      const a = P(w.a), b = P(w.b); pts.push([a[0], a[1]], [b[0], b[1]]);
      return [{ w, idx, a, b, z: (a[2] + b[2]) / 2 }];
    });
    const pp = design.plates.map((p, idx) => {
      const q = p.pts.map(P);
      q.forEach((x) => pts.push([x[0], x[1]]));
      return { p, idx, q, z: q.reduce((s, x) => s + x[2], 0) / q.length };
    });
    // the compare ghost shares the camera and the fit
    const gw = (gh?.wires ?? []).filter((w) => !w.necOnly).map((w) => { const a = P(w.a), b = P(w.b); pts.push([a[0], a[1]], [b[0], b[1]]); return { a, b, r: w.r }; });
    const gp = (gh?.plates ?? []).map((p) => { const q = p.pts.map(P); q.forEach((x) => pts.push([x[0], x[1]])); return { q }; });
    const fp = feedPoint(design);
    const xs = pts.map((x) => x[0]), ys = pts.map((x) => x[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY, 1e-6);
    const pad = showDims ? PAD + 36 : PAD; // room for the dimension lines
    const k0 = Math.min((W - 2 * pad) / Math.max(maxX - minX, span * 0.05, minSpan, maxX - minX + radPad), (H - 2 * pad) / Math.max(maxY - minY, span * 0.05, (minSpan * H) / W, maxY - minY + radPad));
    const ox0 = W / 2 - ((minX + maxX) / 2) * k0, oy0 = H / 2 - ((minY + maxY) / 2) * k0;
    pw.sort((a, b) => b.z - a.z);
    pp.sort((a, b) => b.z - a.z);
    // world point the field plane passes through and r is measured from: the feed, else the middle of the drawing
    const mid = wires.length ? wires.reduce<Vec3>((s, w) => [s[0] + (w.a[0] + w.b[0]) / (2 * wires.length), s[1] + (w.a[1] + w.b[1]) / (2 * wires.length), s[2] + (w.a[2] + w.b[2]) / (2 * wires.length)], [0, 0, 0]) : [0, 0, 0] as Vec3;
    return { pw, pp, gw, gp, P, k0, ox0, oy0, fp: fp ? P(fp) : null, fpw: fp ?? mid };
  }, [design, gh, cy, cp, minSpan, radPad, showDims]);

  const { pw, pp, gw, gp, P, fp, fpw } = scene;
  // zoom/pan on top of the fit: about the view centre, then shifted
  const k = scene.k0 * zv.z, ox = (scene.ox0 - W / 2) * zv.z + W / 2 + zv.x, oy = (scene.oy0 - H / 2) * zv.z + H / 2 + zv.y;
  const S = useCallback((x: number, y: number): P2 => [ox + x * k, oy + y * k], [ox, oy, k]);
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
  const hover = useEffectiveHover();
  const lit = hover && !hover.fromDrawing && (hover.tags.length || hover.wires?.length || hover.plates?.length) ? new Set(hover.tags) : null;
  const litW = new Set(hover?.wires), litP = hover?.plates ? new Set(hover.plates) : null;
  // every dimension at once, or just the hovered / pinned one; they keep clear of the toolbar, scale bar, axes and feed dot
  const avoid = useMemo((): Box[] => {
    const boxes: Box[] = [[W * 0.4, 0, W, 40], [PAD - 20, H - 44, PAD + barPx + 8, H - 8], [W - 90, H - 90, W, H]];
    if (fp) { const [x, y] = S(fp[0], fp[1]); boxes.push([x - 9, y - 9, x + 40, y + 22]); }
    return boxes;
  }, [fp, S, barPx]);
  const all = useMemo(() => {
    if (!showDims) return [];
    const pt = (q: Vec3): P2 => { const p = P(q); return S(p[0], p[1]); };
    const items = design.dims.flatMap((d) => (d.at ? [{ d, span: [pt(d.at[0]), pt(d.at[1])] as [P2, P2], text: (d.key ? `${d.key} ` : "") + fmtLen(d.value, unit) }] : []));
    const g = placeDims(items, W, H, avoid);
    return items.flatMap((it, i) => (g[i] ? [{ at: it.d.at, g: g[i]! }] : []));
  }, [showDims, design, P, S, unit, avoid]);
  const hotAt = hover?.span?.at;
  const hotGeom = useMemo(() => {
    if (!hover?.span || all.some((x) => x.at === hover.span!.at)) return null;
    const pt = (q: Vec3): P2 => { const p = P(q); return S(p[0], p[1]); };
    const span: [P2, P2] = [pt(hover.span.at[0]), pt(hover.span.at[1])], text = fmtLen(hover.span.value, unit);
    return placeDims([{ span, text }], W, H, avoid)[0] ?? layoutDim(span, text, 0, W, H);
  }, [hover, all, avoid, P, S, unit]);
  const dimGroup = (g: DimGeom, key: string, cls: string) => (
    <g key={key} className={`dimline ${cls}`} pointerEvents="none">
      {g.ext.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} className="dim-ext" />)}
      {g.arrow && <line x1={g.arrow[0]} y1={g.arrow[1]} x2={g.arrow[2]} y2={g.arrow[3]} className="dim-arrow" markerStart="url(#dim-head)" markerEnd="url(#dim-head)" />}
      <rect x={g.box[0] + 3} y={g.box[1] + 2} width={g.box[2] - g.box[0] - 6} height={g.box[3] - g.box[1] - 4} rx={3} className="dim-bg" />
      <text x={g.label[0]} y={g.label[1]} textAnchor="middle" dominantBaseline="central" className="dim-text">{g.text}</text>
    </g>
  );

  const rectOf = () => svgRef.current?.getBoundingClientRect();
  /** Client point → view-box px. */
  const toBox = (cx: number, cy2: number): P2 => { const r = rectOf(); return r ? [((cx - r.left) / r.width) * W, ((cy2 - r.top) / r.height) * H] : [W / 2, H / 2]; };
  const zoomBy = (f: number, q: P2 = [W / 2, H / 2]) => { if (!on) setVz((v) => zoomAt(v, q, f, W, H)); };
  const resetView = () => {
    setVz(FIT);
    if (isPcb) set({ pcbView: "top" }); else set({ view: "3d", yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH });
  };
  // the wheel listener must be non-passive to stop the page from scrolling; it reads the latest state through refs
  const wheel = useRef<(e: WheelEvent) => void>(() => {});
  useEffect(() => {
    wheel.current = (e) => { e.preventDefault(); zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), toBox(e.clientX, e.clientY)); };
  });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const f = (e: WheelEvent) => wheel.current(e);
    el.addEventListener("wheel", f, { passive: false });
    return () => el.removeEventListener("wheel", f);
  }, [svgRef]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "Escape" && getPin()) setPin(null); };
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    setTip(null);
    if (ptrs.current.size === 2) {
      const [p, q] = [...ptrs.current.values()];
      drag.current = { kind: "pinch", x: 0, y: 0, yaw: cy, pitch: cp, px: 0, py: 0, moved: true, hit: null, dist: Math.hypot(p[0] - q[0], p[1] - q[1]), mx: (p[0] + q[0]) / 2, my: (p[1] + q[1]) / 2 };
      return;
    }
    if (e.button === 1) e.preventDefault();
    drag.current = { kind: e.button === 1 || e.shiftKey ? "pan" : "rot", x: e.clientX, y: e.clientY, yaw: cy, pitch: cp, px: vz.x, py: vz.y, moved: false, hit: (e.target as Element).closest("[data-tag]")?.getAttribute("data-tag") ?? null, dist: 0, mx: 0, my: 0 };
  };
  const move = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (ptrs.current.has(e.pointerId)) ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    if (!d) return;
    if (d.kind === "pinch") {
      const [p, q] = [...ptrs.current.values()];
      if (!q) return;
      const dist = Math.hypot(p[0] - q[0], p[1] - q[1]), mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2, r = rectOf();
      if (!on && r && d.dist > 0) { const sc = W / r.width; setVz((v) => { const z = zoomAt(v, toBox(mx, my), dist / d.dist, W, H); return { ...z, x: z.x + (mx - d.mx) * sc, y: z.y + (my - d.my) * sc }; }); }
      d.dist = dist; d.mx = mx; d.my = my;
      return;
    }
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    if (d.kind === "pan") { const r = rectOf(); if (!on && r) setVz((v) => ({ ...v, x: d.px + (dx * W) / r.width, y: d.py + (dy * W) / r.width })); return; }
    if (view !== "3d") setView("3d", { yaw: d.yaw, pitch: d.pitch });
    set({ yaw: d.yaw + dx * 0.5, pitch: Math.max(-89, Math.min(89, d.pitch + dy * 0.5)) });
  };
  const up = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    ptrs.current.delete(e.pointerId);
    if (d?.kind === "pinch") { drag.current = null; ptrs.current.clear(); return; }
    drag.current = null;
    // a click without a drag pins the wire's tag, or unpins on the background
    if (d && !d.moved && e.button === 0) { if (d.hit) togglePin(`w:${d.hit}`, { tags: [d.hit], fromDrawing: true }); else setPin(null); }
  };
  const key = (e: React.KeyboardEvent<SVGSVGElement>) => {
    const rot = (dy: number, dp: number) => { if (view !== "3d") setView("3d", { yaw: cy, pitch: cp }); set({ yaw: cy + dy, pitch: Math.max(-89, Math.min(89, cp + dp)) }); };
    const h: Record<string, () => void> = {
      ArrowLeft: () => rot(-5, 0), ArrowRight: () => rot(5, 0), ArrowUp: () => rot(0, -5), ArrowDown: () => rot(0, 5),
      "+": () => zoomBy(STEP_KEY), "=": () => zoomBy(STEP_KEY), "-": () => zoomBy(1 / STEP_KEY), _: () => zoomBy(1 / STEP_KEY), "0": resetView,
    };
    if (h[e.key]) { e.preventDefault(); h[e.key](); }
  };
  const showTip = (e: React.PointerEvent, lines: string[]) => {
    if (drag.current || e.pointerType === "touch") return;
    const r = boxRef.current?.getBoundingClientRect();
    if (!r) return;
    const x = e.clientX - r.left, y = e.clientY - r.top;
    setTip({ x, y, flipX: x > r.width * 0.6, flipY: y > r.height * 0.7, lines });
  };
  const wireLines = (w: Wire) => [
    (w.tag ? `${w.tag} · ` : "") + t(ROLES.find((r) => r[0] === (w.group ?? "driven"))![1]),
    `${t("Length")} ${fmtLen(Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]), unit)}`,
    `${t("Diameter")} ${fmtLen(2 * w.r, unit)}`,
  ];
  const plateLines = (p: Plate) => { const [a, b] = plateSize(p.pts); return [t(p.label), `${t("Size")} ${fmtLen(a, unit)} × ${fmtLen(b, unit)}`, `${t("Thickness")} ${fmtLen(p.thickness, unit)}`]; };

  return (
    <div className="preview" ref={boxRef}>
      <div className="preview-tools">
        <Select value={view} ariaLabel="View" options={[["3d", "3D (drag to rotate)"], ["top", "Top"], ["front", "Front"], ["side", "Side"]]} onChange={(v) => setView(v)} />
        <button className={showDims ? "on" : ""} aria-pressed={showDims} onClick={() => set({ showDims: !showDims })}>{t("Dimensions")}</button>
        <button className={on ? "on" : ""} aria-pressed={on} disabled={!eligible} title={eligible ? undefined : t("No field model for this antenna")} onClick={() => setRadiation((r) => !r)}>{t("Radiation")}</button>
        {on && <button onClick={() => setPlaying((p) => !p)}>{playing ? t("Pause") : t("Play")}</button>}
        <button className={gh ? "on" : ""} aria-pressed={!!gh} onClick={() => setGhost(gh ? null : { type, wires: design.wires, plates: design.plates })}>{gh ? t("Clear compare") : t("Pin for compare")}</button>
        {zoomed && !on && <button onClick={() => setVz(FIT)}>{t("Fit")}</button>}
        <button aria-label={t("Reset view")} title={t("Reset view")} onClick={resetView}>↺</button>
      </div>
      {fresh && <RadiationLayer data={fresh} toScreen={toScreen} W={W} H={H} theme={theme} playing={playing} />}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t("Antenna drawing")} tabIndex={0}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; ptrs.current.clear(); }}
        onDoubleClick={() => setVz(FIT)} onKeyDown={key} onContextMenu={(e) => { if (drag.current?.moved) e.preventDefault(); }}>
        <defs><marker id="dim-head" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" className="dim-head" /></marker></defs>
        <rect x="0" y="0" width={W} height={H} className={fresh ? "svg-bg clear" : "svg-bg"} />
        {pp.map(({ p, idx, q }) => (
          <polygon key={`p${idx}`} points={q.map((x) => S(x[0], x[1]).join(",")).join(" ")} className={`plate plate-${p.material}${litP ? (litP.has(idx) ? " lit" : " faded") : ""}`}
            onPointerMove={(e) => showTip(e, plateLines(p))} onPointerLeave={() => setTip(null)} />
        ))}
        {pw.map(({ w, idx, a, b }) => {
          const [x1, y1] = S(a[0], a[1]), [x2, y2] = S(b[0], b[1]);
          const cls = lit ? ((w.tag && lit.has(w.tag)) || litW.has(idx) ? " lit" : " faded") : hover?.fromDrawing && w.tag && hover.tags.includes(w.tag) ? " lit" : "";
          return <line key={`w${idx}`} x1={x1} y1={y1} x2={x2} y2={y2} className={`wire wire-${w.group ?? "driven"}${cls}`}
            strokeWidth={Math.min(16, Math.max(1.6, 2 * w.r * k))} strokeLinecap="round" />;
        })}
        {gp.map(({ q }, i) => <polygon key={`gp${i}`} points={q.map((x) => S(x[0], x[1]).join(",")).join(" ")} className="ghost ghost-plate" pointerEvents="none" />)}
        {/* the pinned design as thin dashes over the live one, so parts that did not move stay visible */}
        {gw.map(({ a, b }, i) => { const [x1, y1] = S(a[0], a[1]), [x2, y2] = S(b[0], b[1]); return <line key={`gw${i}`} x1={x1} y1={y1} x2={x2} y2={y2} className="ghost" strokeWidth={1.5} pointerEvents="none" />; })}
        {pw.map(({ w, a, b }: { w: Wire; a: number[]; b: number[] }, i) => {
          if (!w.tag) return null;
          const key = `${w.tag}`;
          if (tagged.has(key) && w.group !== "driven") return null;
          tagged.add(key);
          const [x, y] = S((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
          return <text key={`t${i}`} x={x + 6} y={y - 6} className="tag" pointerEvents="none">{w.tag}</text>;
        })}
        {/* wider invisible strokes to hover and click the wires; not part of the exported drawing */}
        {pw.map(({ w, idx, a, b }) => {
          const [x1, y1] = S(a[0], a[1]), [x2, y2] = S(b[0], b[1]);
          return <line key={`h${idx}`} x1={x1} y1={y1} x2={x2} y2={y2} className="ui hit" data-tag={w.tag}
            onPointerEnter={w.tag ? () => { if (!drag.current) setHover({ tags: [w.tag!], fromDrawing: true }); } : undefined}
            onPointerMove={(e) => showTip(e, wireLines(w))}
            onPointerLeave={() => { setTip(null); if (w.tag) setHover(null); }} />;
        })}
        {fp && (() => { const [x, y] = S(fp[0], fp[1]); return <g><circle cx={x} cy={y} r={6} className="feed-dot" /><text x={x + 9} y={y + 16} className="feed-label">{t("feed")}</text></g>; })()}
        {all.map(({ at, g }, i) => dimGroup(g, `d${i}`, `all${at === hotAt ? " hot" : hotAt ? " faded" : ""}`))}
        {hotGeom && dimGroup(hotGeom, "hot", "hot")}
        {gh && (
          <g transform={`translate(${PAD - 16}, ${H - 70})`} pointerEvents="none">
            <line x1={0} y1={0} x2={22} y2={0} className="ghost" strokeWidth={2} />
            <text x={28} y={4} className="legend-text">{t("pinned")}</text>
            <line x1={0} y1={16} x2={22} y2={16} className="wire wire-driven" strokeWidth={2} />
            <text x={28} y={20} className="legend-text">{t("current")}</text>
          </g>
        )}
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
      {tip && (
        <div className="preview-tip" role="tooltip" style={{ left: tip.x + (tip.flipX ? -14 : 14), top: tip.y + (tip.flipY ? -14 : 14), transform: `translate(${tip.flipX ? "-100%" : "0"}, ${tip.flipY ? "-100%" : "0"})` }}>
          {tip.lines.map((l, i) => <div key={i} className={i === 0 ? "tip-head" : ""}>{l}</div>)}
        </div>
      )}
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
