/** Fixed geometry rules for printed parts, in mm. There are no printer settings: these suit any common FDM printer. */
export const CLEAR = 0.3;          // added to every wire, tube and boom diameter
export const WALL = 2;             // minimum wall
export const INSULATE = 2;         // plastic between conductors that must not touch
export const MAX_SIZE = 180;       // largest extent printed in one piece
export const M3_HOLE = 3.4;
export const M3_NUT = 6.6;         // M3 nut across corners (6.35) + clearance, hexagonal pocket
export const M3_NUT_DEPTH = 2.8;
export const ZIP_W = 5.2;          // zip-tie slot, fits ties up to 4.8 × 1.3 mm
export const ZIP_T = 2.2;
export const FLANGE_PITCH = 18.3;  // screw spacing of SO-239 and N 4-hole panel jacks
export const FLANGE_BODY = 16;     // hole for the jack body
export const SEG_H = 170;          // tallest stacked piece; its spigot (≤ 8 mm) keeps it within MAX_SIZE
export const mm = (m: number) => m * 1000;
