// Page drawing model in millimetres (origin top-left, y down) with two renderers: a minimal PDF writer
// (A4, Helvetica, vector, prints at exactly 1:1 with "actual size") and SVG with mm units. No dependencies.

export type Prim =
  | { k: "line"; x1: number; y1: number; x2: number; y2: number; w: number; dash?: boolean; grey?: boolean }
  | { k: "rect"; x: number; y: number; w: number; h: number; fill?: boolean; lw?: number; dash?: boolean; grey?: boolean }
  | { k: "poly"; pts: [number, number][]; fill?: boolean; lw?: number; closed?: boolean; grey?: boolean }
  | { k: "circle"; cx: number; cy: number; r: number; fill?: boolean; lw?: number; white?: boolean; grey?: boolean }
  /** Everything up to the matching "unclip" is cut off outside this rectangle (tiles of a big drawing). */
  | { k: "clip"; x: number; y: number; w: number; h: number }
  | { k: "unclip" }
  | { k: "text"; x: number; y: number; s: string; size: number; anchor?: "start" | "middle" | "end"; bold?: boolean; grey?: boolean };

export interface Page { w: number; h: number; prims: Prim[] }

export const A4 = { w: 210, h: 297 };

// Helvetica advance widths (1/1000 em) for ASCII 32..126, from the standard AFM.
const HW = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];

/** Characters Helvetica/WinAnsi cannot show, spelled out. */
const SUB: Record<string, string> = { "ε": "e", "λ": "lambda", "Ω": "Ohm", "δ": "d", "θ": "theta", "φ": "phi", "Δ": "delta ", "π": "pi", "≲": "<~", "√": "sqrt", "≈": "~", "−": "-", "—": "-", "…": "...", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", "’": "'", "“": "\"", "”": "\"" };
/** WinAnsi codes for the Latin-1 characters we use. */
const WIN: Record<string, number> = { "·": 0xb7, "×": 0xd7, "Ø": 0xd8, "±": 0xb1, "°": 0xb0, "µ": 0xb5, "–": 0x96, "²": 0xb2 };

export function ascii(s: string): string {
  return [...s].map((c) => SUB[c] ?? c).join("");
}

export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const c of ascii(s)) { const i = c.charCodeAt(0) - 32; w += i >= 0 && i < HW.length ? HW[i] : 556; }
  return (w / 1000) * size * (bold ? 1.06 : 1);
}

/** Greedy word wrap to a width in mm. */
export function wrap(s: string, size: number, width: number, bold = false): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of s.split(/\s+/)) {
    const t = line ? `${line} ${word}` : word;
    if (textWidth(t, size, bold) > width && line) { out.push(line); line = word; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

// ---------------------------------------------------------------- PDF

const PT = 72 / 25.4;
const f2 = (v: number) => (Math.round(v * 1000) / 1000).toString();

function pdfString(s: string): string {
  let o = "(";
  for (const c of ascii(s)) {
    if (c === "(" || c === ")" || c === "\\") o += "\\" + c;
    else if (WIN[c] != null) o += "\\" + WIN[c].toString(8);
    else { const n = c.charCodeAt(0); o += n >= 32 && n < 127 ? c : "?"; }
  }
  return o + ")";
}

function pageStream(p: Page): string {
  const X = (x: number) => f2(x * PT), Y = (y: number) => f2((p.h - y) * PT);
  const o: string[] = ["1 J 1 j"];
  const stroke = (grey?: boolean) => (grey ? "0.55 G" : "0 G");
  const fill = (grey?: boolean, white?: boolean) => (white ? "1 g" : grey ? "0.55 g" : "0 g");
  for (const q of p.prims) {
    switch (q.k) {
      case "line":
        o.push(stroke(q.grey), `${f2(q.w * PT)} w`, q.dash ? `[${f2(2 * PT)} ${f2(1.2 * PT)}] 0 d` : "[] 0 d", `${X(q.x1)} ${Y(q.y1)} m ${X(q.x2)} ${Y(q.y2)} l S`);
        break;
      case "rect": {
        const r = `${X(q.x)} ${Y(q.y + q.h)} ${f2(q.w * PT)} ${f2(q.h * PT)} re`;
        if (q.fill) o.push(fill(q.grey), "[] 0 d", `${r} f`);
        else o.push(stroke(q.grey), `${f2((q.lw ?? 0.25) * PT)} w`, q.dash ? `[${f2(2 * PT)} ${f2(1.2 * PT)}] 0 d` : "[] 0 d", `${r} S`);
        break;
      }
      case "poly": {
        if (q.pts.length < 2) break;
        const path = q.pts.map(([x, y], i) => `${X(x)} ${Y(y)} ${i ? "l" : "m"}`).join(" ") + (q.closed || q.fill ? " h" : "");
        o.push("[] 0 d", q.fill ? `${fill(q.grey)} ${path} f` : `${stroke(q.grey)} ${f2((q.lw ?? 0.25) * PT)} w ${path} S`);
        break;
      }
      case "circle": {
        const c = 0.5523 * q.r, cx = q.cx, cy = q.cy, r = q.r;
        const pts = [[cx + r, cy], [cx + r, cy - c, cx + c, cy - r, cx, cy - r], [cx - c, cy - r, cx - r, cy - c, cx - r, cy], [cx - r, cy + c, cx - c, cy + r, cx, cy + r], [cx + c, cy + r, cx + r, cy + c, cx + r, cy]];
        const path = `${X(pts[0][0])} ${Y(pts[0][1])} m ` + pts.slice(1).map((s) => `${X(s[0])} ${Y(s[1])} ${X(s[2])} ${Y(s[3])} ${X(s[4])} ${Y(s[5])} c`).join(" ") + " h";
        o.push("[] 0 d", q.fill ? `${fill(q.grey, q.white)} ${path} f` : `${stroke(q.grey)} ${f2((q.lw ?? 0.25) * PT)} w ${path} S`);
        break;
      }
      case "clip":
        o.push("q", `${X(q.x)} ${Y(q.y + q.h)} ${f2(q.w * PT)} ${f2(q.h * PT)} re W n`);
        break;
      case "unclip":
        o.push("Q");
        break;
      case "text": {
        const w = textWidth(q.s, q.size, q.bold);
        const x = q.anchor === "middle" ? q.x - w / 2 : q.anchor === "end" ? q.x - w : q.x;
        o.push(fill(q.grey), `BT /${q.bold ? "F2" : "F1"} ${f2(q.size * PT)} Tf ${X(x)} ${Y(q.y)} Td ${pdfString(q.s)} Tj ET`);
        break;
      }
    }
  }
  return o.join("\n");
}

export function toPDF(pages: Page[], title: string): Uint8Array {
  const objs: string[] = [];
  const add = (s: string) => { objs.push(s); return objs.length; };
  const catalog = add(""), pagesObj = add("");
  const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const f2b = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const info = add(`<< /Title ${pdfString(title)} /Producer (Antenna Generator) >>`);
  const kids: number[] = [];
  for (const p of pages) {
    const s = pageStream(p);
    const c = add(`<< /Length ${s.length} >>\nstream\n${s}\nendstream`);
    kids.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${f2(p.w * PT)} ${f2(p.h * PT)}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2b} 0 R >> >> /Contents ${c} 0 R >>`));
  }
  objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R /ViewerPreferences << /PrintScaling /None >> >>`;
  objs[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;
  let out = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offs: number[] = [];
  objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  // every character is < 256 (ASCII + the binary comment), so a byte-per-char copy is exact
  const b = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 0xff;
  return b;
}

// ---------------------------------------------------------------- SVG

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function toSVG(p: Page, title: string): string {
  const o: string[] = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f2(p.w)}mm" height="${f2(p.h)}mm" viewBox="0 0 ${f2(p.w)} ${f2(p.h)}">`, `<title>${esc(title)}</title>`,
    `<rect x="0" y="0" width="${f2(p.w)}" height="${f2(p.h)}" fill="#fff"/>`];
  const col = (grey?: boolean) => (grey ? "#8c8c8c" : "#000");
  let nclip = 0;
  for (const q of p.prims) {
    switch (q.k) {
      case "clip": o.push(`<clipPath id="c${nclip}"><rect x="${f2(q.x)}" y="${f2(q.y)}" width="${f2(q.w)}" height="${f2(q.h)}"/></clipPath>`, `<g clip-path="url(#c${nclip++})">`); break;
      case "unclip": o.push("</g>"); break;
      case "line": o.push(`<line x1="${f2(q.x1)}" y1="${f2(q.y1)}" x2="${f2(q.x2)}" y2="${f2(q.y2)}" stroke="${col(q.grey)}" stroke-width="${f2(q.w)}" stroke-linecap="round"${q.dash ? ` stroke-dasharray="2 1.2"` : ""}/>`); break;
      case "rect": o.push(`<rect x="${f2(q.x)}" y="${f2(q.y)}" width="${f2(q.w)}" height="${f2(q.h)}" ${q.fill ? `fill="${col(q.grey)}"` : `fill="none" stroke="${col(q.grey)}" stroke-width="${f2(q.lw ?? 0.25)}"${q.dash ? ` stroke-dasharray="2 1.2"` : ""}`}/>`); break;
      case "poly": o.push(`<${q.closed || q.fill ? "polygon" : "polyline"} points="${q.pts.map(([x, y]) => `${f2(x)},${f2(y)}`).join(" ")}" ${q.fill ? `fill="${col(q.grey)}"` : `fill="none" stroke="${col(q.grey)}" stroke-width="${f2(q.lw ?? 0.25)}" stroke-linejoin="round"`}/>`); break;
      case "circle": o.push(`<circle cx="${f2(q.cx)}" cy="${f2(q.cy)}" r="${f2(q.r)}" ${q.fill ? `fill="${q.white ? "#fff" : col(q.grey)}"` : `fill="none" stroke="${col(q.grey)}" stroke-width="${f2(q.lw ?? 0.25)}"`}/>`); break;
      case "text": o.push(`<text x="${f2(q.x)}" y="${f2(q.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${f2(q.size)}"${q.bold ? ` font-weight="bold"` : ""}${q.anchor && q.anchor !== "start" ? ` text-anchor="${q.anchor}"` : ""} fill="${col(q.grey)}">${esc(q.s)}</text>`); break;
    }
  }
  o.push("</svg>");
  return o.join("\n") + "\n";
}
