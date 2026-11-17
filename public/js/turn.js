// The turning town: pure maths of the view angle. rot = 0 is the classic view (the grid turned 45 degrees: +x runs down to the right,
// +y down to the left). Turning the view adds to rot (clockwise on screen). Cell positions are in grid corner coordinates (a cell
// x, y spans [x, x + 1)), turned about the grid centre c0; a world pixel is the screen pixel at zoom 1 with the camera at the origin.
export const K = 32 * Math.SQRT2; // world px of one cell along a turned axis (a cell is 64 x 32 px at the classic angle)
const QUARTER = Math.PI / 2;

/** Cosine and sine of the view phase phi = 45 degrees + rot. */
export function trig(rot) { const phi = Math.PI / 4 + rot; return { cs: Math.cos(phi), sn: Math.sin(phi) }; }
/** Grid corner (u, v) -> world px. At rot 0 this is ((u - v) * 32, (u + v) * 16). */
export function project(u, v, cs, sn, c0) {
  const U = u - c0, V = v - c0;
  return [(U * cs - V * sn) * K, (U * sn + V * cs) * K / 2 + 32 * c0];
}
/** World px -> grid corner (u, v), the inverse of project. */
export function unproject(wx, wy, cs, sn, c0) {
  const rx = wx / K, ry = (wy - 32 * c0) * 2 / K;
  return [rx * cs + ry * sn + c0, -rx * sn + ry * cs + c0];
}
/** The angle of the nearest 90 degree snap. */
export const snapRot = (rot) => Math.round(rot / QUARTER) * QUARTER;
/** True when rot is (almost) on a 90 degree snap: the town can be drawn from baked layers. */
export const isSnap = (rot) => Math.abs(rot - snapRot(rot)) < 0.002;
/** Which quarter the view phase is in (0 to 3): the side of each floor axis the viewer stands on. 0 is the classic view. */
export function quarterOf(rot) {
  const t = (Math.PI / 4 + rot) / QUARTER;
  return ((Math.floor(t) % 4) + 4) % 4;
}
/** rot as 0 to 2 pi. */
export const normRot = (rot) => ((rot % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
