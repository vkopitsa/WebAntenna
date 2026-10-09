import { ANTENNA_BY_ID, ANTENNAS } from "../lib/antennas";
import type { ParamDef } from "../lib/types";
import { resetParams, set, setParam, useStore } from "../store";
import { useT } from "../i18n";
import { fromUnit, toUnit } from "../format";
import { FreqInput, Num, Section, Select } from "./inputs";
import { BAND_PRESETS, formatBands, parseBands, type Band } from "../lib/bands";
import { fmtHz } from "../lib/units";

/** List of [start, stop] ranges with presets. Stored as the "bands" string param. */
function BandsInput({ def, value }: { def: ParamDef; value: string }) {
  const t = useT();
  const bands = parseBands(value);
  const type = useStore((s) => s.type);
  const multi = !!ANTENNA_BY_ID[type].multiband;
  const commit = (b: Band[]) => setParam(def.key, formatBands(b.length ? b : [[145e6, 145e6]]));
  const update = (i: number, j: 0 | 1, v: number) => {
    const next = bands.map((b) => [...b] as Band);
    next[i][j] = v;
    if (next[i][0] > next[i][1]) next[i] = j === 0 ? [v, v] : [next[i][0], next[i][0]];
    commit(next);
  };
  return (
    <div className="bands">
      {bands.map((b, i) => (
        <div className="band" key={i}>
          <div className="band-row">
            <span className="band-no">{i + 1}</span>
            <FreqInput value={b[0]} min={def.min} max={def.max} onChange={(v) => update(i, 0, v)} id={i === 0 ? `p-${def.key}` : undefined} ariaLabel="Start" />
            <span className="dash">–</span>
            <FreqInput value={b[1]} min={def.min} max={def.max} onChange={(v) => update(i, 1, v)} ariaLabel="Stop" />
            <button className="small" disabled={bands.length < 2} aria-label={t("Remove band")} title={t("Remove band")} onClick={() => commit(bands.filter((_, k) => k !== i))}>✕</button>
          </div>
          <select className="band-preset" aria-label={t("Band preset")} value={BAND_PRESETS.find(([, r]) => r[0] === b[0] && r[1] === b[1])?.[0] ?? ""}
            onChange={(e) => { const hit = BAND_PRESETS.find(([n]) => n === e.target.value); if (hit) commit(bands.map((x, k) => (k === i ? hit[1] : x))); }}>
            <option value="">{t("Band preset…")}</option>
            {BAND_PRESETS.map(([n, [a, c]]) => <option key={n} value={n}>{t(n)} · {fmtHz(a, 3)} – {fmtHz(c, 3)}</option>)}
          </select>
        </div>
      ))}
      <div className="band-actions">
        <button className="small add-band" onClick={() => commit([...bands, bands[bands.length - 1]])}>{t("+ Add band")}</button>
        <button className="small primary" onClick={() => set({ tab: "synth" })} title={t("Find the best antenna type and dimensions for these bands")}>⚡ {t("Synthesize")}</button>
      </div>
      <div className="hint">{multi ? t("Every band is used in the design.") : t("Band 1 sets the dimensions; extra bands are swept in the NEC export.")}</div>
    </div>
  );
}

const CATEGORIES = ["Wire", "Vertical", "Directional", "Circular polarisation", "Printed", "Broadband"] as const;

export function AntennaPicker({ onPick }: { onPick?: () => void }) {
  const t = useT();
  const type = useStore((s) => s.type);
  return (
    <Section title="Antenna type">
      <div className="picker">
        {CATEGORIES.map((c) => {
          const list = ANTENNAS.filter((a) => a.category === c);
          if (!list.length) return null;
          return (
            <div key={c} className="cat">
              <div className="cat-title">{t(c)}</div>
              {list.map((a) => (
                <button key={a.id} className={"pick" + (a.id === type ? " on" : "")} aria-pressed={a.id === type}
                  onClick={() => { set({ type: a.id }); onPick?.(); }}>
                  <span className="pick-name">{t(a.name)}</span>
                  <span className="pick-sum">{t(a.summary)}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </Section>
  );
}

function ParamField({ def }: { def: ParamDef }) {
  const t = useT();
  const unit = useStore((s) => s.unit);
  const value = useStore((s) => s.params[s.type][def.key]);
  const id = `p-${def.key}`;
  const n = typeof value === "number" ? value : parseFloat(String(value));
  let input;
  switch (def.kind) {
    case "bands":
      input = <BandsInput def={def} value={String(value ?? "")} />;
      break;
    case "freq":
      input = <FreqInput id={id} value={n} min={def.min} max={def.max} onChange={(v) => setParam(def.key, v)} />;
      break;
    case "length":
      input = (
        <span className="with-unit">
          <Num id={id} value={+toUnit(n, unit).toPrecision(6)} min={def.min != null ? toUnit(def.min, unit) : undefined}
            max={def.max != null ? toUnit(def.max, unit) : undefined} onChange={(v) => setParam(def.key, fromUnit(v, unit))} />
          <span className="unit">{unit === "in" ? "in" : "mm"}</span>
        </span>
      );
      break;
    case "angle":
      input = <span className="with-unit"><Num id={id} value={n} min={def.min} max={def.max} step={def.step} onChange={(v) => setParam(def.key, v)} /><span className="unit">°</span></span>;
      break;
    case "int":
      input = <Num id={id} value={n} min={def.min} max={def.max} step={1} onChange={(v) => setParam(def.key, Math.round(v))} />;
      break;
    case "select":
      input = <Select id={id} value={String(value)} options={def.options ?? []} onChange={(v) => setParam(def.key, v)} />;
      break;
    default:
      input = <Num id={id} value={n} min={def.min} max={def.max} step={def.step} onChange={(v) => setParam(def.key, v)} />;
  }
  return (
    <div className="field">
      <label htmlFor={id}>{t(def.label)}</label>
      {input}
      {def.hint && <div className="hint">{t(def.hint)}</div>}
    </div>
  );
}

export function ParamsPanel() {
  const t = useT();
  const type = useStore((s) => s.type);
  const def = ANTENNA_BY_ID[type];
  return (
    <Section title="Parameters" right={<button className="small" onClick={resetParams}>{t("Reset")}</button>}>
      <p className="hint lead">{t(def.summary)}</p>
      {def.params.map((p) => <ParamField key={`${type}-${p.key}`} def={p} />)}
    </Section>
  );
}
