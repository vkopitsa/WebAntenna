import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Design, Params } from "../../types";
import { type Box3, boxFits, domeFits, envelope, exits, feedPoint, grow, size, styleOf } from "./geometry";

const build = (id: string, extra: Params = {}): Design => { const def = ANTENNA_BY_ID[id]; return def.build({ ...def.defaults, ...extra }); };

describe("shell geometry", () => {
  it("style: FPV at and above 2 GHz, outdoor below", () => {
    expect(styleOf(build("helix"))).toBe("outdoor");                                    // GPS
    expect(styleOf(build("helix", { bands: "5725e6-5875e6", d: 1e-3 }))).toBe("fpv");
    expect(styleOf(build("biquad"))).toBe("fpv");                                       // 2.4 GHz
  });
  it("envelope of a PCB antenna is its board plus copper", () => {
    const d = build("ifa"), e = envelope(d), b = d.pcb!.board, t = d.pcb!.t * 1000;
    expect(e.lo[0]).toBeLessThanOrEqual(b.x0 * 1000 + 1e-6); expect(e.hi[0]).toBeGreaterThanOrEqual(b.x1 * 1000 - 1e-6);
    expect(e.lo[1]).toBeLessThanOrEqual(b.y0 * 1000 + 1e-6); expect(e.hi[1]).toBeGreaterThanOrEqual(b.y1 * 1000 - 1e-6);
    expect(Math.abs(e.lo[2] + t)).toBeLessThan(0.01); expect(Math.abs(e.hi[2] - (d.pcb!.h * 1000 + t))).toBeLessThan(0.01);
  });
  it("envelope contains an IFA arm that overruns the board", () => {
    const d = build("ifa", { bw: 16e-3 });
    expect(d.notes.join(" ")).toMatch(/arm is longer/);
    const e = envelope(d), arm = d.pcb!.rects.find((q) => q.label === "Radiating arm")!;
    expect(arm.x1 * 1000).toBeGreaterThan(d.pcb!.board.x1 * 1000);
    expect(e.hi[0]).toBeGreaterThanOrEqual(arm.x1 * 1000 - 1e-6);
  });
  it("envelope ignores NEC-only grids and drawn-only parts", () => {
    const e = envelope(build("helix"));            // the ground disc is a plate: included; the NEC grid is not double-counted
    expect(size(e)[0]).toBeGreaterThan(100);
    const y = build("yagi"), ey = envelope(y);
    const boom = y.wires.find((w) => w.drawOnly)!;
    expect(Math.max(Math.abs(boom.a[0]), Math.abs(boom.b[0])) * 1000).toBeGreaterThanOrEqual(ey.hi[0] - 1e-6);
  });
  it("feed point: dipole at the origin, quad at the bottom of the driven loop, collinear at the origin", () => {
    expect(feedPoint(build("dipole")).map((v) => Math.round(v))).toEqual([0, 0, 0]);
    const q = feedPoint(build("quad"));
    expect(q[2]).toBeLessThan(-100);
    expect(feedPoint(build("collinear"))).toEqual([0, 0, 0]);
    expect(feedPoint(build("helix"))).toEqual([0, 0, 0]);                       // at "start"
    const qd = build("quad"), S = 0.15 * (299792458 / qd.f) * 1000;             // default spacing 0.15 λ
    expect(q[0]).toBeCloseTo(S / 2, 1); expect(q[1]).toBeCloseTo(0, 6);
    const side = qd.wires[0].a[2] * -2000;                                      // driven loop side, mm
    expect(q[2]).toBeCloseTo(-side / 2, 6);
    const syn: Design = { ...qd, wires: [{ a: [0, 0, 0], b: [0.01, 0.02, 0.03], r: 1e-3 }], feed: { wire: 0, at: "end" } };
    expect(feedPoint(syn)).toEqual([10, 20, 30]);
  });
  it("exits: a box round the dipole centre has one exit per arm, pointing outwards", () => {
    const d = build("dipole"), b = grow({ lo: [0, 0, 0], hi: [0, 0, 0] }, 40);
    const ex = exits(d, b);
    expect(ex.length).toBe(2);
    ex.forEach((x) => { expect(Math.abs(Math.abs(x.at[1]) - 40)).toBeLessThan(1e-6); expect(Math.sign(x.dir[1])).toBe(Math.sign(x.at[1])); expect(x.d).toBeCloseTo(2, 6); });
  });
  it("exits: a wire passing through a box gives two exits", () => {
    const d = build("yagi"), boom = d.wires.find((w) => w.drawOnly)!;
    const c = [(boom.a[0] + boom.b[0]) * 500, (boom.a[1] + boom.b[1]) * 500, (boom.a[2] + boom.b[2]) * 500] as [number, number, number];
    const ex = exits(d, { lo: [c[0] - 20, c[1] - 20, c[2] - 20], hi: [c[0] + 20, c[1] + 20, c[2] + 20] }).filter((x) => x.d > 20);
    expect(ex.length).toBe(2);
  });
  it("exits: surface edge cases on a synthetic design", () => {
    const base = build("dipole"), box = { lo: [-10, -10, -10], hi: [10, 10, 10] } as Box3;
    const mk = (pts: [number, number, number][]): Design => ({ ...base, feed: undefined, wires: pts.slice(1).map((p, i) => ({ a: pts[i].map((v) => v / 1000) as [number, number, number], b: p.map((v) => v / 1000) as [number, number, number], r: 1e-3 })) });
    // endpoint exactly on the surface, wire coming from outside: no crossing into the box interior beyond a touch
    const touch = exits(mk([[-30, 0, 0], [-10, 0, 0]]), box);
    expect(touch.length).toBe(1); expect(touch[0].at[0]).toBeCloseTo(-10, 6); expect(touch[0].dir[0]).toBeCloseTo(-1, 6);
    // wire ending on the surface from inside: one exit, outwards
    const inner = exits(mk([[0, 0, 0], [10, 0, 0]]), box);
    expect(inner.length).toBe(1); expect(inner[0].dir[0]).toBeCloseTo(1, 6);
    // segment lying in a face plane does not cross it
    const inPlane = exits(mk([[10, -5, 0], [10, 5, 0]]), box);
    expect(inPlane.length).toBe(0);
    // polyline with a shared vertex on the surface: one exit, not two
    const poly = exits(mk([[0, 0, 0], [10, 0, 0], [30, 0, 0]]), box);
    expect(poly.length).toBe(1); expect(poly[0].at[0]).toBeCloseTo(10, 6);
  });
  it("fits", () => {
    expect(boxFits({ lo: [0, 0, 0], hi: [162, 50, 50] }, 2)).toBe(true);    // 162 + 2·(2 + 7) = 180
    expect(boxFits({ lo: [0, 0, 0], hi: [163, 50, 50] }, 2)).toBe(false);
    expect(domeFits(80, 500, 2)).toBe(true);
    expect(domeFits(84, 100, 2)).toBe(false);
    expect(domeFits(30, 600, 2)).toBe(false);
  });
});
