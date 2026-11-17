import { describe, it, expect } from "vitest";
import { moveLine, parseLine, openArea, TAG_WORDS } from "../public/kit.js";

const area = openArea(0); // 80..119
const cells = (line: string) => {
  const r = parseLine(line);
  if (!r.ok) throw new Error(r.message);
  return r.items.map((i) => (i.ok && "x" in i.cmd ? `${i.cmd.v}.${i.cmd.x}.${i.cmd.y}` : i.ok ? i.cmd.v : "skipped"));
};

describe("moveLine: the Play plot", () => {
  it("moves every cell command by the offset from the first cell to the plot, and keeps T, J and the cm1 format", () => {
    const line = "cm1;T.gemini;J.harbor.garden;B.100.100.bakery.3.4.217;E.100.100.chimney.n.4;S.101.100.t2.sun.-.-;C.102.101;K.100.100.cafe.home";
    const r = moveLine(line, { x: 90, y: 95 }, area);
    expect(r).toEqual({ ok: true, first: { x: 100, y: 100 }, line: "cm1;T.gemini;J.harbor.garden;B.90.95.bakery.3.4.217;E.90.95.chimney.n.4;S.91.95.t2.sun.-.-;C.92.96;K.90.95.cafe.home" });
    expect(cells((r as { line: string }).line)).toEqual(["T", "J", "B.90.95", "E.90.95", "S.91.95", "C.92.96", "K.90.95"]);
  });
  it("moves a free model F line, with its shapes untouched, and A on the same cell", () => {
    const f = "F.100.100.t-6-6-0-4-4-8-eed_o-2-2-7-12-12-8-d22";
    const r = moveLine(`cm1;${f};A.100.100.b-0-0-0-2-2-2-f80;K.100.100.robot`, { x: 85, y: 110 }, area);
    expect(r.ok && r.line).toBe("cm1;F.85.110.t-6-6-0-4-4-8-eed_o-2-2-7-12-12-8-d22;A.85.110.b-0-0-0-2-2-2-f80;K.85.110.robot");
  });
  it("moves a picture G line, also its add line, and a K photo tag (L5)", () => {
    const g = "G.100.100.s.4.4.4xf00_4x-_4xfff_4x00f";
    const r = moveLine(`cm1;${g};G.100.100.s.4.4.add.fff;K.100.100.photo`, { x: 81, y: 82 }, area);
    expect(r.ok && r.line).toBe("cm1;G.81.82.s.4.4.4xf00_4x-_4xfff_4x00f;G.81.82.s.4.4.add.fff;K.81.82.photo");
    expect(TAG_WORDS).toContain("photo");
  });
  it("normalises leading zeros and keeps a line with a skipped command", () => {
    const r = moveLine("cm1;B.001.002.tower.9.15.999;Q.1.1;C.5.5", { x: 90, y: 90 }, { x0: 0, y0: 0, x1: 199, y1: 199 });
    expect(r.ok && r.line).toBe("cm1;B.90.90.tower.9.15.999;Q.1.1;C.94.93");
  });
  it("does not move a line that already starts on the plot, nor a line with no cell command", () => {
    const line = "cm1;T.claude;B.100.100.bakery.3.4.217";
    expect(moveLine(line, { x: 100, y: 100 }, area)).toEqual({ ok: true, line, first: { x: 100, y: 100 } });
    expect(moveLine("cm1;T.claude;J.harbor.garden", { x: 90, y: 90 }, area)).toEqual({ ok: true, line: "cm1;T.claude;J.harbor.garden", first: null });
  });
  it("moves a plan line too (P has no cell, its B and E cells move)", () => {
    const r = moveLine("cm1;P.sunrise.harbor;B.100.100.cottage.3.4.1;E.100.100.chimney.n.2", { x: 90, y: 90 }, area);
    expect(r.ok && r.line).toBe("cm1;P.sunrise.harbor;B.90.90.cottage.3.4.1;E.90.90.chimney.n.2");
  });
  it("refuses a move when any cell would land outside the open area", () => {
    const line = "cm1;B.100.100.bakery.3.4.217;C.110.100";
    expect(moveLine(line, { x: 115, y: 100 }, area)).toMatchObject({ ok: false, code: "outside" }); // the C cell goes to 125
    expect(moveLine(line, { x: 80, y: 80 }, area).ok).toBe(true); // 110 -> 90 stays inside
    expect(moveLine("cm1;B.100.100.bakery.3.4.217", { x: 120, y: 100 }, area)).toMatchObject({ ok: false, code: "outside" });
    expect(moveLine("cm1;B.100.100.bakery.3.4.217;C.0.0", { x: 90, y: 90 }, { x0: 0, y0: 0, x1: 199, y1: 199 })).toMatchObject({ ok: false, code: "outside" }); // C.0.0 -> -10
  });
  it("passes line errors on", () => {
    expect(moveLine("hello", { x: 1, y: 1 }, area)).toMatchObject({ ok: false, code: "bad_prefix" });
  });
});
