import { useSyncExternalStore } from "react";
import type { Vec3 } from "./lib/types";

/** What the pointer is over: a Dimensions row or table row (lights up wires) or a wire in the drawing (lights up rows). */
export interface Hover {
  /** Wire tags to light up. */
  tags: string[];
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
