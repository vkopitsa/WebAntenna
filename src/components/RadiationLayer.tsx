import { useEffect, useMemo, useRef, useState } from "react";
import type { Vec3 } from "../lib/types";
import { C0 } from "../lib/rf";
import { fieldScale, rampLUT, shade, type RadiationField, type RGB } from "../lib/nearfield";

const PERIOD = 1500; // ms per RF cycle

function token(name: string): RGB {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  const n = m ? parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Animated near field (canvas, under the SVG) with the wires' current glow. */
export function RadiationLayer({ data, toScreen, W, H, theme, playing }: {
  data: RadiationField; toScreen: (q: Vec3) => [number, number]; W: number; H: number; theme: string; playing: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [scheme, setScheme] = useState(0);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const on = () => setScheme((n) => n + 1);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  // theme / scheme: re-read the tokens when the colours change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const colours = useMemo(() => ({ lut: rampLUT(token("--field-lo"), token("--field-mid"), token("--field-hi")), glow: token("--field-hi") }), [theme, scheme]);
  const scale = useMemo(() => fieldScale(data.grid, C0 / data.f / 2), [data]);
  const segs = useMemo(() => {
    const n = data.ir.length, pts: { a: [number, number]; b: [number, number] }[] = [];
    const v = (i: number): Vec3 => [data.segs[i], data.segs[i + 1], data.segs[i + 2]];
    for (let i = 0; i < n; i++) pts.push({ a: toScreen(v(6 * i)), b: toScreen(v(6 * i + 3)) });
    let imax = 1e-30;
    for (let i = 0; i < n; i++) imax = Math.max(imax, Math.hypot(data.ir[i], data.ii[i]));
    return { pts, imax };
  }, [data, toScreen]);

  useEffect(() => {
    const cv = canvas.current, ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const { nx, ny } = data.grid;
    const off = document.createElement("canvas");
    off.width = nx; off.height = ny;
    const octx = off.getContext("2d")!;
    const img = octx.createImageData(nx, ny);
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const animate = playing && !reduced;
    const [r, g, b] = colours.glow;
    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      // E(t) = Re(E e^{jωt}); with e^{−jkr} the wavefronts move outward
      const phase = animate ? (2 * Math.PI * (now - t0)) / PERIOD : null;
      shade(data.grid, phase, scale, colours.lut, img.data);
      octx.putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(off, 0, 0, W, H);
      const c = phase == null ? 0 : Math.cos(phase), s = phase == null ? 0 : Math.sin(phase);
      ctx.lineCap = "round"; ctx.lineWidth = 8;
      ctx.shadowColor = ctx.strokeStyle = `rgb(${r},${g},${b})`; ctx.shadowBlur = 14;
      segs.pts.forEach(({ a, b: q }, i) => {
        const ir = data.ir[i], ii = data.ii[i];
        const m = phase == null ? Math.hypot(ir, ii) : Math.abs(ir * c - ii * s);
        ctx.globalAlpha = Math.min(1, m / segs.imax);
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      });
      ctx.globalAlpha = 1; ctx.shadowBlur = 0;
      if (animate && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const onVis = () => { if (!document.hidden && animate) { cancelAnimationFrame(raf); raf = requestAnimationFrame(draw); } };
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); document.removeEventListener("visibilitychange", onVis); };
  }, [data, scale, colours, segs, playing, W, H]);

  return <canvas ref={canvas} width={W} height={H} className="radiation-canvas" aria-hidden="true" />;
}
