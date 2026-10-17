import { useEffect, useMemo, useRef, useState } from "react";
import type { AntennaDef, Design, Params } from "../lib/types";
import { interpZ, patternChoices, s11, sweepBreaks, toS1P, type SimResult, type ZPoint } from "../lib/simulate";
import { parseBands } from "../lib/bands";
import { parseOpenEMS, parseTouchstone, type Imported } from "../lib/importers";
import { fmtHz } from "../lib/units";
import { useT } from "../i18n";
import { useSimulation } from "../useSimulation";
import { CursorReadout } from "./CursorReadout";
import { FreqChart, Pattern3D, PolarChart, SmithChart, type FCursor, type Series } from "./Charts";
import { Select } from "./inputs";
import { download } from "../download";
import { phaseText, useFdtd } from "../useFdtd";
import type { Engine } from "../fdtdJob";
import { clampParams, set, useStore } from "../store";
import { advise, bestMatch, tuning } from "../lib/build";
import { fmtLen } from "../format";
import { fmtMsg } from "../msg";

const Z0S: [string, string][] = [["50", "50 Ω"], ["75", "75 Ω"], ["140", "140 Ω (helix)"], ["200", "200 Ω (folded dipole + 4:1)"], ["300", "300 Ω"]];

function bandSummary(z: ZPoint[], z0: number, bands: [number, number][]) {
  return bands.map(([a, b]) => {
    // a NaN point (solver blow-up, odd .s1p) would make indexOf(min) −1
    const ok = z.filter((p) => Number.isFinite(p.r) && Number.isFinite(p.x));
    // the band edges and centre, interpolated: a narrow band holds only a couple of sweep points, and the edges are
    // usually the worst SWR
    const extra = [a, (a + b) / 2, b].map((f) => interpZ(ok, f)).filter((p): p is ZPoint => p != null);
    const pts = [...ok.filter((p) => p.f >= a && p.f <= b), ...extra].sort((p, q) => p.f - q.f);
    if (!pts.length) return { a, b, none: true as const };
    const sw = pts.map((p) => s11(p, z0).swr);
    const best = sw.indexOf(Math.min(...sw));
    // the model stops inside the band (a fixed-shape table): say how far the numbers go
    const top = z[z.length - 1].f, upTo = top < b - (b - a) * 0.01 ? top : null;
    return { a, b, none: false as const, minSwr: sw[best], fBest: pts[best].f, maxSwr: Math.max(...sw), zMid: interpZ(ok, (a + b) / 2) ?? pts[Math.floor(pts.length / 2)], upTo };
  });
}

export function SimPanel({ def, params, design, active = true }: { def: AntennaDef; params: Params; design: Design; active?: boolean }) {
  const t = useT();
  const choices = useMemo(() => patternChoices(params, design), [params, design]);
  const [pf, setPf] = useState<number | null>(null);
  const patternF = pf != null && choices.some((c) => Math.abs(c - pf) < 1) ? pf : choices[0];
  const [z0s, setZ0] = useState<string | null>(null);
  const z0 = Number(z0s ?? String(Math.round(design.feedZ0 ?? 50)));
  const sim = useSimulation(def.id, params, patternF, active);
  const fdtd = useFdtd();
  const [engine, setEngine] = useState<Engine>("auto");
  const fdKey = JSON.stringify([def.id, params]);
  const fdOut = fdtd.st.out && fdtd.st.key === fdKey ? fdtd.st.out : null;
  // an edit while FDTD runs: its result would be for the old design (and "Tune" would write the old params back)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (fdtd.st.status === "running" && fdtd.st.key !== fdKey) fdtd.cancel(); }, [fdKey]);
  const runFd = (job: "run" | "tune") => {
    fdtd.start(job, def.id, params, patternF, engine).then((out) => {
      if (job === "tune") set((s) => ({ params: { ...s.params, [def.id]: { ...s.params[def.id], ...out.params } } }));
    }).catch(() => {});
  };
  // a stale result of the previous design stays on screen while the new one runs: don't export it
  const simReady = fdOut != null || sim.status === "done";
  const bands = parseBands(String(params.bands ?? ""));
  const [bandSel, setBandSel] = useState(0);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [imp, setImp] = useState<Imported | null>(null);
  const [impErr, setImpErr] = useState<string | null>(null);
  const r: SimResult | null = fdOut ? fdOut.result : sim.result;
  const bandIdx = Math.min(bandSel, bands.length);
  const own = r && r.z.length ? r.z : [];
  const primaryZ = own.length ? own : imp?.z ?? [];
  const pat = r?.pattern ?? imp?.pattern ?? null;
  const patOverlay = r?.pattern && imp?.pattern ? imp.pattern : null;

  const win = bandIdx < bands.length && bands.length > 1 ? (() => { const [a, b] = bands[bandIdx]; const m = 0.03 * (a + b) / 2; return [a - m, b + m] as const; })() : null;
  const clip = (z: ZPoint[]) => (win ? z.filter((p) => p.f >= win[0] && p.f <= win[1]) : z);
  const curves = useMemo(() => {
    const out: { name: string; cls: string; z: ZPoint[]; breaks?: number[] }[] = [];
    // separate band sweeps: lift the pen between them instead of drawing a line over frequencies never computed
    if (own.length) { const z = clip(own); out.push({ name: "Simulated", cls: "s1", z, breaks: sweepBreaks(z.map((p) => p.f), design.sweeps) }); }
    if (imp) out.push({ name: imp.name, cls: own.length ? "s2" : "s1", z: clip(imp.z) });
    return out.filter((c) => c.z.length > 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [own, imp, design.sweeps, win?.[0], win?.[1]]);
  // x axis: the selected band's window, or every band (parts the model doesn't reach stay visible, empty)
  const span = win ?? (bands.length ? [Math.min(...bands.map((b) => b[0])), Math.max(...bands.map((b) => b[1]))] as const : undefined);
  const ser = (fn: (p: ZPoint) => number, raw?: (p: ZPoint) => number): Series[] => curves.map((c) => ({ name: c.name, cls: c.cls, f: c.z.map((p) => p.f), values: c.z.map(fn), raw: raw && c.z.map(raw), breaks: c.breaks }));
  const zMain = curves[0];

  const onFile = async (file: File) => {
    setImpErr(null);
    try {
      const text = await file.text();
      const name = file.name.replace(/\.[^.]+$/, "");
      setImp(/\.json$/i.test(file.name) ? parseOpenEMS(JSON.parse(text), name, design.f) : parseTouchstone(text, name));
    } catch (e) { setImpErr(String(e instanceof Error ? e.message : e)); }
  };

  const [curF, setCurF] = useState<number | null>(null);
  const [pinned, setPinned] = useState(false);
  const cursor: FCursor = {
    f: curF, pinned,
    hover: (f) => { if (!pinned) setCurF(f); },
    toggle: () => { if (pinned) setPinned(false); else if (curF != null) setPinned(true); },
  };
  useEffect(() => {
    if (!pinned) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { setPinned(false); setCurF(null); } };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [pinned]);

  const summary = primaryZ.length ? bandSummary(primaryZ, z0, bands) : [];
  const unit = useStore((s) => s.unit);
  const tune = useMemo(() => (imp ? tuning(def, params, design) : null), [imp, def, params, design]);
  const adv = useMemo(() => (imp && tune ? advise(def, params, tune.rows, imp.z, z0) : null), [imp, tune, def, params, z0]);
  const applyTrim = (v: number) => set((s) => ({ params: { ...s.params, [def.id]: { ...s.params[def.id], ...clampParams(def.id, { trim: v }) } } }));
  return (
    <div className="sim">
      <div className="sim-bar">
        {r?.method !== "openems" && !fdOut && (
          <span className={"badge " + (sim.status === "done" ? "ok" : sim.status === "error" ? "err" : "warn")}>
            {sim.status === "running" ? `${t("Simulating…")} ${Math.round(sim.progress * 100)} %` : sim.status === "error" ? t("Simulation failed") : sim.status === "done" ? t("Simulated") : t("Waiting…")}
          </span>
        )}
        {r?.unknowns != null && <span className="muted small">{t("{0} unknowns", r.unknowns)}</span>}
        <span className="spacer" />
        <label className="inline">{t("Reference Z0")}<Select value={String(z0)} options={Z0S.some(([v]) => Number(v) === z0) ? Z0S : [[String(z0), `${z0} Ω`], ...Z0S]} onChange={setZ0} ariaLabel="Reference Z0" /></label>
        {choices.length > 1 && <label className="inline">{t("Pattern at")}<Select value={String(patternF)} options={choices.map((c) => [String(c), fmtHz(c, 3)] as [string, string])} onChange={(v) => setPf(Number(v))} ariaLabel="Pattern at" /></label>}
        <button className="small" onClick={() => fileRef.current?.click()}>{t("Load results (.json / .s1p / .s2p)")}</button>
        <input ref={fileRef} type="file" accept=".json,.s1p,.S1P,.s2p,.S2P,.txt" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); e.target.value = ""; }} />
        {imp && <button className="small" onClick={() => setImp(null)}>{t("Clear {0}", imp.name)}</button>}
        {own.length > 0 && <button className="small" disabled={!simReady} onClick={() => download(`${def.id}-sim.s1p`, toS1P(def.name, own, z0), "text/plain")}>S11 (.s1p)</button>}
        {r?.pattern && <button className="small" disabled={!simReady} onClick={() => download(`${def.id}-pattern.csv`, ["cut,angle_deg,gain_dBi", ...r.pattern!.cuts.flatMap((c) => c.deg.map((a, i) => `${c.id},${a},${c.dbi[i].toFixed(3)}`))].join("\n") + "\n", "text/csv")}>{t("Pattern")} (.csv)</button>}
      </div>
      {design.pcb && (
        <div className="box fdtd-bar">
          <b>{t("FDTD (in the browser)")}</b>
          <label className="inline">{t("Engine")}<Select value={engine} onChange={setEngine} options={[["auto", "Auto (WebGPU if available)"], ["gpu", "WebGPU"], ["cpu", "CPU (slow)"]]} ariaLabel="Engine" /></label>
          {fdtd.st.status === "running" ? <>
            <button className="small danger" onClick={fdtd.cancel}>{t("Stop")}</button>
            <span className="muted small">{phaseText(t, fdtd.st.phase, fdtd.st.pass)}{fdtd.st.engine ? ` · ${fdtd.st.engine === "gpu" ? "WebGPU" : "CPU"}` : ""}{fdtd.st.cells ? ` · ${(fdtd.st.cells / 1e3).toFixed(0)} k ${t("cells")}` : ""} · {t("step {0}", fdtd.st.step)} · {t("field {0} dB", fdtd.st.decay > 0 ? (20 * Math.log10(fdtd.st.decay)).toFixed(0) : "…")}{fdtd.st.t0 ? ` · ${Math.max(0, Math.round((Date.now() - fdtd.st.t0) / 1000))} s` : ""}</span>
            {fdtd.st.fellBack && <span className="warn-text small">{t("No WebGPU in this browser: running on the CPU, this can take tens of minutes. Chrome/Edge with WebGPU is 10–50× faster.")}</span>}
          </> : <>
            <button className="small primary" onClick={() => runFd("run")}>{t("Run FDTD")}</button>
            {"trim" in params && <button className="small" onClick={() => runFd("tune")} title={t("Run, rescale the resonant length onto the band centre, run again")}>{t("Tune to band")}</button>}
          </>}
          {fdOut && <span className="muted small">{fdOut.engine === "gpu" ? "WebGPU" : "CPU"} · {(fdOut.cells / 1e3).toFixed(0)} k {t("cells")} · {fdOut.steps} {t("steps")} · {(fdOut.ms / 1000).toFixed(1)} s{fdOut.fRes ? ` · ${t("resonance")} ${fmtHz(fdOut.fRes, 3)}` : ""}</span>}
          {fdtd.st.status === "error" && <span className="err-text small">{fdtd.st.error}</span>}
        </div>
      )}
      {impErr && <div className="box err-text">{impErr}</div>}
      {sim.error && <div className="box err-text">{sim.error}</div>}
      {r?.method === "none" && !imp && <div className="box hint">{t("No simulation model for this antenna type.")}</div>}
      {(r || imp) && (
        <div className="sim-summary box">
          <div className="kv">
            {pat && Number.isFinite(pat.max.theta) && <>
              <span>{t("Max gain")}</span><span><b>{pat.max.dbi.toFixed(2)} dBi</b> · θ {pat.max.theta}°, φ {pat.max.phi}° · {fmtHz(pat.f, 3)}</span>
              <span>{t("Front-to-back")}</span><span>{(pat.max.dbi - pat.back).toFixed(1)} dB</span>
              <span>{t("Beamwidth (−3 dB)")}</span><span>{Number.isFinite(pat.hpbw) ? `${pat.hpbw.toFixed(0)}°` : "—"}</span>
            </>}
            {pat && !Number.isFinite(pat.max.theta) && <><span>{t("Directivity (openEMS)")}</span><span><b>{pat.max.dbi.toFixed(2)} dBi</b></span></>}
            {summary.map((s, i) => <span key={i} className="kv-pair">
              <span>{t("Band {0}", i + 1)} · {fmtHz(s.a, 3)}–{fmtHz(s.b, 3)}</span>
              {s.none ? <span className="muted">{t("Not computed: outside the model's range")}</span>
                : <span>{t("SWR {0}–{1} (best at {2}), Z ≈ {3}", s.minSwr.toFixed(2), Number.isFinite(s.maxSwr) ? s.maxSwr.toFixed(2) : "∞", fmtHz(s.fBest, 3), `${s.zMid.r.toFixed(0)} ${s.zMid.x >= 0 ? "+" : "−"} j${Math.abs(s.zMid.x).toFixed(0)} Ω`)}{s.upTo != null && <span className="muted"> · {t("computed up to {0}", fmtHz(s.upTo, 3))}</span>}</span>}
            </span>)}
          </div>
          {r?.notes.map((n) => <p key={n} className="hint">{t(n)}</p>)}
          {fdOut?.notes.map((n, i) => <p key={i} className={i === 0 ? "hint" : "hint warn-text"}>{fmtMsg(t, unit, n)}</p>)}
          {imp && <p className="hint">{t("Loaded: {0}", imp.name)} ({imp.source === "openems" ? "openEMS" : "Touchstone"})</p>}
        </div>
      )}
      {imp && adv && tune && (
        <div className="box">
          <h3>{t("Measured vs model")}</h3>
          {adv.rows.length > 0 ? (
            <ul className="advice">
              {adv.rows.map(({ row, fMeas, swr, change }, i) => {
                const sim = own.length ? bestMatch(own, z0, row.f * 0.8, row.f * 1.2) : null;
                return (
                  <li key={i}>
                    <b>{fmtMsg(t, unit, row.what)}{row.tag ? ` (${row.tag})` : ""}</b>: {t("best match at {0} (SWR {1}); target {2}", fmtHz(fMeas, 4), swr.toFixed(2), fmtHz(row.f, 4))}
                    {sim ? `; ${t("model {0}", fmtHz(sim.f, 4))}` : ""}. {Math.abs(change) < 0.2e-3 ? t("On target: no trimming needed.") : change > 0 ? `${t(row.how, fmtLen(change, unit))}.` : t("The part is too short (best match above the target): add about {0} at each trim point, or cut a new part.", fmtLen(-change, unit))}
                  </li>
                );
              })}
            </ul>
          ) : <p className="hint">{tune.note ? fmtMsg(t, unit, tune.note) : t("No clear match dip (SWR below 3) within ±20 % of the design frequency.")}</p>}
          {adv.trim != null && Math.abs(adv.trim - Number(params.trim ?? 0)) >= 0.2 && (
            <p className="hint"><button className="small" onClick={() => applyTrim(adv.trim!)}>{t("Rescale the design for the next build (trim {0} %)", adv.trim)}</button> {t("Scales every dimension so the next build lands on the target, based on this measurement.")}</p>
          )}
        </div>
      )}
      {curves.length > 0 && bands.length > 1 && (
        <div className="seg" role="tablist">
          {bands.map((_, i) => <button key={i} className={bandIdx === i ? "on" : ""} onClick={() => setBandSel(i)}>{t("Band {0}", i + 1)}</button>)}
          <button className={bandIdx === bands.length ? "on" : ""} onClick={() => setBandSel(bands.length)}>{t("All")}</button>
        </div>
      )}
      <div className="chart-grid">
        {zMain && <>
          <FreqChart title="Return loss S11" unit="dB" bands={bands} span={span} yMax={0} refLine={-9.54} series={ser((p) => s11(p, z0).db)} cursor={cursor} />
          <FreqChart title="Input impedance" unit="Ω" bands={bands} span={span} refLine={0} series={[
            { name: t("Re Zin"), cls: "s1", f: zMain.z.map((p) => p.f), values: zMain.z.map((p) => p.r), breaks: zMain.breaks },
            { name: t("Im Zin"), cls: "s2", f: zMain.z.map((p) => p.f), values: zMain.z.map((p) => p.x), breaks: zMain.breaks }]} cursor={cursor} />
          <FreqChart title="SWR" unit="" bands={bands} span={span} yMin={1} refLine={2} digits={2} series={ser((p) => Math.min(s11(p, z0).swr, 20), (p) => s11(p, z0).swr)} cursor={cursor} />
          <SmithChart z={zMain.z} z0={z0} bands={bands} breaks={zMain.breaks} overlay={curves[1] ? { name: curves[1].name, z: curves[1].z } : undefined} cursor={cursor} />
          <CursorReadout curves={curves} z0={z0} cursor={cursor} pattern={pat} />
        </>}
        {pat && pat.cuts.map((c) => <PolarChart key={c.id} cut={c} top={Math.max(pat.max.dbi, patOverlay?.max.dbi ?? -Infinity)}
          overlay={patOverlay?.cuts.find((x) => x.id === c.id)} names={patOverlay ? ["Simulated", imp!.name] : undefined} />)}
        {pat && pat.grid.dbi.length > 0 && <Pattern3D pattern={pat} />}
      </div>
    </div>
  );
}
