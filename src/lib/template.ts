// 1:1 build templates and the printable build pack (PDF). Three template kinds:
//  - pcb:   each copper layer at 1:1 (optionally mirrored for toner transfer), feed and probe hole marked;
//  - wire:  a flat projection of small wire antennas (biquad, Moxon, helix side view, PCB loop) for bending;
//  - strip: a boom drilling strip for Yagis, cut into page-length pieces you tape end to end.
// Large wire antennas get no paper template: the cut list is the template.
import type { AntennaDef, Design, Params, Vec3 } from "./types";
import { A4, type Page, type Prim, toPDF, toSVG, wrap } from "./drawing";
import { buildPack, en, pieces, type Msg } from "./build";
import { boardsOf, copperBoxes, isProbe, type Pcb } from "./pcb";
import { PROBE_CLEAR, PROBE_DRILL } from "./fab";

/** A drawing in mm, origin at its own top-left. */
interface Drawing { w: number; h: number; prims: Prim[]; caption: string }

const MARGIN = 12, TOP = 28, BOTTOM = 280;
const CW = A4.w - 2 * MARGIN, CH = BOTTOM - TOP;

// ---------------------------------------------------------------- PCB

function pcbDrawing(p: Pcb, layer: "top" | "bottom", mirror: boolean, name: string): Drawing {
  const P = 8, b = p.board;
  const W = (b.x1 - b.x0) * 1e3, H = (b.y1 - b.y0) * 1e3;
  const X = (x: number) => P + (mirror ? (b.x1 - x) : (x - b.x0)) * 1e3, Y = (y: number) => P + (b.y1 - y) * 1e3;
  const prims: Prim[] = [p.outline ? { k: "poly", pts: p.outline.map(([x, y]): [number, number] => [X(x), Y(y)]), closed: true, lw: 0.2 } : { k: "rect", x: P, y: P, w: W, h: H, dash: true, lw: 0.2 }];
  for (const q of p.rects.filter((r) => r.layer === layer)) {
    const x0 = Math.min(X(q.x0), X(q.x1)), x1 = Math.max(X(q.x0), X(q.x1));
    prims.push({ k: "rect", x: x0, y: Y(q.y1), w: x1 - x0, h: (q.y1 - q.y0) * 1e3, fill: true });
  }
  for (const q of (p.polys ?? []).filter((r) => r.layer === layer)) prims.push({ k: "poly", pts: q.pts.map(([x, y]) => [X(x), Y(y)]), fill: true, closed: true });
  // crop marks at the board corners
  for (const [cx, cy, sx, sy] of [[P, P, -1, -1], [P + W, P, 1, -1], [P, P + H, -1, 1], [P + W, P + H, 1, 1]]) {
    prims.push({ k: "line", x1: cx + sx * 1.5, y1: cy, x2: cx + sx * 6, y2: cy, w: 0.15 }, { k: "line", x1: cx, y1: cy + sy * 1.5, x2: cx, y2: cy + sy * 6, w: 0.15 });
  }
  const s = p.port.start, t = p.port.stop;
  for (const q of p.drills ?? []) prims.push({ k: "circle", cx: X(q.x), cy: Y(q.y), r: q.d * 500, fill: true, white: true });
  if (p.drills) { /* holes drawn above; the feed is the coax through them */ } else if (isProbe(p)) {
    const cx = X(s[0]), cy = Y(s[1]);
    if (layer === "bottom") prims.push({ k: "circle", cx, cy, r: PROBE_CLEAR * 500, fill: true, white: true });
    prims.push({ k: "circle", cx, cy, r: PROBE_DRILL * 500, fill: true, white: true }, { k: "line", x1: cx - 2.5, y1: cy, x2: cx + 2.5, y2: cy, w: 0.15, grey: true }, { k: "line", x1: cx, y1: cy - 2.5, x2: cx, y2: cy + 2.5, w: 0.15, grey: true });
  } else if (layer === "top") {
    const cx = (X(s[0]) + X(t[0])) / 2, cy = (Y(s[1]) + Y(t[1])) / 2;
    prims.push({ k: "circle", cx, cy, r: 1.2, lw: 0.3 }, { k: "text", x: cx + 2, y: cy - 1.8, s: "FEED", size: 2.2, bold: true, grey: true });
  }
  const what = layer === "top" ? (mirror ? "Top copper, MIRRORED for toner transfer" : "Top copper, seen from the top") : mirror ? "Bottom copper, as seen from below (prints right for toner transfer)" : "Bottom copper, seen through the board from the top";
  return { w: W + 2 * P, h: H + 2 * P, prims, caption: `${name} - ${what} - board ${W.toFixed(1)} x ${H.toFixed(1)} mm` };
}

/**
 * Most A4 tiles for one 1:1 drawing that is taped together (PCB, helix wrap): a 10-turn 70 cm helix takes 27.
 * Bigger ones (a VHF printed board, a design typed in at 100 kHz) get no template; the dimensions and cut list do.
 */
const MAX_TILES = 30;
const fitsTiles = (d: Drawing) => Math.min(tiles(d.w, d.h), tiles(d.h, d.w)) <= MAX_TILES;

/** Every board's copper layers (a stacked build: one pair per board, named in the caption). */
function pcbDrawings(p: Pcb, mirror: boolean, name: string): Drawing[] {
  return boardsOf(p).flatMap(({ label, pcb }) => {
    const n = label ? `${name} ${label}` : name;
    const ds = [];
    if (copperBoxes(pcb).some((q) => q.layer === "top")) ds.push(pcbDrawing(pcb, "top", mirror, n));
    if (copperBoxes(pcb).some((q) => q.layer === "bottom")) ds.push(pcbDrawing(pcb, "bottom", mirror, n));
    return ds.filter(fitsTiles);
  });
}

// ---------------------------------------------------------------- wire projection

function wireDrawing(def: AntennaDef, d: Design): Drawing | null {
  const ws = d.wires.filter((w) => !w.necOnly);
  const metal = d.plates.filter((pl) => pl.material === "metal");
  const pts: Vec3[] = [...ws.flatMap((w) => [w.a, w.b]), ...metal.flatMap((pl) => pl.pts)];
  if (!pts.length) return null;
  const lo = [0, 1, 2].map((i) => Math.min(...pts.map((q) => q[i]))), hi = [0, 1, 2].map((i) => Math.max(...pts.map((q) => q[i])));
  const ext = hi.map((v, i) => v - lo[i]);
  const drop = ext.indexOf(Math.min(...ext));
  const [iu, iv] = [0, 1, 2].filter((i) => i !== drop);
  const eu = ext[iu] * 1e3, ev = ext[iv] * 1e3;
  // only for real 2D shapes that fit on a few sheets of paper
  const P = 10;
  if (Math.min(eu, ev) < 0.05 * Math.max(eu, ev)) return null;
  if (Math.min(tiles(eu + 2 * P, ev + 2 * P), tiles(ev + 2 * P, eu + 2 * P)) > 6) return null;
  const X = (q: Vec3) => P + (q[iu] - lo[iu]) * 1e3, Y = (q: Vec3) => P + (hi[iv] - q[iv]) * 1e3;
  const prims: Prim[] = [];
  const printed = def.category === "Printed";
  for (const pl of d.plates) {
    const poly = pl.pts.map((q) => [X(q), Y(q)] as [number, number]);
    if (pl.material === "metal") prims.push(printed ? { k: "poly", pts: poly, fill: true } : { k: "poly", pts: poly, closed: true, lw: 0.3, grey: true });
    else prims.push({ k: "poly", pts: poly, closed: true, lw: 0.2, grey: true });
  }
  for (const w of ws) prims.push({ k: "line", x1: X(w.a), y1: Y(w.a), x2: X(w.b), y2: Y(w.b), w: Math.max(w.r * 2e3, 0.3), grey: w.drawOnly });
  for (const pc of pieces(d)) {
    if (pc.mech) continue;
    const first = d.wires[pc.wires[0]];
    if (pc.tag) prims.push({ k: "text", x: (X(first.a) + X(first.b)) / 2 + 1.5, y: (Y(first.a) + Y(first.b)) / 2 - 1.5, s: pc.tag, size: 3, bold: true, grey: true });
  }
  if (d.feed) {
    const w = d.wires[d.feed.wire];
    const q: Vec3 = d.feed.at === "start" ? w.a : d.feed.at === "end" ? w.b : [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2, (w.a[2] + w.b[2]) / 2];
    prims.push({ k: "circle", cx: X(q), cy: Y(q), r: 1.8, lw: 0.3 }, { k: "text", x: X(q) + 2.5, y: Y(q) + 4, s: "FEED", size: 2.4, bold: true, grey: true });
  }
  return { w: eu + 2 * P, h: ev + 2 * P, prims, caption: `${def.name} - flat view, 1:1 - ${eu.toFixed(1)} x ${ev.toFixed(1)} mm` };
}

// ---------------------------------------------------------------- wire-cage frames

/** One hot frame and one ground frame of a wire cage at 1:1, side by side, with the hoop positions at the bends. */
function frameDrawing(def: AntennaDef, d: Design): Drawing | null {
  const f = d.frames;
  if (!f) return null;
  const wd = Math.max(2 * d.wires[1].r * 1e3, 0.4), P = 12;
  const mmP = (q: [number, number]): [number, number] => [q[0] * 1e3, q[1] * 1e3];
  const hot = f.hot.map(mmP), gnd = f.ground.map(mmP);
  const all = [...hot, ...gnd], zTop = Math.max(...all.map((q) => q[1]));
  const hx0 = Math.min(...hot.map((q) => q[0])), gx0 = Math.min(...gnd.map((q) => q[0]));
  const hotW = Math.max(...hot.map((q) => q[0])) - hx0, gndW = Math.max(...gnd.map((q) => q[0])) - gx0;
  const dxG = P + hotW + 25 - gx0;
  const prims: Prim[] = [];
  const draw = (pts: [number, number][], dx: number, name: string, endName: string) => {
    const X = (q: [number, number]) => dx + q[0], Y = (q: [number, number]) => P + 6 + zTop - q[1];
    pts.slice(1).forEach((q, i) => prims.push({ k: "line", x1: X(pts[i]), y1: Y(pts[i]), x2: X(q), y2: Y(q), w: wd }));
    for (const q of pts.slice(1)) prims.push({ k: "circle", cx: X(q), cy: Y(q), r: wd / 2 + 1.2, lw: 0.25 });   // every bend carries a hoop
    prims.push({ k: "text", x: X(pts[0]) - 1, y: Y(pts[0]) + 4, s: endName, size: 2.2, bold: true, grey: true });
    const xs = pts.map(X), ys = pts.map(Y);
    prims.push({ k: "text", x: (Math.min(...xs) + Math.max(...xs)) / 2, y: Math.max(...ys) + 9, s: name, size: 2.8, bold: true, anchor: "middle" });
  };
  draw(hot, P - hx0, `HOT FRAME x ${f.n}`, "WASHER");
  draw(gnd, dxG, `GROUND FRAME x ${f.n}`, "COLLAR");
  const w = dxG + gx0 + gndW + P, h = zTop - Math.min(...all.map((q) => q[1])) + 2 * P + 18;
  const out: Drawing = { w, h, prims, caption: `${def.name} - frames, 1:1 (circles: hoops at the bends; the axis is to the left of each frame)` };
  return fitsTiles(out) ? out : null;
}

// ---------------------------------------------------------------- sheet-metal flat patterns

/** Overlap flap drawn dashed along one straight edge of a sector, for a soldered lap seam (mm). */
const LAP = 5;

/** One drawing per formed sheet part: annular sectors (cones), strips (rims, skirts) and discs, at 1:1. */
function sheetDrawings(def: AntennaDef, d: Design): Drawing[] {
  const P = 8;
  return (d.sheets ?? []).map((sh): Drawing => {
    const prims: Prim[] = [];
    if (sh.kind === "strip") {
      const w = sh.w * 1e3, h = sh.h * 1e3;
      prims.push({ k: "rect", x: P, y: P, w, h, lw: 0.3 }, { k: "line", x1: P + w, y1: P, x2: P + w + LAP, y2: P, w: 0.2, dash: true }, { k: "line", x1: P + w + LAP, y1: P, x2: P + w + LAP, y2: P + h, w: 0.2, dash: true }, { k: "line", x1: P + w, y1: P + h, x2: P + w + LAP, y2: P + h, w: 0.2, dash: true });
      prims.push({ k: "text", x: P + w / 2, y: P + h / 2 + 1, s: sh.label, size: Math.min(3, h / 3), anchor: "middle", grey: true });
      return { w: w + LAP + 2 * P, h: h + 2 * P, prims, caption: `${def.name} - ${sh.label}: strip ${w.toFixed(1)} x ${h.toFixed(1)} mm (roll it into a ring of ${(w / Math.PI).toFixed(1)} mm diameter)` };
    }
    if (sh.kind === "disc") {
      const R = (sh.d * 1e3) / 2, c = P + R;
      prims.push({ k: "circle", cx: c, cy: c, r: R, lw: 0.3 });
      if (sh.hole > 0) prims.push({ k: "circle", cx: c, cy: c, r: (sh.hole * 1e3) / 2, lw: 0.3 });
      prims.push({ k: "line", x1: c - 3, y1: c, x2: c + 3, y2: c, w: 0.15, grey: true }, { k: "line", x1: c, y1: c - 3, x2: c, y2: c + 3, w: 0.15, grey: true });
      if (R > 12) prims.push({ k: "text", x: c, y: c + R / 2, s: sh.label, size: 2.6, anchor: "middle", grey: true });
      return { w: 2 * R + 2 * P, h: 2 * R + 2 * P, prims, caption: `${def.name} - ${sh.label}: disc ${(2 * R).toFixed(1)} mm, hole ${(sh.hole * 1e3).toFixed(1)} mm` };
    }
    // annular sector, apex at the origin, from angle 0 (the lap edge) to `angle`
    const r0 = sh.r0 * 1e3, r1 = sh.r1 * 1e3, A = (sh.angle * Math.PI) / 180;
    const n = Math.max(8, Math.ceil(sh.angle / 2));
    const arc = (r: number) => Array.from({ length: n + 1 }, (_, i) => [r * Math.cos((A * i) / n), r * Math.sin((A * i) / n)] as [number, number]);
    const outline = [...arc(r1), ...arc(r0).reverse()];
    // lap flap: the edge at angle 0 shifted outward (toward negative angles) by LAP
    const flap: [number, number][] = [[r0, 0], [r0, -LAP], [r1, -LAP], [r1, 0]];
    const all = [...outline, ...flap];
    const x0 = Math.min(...all.map((q) => q[0])), y0 = Math.min(...all.map((q) => q[1]));
    const x1 = Math.max(...all.map((q) => q[0])), y1 = Math.max(...all.map((q) => q[1]));
    const T = (q: [number, number]): [number, number] => [P + q[0] - x0, P + (y1 - q[1])];
    prims.push({ k: "poly", pts: outline.map(T), closed: true, lw: 0.3 });
    for (let i = 0; i < 3; i++) { const a = T(flap[i]), b = T(flap[i + 1]); prims.push({ k: "line", x1: a[0], y1: a[1], x2: b[0], y2: b[1], w: 0.2, dash: true }); }
    const apex = T([0, 0]);
    prims.push({ k: "circle", cx: apex[0], cy: apex[1], r: 0.6, fill: true });
    const mid = T([((r0 + r1) / 2) * Math.cos(A / 2), ((r0 + r1) / 2) * Math.sin(A / 2)]);
    prims.push({ k: "text", x: mid[0], y: mid[1], s: sh.label, size: Math.min(3, Math.max(1.6, (r1 - r0) / 5)), anchor: "middle", grey: true });
    return { w: x1 - x0 + 2 * P, h: y1 - y0 + 2 * P, prims, caption: `${def.name} - ${sh.label}: sector R ${r0.toFixed(1)} - ${r1.toFixed(1)} mm, ${sh.angle.toFixed(1)} degrees (dot = cone apex; dashed = ${LAP} mm lap for the seam)` };
  }).filter(fitsTiles);
}

// ---------------------------------------------------------------- helix winding wrap

/** Paper you wrap round the former (printed side out): wind the wire along the lines. */
function helixDrawing(def: AntennaDef, d: Design): Drawing | null {
  const D = d.dims.find((x) => x.key === "D")?.value, S = d.dims.find((x) => x.key === "S")?.value;
  const Lax = d.dims.find((x) => x.label === "Helix length (axial)")?.value;
  const hw = d.wires.filter((w) => w.group === "driven" && !w.necOnly);
  if (!D || !S || !Lax || hw.length < 4) return null;
  const wd = 2 * hw[0].r;
  // handedness from the geometry: angle advances with height → right-handed
  const w = hw[Math.floor(hw.length / 2)];
  const right = (w.a[0] * w.b[1] - w.a[1] * w.b[0]) * (w.b[2] - w.a[2]) > 0;
  const C = Math.PI * (D - wd) * 1e3, H = Lax * 1e3, s = S * 1e3, P = 10, n = Math.round(Lax / S);
  // past MAX_TILES (big VHF/HF helices) the cut list is the template
  if (!fitsTiles({ w: C + 2 * P + 6, h: H + 2 * P + 4, prims: [], caption: "" })) return null;
  const prims: Prim[] = [{ k: "rect", x: P, y: P, w: C, h: H, lw: 0.25 }];
  for (let i = 0; i < n; i++) {
    const y0 = P + H - i * s, y1 = y0 - s;
    prims.push(right ? { k: "line", x1: P, y1: y0, x2: P + C, y2: y1, w: Math.max(wd * 1e3, 0.4) } : { k: "line", x1: P + C, y1: y0, x2: P, y2: y1, w: Math.max(wd * 1e3, 0.4) });
    prims.push({ k: "text", x: P + C + 1.5, y: y1 + 1, s: `${i + 1}`, size: 2.4, grey: true });
  }
  prims.push({ k: "text", x: P + C / 2, y: P + H + 5, s: "FEED END (ground plane side)", size: 2.4, bold: true, anchor: "middle", grey: true });
  prims.push({ k: "line", x1: P, y1: P - 3, x2: P + C, y2: P - 3, w: 0.15, grey: true }, { k: "text", x: P + C / 2, y: P - 4, s: `${C.toFixed(1)} mm = circumference of a ${((D - wd) * 1e3).toFixed(1)} mm former`, size: 2.2, anchor: "middle", grey: true });
  return { w: C + 2 * P + 6, h: H + 2 * P + 4, prims, caption: `${def.name} - winding wrap (${right ? "right" : "left"}-hand, ${n} turns, pitch ${s.toFixed(1)} mm). Wrap it printed side out round the former; the side edges must just meet.` };
}

// ---------------------------------------------------------------- boom drilling strip

interface Mark { s: number; tag: string }

/** Longest boom that gets a paper drilling strip (≈ 14 A4 pages); beyond it the element positions in the dimensions are the template. */
const MAX_STRIP = 20;

function boomMarks(d: Design): { L: number; marks: Mark[]; dia: number } | null {
  const ps = pieces(d);
  const boom = ps.filter((pc) => pc.mech).sort((a, b) => b.length - a.length)[0];
  if (!boom || boom.length < 0.1 || boom.length > MAX_STRIP) return null;
  const bw = d.wires[boom.wires[0]];
  const a = bw.a, b = d.wires[boom.wires[boom.wires.length - 1]].b;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const u = [(b[0] - a[0]) / L, (b[1] - a[1]) / L, (b[2] - a[2]) / L];
  const marks: Mark[] = [];
  for (const pc of ps) {
    if (pc.mech || pc.group === "feed") continue;
    let cx = 0, cy = 0, cz = 0, tot = 0;
    for (const i of pc.wires) { const w = d.wires[i]; const l = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1], w.b[2] - w.a[2]); cx += ((w.a[0] + w.b[0]) / 2) * l; cy += ((w.a[1] + w.b[1]) / 2) * l; cz += ((w.a[2] + w.b[2]) / 2) * l; tot += l; }
    const c = [cx / tot - a[0], cy / tot - a[1], cz / tot - a[2]];
    const s = c[0] * u[0] + c[1] * u[1] + c[2] * u[2];
    const off = Math.hypot(c[0] - s * u[0], c[1] - s * u[1], c[2] - s * u[2]);
    if (off < Math.max(5 * boom.dia, 0.05) && s > -0.01 && s < L + 0.01) marks.push({ s, tag: pc.tag || "?" });
  }
  marks.sort((x, y) => x.s - y.s);
  return { L, marks, dia: boom.dia };
}

const SEG = 240, SW = 22, SGAP = 9;

function stripPages(title: string, L: number, marks: Mark[]): Page[] {
  const n = Math.ceil((L * 1e3) / SEG);
  const perPage = Math.floor((CW + SGAP) / (SW + SGAP));
  const pages: Page[] = [];
  for (let p0 = 0; p0 < n; p0 += perPage) {
    const prims: Prim[] = [];
    for (let j = 0; j < perPage && p0 + j < n; j++) {
      const i = p0 + j, s0 = i * SEG, len = Math.min(SEG, L * 1e3 - s0);
      const x = MARGIN + j * (SW + SGAP), y = TOP + 6;
      prims.push({ k: "text", x: x + SW / 2, y: y - 2, s: `Strip ${i + 1}/${n}`, size: 2.8, bold: true, anchor: "middle" });
      prims.push({ k: "rect", x, y, w: SW, h: len, lw: 0.25 }, { k: "line", x1: x + SW / 2, y1: y, x2: x + SW / 2, y2: y + len, w: 0.15, dash: true, grey: true });
      for (let mm = Math.ceil(s0 / 10) * 10; mm <= s0 + len + 1e-6; mm += 10) {
        const yy = y + mm - s0, major = mm % 50 === 0;
        prims.push({ k: "line", x1: x, y1: yy, x2: x + (major ? 4 : 2), y2: yy, w: 0.15 });
        if (major && mm % 100 === 0 && mm - s0 > 3 && s0 + len - mm > 3) prims.push({ k: "text", x: x + 4.6, y: yy + 0.8, s: `${mm}`, size: 1.9, grey: true });
      }
      for (const m of marks) {
        const mm = m.s * 1e3;
        if (mm < s0 - 1e-6 || mm > s0 + len + 1e-6) continue;
        const yy = y + mm - s0;
        prims.push({ k: "line", x1: x, y1: yy, x2: x + SW, y2: yy, w: 0.5 }, { k: "circle", cx: x + SW / 2, cy: yy, r: 0.9, fill: true });
        prims.push({ k: "text", x: x + SW - 0.8, y: yy - 1.2, s: m.tag, size: 2.6, bold: true, anchor: "end" }, { k: "text", x: x + SW - 0.8, y: yy + 3, s: mm.toFixed(1), size: 2, anchor: "end" });
      }
      if (i === 0) prims.push({ k: "text", x: x + SW / 2, y: y + 5, s: "BOOM START", size: 2, bold: true, anchor: "middle", grey: true });
      if (i === n - 1) prims.push({ k: "text", x: x + SW / 2, y: y + len - 2, s: "BOOM END", size: 2, bold: true, anchor: "middle", grey: true });
      else prims.push({ k: "text", x: x + SW / 2, y: y + len + 4, s: `to strip ${i + 2}`, size: 2, anchor: "middle", grey: true });
    }
    pages.push(frame(prims, title, "Boom drilling strip, 1:1. Cut along the outlines, tape the strips end to end on the boom from the BOOM START end, drill at the dots. Distances in mm from the boom start."));
  }
  return pages;
}

// ---------------------------------------------------------------- page assembly

function frame(prims: Prim[], title: string, sub: string, page?: string): Page {
  const out: Prim[] = [{ k: "text", x: MARGIN, y: 14, s: title, size: 4.6, bold: true }];
  wrap(sub, 2.6, CW).slice(0, 2).forEach((l, i) => out.push({ k: "text", x: MARGIN, y: 19.5 + i * 3.4, s: l, size: 2.6, grey: true }));
  // 50 mm scale check
  const y = 287;
  out.push({ k: "line", x1: MARGIN, y1: y, x2: MARGIN + 50, y2: y, w: 0.4 });
  for (let i = 0; i <= 5; i++) out.push({ k: "line", x1: MARGIN + i * 10, y1: y - (i % 5 === 0 ? 2.5 : 1.5), x2: MARGIN + i * 10, y2: y, w: 0.2 });
  out.push({ k: "text", x: MARGIN + 53, y: y + 0.6, s: "Print at 100 % (actual size): this bar must measure 50 mm.", size: 2.4, grey: true });
  if (page) out.push({ k: "text", x: A4.w - MARGIN, y: y + 0.6, s: page, size: 2.4, anchor: "end", grey: true });
  return { w: A4.w, h: A4.h, prims: [...out, ...prims] };
}

const shift = (ps: Prim[], dx: number, dy: number): Prim[] => ps.map((q) => {
  switch (q.k) {
    case "line": return { ...q, x1: q.x1 + dx, y1: q.y1 + dy, x2: q.x2 + dx, y2: q.y2 + dy };
    case "rect": return { ...q, x: q.x + dx, y: q.y + dy };
    case "poly": return { ...q, pts: q.pts.map(([x, y]) => [x + dx, y + dy] as [number, number]) };
    case "circle": return { ...q, cx: q.cx + dx, cy: q.cy + dy };
    case "text": return { ...q, x: q.x + dx, y: q.y + dy };
  }
});

const TH = CH - 8;
const tiles = (w: number, h: number) => (w <= CW && h + 6 <= CH ? 1 : Math.ceil(w / CW) * Math.ceil(h / TH));

/** Quarter turn (clockwise) of a drawing, to tile it on fewer pages. Text stays upright. */
function rotate(d: Drawing): Drawing {
  const R = (x: number, y: number): [number, number] => [d.h - y, x];
  const prims = d.prims.map((q): Prim => {
    switch (q.k) {
      case "line": { const [x1, y1] = R(q.x1, q.y1), [x2, y2] = R(q.x2, q.y2); return { ...q, x1, y1, x2, y2 }; }
      case "rect": { const [x, y] = R(q.x, q.y + q.h); return { ...q, x, y, w: q.h, h: q.w }; }
      case "poly": return { ...q, pts: q.pts.map(([x, y]) => R(x, y)) };
      case "circle": { const [cx, cy] = R(q.cx, q.cy); return { ...q, cx, cy }; }
      case "text": { const [x, y] = R(q.x, q.y); return { ...q, x, y }; }
    }
  });
  return { w: d.h, h: d.w, prims, caption: `${d.caption} (turned 90 degrees)` };
}

/** Stack drawings down the pages; a drawing bigger than the page area is tiled over several pages. */
function layout(ds: Drawing[], title: string, sub: string): Page[] {
  const pages: Prim[][] = [];
  let cur: Prim[] = [], y = TOP;
  const flush = () => { if (cur.length) pages.push(cur); cur = []; y = TOP; };
  for (const d0 of ds) {
    const d = tiles(d0.h, d0.w) < tiles(d0.w, d0.h) ? rotate(d0) : d0;
    const cap = wrap(d.caption, 2.8, CW, true).slice(0, 2), ch = cap.length * 3.6;
    if (d.w <= CW && d.h + 2 + ch <= CH) {
      if (y + d.h + 2 + ch > BOTTOM) flush();
      cap.forEach((l, i) => cur.push({ k: "text", x: MARGIN, y: y + 3.5 + i * 3.6, s: l, size: 2.8, bold: true }));
      cur.push(...shift(d.prims, MARGIN + (CW - d.w) / 2, y + 1.5 + ch));
      y += d.h + 6 + ch;
      continue;
    }
    flush();
    const tw = CW, th = TH, nx = Math.ceil(d.w / tw), ny = Math.ceil(d.h / th);
    for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
      const id = `${String.fromCharCode(65 + r)}${c + 1}`;
      const clip = d.prims.filter((q) => inTile(q, c * tw, r * th, tw, th));
      wrap(`Tile ${id} of ${String.fromCharCode(64 + ny)}${nx}: ${d.caption}`, 2.6, CW, true).slice(0, 2).forEach((l, i) => cur.push({ k: "text", x: MARGIN, y: TOP + 1 + i * 3.2, s: l, size: 2.6, bold: true }));
      cur.push({ k: "rect", x: MARGIN, y: TOP + 6, w: tw, h: th, lw: 0.15, dash: true, grey: true });
      cur.push(...shift(clip, MARGIN - c * tw, TOP + 6 - r * th));
      pages.push(cur); cur = [];
    }
  }
  flush();
  return pages.map((ps, i) => frame(ps, title, sub, `${i + 1}/${pages.length}`));
}

/** Coarse clip: keep primitives that touch the tile (the page edge clips the rest when printed). */
function inTile(q: Prim, x: number, y: number, w: number, h: number): boolean {
  const bb = q.k === "line" ? [Math.min(q.x1, q.x2), Math.min(q.y1, q.y2), Math.max(q.x1, q.x2), Math.max(q.y1, q.y2)]
    : q.k === "rect" ? [q.x, q.y, q.x + q.w, q.y + q.h]
      : q.k === "poly" ? [Math.min(...q.pts.map((p) => p[0])), Math.min(...q.pts.map((p) => p[1])), Math.max(...q.pts.map((p) => p[0])), Math.max(...q.pts.map((p) => p[1]))]
        : q.k === "circle" ? [q.cx - q.r, q.cy - q.r, q.cx + q.r, q.cy + q.r] : [q.x, q.y - q.size, q.x + 1, q.y];
  return bb[2] >= x && bb[0] <= x + w && bb[3] >= y && bb[1] <= y + h;
}

// ---------------------------------------------------------------- public API

export type TemplateKind = "pcb" | "wire" | "strip" | "sheet" | "none";

export function templateKind(def: AntennaDef, d: Design): TemplateKind {
  if (d.pcb) return pcbDrawings(d.pcb, false, def.name).length ? "pcb" : "none";
  if (boomMarks(d)) return "strip";
  if (d.sheets?.length) return sheetDrawings(def, d).length ? "sheet" : "none";
  if (def.id === "helix" && helixDrawing(def, d)) return "wire";
  if (frameDrawing(def, d)) return "wire";
  return wireDrawing(def, d) ? "wire" : "none";
}

export function templatePages(def: AntennaDef, d: Design, mirror: boolean): Page[] {
  const name = def.name;
  if (d.pcb) {
    return layout(pcbDrawings(d.pcb, mirror, name), `${name}: 1:1 PCB template`, "Black = copper. For toner transfer or photo etching use the mirrored option. Check the scale bar before you etch.");
  }
  const bm = boomMarks(d);
  if (bm) return stripPages(`${name}: boom drilling strip`, bm.L, bm.marks);
  if (d.sheets?.length) {
    const sd = sheetDrawings(def, d);
    return sd.length ? layout(sd, `${name}: 1:1 flat patterns`, "Glue the patterns onto 0.3-0.5 mm brass or copper sheet and cut along the solid lines. Dashed: optional lap for the soldered seam.") : [];
  }
  const hx = def.id === "helix" ? helixDrawing(def, d) : null;
  if (hx) return layout([hx], `${name}: 1:1 winding template`, "Cut it out, tape the tiles together, wrap it round the former printed side out and wind the wire along the lines.");
  const fd = frameDrawing(def, d);
  if (fd) return layout([fd], `${name}: 1:1 frame template`, "Bend every frame over its drawing: all frames of a side must match it. Lines are drawn at the wire diameter.");
  const w = wireDrawing(def, d);
  return w ? layout([w], `${name}: 1:1 template`, "Bend the wire over the drawing. Lines are drawn at the wire diameter; FEED marks the feed point.") : [];
}

/** One sheet at 1:1 for plotters, cutters and large-format printers (no tiling). */
export function templateSVG(def: AntennaDef, d: Design, mirror: boolean): string | null {
  const ds: Drawing[] = [];
  if (d.pcb) {
    ds.push(...pcbDrawings(d.pcb, mirror, def.name));
  } else {
    const bm = boomMarks(d);
    if (bm) {
      // one continuous strip
      const L = bm.L * 1e3, prims: Prim[] = [{ k: "rect", x: 10, y: 10, w: SW, h: L, lw: 0.25 }];
      for (let mm = 0; mm <= L; mm += 10) prims.push({ k: "line", x1: 10, y1: 10 + mm, x2: 10 + (mm % 50 ? 2 : 4), y2: 10 + mm, w: 0.15 });
      for (const m of bm.marks) prims.push({ k: "line", x1: 10, y1: 10 + m.s * 1e3, x2: 10 + SW, y2: 10 + m.s * 1e3, w: 0.5 }, { k: "circle", cx: 10 + SW / 2, cy: 10 + m.s * 1e3, r: 0.9, fill: true }, { k: "text", x: 10 + SW + 2, y: 11 + m.s * 1e3, s: `${m.tag}  ${(m.s * 1e3).toFixed(1)} mm`, size: 3 });
      ds.push({ w: SW + 60, h: L + 20, prims, caption: `${def.name} - boom drilling strip, 1:1, mm from the boom start` });
    } else if (d.sheets?.length) {
      ds.push(...sheetDrawings(def, d));
    } else {
      const w = (def.id === "helix" && helixDrawing(def, d)) || frameDrawing(def, d) || wireDrawing(def, d);
      if (w) ds.push(w);
    }
  }
  if (!ds.length) return null;
  const W = Math.max(...ds.map((x) => x.w)) + 20;
  const prims: Prim[] = [];
  let y = 10;
  for (const x of ds) { prims.push({ k: "text", x: 10, y: y + 4, s: x.caption, size: 3.2, bold: true }, ...shift(x.prims, 10, y + 6)); y += x.h + 14; }
  return toSVG({ w: W, h: y, prims }, `${def.name} 1:1 template`);
}

// ---------------------------------------------------------------- build sheet (text pages)

class Flow {
  pages: Prim[][] = [[]];
  y = TOP;
  get cur() { return this.pages[this.pages.length - 1]; }
  need(h: number) { if (this.y + h > BOTTOM) { this.pages.push([]); this.y = TOP; } }
  heading(s: string) { this.need(10); this.y += 3; this.cur.push({ k: "text", x: MARGIN, y: this.y + 3.6, s, size: 3.8, bold: true }); this.y += 6.5; }
  para(s: string, indent = 0, size = 2.9) {
    for (const l of wrap(s, size, CW - indent)) { this.need(size * 1.45); this.cur.push({ k: "text", x: MARGIN + indent, y: this.y + size, s: l, size }); this.y += size * 1.45; }
  }
  bullet(s: string, mark = "-") {
    const size = 2.9, lines = wrap(s, size, CW - 6);
    lines.forEach((l, i) => { this.need(size * 1.45); if (!i) this.cur.push({ k: "text", x: MARGIN + 1, y: this.y + size, s: mark, size }); this.cur.push({ k: "text", x: MARGIN + 6, y: this.y + size, s: l, size }); this.y += size * 1.45; });
    this.y += 0.6;
  }
  table(widths: number[], head: string[], rows: string[][], num: boolean[] = []) {
    const size = 2.6, lh = size * 1.4;
    const xs = widths.map((_, i) => MARGIN + widths.slice(0, i).reduce((a, b) => a + b, 0));
    const row = (cells: string[], bold: boolean) => {
      const wrapped = cells.map((c, i) => wrap(c, size, widths[i] - 2, bold));
      const h = Math.max(...wrapped.map((l) => l.length)) * lh + 1;
      this.need(h);
      wrapped.forEach((ls, i) => ls.forEach((l, k) => this.cur.push({ k: "text", x: num[i] ? xs[i] + widths[i] - 2 : xs[i], y: this.y + size + k * lh, s: l, size, bold, anchor: num[i] ? "end" : "start" })));
      this.y += h;
      this.cur.push({ k: "line", x1: MARGIN, y1: this.y - 0.4, x2: MARGIN + widths.reduce((a, b) => a + b, 0), y2: this.y - 0.4, w: bold ? 0.25 : 0.1, grey: !bold });
    };
    row(head, true);
    rows.forEach((r) => row(r, false));
    this.y += 2;
  }
}

const mmS = (m: number) => `${(m * 1e3).toFixed(Math.abs(m) < 0.01 ? 2 : 1)} mm`;

export function buildSheetPages(def: AntennaDef, p: Params, d: Design, version: string): Page[] {
  const pack = buildPack(def, p, d);
  const F = new Flow();
  const t = (m: Msg) => en(m);
  F.heading("Key dimensions");
  F.table([120, 66], ["Dimension", "Value"], d.dims.map((x) => [`${x.key ? x.key + "  " : ""}${x.label}`, mmS(x.value)]), [false, true]);
  F.heading("Bill of materials");
  F.table([92, 40, 54], ["Item", "Quantity", "Note"], pack.bom.map((r) => [t(r.item), t(r.qty), r.note ? t(r.note) : ""]));
  if (pack.cuts.length) {
    F.heading("Cut list");
    F.table([40, 16, 12, 30, 30, 18, 40], ["Part", "Tag", "Qty", "Length", "Cut to", "Dia.", "Note"],
      pack.cuts.map((c) => [t(c.what), c.tag, String(c.qty), mmS(c.length), mmS(c.cut), mmS(c.dia), c.note ? t(c.note) : ""]), [false, false, true, true, true, true, false]);
  }
  F.heading("Tuning");
  if (pack.tune.length) {
    for (const r of pack.tune) F.bullet(`${t(r.what)}${r.tag ? ` (${r.tag})` : ""}: ${en({ s: r.how, a: [{ len: r.step }] })} - the best match moves up by about ${en({ s: "{0}", a: [{ hz: r.df }] })} (${(100 * r.df / r.f).toFixed(2)} %). Adding the same length moves it down by the same amount.`);
  } else F.para(pack.tuneNote ? t(pack.tuneNote) : "Not tuned by trimming.");
  if (pack.substrate.length) { F.heading("Substrate"); pack.substrate.forEach((m) => F.bullet(t(m))); }
  F.heading("Build steps");
  pack.steps.forEach((m, i) => F.bullet(t(m), `${i + 1}.`));
  if (d.notes.length) { F.heading("Design notes"); d.notes.forEach((n) => F.bullet(n)); }
  const bands = String(p.bands ?? "").split(";").filter(Boolean).map((b) => b.split("-").map((x) => `${(+x / 1e6).toFixed(3)}`).join("-") + " MHz").join(", ");
  return F.pages.map((ps, i) => frame(ps, `${def.name}: build sheet`, `Design ${(d.f / 1e6).toFixed(3)} MHz${bands ? `; bands ${bands}` : ""}. Antenna Generator v${version}.`, `${i + 1}/${F.pages.length}`));
}

/** Build sheet followed by the 1:1 templates, as one PDF. */
export function buildPackPDF(def: AntennaDef, p: Params, d: Design, version: string, mirror: boolean): Uint8Array {
  const pages = [...buildSheetPages(def, p, d, version), ...templatePages(def, d, mirror)];
  return toPDF(pages, `${def.name} build pack`);
}

