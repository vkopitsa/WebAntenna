import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import { ANTENNAS } from "../../antennas";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { add, box, rod, scale } from "../shapes";
import { gpMastAxis, PLATE } from "../families/hub";
import { feedPoint, STYLE, styleOf } from "./geometry";
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
  const bands5 = "3.5e6-3.8e6;7e6-7.2e6;10.1e6-10.15e6;14e6-14.35e6;18e6-18.2e6";
  const hoodCases: [string, Params][] = [
    ...wireIds.map((id): [string, Params] => [id, {}]),
    ["dipole", { droop: 0 }], ["dipole", { droop: 60 }], ["groundplane", { droop: 0 }], ["groundplane", { droop: 60 }],
    ["fandipole", { fan: 5, bands: bands5 }], ["fandipole", { fan: 45, bands: bands5 }], ["yagi", { boom: "through" }], ["yagi", { driven: "split" }],
    ["discone", { rods: 6 }], ["discone", { rods: 32 }],
  ];
  const hoods = () => hoodCases.map(([id, extra]) => {
    const { p, d } = setup(id, extra);
    return { id, extra, p, d, plan: shellPlan(id, p, d), spec: partsFor(id, p, d).find((s) => s.id === "shell")! };
  }).filter((h) => h.plan.kind === "feed");
  it("feed hoods: one solid, every exit ray clear, every slot open straight down past the bottom", () => {
    const hs = hoods();
    expect(hs.map((h) => h.id)).toEqual(expect.arrayContaining(["dipole", "fandipole", "groundplane", "yagi", "discone"]));
    for (const { id, extra, d, plan, spec } of hs) {
      if (plan.kind !== "feed") continue;
      const tag = `${id} ${JSON.stringify(extra)}`;
      const r = buildPart(M, spec, id);
      expect(r.ok, tag).toBe(true);
      const [h] = spec.build(M);
      expect(h.decompose().length, tag).toBe(1);
      const wall = STYLE[styleOf(d)].wall, z0 = plan.inner.lo[2];
      for (const x of plan.exits) {
        if (Math.abs(x.at[2] - z0) < 1e-6 && x.dir[2] < 0) continue;          // out through the open bottom
        const out = rod(M, add(x.at, scale(x.dir, -1)), add(x.at, scale(x.dir, wall + 10)), x.d);
        expect(h.intersect(out).volume(), `${tag} exit ${x.at}`).toBeLessThan(1e-2);
        if (x.dir[2] <= 0.7) expect(h.intersect(rod(M, x.at, [x.at[0], x.at[1], z0 - 5], x.d)).volume(), `${tag} slot ${x.at}`).toBeLessThan(1e-2);
      }
    }
  }, 120_000);
  it("feed hoods fit over their feed part, and the dipole hood stays small", () => {
    const feedPart: Record<string, string> = { dipole: "dipole-centre", fandipole: "fan-centre", groundplane: "gp-hub", discone: "discone-hub", yagi: "yagi-driven" };
    for (const { id, extra, d, plan, spec } of hoods()) {
      const fid = feedPart[id], part = partsFor(id, setup(id, extra).p, d).find((s) => s.id === fid);
      if (!part) continue;
      const fp = feedPoint(d);
      const placed = part.build(M)[0].translate(id === "yagi" ? fp : [0, 0, 0]);   // the yagi block is built in its own frame
      expect(placed.intersect(spec.build(M)[0]).volume(), `${id} ${JSON.stringify(extra)}`).toBeLessThan(1e-2);
      if (id === "dipole" && !Object.keys(extra).length) {
        const b = spec.build(M)[0].boundingBox();
        [0, 1, 2].forEach((i) => expect(b.max[i] - b.min[i]).toBeLessThanOrEqual(70));
      }
      expect(plan.kind).toBe("feed");
    }
  }, 120_000);
  it("the GP mast runs outside the hood (its top, at the hub block, is not above the hood's bottom edge)", () => {
    for (const droop of [0, 45, 60]) {
      const { p, d } = setup("groundplane", { droop });
      const h = partsFor("groundplane", p, d).find((s) => s.id === "shell")!.build(M)[0].boundingBox();
      const m = gpMastAxis(d);
      const outside = m[0] < h.min[0] || m[0] > h.max[0] || m[1] < h.min[1] || m[1] > h.max[1];
      expect(outside || -PLATE <= h.min[2] + 1e-6, `${droop}`).toBe(true);
    }
  });
  it("full boxes: the coax gland stays inside the floor, no breakout through a side wall", () => {
    for (const [id, extra] of [["dipole", { bands: "5725e6-5875e6", d: 1e-3 }], ["biquad", {}]] as const) {
      const { p, d } = setup(id, extra);
      const plan = shellPlan(id, p, d);
      expect(plan.kind, id).toBe("box");
      const wall = STYLE[styleOf(d)].wall, i = plan.inner;
      const shell = M.Manifold.union(partsFor(id, p, d).find((s) => s.id === "shell")!.build(M));
      const band = box(M, [i.lo[0] - wall, i.lo[1] - wall, i.lo[2] - wall], [i.hi[0] + wall, i.hi[1] + wall, i.hi[2] + wall]).subtract(box(M, [i.lo[0], i.lo[1], i.lo[2] - wall - 1], [i.hi[0], i.hi[1], i.hi[2] + wall + 1]));
      expect(shell.intersect(band).volume() / band.volume(), id).toBeGreaterThan(0.99);
    }
  });
});
