import { useState, type ReactNode } from "react";
import { fmtHz, parseHz } from "../lib/units";
import { useT } from "../i18n";

/** Frequency field accepting "435M", "2.45G", "500k", plain Hz. Commits on Enter/blur. */
export function FreqInput({ value, onChange, min, max, id, ariaLabel }: { value: number; onChange: (v: number) => void; min?: number; max?: number; id?: string; ariaLabel?: string }) {
  const t = useT();
  // Draft text while editing; null shows the committed value (so external changes always win).
  const [draft, setDraft] = useState<string | null>(null);
  const [bad, setBad] = useState(false);
  const commit = () => {
    if (draft == null) return;
    const v = parseHz(draft);
    if (v == null || (min != null && v < min) || (max != null && v > max)) { setBad(true); return; }
    setBad(false);
    setDraft(null);
    if (v !== value) onChange(v);
  };
  return <input id={id} type="text" inputMode="decimal" aria-label={ariaLabel && t(ariaLabel)} className={bad ? "bad" : ""} value={draft ?? fmtHz(value).replace(/(\.\d*?)0+ /, "$1 ").replace(". ", " ")}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

/** Plain number, clamped. Commits on Enter/blur so typing intermediate values doesn't fight the user. */
export function Num({ value, onChange, min, max, step, id, digits = 6 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; id?: string; digits?: number }) {
  const show = (v: number) => String(+v.toPrecision(digits));
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft == null) return;
    let v = parseFloat(draft.replace(",", "."));
    setDraft(null);
    if (!Number.isFinite(v)) return;
    if (min != null) v = Math.max(min, v);
    if (max != null) v = Math.min(max, v);
    if (v !== value) onChange(v);
  };
  return <input id={id} type="number" value={draft ?? show(value)} min={min} max={max} step={step ?? "any"}
    onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />;
}

export function Select<T extends string>({ value, options, onChange, id, ariaLabel, className }: { value: T; options: [T, string][]; onChange: (v: T) => void; id?: string; ariaLabel?: string; className?: string }) {
  const t = useT();
  return (
    <select id={id} className={className} aria-label={ariaLabel && t(ariaLabel)} value={value} onChange={(e) => onChange(e.target.value as T)}>
      {options.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}
    </select>
  );
}

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  const t = useT();
  return (
    <section className="section">
      <h3>{t(title)}{right}</h3>
      {children}
    </section>
  );
}
