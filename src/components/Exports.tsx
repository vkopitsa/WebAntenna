import { useState } from "react";
import type { AntennaDef, Design, Params } from "../lib/types";
import { toCSV, toFreeCAD, toJSON, toNEC } from "../lib/export";
import { toOpenEMS } from "../lib/openems";
import { get, shareHash, showHashUntilEdit } from "../store";
import { useT } from "../i18n";
import { download } from "../download";

/** Serialise the live SVG with computed colours inlined, so it renders the same outside the app. */
function svgText(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const src = svg.querySelectorAll("*"), dst = clone.querySelectorAll("*");
  src.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const d = dst[i] as SVGElement;
    for (const p of ["fill", "stroke", "stroke-width", "stroke-opacity", "fill-opacity", "font-size", "font-family", "font-weight", "paint-order", "stroke-dasharray", "stroke-linecap", "opacity"]) d.style.setProperty(p, cs.getPropertyValue(p));
  });
  // interaction-only elements (hover hit areas) stay out of the file
  clone.querySelectorAll(".ui").forEach((el) => el.remove());
  // the Radiation view clears the background on screen; files always get it
  const bg = clone.querySelector(".svg-bg") as SVGElement | null;
  if (bg) bg.style.setProperty("fill", getComputedStyle(document.documentElement).getPropertyValue("--chart-bg").trim());
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  return `<?xml version="1.0" encoding="UTF-8"?>\n${clone.outerHTML}\n`;
}

export function Exports({ def, params, design, svgRef }: { def: AntennaDef; params: Params; design: Design; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const base = `${def.id}-${Math.round(design.f / 1e3) / 1e3}MHz`;
  const share = async () => {
    const url = location.href.split("#")[0] + shareHash(get());
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); }
    catch { showHashUntilEdit(shareHash(get())); setFailed(true); setTimeout(() => setFailed(false), 4000); }   // clipboard blocked: the URL is in the address bar (set here until the next edit)
  };
  return (
    <div className="exports">
      <button disabled={!design.necSupported} title={design.necSupported ? t("4nec2, xnec2c, nec2c, EZNEC import") : t("No wire model for this antenna type")}
        onClick={() => download(`${base}.nec`, toNEC(def, params, design), "text/plain")}>NEC-2 (.nec)</button>
      {design.pcb && <button title={t("FDTD model with plots; run with Python + openEMS")} onClick={() => download(`${base}_openems.py`, toOpenEMS(def, design, base.replace(/[^A-Za-z0-9_]/g, "_")), "text/x-python")}>openEMS (.py)</button>}
      <button onClick={() => download(`${base}.FCMacro`, toFreeCAD(def, design), "text/x-python")}>FreeCAD (.FCMacro)</button>
      <button onClick={() => svgRef.current && download(`${base}.svg`, svgText(svgRef.current), "image/svg+xml")}>{t("Drawing")} (.svg)</button>
      <button onClick={() => download(`${base}.csv`, toCSV(def, design), "text/csv")}>CSV</button>
      <button onClick={() => download(`${base}.json`, toJSON(def, params, design, __APP_VERSION__), "application/json")}>JSON</button>
      <button onClick={() => window.print()}>{t("Print")}</button>
      <button onClick={share}>{copied ? t("Link copied") : failed ? t("Copy failed, the link is in the address bar") : t("Copy share link")}</button>
    </div>
  );
}
