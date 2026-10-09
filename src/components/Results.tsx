import type { Design } from "../lib/types";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { fmtHz } from "../lib/units";

export function Results({ design }: { design: Design }) {
  const t = useT();
  const unit = useStore((s) => s.unit);
  return (
    <div className="results">
      <div className="box">
        <h3>{t("Dimensions")}</h3>
        <table className="data">
          <tbody>
            {design.dims.map((d, i) => (
              <tr key={i}>
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
                  <tr key={j}>{r.map((c, k) => {
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
