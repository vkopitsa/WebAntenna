import { useEffect, useMemo } from "react";
import type { Design } from "../lib/types";
import { useStore } from "../store";
import { useT } from "../i18n";
import { fmtLen } from "../format";
import { fmtHz } from "../lib/units";
import { getPin, setHover, setPin, togglePin, useEffectiveHover, usePin, type Hover } from "../hover";

type Row = Design["tables"][number]["rows"][number];
const dimKey = (d: Design["dims"][number]) => `d:${d.key ?? ""}:${d.label}`;
const rowKey = (title: string, r: Row) => `r:${title}:${r[0]}`;

/** Every linked row of the design (Dimensions rows and tag-named table rows) by key, with what it lights up. */
function linkMap(design: Design): Map<string, Hover> {
  const drawn = new Set(design.wires.filter((w) => w.tag && !w.necOnly).map((w) => w.tag!));
  const m = new Map<string, Hover>();
  for (const d of design.dims) {
    const tags = (d.tags ?? (d.key ? [d.key] : [])).filter((x) => drawn.has(x));
    if (tags.length || d.at) m.set(dimKey(d), { tags, span: d.at ? { at: d.at, value: d.value } : undefined });
  }
  // a table row is linked when its first cell names a wire tag (Yagi "Elements": R, DE, D1, …)
  for (const tb of design.tables) for (const r of tb.rows) if (typeof r[0] === "string" && drawn.has(r[0])) m.set(rowKey(tb.title, r), { tags: [r[0]] });
  for (const tg of drawn) m.set(`w:${tg}`, { tags: [tg], fromDrawing: true });
  return m;
}

export function Results({ design }: { design: Design }) {
  const t = useT();
  const unit = useStore((s) => s.unit);
  const type = useStore((s) => s.type);
  const hover = useEffectiveHover();
  const pin = usePin();
  const links = useMemo(() => linkMap(design), [design]);
  // a rebuilt design (new params or type) drops the hover: rows can vanish under the pointer without a leave event.
  // A pin survives a parameter edit while its row (matched by key) still exists, and is dropped on a type change.
  useEffect(() => {
    setHover(null);
    const p = getPin();
    if (!p) return;
    const h = p.type === type ? links.get(p.key) : undefined;
    setPin(h ? { ...p, hover: h } : null);
  }, [links, type]);
  const fromWire = hover?.fromDrawing ? new Set(hover.tags) : null;
  const rowProps = (key: string, mine: boolean) => {
    const h = links.get(key);
    if (!h) return {};
    const on = pin?.key === key;
    return {
      className: "linked" + (mine ? " hl" : "") + (on ? " pinned" : ""), tabIndex: 0, "aria-selected": on,
      onPointerEnter: () => setHover(h), onPointerLeave: () => setHover(null), onClick: () => togglePin(key, h),
      onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePin(key, h); } },
    };
  };
  return (
    <div className="results">
      <div className="box">
        <h3>{t("Dimensions")}</h3>
        <table className="data">
          <tbody>
            {design.dims.map((d, i) => (
              <tr key={i} {...rowProps(dimKey(d), !!fromWire && !!d.key && fromWire.has(d.key))}>
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
                  <tr key={j} {...rowProps(rowKey(tb.title, r), !!fromWire && typeof r[0] === "string" && fromWire.has(r[0]))}>{r.map((c, k) => {
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
