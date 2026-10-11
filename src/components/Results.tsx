import { useEffect } from "react";
import type { Design } from "../lib/types";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { fmtHz } from "../lib/units";
import { setHover, useHover, type Hover } from "../hover";

export function Results({ design }: { design: Design }) {
  const t = useT();
  const unit = useStore((s) => s.unit);
  const hover = useHover();
  // a rebuilt design (new params or type) drops the highlight: rows can vanish under the pointer without a leave event
  useEffect(() => () => setHover(null), [design]);
  const drawn = new Set(design.wires.filter((w) => w.tag && !w.necOnly).map((w) => w.tag!));
  const dimHover = (d: Design["dims"][number]): Hover | null => {
    const tags = (d.tags ?? (d.key ? [d.key] : [])).filter((x) => drawn.has(x));
    return tags.length || d.at ? { tags, span: d.at ? { at: d.at, value: d.value } : undefined } : null;
  };
  // a table row is linked when its first cell names a wire tag (Yagi "Elements": R, DE, D1, …)
  const rowTag = (r: Design["tables"][number]["rows"][number]) => (typeof r[0] === "string" && drawn.has(r[0]) ? r[0] : null);
  const fromWire = hover?.fromDrawing ? new Set(hover.tags) : null;
  const rowProps = (h: Hover | null, mine: boolean) => h
    ? { className: "linked" + (mine ? " hl" : ""), onPointerEnter: () => setHover(h), onPointerLeave: () => setHover(null) }
    : {};
  return (
    <div className="results">
      <div className="box">
        <h3>{t("Dimensions")}</h3>
        <table className="data">
          <tbody>
            {design.dims.map((d, i) => (
              <tr key={i} {...rowProps(dimHover(d), !!fromWire && !!d.key && fromWire.has(d.key))}>
                <td className="key">{d.key ?? ""}</td>
                <td>{t(d.label)}</td>
                <td className="num">{fmtLen(d.value, unit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {design.tables.map((tb, i) => (
        <div className="box wide" key={i}>
          <h3>{t(tb.title)}</h3>
          <div className="scroll-x">
            <table className="data">
              <thead><tr>{tb.columns.map((c, j) => <th key={j} className={c.kind === "text" ? "" : "num"}>{t(c.label)}</th>)}</tr></thead>
              <tbody>
                {tb.rows.map((r, j) => (
                  <tr key={j} {...rowProps(rowTag(r) ? { tags: [rowTag(r)!] } : null, !!fromWire && fromWire.has(rowTag(r) ?? ""))}>{r.map((c, k) => {
                    const col = tb.columns[k];
                    const txt = typeof c !== "number" ? t(c) : col.kind === "len" ? fmtLen(c, unit) : col.kind === "freq" ? fmtHz(c, 3) : String(c);
                    return <td key={k} className={col.kind === "text" ? "" : "num"}>{txt}</td>;
                  })}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
      <div className="box">
        <h3>{t("Expected performance")}</h3>
        <div className="kv">
          {design.perf.map((p, i) => [<span key={`l${i}`}>{t(p.label)}</span>, <span key={`v${i}`}>{t(p.value)}</span>])}
        </div>
      </div>
      <div className="box">
        <h3>{t("Build notes")}</h3>
        <ul className="notes">{design.notes.map((n, i) => <li key={i}>{t(n)}</li>)}</ul>
      </div>
    </div>
  );
}
