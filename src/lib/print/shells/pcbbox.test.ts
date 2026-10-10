import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import type { Params } from "../../types";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { box, rod } from "../shapes";
import { setup } from "../families/testkit";
import { pcbEntry, postSpots } from "./pcbbox";
import { STYLE, styleOf } from "./geometry";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const PCB = ["patch", "pcbmonopole", "meander", "ifa", "printeddipole", "pcbloop"];
/** Boards with a model (`d.pcb`), plus the probe-fed patch. */
const BOARDS: [string, Params][] = [...PCB.filter((x) => x !== "pcbloop").map((id): [string, Params] => [id, {}]), ["patch", { feed: "probe" }]];

describe("PCB enclosures", () => {
  it("every printed antenna has exactly one part, the shell, and it builds", () => {
    for (const id of PCB) {
      const { p, d } = setup(id);
      const parts = partsFor(id, p, d);
      expect(parts.map((s) => s.id), id).toEqual(["shell"]);
      expect(buildPart(M, parts[0], id).ok, id).toBe(true);
    }
  });
  it("no plastic within the gap of any copper rectangle (except the posts' own touching face)", () => {
    for (const [id, extra] of BOARDS) {
      const { p, d } = setup(id, extra);
      const gap = STYLE[styleOf(d)].gap, h = d.pcb!.h * 1000;
      const shell = M.Manifold.union(partsFor(id, p, d)[0].build(M));
      for (const r of d.pcb!.rects) {
        const z = r.layer === "top" ? [h, h + gap - 0.1] : [-(gap - 0.1), 0];
        const probe = box(M, [r.x0 * 1000, r.y0 * 1000, z[0]], [r.x1 * 1000, r.y1 * 1000, z[1]]);
        expect(shell.intersect(probe).volume(), `${id} ${r.label}`).toBeLessThan(1e-2);
      }
    }
  });
  it("copper overrunning the board stays inside the cavity", () => {
    const { p, d } = setup("ifa", { bw: 0.02, trim: 25 });
    const xs = d.pcb!.rects.map((r) => r.x1 * 1000), b = d.pcb!.board;
    expect(Math.max(...xs)).toBeGreaterThan(b.x1 * 1000);   // the case under test
    const gap = STYLE[styleOf(d)].gap, h = d.pcb!.h * 1000;
    const shell = M.Manifold.union(partsFor("ifa", p, d)[0].build(M));
    for (const r of d.pcb!.rects.filter((x) => x.layer === "top"))
      expect(shell.intersect(box(M, [r.x0 * 1000, r.y0 * 1000, h], [r.x1 * 1000, r.y1 * 1000, h + gap - 0.1])).volume(), r.label).toBeLessThan(1e-2);
  });
  it("posts never land on copper of the layer they touch", () => {
    for (const [id, extra] of BOARDS) {
      const { d } = setup(id, extra);
      for (const layer of ["top", "bottom"] as const) for (const s of postSpots(d, layer))
        for (const r of d.pcb!.rects.filter((x) => x.layer === layer))
          expect(s[0] + 2 < r.x0 * 1000 || s[0] - 2 > r.x1 * 1000 || s[1] + 2 < r.y0 * 1000 || s[1] - 2 > r.y1 * 1000, `${id} ${layer}`).toBe(true);
    }
  });
  it("the board is held: posts on both sides where copper leaves room, none under a full ground pour", () => {
    for (const id of ["pcbmonopole", "meander", "ifa"]) {
      const { d } = setup(id);
      if (id !== "ifa") expect(postSpots(d, "top").length, id).toBeGreaterThanOrEqual(2);
      expect(postSpots(d, "bottom").length, id).toBeGreaterThanOrEqual(2);
    }
    expect(postSpots(setup("ifa").d, "top")).toEqual([]);               // the arm runs 2 mm from the top edge: one free corner only
    expect(postSpots(setup("patch").d, "bottom")).toEqual([]);           // ground under the whole board: hot glue
    expect(postSpots(setup("patch").d, "top").length).toBeGreaterThanOrEqual(2);
    expect(postSpots(setup("printeddipole").d, "top")).toEqual([]);      // the arms run the full narrow board
    expect(postSpots(setup("printeddipole").d, "bottom").length).toBeGreaterThanOrEqual(2);
  });
  it("posts on a board narrower than two posts do not overlap or leave the board", () => {
    const { d } = setup("printeddipole", { w: 0.1e-3 });
    const b = d.pcb!.board, s = postSpots(d, "bottom");
    expect(s.length).toBeGreaterThanOrEqual(2);
    for (const a of s) {
      expect(a[0] - 1.5 >= b.x0 * 1000 - 1e-9 && a[0] + 1.5 <= b.x1 * 1000 + 1e-9).toBe(true);
      for (const c of s) if (a !== c) expect(Math.max(Math.abs(a[0] - c[0]), Math.abs(a[1] - c[1]))).toBeGreaterThanOrEqual(3);
    }
  });
  it("the coax enters on the board edge nearest the port, or under a probe feed", () => {
    expect(pcbEntry(setup("patch").d).dir).toEqual([-1, 0, 0]);
    expect(pcbEntry(setup("patch", { feed: "probe" }).d)).toMatchObject({ dir: [0, 0, -1], probe: true });
    expect(pcbEntry(setup("ifa").d).dir).toEqual([-1, 0, 0]);
    expect(pcbEntry(setup("printeddipole").d).at[1]).toBeCloseTo(0, 6);  // between the arms, across the narrow board
  });
  it("the coax entry is a clear path from the port through the wall", () => {
    for (const [id, extra] of BOARDS) {
      const { p, d } = setup(id, extra);
      const e = pcbEntry(d), shell = M.Manifold.union(partsFor(id, p, d)[0].build(M));
      const end: [number, number, number] = [e.at[0] + e.dir[0] * 30, e.at[1] + e.dir[1] * 30, e.at[2] + e.dir[2] * 30];
      expect(shell.intersect(rod(M, e.at, end, e.probe ? 6 : 3)).volume(), id).toBeLessThan(1e-2);
    }
  });
});
