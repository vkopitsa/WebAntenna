import { describe, expect, it } from "vitest";
import { ANTENNAS, ANTENNA_BY_ID } from "./antennas";
import { necWires, toCSV, toFreeCAD, toJSON, toNEC } from "./export";

describe("NEC export", () => {
  it("dipole deck has the expected cards and a centre-segment feed", () => {
    const def = ANTENNA_BY_ID.dipole;
    const d = def.build(def.defaults);
    const nec = toNEC(def, def.defaults, d);
    const cards = nec.trim().split("\n").map((l) => l.split(" ")[0]);
    expect(cards.filter((c) => c === "GW").length).toBeGreaterThanOrEqual(3);
    // 2 m: the 31 mm gap is longer than a λ/80 segment, so no taper
    expect(cards.filter((c) => c === "GC").length).toBe(0);
    expect(cards.slice(-5)).toEqual(["GE", "EX", "FR", "RP", "EN"]);
    const ex = nec.split("\n").find((l) => l.startsWith("EX"))!.split(" ");
    const gw = nec.split("\n").find((l) => l.startsWith(`GW ${ex[2]} `))!.split(" ");
    expect(Number(ex[3])).toBe((Number(gw[2]) + 1) / 2);
    expect(Number(gw[2]) % 2).toBe(1);
  });
  it("every NEC-capable antenna exports; boom stays out of the model", () => {
    for (const a of ANTENNAS) {
      const d = a.build(a.defaults);
      if (!d.necSupported) {
        expect(() => toNEC(a, a.defaults, d)).toThrow();
        continue;
      }
      const nec = toNEC(a, a.defaults, d);
      const gw = nec.split("\n").filter((l) => l.startsWith("GW"));
      expect(gw.length, a.id).toBeGreaterThanOrEqual(necWires(d).length);
      // every GC follows a GW with radius 0
      const ls = nec.split("\n");
      ls.forEach((l, i) => { if (l.startsWith("GC")) expect(ls[i - 1].split(" ")[9], a.id).toBe("0"); });
      for (const l of gw) expect(l.split(" ")).toHaveLength(10);
    }
    const y = ANTENNA_BY_ID.yagi;
    const d = y.build(y.defaults);
    expect(necWires(d).length).toBe(d.wires.length - 1);
  });
});

describe("FreeCAD / CSV / JSON", () => {
  it("FreeCAD macro has one rod per visible wire and one plate per plate", () => {
    const h = ANTENNA_BY_ID.helix;
    const d = h.build(h.defaults);
    const py = toFreeCAD(h, d);
    expect(py.split("\n").filter((l) => l.startsWith("rod(")).length).toBe(d.wires.filter((w) => !w.necOnly).length);
    expect(py.split("\n").filter((l) => l.startsWith("plate(")).length).toBe(1);
    expect(py).toContain("doc.recompute()");
  });
  it("CSV quotes commas and converts to mm", () => {
    const def = ANTENNA_BY_ID.moxon;
    const csv = toCSV(def, def.build(def.defaults));
    expect(csv.split("\n")[0]).toBe("Moxon rectangle");
    expect(csv).toMatch(/Width \(driver and reflector\),A,\d+\.\d+/);
  });
  it("JSON round-trips", () => {
    const def = ANTENNA_BY_ID.patch;
    const o = JSON.parse(toJSON(def, def.defaults, def.build(def.defaults), "0.1.0"));
    expect(o.antenna).toBe("patch");
    expect(o.plates.length).toBeGreaterThanOrEqual(4);
  });
});

describe("tapered feed", () => {
  it("HF dipole: arms are tapered from the 50 mm gap (GW radius 0 + GC)", () => {
    const def = ANTENNA_BY_ID.dipole;
    const p = { ...def.defaults, bands: "7e6-7.2e6" };
    const ls = toNEC(def, p, def.build(p)).split("\n");
    expect(ls.filter((l) => l.startsWith("GC"))).toHaveLength(2);
  });
});

describe("multi-band NEC", () => {
  it("emits an FR + RP pair per band", () => {
    const def = ANTENNA_BY_ID.dipole;
    const p = { ...def.defaults, bands: "144e6-146e6;430e6-440e6" };
    const nec = toNEC(def, p, def.build(p));
    expect(nec.split("\n").filter((l) => l.startsWith("FR"))).toHaveLength(2);
    expect(nec.split("\n").filter((l) => l.startsWith("RP"))).toHaveLength(2);
  });
});
