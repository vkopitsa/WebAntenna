import { describe, expect, it } from "vitest";
import { ANTENNA_BY_ID } from "./antennas";
import { buildMesh, currentElements, gainFn, segCurrents, solve } from "./mom";
import { wavelength } from "./rf";

const solved = (id: string, extra = {}) => {
  const def = ANTENNA_BY_ID[id];
  const d = def.build({ ...def.defaults, ...extra });
  const m = buildMesh(d, wavelength(d.f), 60, 450)!;
  return { d, s: solve(m, d.f)! };
};

describe("MoM currents", () => {
  it("segment currents of a centre-fed dipole: 1/Z at the feed, symmetric arms, small at the ends", () => {
    // the dipole is a short feed-gap wire (2 segments, wire 0) and two equal arms running outward from it
    const { s } = solved("dipole");
    const { ir, ii } = segCurrents(s);
    const n = s.mesh.segs.length, arm = (n - 2) / 2;
    const mag = Array.from(ir, (r, i) => Math.hypot(r, ii[i]));
    const iin = 1 / Math.hypot(s.z[0], s.z[1]);
    expect(mag[0]).toBeCloseTo(iin, 3);
    expect(mag[1]).toBeCloseTo(iin, 3);
    for (let i = 0; i < arm; i++) expect(mag[2 + i]).toBeCloseTo(mag[2 + arm + i], 6);
    expect(mag[2 + arm - 1]).toBeLessThan(0.1 * iin);
    for (let i = 1; i < arm; i++) expect(mag[2 + i]).toBeLessThanOrEqual(mag[1 + i] + 1e-12);
  });
  it("currentElements: two per unknown, and gainFn still gives the dipole 2.15 dBi", () => {
    const { s } = solved("dipole");
    expect(currentElements(s).length).toBe(2 * s.mesh.unknowns.length);
    expect(gainFn(s)(Math.PI / 2, 0)).toBeCloseTo(2.15, 0);
  });
});
