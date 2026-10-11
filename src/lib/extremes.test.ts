import { describe, expect, it } from "vitest";
import { ANTENNAS } from "./antennas";
import { SPRING_MAX_TURNS } from "./antennas/spring";
import { FAN_MAX } from "./antennas/fandipole";
import { patternChoices } from "./simulate";
import { toNEC } from "./export";
import { buildPack } from "./build";
import { buildPackPDF, templateSVG } from "./template";

// Every antenna at the ends of the band range (100 kHz … 100 GHz): the design, the exports and the
// paper templates must finish quickly and stay finite. At 100 kHz a spring once asked for millions of
// turns (OOM), a yagi's boom strip overflowed the stack and helix / PCB templates ran to millions of A4 tiles.
describe("band extremes", () => {
  for (const def of ANTENNAS) {
    const bp = def.params.find((p) => p.kind === "bands")!;
    for (const f of [bp.min!, bp.max!]) {
      it(`${def.id} at ${f} Hz`, () => {
        const p = { ...def.defaults, [bp.key]: `${f}-${f}` };
        const d = def.build(p);
        expect(d.wires.every((w) => [...w.a, ...w.b, w.r].every(Number.isFinite))).toBe(true);
        expect(d.wires.length).toBeLessThan(5000);
        if (d.necSupported) expect(toNEC(def, p, d)).not.toMatch(/NaN|Infinity/);
        expect(JSON.stringify(buildPack(def, p, d))).not.toMatch(/NaN|null/);
        buildPackPDF(def, p, d, "test", false);
        expect(templateSVG(def, d, false) ?? "").not.toMatch(/NaN|Infinity/);
      }, 60000); // seconds normally; the old failures ran out of memory or never finished
    }
  }
  it("the spring stops at its turn cap and says so", () => {
    const def = ANTENNAS.find((a) => a.id === "spring")!;
    const d = def.build({ ...def.defaults, bands: "1e6-1e6" });
    expect(d.wires.length).toBeLessThanOrEqual(SPRING_MAX_TURNS * 8 + 5);
    expect(d.notes.some((n) => n.includes("more than 100 turns"))).toBe(true);
  });
  it("the fan dipole tunes at most FAN_MAX elements and says so (12 bands took 15 s on the main thread)", () => {
    const def = ANTENNAS.find((a) => a.id === "fandipole")!;
    const bands = Array.from({ length: 12 }, (_, i) => `${(3.5e6 * 1.45 ** i).toFixed(0)}-${(3.6e6 * 1.45 ** i).toFixed(0)}`).join(";");
    const d = def.build({ ...def.defaults, bands });
    expect(d.wires.length).toBe(1 + 2 * FAN_MAX);
    expect(d.notes.some((n) => n.startsWith("Only the first 6 bands"))).toBe(true);
  }, 60000);
  it("pattern choices are unique when bands repeat (duplicate React keys)", () => {
    const def = ANTENNAS.find((a) => a.id === "dipole")!;
    const p = { ...def.defaults, bands: "144e6-146e6;144e6-146e6" };
    expect(patternChoices(p, def.build(p))).toEqual([145e6]);
  });
});
