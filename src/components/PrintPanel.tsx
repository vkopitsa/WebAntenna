import { useMemo, useState } from "react";
import type { AntennaDef, Design, Params } from "../lib/types";
import { partsFor, partsReadme, USE_LABELS, type BuiltPart } from "../lib/print";
import { zip } from "../lib/zip";
import { usePrintParts } from "../usePrintParts";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { fmtMsg } from "../msg";
import { download } from "../download";
import { MeshView } from "./MeshView";

/** "3D-printed parts" box in the Build tab: STL per part, all parts as a zip, and a preview. */
export function PrintPanel({ def, params, design, base }: { def: AntennaDef; params: Params; design: Design; base: string }) {
  const t = useT();
  const unit = useStore((s) => s.unit);
  const specs = useMemo(() => partsFor(def.id, params, design), [def.id, params, design]);
  const st = usePrintParts(def.id, params, design, specs.length > 0);
  const [sel0, setSel] = useState(0);
  const sel = Math.max(0, Math.min(sel0, specs.length - 1));   // the list can shrink when a parameter changes
  const current = st.status === "done";   // parts match the current parameters
  const built = (id: string): BuiltPart | undefined => st.parts?.find((p) => p.id === id);
  const files = (id: string) => { const b = built(id); return b?.ok ? b.segments.map((g, k) => ({ name: `${base}-${id}${b.segments.length > 1 ? `-${k + 1}` : ""}.stl`, data: g.stl })) : []; };
  const save = (fs: { name: string; data: Uint8Array }[], zipName: string) => fs.length === 1 ? download(fs[0].name, fs[0].data, "model/stl") : download(zipName, zip(fs), "application/zip");
  const saveAll = () => download(`${base}-parts.zip`, zip([{ name: "README.txt", data: partsReadme(def.name, specs) }, ...specs.flatMap((s) => files(s.id))]), "application/zip");
  const preview = built(specs[sel]?.id ?? "");

  return (
    <div className="box">
      <h3>{t("3D-printed parts")}</h3>
      {specs.length === 0 ? <p className="hint">{t("No printed parts for this antenna yet.")}</p> : (
        <>
          <div className="exports">
            <button className="primary" disabled={st.status !== "done"} onClick={saveAll}>{t("All parts (.zip)")}</button>
            {st.status === "running" && <span className="hint">{t("Building parts…")}</span>}
            {st.status === "error" && <span className="hint err-text">{t("Could not load the 3D geometry engine: {0}", st.error)}</span>}
          </div>
          <div className="scroll-x">
            <table className="data print-parts">
              <thead><tr><th>{t("Part")}</th><th>{t("Use")}</th><th className="num">{t("Quantity")}</th><th>{t("Size")}</th><th>{t("What it does")}</th><th /></tr></thead>
              <tbody>
                {specs.map((s, i) => {
                  const b = built(s.id);
                  const size = b?.ok ? b.segments[0].size.map((x) => fmtLen(x / 1000, unit)).join(" × ") : b ? fmtMsg(t, unit, b.error) : "…";
                  return (
                    <tr key={s.id} className={i === sel ? "on" : undefined} tabIndex={0} aria-selected={i === sel} onClick={() => setSel(i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSel(i); } }}>
                      <td>{t(s.title)}</td><td>{t(USE_LABELS[s.use])}</td><td className="num">{s.qty}</td>
                      <td>{size}</td><td>{fmtMsg(t, unit, s.purpose)}{s.warn && <div className="err-text">{fmtMsg(t, unit, s.warn)}</div>}</td>
                      <td><button className="small" disabled={!current || !b?.ok} onClick={() => save(files(s.id), `${base}-${s.id}.zip`)}>STL</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="print-detail">
            {preview?.ok && <MeshView tris={preview.segments[0].tris} />}
            {specs[sel] && (
              <div>
                <h4>{t("How to use: {0}", t(specs[sel].title))}</h4>
                <ol className="notes">{specs[sel].howTo.map((h, i) => <li key={i}>{fmtMsg(t, unit, h)}</li>)}</ol>
              </div>
            )}
          </div>
          <p className="hint">{t("Click a part to see it and how to use it. STL in millimetres. PETG or ASA for parts that stay outdoors; PLA is fine for jigs. Slice with your printer's usual settings; the zip has every part and a README with the instructions.")}</p>
        </>
      )}
    </div>
  );
}
