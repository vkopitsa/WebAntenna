// The Preview's orthographic camera as a world basis, and the field plane that fills its view box.
import type { Vec3 } from "../lib/types";
import type { FieldPlane } from "../lib/nearfield";

/** Rows of Preview's camera(): screen x = q·right, screen y (down) = q·down, depth = q·depth. */
export function cameraBasis(yawDeg: number, pitchDeg: number): { right: Vec3; down: Vec3; depth: Vec3 } {
  const y = (yawDeg * Math.PI) / 180, p = (pitchDeg * Math.PI) / 180;
  const cy = Math.cos(y), sy = Math.sin(y), cp = Math.cos(p), sp = Math.sin(p);
  return { right: [sy, -cy, 0], down: [-sp * cy, -sp * sy, -cp], depth: [cp * cy, cp * sy, -sp] };
}

/** The plane through ref's depth covering the SVG box: SVG (x, y) = (ox + sx·k, oy + sy·k), sx/sy in metres. */
export function screenPlane(yawDeg: number, pitchDeg: number, view: { ox: number; oy: number; k: number; W: number; H: number }, ref: Vec3, nx: number): FieldPlane {
  const { right, down, depth } = cameraBasis(yawDeg, pitchDeg);
  const { ox, oy, k, W, H } = view;
  const sx = -ox / k, sy = -oy / k;
  const dz = ref[0] * depth[0] + ref[1] * depth[1] + ref[2] * depth[2];
  const origin = [0, 1, 2].map((i) => right[i] * sx + down[i] * sy + depth[i] * dz) as Vec3;
  return { origin, u: right, v: down, w: W / k, h: H / k, nx, ny: Math.round((nx * H) / W), ref };
}
