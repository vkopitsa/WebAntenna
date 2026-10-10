import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { ANTENNAS } from "../../antennas";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { rod } from "../shapes";
import { exits, STYLE, styleOf } from "./geometry";
import { shellPlan } from "./index";
import { setup } from "../families/testkit";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const wireIds = ANTENNAS.filter((a) => a.category !== "Printed").map((a) => a.id);

describe("shells for wire antennas", () => {
  it("every wire antenna has exactly one shell, and it builds at defaults", () => {
    for (const id of wireIds) {
      const { p, d } = setup(id);
      const sh = partsFor(id, p, d).filter((s) => s.id === "shell");
      expect(sh.length, id).toBe(1);
      expect(buildPart(M, sh[0], id).ok, id).toBe(true);
    }
  }, 120_000);
  it("kind by size: a 5.8 GHz dipole is fully enclosed, a 7 MHz dipole gets a feed box; GPS helix gets a dome", () => {
    const plan = (id: string, extra = {}) => { const { p, d } = setup(id, extra); return shellPlan(id, p, d).kind; };
    expect(plan("dipole", { bands: "5725e6-5875e6", d: 1e-3 })).toBe("box");
    expect(plan("dipole", { bands: "7e6-7.2e6" })).toBe("feed");
    expect(plan("helix")).toBe("dome");
  });
  it("full shells keep the gap from every live wire", () => {
    for (const [id, extra] of [["dipole", { bands: "5725e6-5875e6", d: 1e-3 }], ["helix", {}], ["helix", { bands: "5725e6-5875e6", d: 1e-3, turns: 5 }], ["moxon", { bands: "2400e6-2483e6", d: 1e-3 }], ["biquad", {}]] as const) {
      const { p, d } = setup(id, extra);
      const plan = shellPlan(id, p, d);
      expect(plan.kind === "feed", `${id} ${JSON.stringify(extra)}`).toBe(false);
      const shell = M.Manifold.union(partsFor(id, p, d).find((s) => s.id === "shell")!.build(M).map((s, i, all) => s.translate([0, 0, plan.pieceZ?.(i, all.length) ?? 0])).map((s) => s.translate(plan.toWorld ?? [0, 0, 0])));
      const gap = STYLE[styleOf(d)].gap;
      for (const w of d.wires.filter((x) => !x.drawOnly && !x.necOnly)) {
        const a = w.a.map((v) => v * 1000) as [number, number, number], b = w.b.map((v) => v * 1000) as [number, number, number];
        expect(shell.intersect(rod(M, a, b, 2 * w.r * 1000 + 2 * (gap - 0.1))).volume(), `${id} wire`).toBeLessThan(1e-2);
      }
    }
  }, 120_000);
  it("feed boxes: every exit ray passes clear through its hole", () => {
    for (const id of ["dipole", "fandipole", "yagi", "moxon", "quad", "jpole", "collinear", "groundplane", "discone"]) {
      const { p, d } = setup(id);
      const plan = shellPlan(id, p, d, M, partsFor(id, p, d));   // with M the plan's cavity is the one that gets built
      if (plan.kind !== "feed") continue;
      // in the box frame (a feed box may be turned about the vertical axis through the feed point)
      const c = plan.gland;
      const shell = M.Manifold.union(partsFor(id, p, d).find((s) => s.id === "shell")!.build(M).map((h) => h.translate([-c[0], -c[1], 0]).rotate([0, 0, -plan.turn]).translate([c[0], c[1], 0])));
      for (const x of exits(plan.frame, plan.inner)) {
        const probe = rod(M, x.at, [x.at[0] + x.dir[0] * 20, x.at[1] + x.dir[1] * 20, x.at[2] + x.dir[2] * 20], x.d);
        expect(shell.intersect(probe).volume(), `${id} exit ${x.at}`).toBeLessThan(1e-2);
      }
    }
  }, 120_000);
  it("every shell piece is one solid (exit holes never split a half), at defaults and for the full-shell cases", () => {
    const cases: [string, Params][] = [...wireIds.map((id): [string, Params] => [id, {}]), ["dipole", { bands: "5725e6-5875e6", d: 1e-3 }], ["moxon", { bands: "2400e6-2483e6", d: 1e-3 }], ["helix", { bands: "5725e6-5875e6", d: 1e-3, turns: 5 }]];
    for (const [id, extra] of cases) {
      const { p, d } = setup(id, extra);
      const segs = partsFor(id, p, d).find((s) => s.id === "shell")!.build(M);
      segs.forEach((s, i) => expect(s.decompose().length, `${id} ${JSON.stringify(extra)} piece ${i}`).toBe(1));
    }
  }, 120_000);
});
