import { describe, it, expect } from "vitest";
import { trig, project, unproject, snapRot, isSnap, quarterOf, normRot } from "../public/js/turn.js";

const C0 = 100;

describe("turning the town", () => {
  it("rot 0 is the classic view", () => {
    const { cs, sn } = trig(0);
    for (const [u, v] of [[0, 0], [100, 100], [37.5, 81], [199, 3]]) {
      const [x, y] = project(u, v, cs, sn, C0);
      expect(x).toBeCloseTo((u - v) * 32, 6);
      expect(y).toBeCloseTo((u + v) * 16, 6);
    }
  });
  it("project and unproject are inverses at any angle", () => {
    for (const rot of [0, 0.3, Math.PI / 2, 2.5, -1.2, 5]) {
      const { cs, sn } = trig(rot);
      const [x, y] = project(81.5, 120.25, cs, sn, C0);
      const [u, v] = unproject(x, y, cs, sn, C0);
      expect(u).toBeCloseTo(81.5, 6);
      expect(v).toBeCloseTo(120.25, 6);
    }
  });
  it("a 90 degree turn to the right moves the top corner (0, 0) to where the right corner (200, 0) was", () => {
    const a = trig(0), b = trig(Math.PI / 2);
    const [x0, y0] = project(200, 0, a.cs, a.sn, C0), [x1, y1] = project(0, 0, b.cs, b.sn, C0);
    expect(x1).toBeCloseTo(x0, 6);
    expect(y1).toBeCloseTo(y0, 6);
  });
  it("snaps, quarters and angle wrap", () => {
    expect(snapRot(1.4)).toBeCloseTo(Math.PI / 2, 9);
    expect(isSnap(Math.PI)).toBe(true);
    expect(isSnap(1.0)).toBe(false);
    expect([0, Math.PI / 2, Math.PI, -Math.PI / 2, 2 * Math.PI].map(quarterOf)).toEqual([0, 1, 2, 3, 0]);
    expect(normRot(-Math.PI / 2)).toBeCloseTo(1.5 * Math.PI, 9);
  });
});
