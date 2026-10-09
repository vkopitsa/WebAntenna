import { useEffect, useMemo, useRef, useState } from "react";
import { ANTENNA_BY_ID } from "./lib/antennas";
import { set, useStore, type MainTab, type Theme, type Unit } from "./store";
import { LANGS, useT, type Lang } from "./i18n";
import { AntennaPicker, ParamsPanel } from "./components/Sidebar";
import { Preview } from "./components/Preview";
import { Results } from "./components/Results";
import { Exports } from "./components/Exports";
import { Select } from "./components/inputs";
import { SimPanel } from "./components/SimPanel";
import { SynthPanel } from "./components/SynthPanel";
import { BuildPanel } from "./components/BuildPanel";

export default function App() {
  const t = useT();
  const type = useStore((s) => s.type);
  const params = useStore((s) => s.params[s.type]);
  const unit = useStore((s) => s.unit);
  const lang = useStore((s) => s.lang);
  const theme = useStore((s) => s.theme);
  const [drawer, setDrawer] = useState(false);
  const tab = useStore((s) => s.tab);
  const setTab = (v: MainTab) => set({ tab: v });
  const svgRef = useRef<SVGSVGElement | null>(null);
  const def = ANTENNA_BY_ID[type];

  const { design, error } = useMemo(() => {
    try { return { design: def.build(params), error: null }; }
    catch (e) { return { design: null, error: String(e) }; }
  }, [def, params]);

  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    if (theme === "auto") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);
  useEffect(() => { document.title = `${t(def.name)} · ${t("Antenna Generator")}`; }, [def, t]);

  return (
    <div className="app">
      <header className="toolbar">
        <button className="mobile-only menu-btn" onClick={() => setDrawer((d) => !d)} aria-label={t("Antenna and parameters")} aria-expanded={drawer}>☰</button>
        <span className="brand">{t("Antenna Generator")}</span>
        <span className="ver">v{__APP_VERSION__}</span>
        <span className="current">{t(def.name)}</span>
        <span className="spacer" />
        <Select<Unit> value={unit} ariaLabel="Units" options={[["mm", "mm"], ["in", "inch"]]} onChange={(v) => set({ unit: v })} />
        <Select<Lang> value={lang} ariaLabel="Language" options={LANGS} onChange={(v) => set({ lang: v })} />
        <Select<Theme> className="theme-select" value={theme} ariaLabel="Theme" options={[["auto", "Auto"], ["light", "Light"], ["dark", "Dark"]]} onChange={(v) => set({ theme: v })} />
      </header>
      <div className="body">
        {drawer && <div className="backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />}
        <aside className={"side" + (drawer ? " open" : "")} aria-label={t("Antenna and parameters")}>
          <div className="panel">
            <button className="mobile-only drawer-close" onClick={() => setDrawer(false)} aria-label={t("Close")}>✕</button>
            <ParamsPanel />
            <AntennaPicker onPick={() => setDrawer(false)} />
          </div>
        </aside>
        <main className="main">
          <div className="seg main-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "design"} className={tab === "design" ? "on" : ""} onClick={() => setTab("design")}>{t("Design")}</button>
            <button role="tab" aria-selected={tab === "sim"} className={tab === "sim" ? "on" : ""} onClick={() => setTab("sim")}>{t("Simulation")}</button>
            <button role="tab" aria-selected={tab === "build"} className={tab === "build" ? "on" : ""} onClick={() => setTab("build")}>{t("Build")}</button>
            <button role="tab" aria-selected={tab === "synth"} className={tab === "synth" ? "on" : ""} onClick={() => setTab("synth")}>{t("Synthesis")}</button>
          </div>
          {tab === "synth" ? <SynthPanel /> : design ? (tab === "design" ? (
            <>
              <Preview design={design} svgRef={svgRef} />
              <Exports def={def} params={params} design={design} svgRef={svgRef} />
              <Results design={design} />
              <p className="hint disclaimer">{t("Formulas give a starting point. Build slightly long, measure with an antenna analyser or VNA, then trim.")}</p>
            </>
          ) : tab === "build" ? <BuildPanel def={def} params={params} design={design} /> : <SimPanel def={def} params={params} design={design} />) : <div className="box err-text">{error}</div>}
        </main>
      </div>
    </div>
  );
}
