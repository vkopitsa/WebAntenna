import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { ANTENNAS } from "../antennas";
import type { Params } from "../types";
import { buildPart, partsFor } from ".";
import { FAIL } from "./parts";
import { MAX_SIZE } from "./rules";
import { loadManifold } from "./manifold";
import { meshOf, toSTL } from "./stl";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

/** Minimal binary STL reader for the round-trip test. */
function readSTL(b: Uint8Array) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const n = v.getUint32(80, true);
  const tris: number[][] = [];
  for (let t = 0; t < n; t++) { const o = 84 + 50 * t + 12; tris.push(Array.from({ length: 9 }, (_, k) => v.getFloat32(o + 4 * k, true))); }
  return { n, tris };
}

describe("STL writer", () => {
  it("header, count and size are consistent, and the triangles read back", () => {
    const stl = toSTL(meshOf(M.Manifold.cube([10, 20, 30])), "cube");
    const { n, tris } = readSTL(stl);
    expect(n).toBe(12);
    expect(stl.length).toBe(84 + 50 * 12);
    expect(new TextDecoder().decode(stl.slice(0, 5))).not.toBe("solid");
    const xs = tris.flatMap((t) => [t[0], t[3], t[6]]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(10, 5);
  });
});

describe("partsFor", () => {
  it("every wire antenna has at least one printed part", () => {
    for (const def of ANTENNAS) { const d = def.build(def.defaults); if (!d.pcb && def.category !== "Printed") expect(partsFor(def.id, def.defaults, d).length, def.id).toBeGreaterThan(0); }
  });
  it("printed antennas have exactly one part, the shell", () => {
    for (const def of ANTENNAS) { const d = def.build(def.defaults); if (def.category === "Printed") expect(partsFor(def.id, def.defaults, d).map((s) => s.id), def.id).toEqual(["shell"]); }
  });
  it("every part of every antenna builds at defaults", () => {
    for (const def of ANTENNAS) for (const s of partsFor(def.id, def.defaults, def.build(def.defaults))) expect(buildPart(M, s, s.id).ok, `${def.id} ${s.id}`).toBe(true);
  }, 60_000);
  it("at parameter extremes every part builds or is reported too large, never broken", () => {
    for (const def of ANTENNAS) {
      const cases: Params[] = [];
      for (const q of def.params) {
        if ((q.kind === "int" || q.kind === "length" || q.kind === "angle") && q.min != null && q.max != null) cases.push({ [q.key]: q.min }, { [q.key]: q.max });
        if (q.kind === "select") for (const [v] of q.options!) cases.push({ [q.key]: v });
      }
      for (const extra of cases) {
        const p = { ...def.defaults, ...extra };
        for (const s of partsFor(def.id, p, def.build(p))) {
          const r = buildPart(M, s, s.id);
          if (r.ok) r.segments.forEach((g) => expect(Math.max(...g.size)).toBeLessThanOrEqual(MAX_SIZE));
          else expect(["Too large to print in one piece: {0}", FAIL.thick, FAIL.radome, FAIL.hood], `${def.id} ${JSON.stringify(extra)} ${s.id}`).toContain(r.error.s);
        }
      }
    }
  }, 300_000);
});

describe("how-to instructions", () => {
  it("every part has numbered steps, and the zip README lists them", async () => {
    const { partsReadme } = await import(".");
    for (const def of ANTENNAS) {
      const specs = partsFor(def.id, def.defaults, def.build(def.defaults));
      specs.forEach((s) => expect(s.howTo.length, s.id).toBeGreaterThan(0));
      if (specs.length) {
        const txt = partsReadme(def.name, specs);
        for (const s of specs) expect(txt).toContain(s.title);
        expect(txt).toContain("1. ");
        expect(txt).not.toMatch(/\{\d\}/);
      }
    }
  });
});
