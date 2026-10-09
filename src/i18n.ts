import { useStore, get } from "./store";
import { UK } from "./i18n/uk";

export type Lang = "en" | "uk";
export const LANGS: [Lang, string][] = [["en", "English"], ["uk", "Українська"]];

/** English source string → translation, per language. English is the key itself (same scheme as WebVNA). */
export const DICTS: Record<Lang, Record<string, string>> = { en: {}, uk: UK };

export function translate(lang: Lang, s: string, ...args: (string | number)[]): string {
  let out = DICTS[lang]?.[s] ?? s;
  args.forEach((a, i) => { out = out.split(`{${i}}`).join(String(a)); });
  return out;
}

export function useT() {
  const lang = useStore((s) => s.lang);
  return (s: string, ...a: (string | number)[]) => translate(lang, s, ...a);
}

export const tr = (s: string, ...a: (string | number)[]) => translate(get().lang, s, ...a);
