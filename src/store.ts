// Tiny external store (no dependency): state + localStorage persistence + share-link hash.
import { useSyncExternalStore } from "react";
import { ANTENNA_BY_ID, ANTENNAS } from "./lib/antennas";
import type { Params } from "./lib/types";
import { parseBands } from "./lib/bands";
import type { Lang } from "./i18n";

export type Unit = "mm" | "in";
export type Theme = "auto" | "light" | "dark";
export type ViewMode = "3d" | "top" | "front" | "side";
export type MainTab = "design" | "sim" | "build" | "synth";

export interface State {
  type: string;
  /** Params per antenna type, so switching type keeps your edits. */
  params: Record<string, Params>;
  unit: Unit;
  lang: Lang;
  theme: Theme;
  view: ViewMode;
  /** Main area tab (not persisted). */
  tab: MainTab;
  /** Printed antennas read best from the top; they keep their own view setting. */
  pcbView: ViewMode;
  yaw: number;
  pitch: number;
  /** Draw every dimension in the Preview at once (persisted). */
  showDims: boolean;
}

/** Default 3D camera angles (degrees). */
export const DEFAULT_YAW = 120, DEFAULT_PITCH = 25;

const KEY = "antgen.settings.v1";
const defaults = (): State => ({
  type: "yagi",
  params: Object.fromEntries(ANTENNAS.map((a) => [a.id, { ...a.defaults }])),
  unit: "mm",
  lang: (typeof navigator !== "undefined" && navigator.language?.startsWith("uk")) ? "uk" : "en",
  theme: "auto",
  view: "3d",
  tab: "design",
  pcbView: "top",
  yaw: DEFAULT_YAW,
  pitch: DEFAULT_PITCH,
  showDims: false,
});

function load(): State {
  const s = defaults();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<State>;
      if (o.type && ANTENNA_BY_ID[o.type]) s.type = o.type;
      if (o.unit === "mm" || o.unit === "in") s.unit = o.unit;
      if (o.lang === "en" || o.lang === "uk") s.lang = o.lang;
      if (o.theme === "auto" || o.theme === "light" || o.theme === "dark") s.theme = o.theme;
      if (typeof o.showDims === "boolean") s.showDims = o.showDims;
      if (o.params) for (const id of Object.keys(s.params)) if (o.params[id]) s.params[id] = clean(id, o.params[id]);
    }
  } catch { /* private mode or bad JSON: defaults */ }
  return applyHash(s);
}

/** Keep only known keys; migrate the old single "f" param (v0.1.0) to a one-band list. */
function clean(id: string, saved: Params): Params {
  const def = ANTENNA_BY_ID[id];
  const out: Params = {};
  for (const pd of def.params) out[pd.key] = saved[pd.key] ?? def.defaults[pd.key];
  if (typeof saved.f === "number" && saved.bands === undefined && "bands" in out) out.bands = `${saved.f}-${saved.f}`;
  return out;
}

/** Share link: #t=yagi&f=145500000&n=9 … */
function applyHash(s: State): State {
  if (typeof location === "undefined" || location.hash.length < 2) return s;
  const q = new URLSearchParams(location.hash.slice(1));
  const t = q.get("t");
  if (!t || !ANTENNA_BY_ID[t]) return s;
  const def = ANTENNA_BY_ID[t];
  const p: Params = { ...def.defaults };
  for (const pd of def.params) {
    const raw = q.get(pd.key);
    if (raw == null) continue;
    if (pd.kind === "select") { if (pd.options?.some(([v]) => v === raw)) p[pd.key] = raw; }
    else if (pd.kind === "bands") { if (parseBands(raw).length) p[pd.key] = raw; }
    else { const n = parseFloat(raw); if (Number.isFinite(n)) p[pd.key] = n; }
  }
  return { ...s, type: t, params: { ...s.params, [t]: p } };
}

export function shareHash(s: State): string {
  const q = new URLSearchParams({ t: s.type });
  for (const [k, v] of Object.entries(s.params[s.type])) q.set(k, String(v));
  return "#" + q.toString();
}

let state: State = load();
const subs = new Set<() => void>();

export const get = () => state;
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  try {
    const { type, params, unit, lang, theme, showDims } = state;
    localStorage.setItem(KEY, JSON.stringify({ type, params, unit, lang, theme, showDims }));
  } catch { /* ignore */ }
  subs.forEach((f) => f());
}
export function setParam(key: string, value: number | string) {
  set((s) => ({ params: { ...s.params, [s.type]: { ...s.params[s.type], [key]: value } } }));
}
export function resetParams() {
  set((s) => ({ params: { ...s.params, [s.type]: { ...ANTENNA_BY_ID[s.type].defaults } } }));
}

export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => sel(state), () => sel(state));
}
