import { useEffect, useRef, useState } from "react";
import type { Candidate } from "../lib/synth";
import { phaseText, useFdtd } from "../useFdtd";
import { ANTENNA_BY_ID, WIDEST } from "../lib/antennas";
import { parseBands, spanRatio } from "../lib/bands";
import type { Goal, SynthOptions } from "../lib/synth";
import { fmtHz } from "../lib/units";
import { wavelength } from "../lib/rf";
import { useT } from "../i18n";
import { clampParams, set, useStore } from "../store";
import { fmtMsg } from "../msg";
import type { Msg } from "../lib/build";
import { fmtLen, fromUnit, toUnit } from "../format";
import { useSynthesis } from "../useSynthesis";
import { Num, Select } from "./inputs";

/** Search all antenna types for the best one on the current bands (MoM / analytic engines in a worker). */
export function SynthPanel() {
  const t = useT();
  const unit = useStore((s) => s.unit);
  const bandsStr = useStore((s) => String(s.params[s.type].bands ?? ""));
  const bands = parseBands(bandsStr);
  const [goal, setGoal] = useState<Goal>("balanced");
  const [family, setFamily] = useState<SynthOptions["family"]>("any");
  const [pol, setPol] = useState<SynthOptions["pol"]>("any");
  const [pattern, setPattern] = useState<SynthOptions["pattern"]>("any");
  const [d, setD] = useState(2e-3);
  const [er, setEr] = useState(4.4);
  const [h, setH] = useState(1.6e-3);
  const { state, run, cancel } = useSynthesis();
  const [useFd, setUseFd] = useState(true);
  const fdtd = useFdtd();
  const [rows, setRows] = useState<Candidate[] | null>(null);
  const [fdNote, setFdNote] = useState("");
  // FDTD notes per candidate, kept as messages so they follow the language and unit
  const [fdMsgs, setFdMsgs] = useState<Record<string, Msg>>({});
  const fdStopped = useRef(false);
  // bumped by every new FDTD loop and by a band change: a superseded loop exits without touching state
  const runId = useRef(0);
  // The panel stays mounted while the sidebar is edited: results for other bands would be wrong (and their SWR
  // columns wouldn't match the header), so a band change stops the run and clears them.
  useEffect(() => { runId.current++; cancel(); fdtd.cancel(); setRows(null); setFdNote(""); setFdMsgs({}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [bandsStr]);
  // After the wire/analytic search: tune every printed (formula) candidate with FDTD and score it.
  useEffect(() => {
    if (state.status !== "done" || !state.result) return;
    setRows(state.result);
    if (!useFd) return;
    let alive = true;
    const myRun = ++runId.current;
    const live = () => alive && runId.current === myRun;
    fdStopped.current = false;
    (async () => {
      let list = state.result!;
      for (const c of state.result!.filter((x) => !Number.isFinite(x.score))) {
        if (!live() || fdStopped.current) break;
        setFdNote(`${t("FDTD tuning")}: ${t(ANTENNA_BY_ID[c.id].name)}`);
        try {
          const out = await fdtd.start("tune", c.id, c.params, undefined, "auto");
          if (!live()) return;
          const z0 = c.feedZ0 || 50;
          const swr = bands.map(([a, b]) => {
            const pts = out.result.z.filter((p) => p.f >= a && p.f <= b);
            const s1 = (pts.length ? pts : [out.result.z.reduce((x, y) => (Math.abs(y.f - (a + b) / 2) < Math.abs(x.f - (a + b) / 2) ? y : x))]).map((p) => { const g = Math.hypot(p.r - z0, p.x) / Math.hypot(p.r + z0, p.x); return g >= 1 ? 99 : (1 + g) / (1 - g); });
            return Math.max(...s1);
          });
          const ml = Math.max(...swr.map((x) => { const g = (x - 1) / (x + 1); return -10 * Math.log10(Math.max(1 - g * g, 1e-6)); }));
          const gain = out.result.pattern?.max.dbi ?? NaN;
          const score = goal === "match" ? 10 * ml : goal === "gain" ? 4 * ml - gain : goal === "small" ? 4 * ml + 3 * c.size : 6 * ml - 0.4 * gain;
          const upd: Candidate = { ...c, params: out.params, swr, gain, score, note: undefined };
          setFdMsgs((m) => ({ ...m, [c.id]: out.converged
            ? { s: "FDTD ({0}) tuned, trim {1} %", a: [out.engine === "gpu" ? "WebGPU" : "CPU", Number(out.params.trim ?? 0).toFixed(1)] }
            : { s: "FDTD ({0}) tuned, trim {1} %, did not converge: approximate", a: [out.engine === "gpu" ? "WebGPU" : "CPU", Number(out.params.trim ?? 0).toFixed(1)] } }));
          list = list.map((x) => (x.id === c.id ? upd : x));
          const scored = list.filter((x) => Number.isFinite(x.score)).sort((a, b) => a.score - b.score);
          list = [...scored, ...list.filter((x) => !Number.isFinite(x.score))];
          setRows(list);
        } catch (e) {
          // one candidate the FDTD can't run (e.g. a grid too large for a very wide band) must not stop the others
          // a cancellation (band change, unmount, Stop button) is not a failure of this candidate
          if (!live()) return;
          if (fdStopped.current) break;
          setFdMsgs((m) => ({ ...m, [c.id]: { s: "FDTD (not run): {0}", a: [e instanceof Error ? e.message : String(e)] } }));
          list = list.map((x) => (x.id === c.id ? { ...x, note: undefined } : x));
          setRows(list);
        }
      }
      if (live()) setFdNote("");
    })();
    return () => { alive = false; fdtd.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.result]);
  const lamLow = wavelength(Math.min(...bands.map((b) => b[0])));
  const go = () => run({ bands, goal, family, pol, pattern, d, er, h });
  const apply = (id: string, params: Record<string, number | string>) => {
    set((s) => ({ type: id, params: { ...s.params, [id]: { ...s.params[id], ...clampParams(id, params) } }, tab: "design" }));
  };
  return (
    <div className="sim synth">
      <div className="box">
        <h3>{t("Synthesize the best antenna")}</h3>
        <p className="hint">{t("Every antenna type that passes the filters is optimised for the bands below with the built-in solvers, then ranked. Single-band types are scored on every band, so multi-band requests favour antennas that really cover them.")}</p>
        <div className="kv">
          <span>{t("Frequency bands")}</span>
          <span>{bands.map((b, i) => <span key={i} className="chip">{fmtHz(b[0], 3)} – {fmtHz(b[1], 3)}</span>)} <span className="hint">{t("(edit them in the sidebar)")}</span></span>
        </div>
        {spanRatio(bands) > WIDEST.maxRatio! * 1.001 && (() => {
          const lo = Math.min(...bands.map((b) => b[0]));
          return <p className="hint warn-text">{t("No antenna type here covers {0}:1 in one piece. The widest, “{1}”, covers {2}–{3}. Split the range between two or more antennas (one set of bands each) and synthesize each part.", +spanRatio(bands).toPrecision(3), t(WIDEST.name), fmtHz(lo, 3), fmtHz(lo * WIDEST.maxRatio!, 3))}</p>;
        })()}
        <div className="synth-grid">
          <label>{t("Goal")}<Select value={goal} onChange={setGoal} options={[["balanced", "Balanced (match, gain, size)"], ["match", "Best match over the bands"], ["gain", "Maximum gain"], ["small", "Smallest antenna"]]} /></label>
          <label>{t("Family")}<Select value={family} onChange={setFamily} options={[["any", "Any"], ["wire", "Wire / rod"], ["printed", "Printed (PCB)"]]} /></label>
          <label>{t("Polarisation")}<Select value={pol} onChange={setPol} options={[["any", "Any"], ["vertical", "Vertical"], ["horizontal", "Horizontal"], ["circular", "Circular"]]} /></label>
          <label>{t("Pattern")}<Select value={pattern} onChange={setPattern} options={[["any", "Any"], ["omni", "Omnidirectional"], ["beam", "Directional (beam)"]]} /></label>
          <label>{t("Element diameter")} ({unit === "in" ? "in" : "mm"})<Num value={+toUnit(d, unit).toPrecision(6)} min={+toUnit(0.05e-3, unit).toPrecision(6)} max={+toUnit(0.2, unit).toPrecision(6)} onChange={(v) => setD(fromUnit(v, unit))} /></label>
          <label>{t("Substrate εr")}<Num value={er} min={1} max={15} onChange={setEr} /></label>
          <label className="check"><input type="checkbox" checked={useFd} onChange={(e) => setUseFd(e.target.checked)} /> {t("Simulate printed candidates with FDTD (WebGPU)")}</label>
          <label>{t("Substrate thickness")} ({unit === "in" ? "in" : "mm"})<Num value={+toUnit(h, unit).toPrecision(6)} min={+toUnit(0.05e-3, unit).toPrecision(6)} max={+toUnit(0.02, unit).toPrecision(6)} onChange={(v) => setH(fromUnit(v, unit))} /></label>
        </div>
        <div className="row-btns">
          {state.status === "running"
            ? <><button className="danger" onClick={cancel}>{t("Stop")}</button>
                <span className="progress"><span style={{ width: `${Math.round(state.progress * 100)}%` }} /></span>
                <span className="muted small">{Math.round(state.progress * 100)} % · {t(state.current)}</span></>
            : <button className="primary" onClick={go} disabled={!bands.length}>{t("Synthesize")}</button>}
        </div>
        {state.error && <p className="err-text">{state.error}</p>}
        {fdNote && <p className="muted small">{fdtd.st.status === "running" ? "⏳ " : ""}{fdNote}{fdtd.st.status === "running" ? ` · ${phaseText(t, fdtd.st.phase, fdtd.st.pass)}${fdtd.st.engine ? ` (${fdtd.st.engine === "gpu" ? "WebGPU" : "CPU"})` : ""} · ${t("step {0}", fdtd.st.step)}` : ""}
          {fdtd.st.status === "running" && <> <button className="small danger" onClick={() => { fdStopped.current = true; fdtd.cancel(); }}>{t("Stop")}</button></>}</p>}
      </div>
      {rows && (
        <div className="box">
          <h3>{t("Results")}</h3>
          {rows.length === 0 && <p className="hint">{t("No antenna type passes these filters for these bands.")}</p>}
          <div className="scroll-x">
            <table className="data synth-table">
              <thead><tr>
                <th>#</th><th>{t("Antenna")}</th>
                {bands.map((_, i) => <th key={i} className="num">{t("Worst SWR, band {0}", i + 1)}</th>)}
                <th className="num">{t("Gain (worst band)")}</th><th className="num">{t("Size")}</th><th />
              </tr></thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.id} className={i === 0 && Number.isFinite(c.score) ? "best" : ""}>
                    <td>{Number.isFinite(c.score) ? i + 1 : "—"}</td>
                    <td>
                      <b>{t(ANTENNA_BY_ID[c.id].name)}</b>
                      {ANTENNA_BY_ID[c.id].id === "yagi" && <span className="muted small"> · {c.params.n} el.</span>}
                      {ANTENNA_BY_ID[c.id].id === "helix" && <span className="muted small"> · {c.params.turns} {t("turns")}</span>}
                      {c.feedZ0 !== 50 && <span className="muted small"> · Z0 {Math.round(c.feedZ0)} Ω</span>}
                      {fdMsgs[c.id] ? <div className="hint">{fmtMsg(t, unit, fdMsgs[c.id])}</div> : c.note && <div className="hint">{t(c.note)}</div>}
                    </td>
                    {bands.map((_, j) => <td key={j} className={"num " + (c.swr[j] == null ? "" : c.swr[j] < 2 ? "ok-text" : c.swr[j] > 3 ? "err-text" : "")}>{c.swr[j] == null ? "—" : c.swr[j] >= 20 ? "> 20" : c.swr[j].toFixed(2)}</td>)}
                    <td className="num">{Number.isFinite(c.gain) ? `${c.gain.toFixed(1)} dBi` : "—"}</td>
                    <td className="num">{c.size ? `${c.size.toFixed(2)} λ · ${fmtLen(c.size * lamLow, unit)}` : "—"}</td>
                    <td><button className="small primary" onClick={() => apply(c.id, c.params)}>{t("Apply")}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="hint">{t("SWR is against each antenna's natural feed impedance (Z0 shown when it is not 50 Ω: use the matching balun or transformer). Gain is the peak gain on the worst band. Size is the largest dimension at the lowest band.")}</p>
        </div>
      )}
    </div>
  );
}
