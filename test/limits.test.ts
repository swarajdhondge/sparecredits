import { describe, it, expect } from "vitest";
import {
  LIMITS, commandQuota, dailyCaps, slotsLeft, decayState, weekStart, nextMonday, shouldHide, FULL_MESSAGE, dayKey, isFreeLimitError,
} from "../src/limits";
import { applyLine, applyCommand, type Cell, type Store } from "../src/engine";
import { parseCommand, BANNED_PATTERNS } from "../public/kit.js";
import type { Cmd } from "../public/kit.js";

const MIN = 60_000;

describe("command quota", () => {
  const t0 = 1_000_000;
  it("allows 12 per network per 10 minutes, then says how long to wait, then resets", () => {
    let r = commandQuota(0, null, t0, 12);
    expect(r.allowed).toBe(12);
    r = commandQuota(12, r.net, t0 + 4 * MIN, 3);
    expect(r.allowed).toBe(0);
    expect(r.code).toBe("wait");
    expect(r.reason).toBe("Wait: 12 commands per 10 minutes per person. Try again in 360 seconds.");
    r = commandQuota(12, r.net, t0 + 10 * MIN, 3);
    expect(r.allowed).toBe(3);
    expect(r.net).toEqual({ start: t0 + 10 * MIN, n: 3 });
  });
  it("allows part of a line", () => {
    expect(commandQuota(0, { start: t0, n: 9 }, t0 + 1000, 5).allowed).toBe(3);
  });
  it("stops at 60 per visit", () => {
    const r = commandQuota(58, null, 5 * MIN, 5);
    expect(r.allowed).toBe(2);
    expect(r.code).toBe("rate_limit");
    expect(r.reason).toMatch(/60 commands/);
  });
});

describe("daily caps", () => {
  it("per IP: 10 visits a day", () => {
    expect(dailyCaps(59, 0, 0)).toBeNull();
    expect(dailyCaps(60, 0, 0)).toMatch(/60 visits/);
  });
  it("global visits and commands show the full message", () => {
    expect(dailyCaps(0, 4999, 0)).toBeNull();
    expect(dailyCaps(0, 5000, 0)).toBe(FULL_MESSAGE);
    expect(dailyCaps(0, 0, 25000)).toBe(FULL_MESSAGE);
  });
  it("slots left is whichever runs out first", () => {
    expect(slotsLeft(0, 0)).toBe(5000);
    expect(slotsLeft(4000, 0)).toBe(1000);
    expect(slotsLeft(0, 24990)).toBe(10);
    expect(slotsLeft(5000, 0)).toBe(0);
  });
  it("day key is UTC", () => {
    expect(dayKey(Date.UTC(2026, 10, 9, 23, 59))).toBe("2026-11-09");
    expect(dayKey(Date.UTC(2026, 10, 10, 0, 0))).toBe("2026-11-10");
  });
  it("sees free-plan errors", () => {
    expect(isFreeLimitError(new Error("Exceeded allowed rows read in Durable Objects free tier"))).toBe(true);
    expect(isFreeLimitError(new Error("Your account has exceeded D1's free tier daily row read limit"))).toBe(true);
    // a code bug must not read as "the city is full"
    for (const bug of ["syntax error", 'near "LIMIT": syntax error', "Cannot read properties of undefined (reading 'storage')", "too many SQL variables"]) {
      expect(isFreeLimitError(new Error(bug))).toBe(false);
    }
  });
});

describe("weeks, decay and auto-hide", () => {
  it("weeks run Monday 00:00 UTC to Monday 00:00 UTC", () => {
    const mon = Date.UTC(2026, 10, 16);
    expect(weekStart(Date.UTC(2026, 10, 14, 15))).toBe(mon - 7 * 86_400_000);
    expect(weekStart(mon)).toBe(mon);
    expect(nextMonday(Date.UTC(2026, 10, 14, 15))).toBe(mon);
    expect(nextMonday(mon)).toBe(mon + 7 * 86_400_000);
  });
  it("decay: fresh, then faded after 7 days, never removed", () => {
    const day = 86_400_000;
    expect(decayState(0, 6 * day)).toBe("fresh");
    expect(decayState(0, 7 * day)).toBe("faded");
    expect(decayState(0, 13 * day)).toBe("faded");
    expect(decayState(0, 300 * day)).toBe("faded");
  });
  it("hides when downvotes minus likes reach 5, or 3 reports", () => {
    expect(shouldHide(0, 4, 0)).toBe(false);
    expect(shouldHide(0, 5, 0)).toBe(true);
    expect(shouldHide(2, 6, 0)).toBe(false);
    expect(shouldHide(2, 7, 0)).toBe(true);
    expect(shouldHide(0, 0, 2)).toBe(false);
    expect(shouldHide(0, 0, 3)).toBe(true);
  });
});

// ----- engine on an in-memory store -----
class MemStore implements Store {
  cells = new Map<string, Cell>();
  votesCleared = 0;
  get(x: number, y: number) { return this.cells.get(`${x},${y}`) ?? null; }
  put(c: Cell, reset?: boolean) { this.cells.set(`${c.x},${c.y}`, c); if (reset) this.votesCleared++; }
  region(x0: number, y0: number, x1: number, y1: number) {
    return [...this.cells.values()].filter((c) => c.x >= x0 && c.x <= x1 && c.y >= y0 && c.y <= y1 && !c.hidden);
  }
}
const ctx = (team: string, now: number) => ({ team, pub: "pub" + team, now });
const cmd = (s: string) => { const r = parseCommand(s); if (!r.ok) throw new Error(s); return r.cmd as Cmd; };

describe("engine", () => {
  it("another team replaces a fresh build, sign and claim at once", () => {
    const s = new MemStore();
    const t = 10_000_000;
    expect(applyCommand(s, ctx("claude", t), cmd("B.5.5.cottage.3.1.1"), "B").ok).toBe(true);
    expect(applyCommand(s, ctx("claude", t), cmd("S.5.5.t2.sun"), "S").ok).toBe(true);
    expect(applyCommand(s, ctx("claude", t), cmd("C.7.7"), "C").ok).toBe(true);
    expect(applyCommand(s, ctx("gemini", t + 1000), cmd("B.5.5.tower.3.1.1"), "B").ok).toBe(true);
    expect(applyCommand(s, ctx("gemini", t + 1000), cmd("S.5.5.t2.moon"), "S").ok).toBe(true);
    expect(applyCommand(s, ctx("gemini", t + 1000), cmd("C.7.7"), "C").ok).toBe(true);
    expect(s.get(5, 5)!.style).toBe("tower");
    expect(s.get(5, 5)!.team).toBe("gemini");
    expect(s.get(5, 5)!.sign).toEqual({ tpl: 2, words: ["moon"] });
    expect(s.get(7, 7)!.team).toBe("gemini");
  });
  it("extend needs a building; one part per side; max 4", () => {
    const s = new MemStore();
    const t = 5_000_000;
    expect(applyCommand(s, ctx("claude", t), cmd("E.1.1.wing.n.3"), "E").code).toBe("no_building");
    applyCommand(s, ctx("claude", t), cmd("B.1.1.house.3.1.1"), "B");
    applyCommand(s, ctx("claude", t), cmd("E.1.1.wing.n.3"), "E");
    applyCommand(s, ctx("claude", t), cmd("E.1.1.tree.n.2"), "E");
    expect(s.get(1, 1)!.parts).toEqual([{ part: "tree", side: "n", h: 2 }]);
    for (const side of ["e", "s", "w"]) expect(applyCommand(s, ctx("claude", t), cmd(`E.1.1.fence.${side}.2`), "E").ok).toBe(true);
    expect(s.get(1, 1)!.parts.length).toBe(4);
  });
  it("signs go on empty cells", () => {
    const s = new MemStore();
    expect(applyCommand(s, ctx("claude", 5e6), cmd("S.9.9.t2.sun"), "S").ok).toBe(true);
    expect(s.get(9, 9)!.sign).toEqual({ tpl: 2, words: ["sun"] });
  });
  it("old buildings stay; hidden buildings count as empty", () => {
    const s = new MemStore();
    const t = 5_000_000;
    applyCommand(s, ctx("claude", t), cmd("B.2.2.house.3.1.1"), "B");
    const later = t + 30 * 86_400_000;
    expect(applyCommand(s, ctx("gemini", later), cmd("E.2.2.wing.n.3"), "E").ok).toBe(true);
    const c = s.get(2, 2)!;
    s.put({ ...c, lastLike: later, hidden: true });
    expect(applyCommand(s, ctx("gemini", later), cmd("B.2.2.tower.3.1.1"), "B").ok).toBe(true);
  });
  it("refuses a build or claim that completes a banned shape", () => {
    const s = new MemStore();
    const t = 5_000_000;
    const cells: [number, number][] = [];
    BANNED_PATTERNS[0].forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "X") cells.push([30 + c, 30 + r]); }));
    const last = cells.pop()!;
    for (const [x, y] of cells) expect(applyCommand(s, ctx("claude", t), cmd(`C.${x}.${y}`), "C").ok).toBe(true);
    const r = applyCommand(s, ctx("claude", t), cmd(`B.${last[0]}.${last[1]}.house.3.1.1`), "B");
    expect(r.ok).toBe(false);
    expect(r.code).toBe("banned_layout");
    expect(s.get(last[0], last[1])).toBeNull();
    expect(applyCommand(s, ctx("claude", t), cmd(`C.${last[0]}.${last[1]}`), "C").code).toBe("banned_layout");
  });
  it("applyLine skips bad commands, applies good ones, and honours the quota", () => {
    const s = new MemStore();
    const r = applyLine(s, ctx("claude", 5e6), "cm1;B.1.1.house.3.1.1;Z.1;C.2.2;C.3.3;C.4.4", 3, "Rate limit.");
    expect(r.applied).toBe(2);
    expect(r.results.map((x) => x.code ?? "ok")).toEqual(["ok", "unknown_verb", "ok", "rate_limit", "rate_limit"]);
    expect(s.get(4, 4)).toBeNull();
    expect(applyLine(s, ctx("claude", 5e6), "nope", 12).code).toBe("bad_prefix");
    // a first T does not use quota: T + 3 claims with allowed 3 applies all 3
    const t = applyLine(s, ctx("claude", 9e6), "cm1;T.claude;C.5.5;C.6.6;C.7.7", 3, "Rate limit.");
    expect(t.results.filter((x) => x.code === "rate_limit")).toHaveLength(0);
  });
});
