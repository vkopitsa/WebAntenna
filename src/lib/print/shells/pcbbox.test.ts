import { beforeAll, describe, expect, it } from "vitest";
import type { ManifoldToplevel } from "manifold-3d";
import type { Design, Params } from "../../types";
import { loadManifold } from "../manifold";
import { buildPart, partsFor } from "..";
import { box, rod, type V3 } from "../shapes";
import { setup } from "../families/testkit";
import { cablePath, edgeStops, holders, pcbCavity, pcbEntry, postSpots, supports } from "./pcbbox";
import { drainAt } from "./clamshell";
import { STYLE, styleOf } from "./geometry";

let M: ManifoldToplevel;
beforeAll(async () => { M = await loadManifold(); });
const PCB = ["patch", "pcbmonopole", "meander", "ifa", "printeddipole", "pcbloop"];
/** Boards with a model (`d.pcb`), plus the probe-fed patch. */
const BOARDS: [string, Params][] = [...PCB.filter((x) => x !== "pcbloop").map((id): [string, Params] => [id, {}]), ["patch", { feed: "probe" }]];
const name = (id: string, extra: Params) => `${id}${Object.keys(extra).length ? JSON.stringify(extra) : ""}`;
const isGround = (label: string) => label.startsWith("Ground");
/** The points do not all lie on one line. */
const notLine = (p: V3[]) => p.some((a, i) => p.some((b, j) => j > i && p.some((c, k) => k > j && Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) > 1)));

describe("PCB enclosures", () => {
  it("every printed antenna has exactly one part, the shell, and it builds", () => {
    for (const id of PCB) {
      const { p, d } = setup(id);
      const parts = partsFor(id, p, d);
      expect(parts.map((s) => s.id), id).toEqual(["shell"]);
      expect(buildPart(M, parts[0], id).ok, id).toBe(true);
    }
  });
  it("each half is one solid", () => {
    for (const [id, extra] of [...BOARDS, ["pcbloop", {}] as [string, Params]]) {
      const { p, d } = setup(id, extra);
      for (const [k, h] of partsFor(id, p, d)[0].build(M).entries()) expect(h.decompose().length, `${name(id, extra)} half ${k}`).toBe(1);
    }
  });
  it("no plastic within the gap of radiator copper; over the ground pour only the holders touch", () => {
    for (const [id, extra] of BOARDS) {
      const { p, d } = setup(id, extra);
      const gap = STYLE[styleOf(d)].gap, h = d.pcb!.h * 1000, g = gap - 0.1;
      const shell = M.Manifold.union(partsFor(id, p, d)[0].build(M));
      const hold = holders(M, d), bare = [...hold.bottom, ...hold.top].reduce((s, x) => s.subtract(x), shell);
      for (const r of d.pcb!.rects) {
        const z = r.layer === "top" ? [h, h + g] : [-g, 0], k = isGround(r.label) ? 0 : g;
        const probe = box(M, [r.x0 * 1000 - k, r.y0 * 1000 - k, z[0]], [r.x1 * 1000 + k, r.y1 * 1000 + k, z[1]]);
        expect((isGround(r.label) ? bare : shell).intersect(probe).volume(), `${name(id, extra)} ${r.label}`).toBeLessThan(1e-2);
      }
    }
  });
  it("copper overrunning the board stays inside the cavity", () => {
    const { p, d } = setup("ifa", { bw: 0.02, trim: 25 });
    const xs = d.pcb!.rects.map((r) => r.x1 * 1000), b = d.pcb!.board;
    expect(Math.max(...xs)).toBeGreaterThan(b.x1 * 1000);   // the case under test
    const gap = STYLE[styleOf(d)].gap, h = d.pcb!.h * 1000;
    const shell = M.Manifold.union(partsFor("ifa", p, d)[0].build(M));
    for (const r of d.pcb!.rects.filter((x) => x.layer === "top" && !isGround(x.label)))
      expect(shell.intersect(box(M, [r.x0 * 1000, r.y0 * 1000, h], [r.x1 * 1000, r.y1 * 1000, h + gap - 0.1])).volume(), r.label).toBeLessThan(1e-2);
  });
  it("posts stay a gap away from radiator copper on the face they touch", () => {
    for (const [id, extra] of BOARDS) {
      const { d } = setup(id, extra);
      const gap = STYLE[styleOf(d)].gap;
      for (const layer of ["top", "bottom"] as const) for (const s of postSpots(d, layer))
        for (const r of d.pcb!.rects.filter((x) => x.layer === layer && !isGround(x.label))) {
          const dx = Math.max(0, r.x0 * 1000 - (s[0] + 1.5), s[0] - 1.5 - r.x1 * 1000), dy = Math.max(0, r.y0 * 1000 - (s[1] + 1.5), s[1] - 1.5 - r.y1 * 1000);
          expect(Math.hypot(dx, dy), `${name(id, extra)} ${layer} ${r.label}`).toBeGreaterThanOrEqual(gap - 1e-9);
        }
    }
  });
  it("every board is held: supports on both faces not all on one line, and a stop on each side", () => {
    for (const [id, extra] of BOARDS) {
      const { d } = setup(id, extra), s = supports(d), st = edgeStops(d);
      expect(notLine(s.bottom), `${name(id, extra)} bottom`).toBe(true);
      expect(notLine(s.top), `${name(id, extra)} top`).toBe(true);
      for (const [i, sg] of [[0, -1], [0, 1], [1, -1], [1, 1]]) expect(st.some((t) => t.i === i && t.s === sg), `${name(id, extra)} side ${i} ${sg}`).toBe(true);
    }
    // ground copper may carry posts: the patch gets bottom posts, the monopole posts at both ends
    expect(postSpots(setup("patch").d, "bottom").length).toBeGreaterThanOrEqual(3);
    const ys = postSpots(setup("pcbmonopole").d, "top").map((s) => s[1]);
    expect(Math.min(...ys)).toBeLessThan(-20);
    expect(Math.max(...ys)).toBeGreaterThan(10);
  });
  it("no post or stop where the outdoor drain cuts", () => {
    const { d } = setup("meander");
    const [x, y] = drainAt(pcbCavity(d));
    for (const layer of ["top", "bottom"] as const) for (const s of postSpots(d, layer)) expect(Math.max(Math.abs(s[0] - x), Math.abs(s[1] - y))).toBeGreaterThan(1.5 + 1.5);
    for (const h of holders(M, d).bottom) expect(h.intersect(rod(M, [x, y, -20], [x, y, 20], 3)).volume()).toBeLessThan(1e-6);
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
    expect(pcbEntry(setup("printeddipole").d).at[1]).toBeCloseTo(0, 6);  // between the arms, across the narrow board
    // over the ground pour, (gap + cable radius) inside its edge
    const ifa = pcbEntry(setup("ifa").d);
    expect(ifa.dir).toEqual([-1, 0, 0]);
    expect(ifa.at[1]).toBeCloseTo(-(1.5 + 1.75), 6);
    // a synthetic port next to the y1 edge (no ground there): that edge, at the port's x
    const { d } = setup("printeddipole"), b = d.pcb!.board;
    const port = { ...d.pcb!.port, start: [-0.5e-3, b.y1 - 2e-3, d.pcb!.h] as Design["wires"][0]["a"], stop: [0.5e-3, b.y1 - 1e-3, d.pcb!.h] as Design["wires"][0]["a"] };
    const e = pcbEntry({ ...d, pcb: { ...d.pcb!, port } });
    expect(e.dir).toEqual([0, 1, 0]);
    expect(e.at[0]).toBeCloseTo(0, 6);
    expect(e.at[1]).toBeCloseTo(b.y1 * 1000, 6);
  });
  it("the cable from the entry to the port crosses no radiator copper (except within 2 mm of the port)", () => {
    for (const [id, extra] of BOARDS) {
      const { d } = setup(id, extra), e = pcbEntry(d), q = d.pcb!.port;
      if (e.probe) continue;
      const c = [((q.start[0] + q.stop[0]) / 2) * 1000, ((q.start[1] + q.stop[1]) / 2) * 1000];
      const L = Math.hypot(c[0] - e.at[0], c[1] - e.at[1]), n = Math.ceil(L / 0.02);
      for (let k = 0; k <= n; k++) {
        const x = e.at[0] + ((c[0] - e.at[0]) * k) / Math.max(n, 1), y = e.at[1] + ((c[1] - e.at[1]) * k) / Math.max(n, 1);
        if (Math.hypot(x - c[0], y - c[1]) < 2) continue;
        for (const r of d.pcb!.rects.filter((x) => x.layer === "top" && !isGround(x.label)))
          expect(x > r.x0 * 1000 && x < r.x1 * 1000 && y > r.y0 * 1000 && y < r.y1 * 1000, `${name(id, extra)} ${r.label} at ${x.toFixed(2)},${y.toFixed(2)}`).toBe(false);
      }
    }
  });
  it("the cable lies on the board in a channel of the top half, under a roof at least a wall thick", () => {
    for (const [id, extra] of BOARDS) {
      const { p, d } = setup(id, extra), path = cablePath(d);
      if (!path) { expect(pcbEntry(d).probe, id).toBe(true); continue; }
      const { wall } = STYLE[styleOf(d)], h = d.pcb!.h * 1000, [, top] = partsFor(id, p, d)[0].build(M);
      expect(top.decompose().length, name(id, extra)).toBe(1);
      const at = (u: V3, z: number): V3 => [u[0], u[1], z];
      for (const [a, b] of [[path[0], path[1]], [path[1], path[2]]]) {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (L < 1e-6) continue;
        expect(M.Manifold.union(partsFor(id, p, d)[0].build(M)).intersect(rod(M, at(a, h + 1.75), at(b, h + 1.75), 3.5)).volume(), `${name(id, extra)} cable`).toBeLessThan(1e-2);
        // the roof over the channel: a thin band from the channel's top up one wall thickness is solid plastic
        const zt = h + 1.75 + (3.5 + 0.3) / 2;
        for (let k = 0; k <= 10; k++) {
          const x = a[0] + ((b[0] - a[0]) * k) / 10, y = a[1] + ((b[1] - a[1]) * k) / 10;
          const probe = box(M, [x - 0.25, y - 0.25, zt + 0.05], [x + 0.25, y + 0.25, zt + wall - 0.05]);
          expect(top.intersect(probe).volume() / probe.volume(), `${name(id, extra)} roof at ${x.toFixed(1)},${y.toFixed(1)}`).toBeGreaterThan(0.999);
        }
      }
    }
  });
  it("the coax entry is a clear path from the port through the wall", () => {
    for (const [id, extra] of BOARDS) {
      const { p, d } = setup(id, extra);
      const e = pcbEntry(d), shell = M.Manifold.union(partsFor(id, p, d)[0].build(M));
      const end: [number, number, number] = [e.at[0] + e.dir[0] * 30, e.at[1] + e.dir[1] * 30, e.at[2] + e.dir[2] * 30];
      expect(shell.intersect(rod(M, e.at, end, e.probe ? 6 : 3)).volume(), name(id, extra)).toBeLessThan(1e-2);
    }
  });
});
