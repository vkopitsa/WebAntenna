import type { Pattern, ZPoint } from "../lib/simulate";
import { s11 } from "../lib/simulate";
import { fmtHz } from "../lib/units";
import { useT } from "../i18n";
import type { FCursor } from "./Charts";
import { interpZ } from "../lib/simulate";

export interface ReadoutCurve { name: string; cls: string; z: ZPoint[] }

/** Values at the shared frequency cursor (hover / pinned), or at the best-match frequency when there is none. */
export function CursorReadout({ curves, z0, cursor, pattern }: { curves: ReadoutCurve[]; z0: number; cursor: FCursor; pattern: Pattern | null }) {
  const t = useT();
  const main = curves[0];
  if (!main) return null;
  let f = cursor.f, label = cursor.pinned ? t("Pinned") : t("Cursor");
  if (f == null) {
    let best = main.z[0], bs = Infinity;
    for (const p of main.z) { const w = s11(p, z0).swr; if (w < bs) { bs = w; best = p; } }
    f = best.f; label = t("Best match");
  }
  const rows = curves.map((c) => ({ c, z: interpZ(c.z, f!) })).filter((x) => x.z);
  const sgn = (x: number) => (x >= 0 ? "+" : "−");
  const gain = pattern && Number.isFinite(pattern.max.theta) && Math.abs(pattern.f - f) <= pattern.f * 0.01 ? pattern.max.dbi : null;
  return (
    <figure className={"chart-card cursor-readout" + (cursor.pinned ? " pinned" : "")} aria-live="off">
      <figcaption>
        <span className="chart-title">{label}</span>
        <span className="cursor-f">{fmtHz(f, 3)}</span>
      </figcaption>
      <table>
        <thead>
          <tr><th />{rows.length > 1 && rows.map(({ c }) => <th key={c.name}><span className={`key ${c.cls}`} />{t(c.name)}</th>)}{rows.length === 1 && <th />}</tr>
        </thead>
        <tbody>
          <tr><td>Z</td>{rows.map(({ c, z }) => <td key={c.name}><b>{z!.r.toFixed(1)} {sgn(z!.x)} j{Math.abs(z!.x).toFixed(1)} Ω</b></td>)}</tr>
          <tr><td>{t("SWR")}</td>{rows.map(({ c, z }) => { const w = s11(z!, z0).swr; return <td key={c.name}><b>{Number.isFinite(w) ? w.toFixed(2) : "∞"}</b></td>; })}</tr>
          <tr><td>{t("Return loss")}</td>{rows.map(({ c, z }) => <td key={c.name}><b>{(-s11(z!, z0).db).toFixed(1)} dB</b></td>)}</tr>
          <tr><td>|S11|</td>{rows.map(({ c, z }) => <td key={c.name}><b>{s11(z!, z0).db.toFixed(1)} dB</b></td>)}</tr>
          {gain != null && <tr><td>{t("Max gain")}</td><td colSpan={Math.max(1, rows.length)}><b>{gain.toFixed(2)} dBi</b></td></tr>}
        </tbody>
      </table>
      <div className="chart-foot">{cursor.f == null ? t("Hover a chart to read a frequency; click to pin.") : cursor.pinned ? t("Click again or press Esc to release.") : t("Click to pin the cursor.")}</div>
    </figure>
  );
}
