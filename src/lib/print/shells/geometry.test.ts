import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "../../antennas";
import type { Design, Params } from "../../types";
import { boxFits, domeFits, envelope, exits, feedPoint, grow, size, styleOf } from "./geometry";

const build = (id: string, extra: Params = {}): Design => { const def = ANTENNA_BY_ID[id]; return def.build({ ...def.defaults, ...extra }); };

describe("shell geometry", () => {
  it("style: FPV at and above 2 GHz, outdoor below", () => {
    expect(styleOf(build("helix"))).toBe("outdoor");                                    // GPS
    expect(styleOf(build("helix", { bands: "5725e6-5875e6", d: 1e-3 }))).toBe("fpv");
    expect(styleOf(build("biquad"))).toBe("fpv");                                       // 2.4 GHz
  });
  it("envelope of a PCB antenna is its board", () => {
    const d = build("ifa"), e = envelope(d), b = d.pcb!.board;
    expect(e.lo[0]).toBeCloseTo(b.x0 * 1000, 6); expect(e.hi[1]).toBeCloseTo(b.y1 * 1000, 6);
    expect(e.lo[2]).toBeCloseTo(0, 6); expect(e.hi[2]).toBeCloseTo(d.pcb!.h * 1000, 6);
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
  it("fits", () => {
    expect(boxFits({ lo: [0, 0, 0], hi: [162, 50, 50] }, 2)).toBe(true);    // 162 + 2·(2 + 7) = 180
    expect(boxFits({ lo: [0, 0, 0], hi: [163, 50, 50] }, 2)).toBe(false);
    expect(domeFits(80, 500, 2)).toBe(true);
    expect(domeFits(84, 100, 2)).toBe(false);
    expect(domeFits(30, 600, 2)).toBe(false);
  });
});
