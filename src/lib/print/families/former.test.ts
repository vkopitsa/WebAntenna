import { beforeAll, describe, expect, it } from "vitest";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { FAIL } from "../parts";
import { pieceBottoms } from "../shapes";
import { helixGeometry, ribs as ribsOf } from "./former";
import { ball, inside, setup } from "./testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });

const FPV = { bands: "5725e6-5875e6", d: 1e-3, turns: 5 };
const CASES: Params[] = [{}, { hand: "lhcp" }, FPV, { ...FPV, hand: "lhcp" }];
/** Put the stacked pieces back where they were cut from. */
const restack = (segs: Manifold[], H: number) => { const zs = pieceBottoms(H); return M.Manifold.union(segs.map((s, i) => s.translate([0, 0, segs.length > 1 ? zs[i] : 0]))); };

describe("helix former", () => {
  it("reads the design: diameter, pitch, turns, hand", () => {
    const { d } = setup("helix");
    const g = helixGeometry(d), dims = Object.fromEntries(d.dims.filter((x) => x.key).map((x) => [x.key, x.value * 1000]));
    expect(2 * g.R).toBeCloseTo(dims.D, 3);
    expect(g.S).toBeCloseTo(dims.S, 3);
    expect(g.n).toBeCloseTo(8, 6);
    expect(g.hand).toBe(1);
    expect(helixGeometry(setup("helix", { hand: "lhcp" }).d).hand).toBe(-1);
  });
  for (const id of ["helix-tube", "helix-frame"]) {
    it(`${id}: every design wire point is clear and held, both hands, GPS and 5.8 GHz`, () => {
      for (const c of CASES) {
        const { p, d } = setup("helix", c);
        const g = helixGeometry(d);
        const spec = partsFor("helix", p, d).find((s) => s.id === id)!;
        const whole = restack(spec.build(M), g.H);
        const probes = g.pts.filter((_, i) => i % 3 === 1);
        for (const q of probes) expect(inside(whole, ball(M, q, g.wireD)), `${JSON.stringify(c)} ${q}`).toBeLessThan(1e-3);
        // the first degrees of the coil, on the true helix (the wire's lower half is below h0 there)
        for (const deg of [1, 3, 6, 10, 20]) {
          const t = (deg * Math.PI) / 180, q: [number, number, number] = [g.R * Math.cos(t), g.hand * g.R * Math.sin(t), g.h0 + (g.S * t) / (2 * Math.PI)];
          expect(inside(whole, ball(M, q, g.wireD)), `${JSON.stringify(c)} start ${deg}°`).toBeLessThan(1e-3);
        }
        if (id === "helix-tube") {
          const held = probes.filter((q) => inside(whole, ball(M, q, g.wireD + 2)) > 0.01).length / probes.length;
          expect(held, JSON.stringify(c)).toBeGreaterThan(0.99);
        } else {
          // the wire crosses each rib: every point of the true helix at a rib angle is held
          const nr = ribsOf(g);
          for (let k = 0; k < nr; k++) for (let turn = 0; turn < 3; turn++) {
            const t = (2 * Math.PI * k) / nr + 2 * Math.PI * turn, q: [number, number, number] = [g.R * Math.cos(t), g.hand * g.R * Math.sin(t), g.h0 + (g.S * t) / (2 * Math.PI)];
            expect(inside(whole, ball(M, q, g.wireD + 2)), `${JSON.stringify(c)} rib ${k} turn ${turn}`).toBeGreaterThan(0.01);
          }
        }
        // feed stub: the L of wire from the axis to the first turn is clear
        expect(inside(whole, ball(M, [g.R / 2, 0, g.h0], g.wireD))).toBeLessThan(1e-3);
      }
    }, 120_000);
  }
  it("tall formers are stacked: piece heights add up, each fits the bed", () => {
    const { p, d } = setup("helix");
    const g = helixGeometry(d);
    const r = buildPart(M, partsFor("helix", p, d)[0], "t");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.segments.length).toBe(pieceBottoms(g.H).length);
      expect(r.segments.length).toBeGreaterThan(1);
      r.segments.forEach((s) => expect(Math.max(...s.size)).toBeLessThanOrEqual(180));
    }
  });
  it("an oversize helix is reported as too large before building", () => {
    for (const s of partsFor("helix", ...(() => { const { p, d } = setup("helix", { bands: "430e6-440e6", turns: 40 }); return [p, d] as const; })())) {
      const t0 = Date.now(), r = buildPart(M, s, s.id);
      expect(r.ok ? "" : r.error.s).toBe("Too large to print in one piece: {0}");
      expect(Date.now() - t0).toBeLessThan(1000);
    }
  });
  it("a tiny 5.8 GHz helix builds or says the wire is too thick", () => {
    for (const extra of [{ ...FPV, cl: 0.75 }, { ...FPV, cl: 0.75, d: 3e-3 }]) {
      const { p, d } = setup("helix", extra);
      for (const s of partsFor("helix", p, d)) { const r = buildPart(M, s, s.id); if (!r.ok) expect(r.error.s).toBe(FAIL.thick); }
    }
  });
});
