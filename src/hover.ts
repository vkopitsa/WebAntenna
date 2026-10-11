import { useSyncExternalStore } from "react";
import type { Vec3 } from "./lib/types";
import { get } from "./store";

/** What the pointer is over: a Dimensions row or table row (lights up wires) or a wire in the drawing (lights up rows). */
export interface Hover {
  /** Wire tags to light up. */
  tags: string[];
  /** Wires to light up by index into `design.wires` (for untagged wires), and plates by index into `design.plates`. */
  wires?: number[];
  plates?: number[];
  /** Span to draw as a dimension line, with its value in metres. */
  span?: { at: [Vec3, Vec3]; value: number };
  /** Set when the pointer is over a wire: rows that mention these tags light up. */
  fromDrawing?: boolean;
}

let cur: Hover | null = null;
const subs = new Set<() => void>();

export function setHover(h: Hover | null) {
  if (h === cur) return;
  cur = h;
  subs.forEach((f) => f());
}

export function useHover(): Hover | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => cur);
}

/** A pinned row or wire: its highlight stays until unpinned. `key` identifies the row across rebuilds, `type` the antenna. */
export interface Pin { key: string; type: string; hover: Hover }

let pinned: Pin | null = null;

export const getPin = () => pinned;
export function setPin(p: Pin | null) {
  if (p === pinned) return;
  pinned = p;
  subs.forEach((f) => f());
}
/** Pin `key`, or unpin it when it is already pinned. */
export function togglePin(key: string, hover: Hover) {
  setPin(pinned?.key === key ? null : { key, type: get().type, hover });
}
export function usePin(): Pin | null {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => pinned);
}
/** What the drawing and tables show: the hover preview, else the pin. */
export function useEffectiveHover(): Hover | null {
  const h = useHover(), p = usePin();
  return h ?? p?.hover ?? null;
}
