import { describe, it, expect } from "vitest";
import { parseLine, parseCommand, planName, PLAN_MAX_CMDS, openArea, BANNED_PATTERNS } from "../public/kit.js";
import { planTargets, planDone, planState, planCaps } from "../src/plans";
import { LIMITS } from "../src/limits";
import { makeCity, FakeSocket } from "./support/harness";

const NOW = Date.UTC(2026, 10, 9, 12, 0);
const DAY = 86_400_000;

describe("plan line parse", () => {
  it("P must be first (after an optional T) and makes a plan line", () => {
    const a = parseLine("cm1;P.sunrise.harbor;B.100.100.ship.3.1.1;E.100.100.flag.n.2");
    expect(a.ok && a.plan).toBe(true);
    const b = parseLine("cm1;T.claude;P.sunrise.harbor;B.100.100.ship.3.1.1");
    expect(b.ok && b.plan).toBe(true);
    const c = parseLine("cm1;B.100.100.ship.3.1.1;P.sunrise.harbor");
    expect(c.ok && c.plan).toBe(false);
    expect(c.ok && c.items[1]).toMatchObject({ ok: false, code: "plan_not_first" });
    const d = parseLine("cm1;T.claude;B.100.100.ship.3.1.1;P.sunrise.harbor");
    expect(d.ok && d.items[2]).toMatchObject({ ok: false, code: "plan_not_first" });
  });
  it("names are two list words, title-cased", () => {
    const r = parseCommand("P.sunrise.harbor");
    expect(r).toMatchObject({ ok: true, cmd: { v: "P", name: "Sunrise Harbor" } });
    expect(planName(["moon", "garden"])).toBe("Moon Garden");
    expect(parseCommand("P.crimson.harbor")).toMatchObject({ ok: false, code: "unknown_word" }); // crimson is not in the list
    expect(parseCommand("P.sunrise")).toMatchObject({ ok: false, code: "wrong_arity" });
    expect(parseCommand("P.sunrise.harbor.x")).toMatchObject({ ok: false, code: "wrong_arity" });
    expect(parseCommand("P.skating.penguin")).toMatchObject({ ok: false, code: "blocked_combo" });
  });
  it("holds up to 40 commands (T not counted); the rest are skipped", () => {
    const cmds = Array.from({ length: 45 }, (_, i) => `B.${80 + (i % 40)}.${80 + Math.floor(i / 40)}.house.3.1.1`);
    const r = parseLine(`cm1;T.gemini;P.moon.garden;${cmds.join(";")}`);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.filter((i) => i.ok).length).toBe(1 + PLAN_MAX_CMDS); // T + P + 39 B
    expect(r.items[r.items.length - 1]).toMatchObject({ ok: false, code: "too_many" });
    expect(r.items.length).toBe(2 + 45);
  });
  it("a plan line takes only B and E, and needs one B", () => {
    const r = parseLine("cm1;P.moon.garden;B.100.100.house.3.1.1;S.101.100.t2.sun;C.102.100");
    expect(r.ok && r.items.map((i) => (i.ok ? "ok" : i.code))).toEqual(["ok", "ok", "plan_only_be", "plan_only_be"]);
    expect(parseLine("cm1;P.moon.garden;E.100.100.flag.n.2")).toMatchObject({ ok: false, code: "empty_plan" });
  });
  it("a normal line is still limited to 12 commands", () => {
    const r = parseLine("cm1;" + Array.from({ length: 14 }, (_, i) => `C.${i}.1`).join(";"));
    expect(r.ok && r.plan).toBe(false);
    expect(r.ok && r.items.filter((i) => i.ok).length).toBe(12);
  });
});

describe("plan targets and progress", () => {
  const area = openArea(0);
  const parse = (l: string) => { const r = parseLine(l); if (!r.ok) throw new Error(r.message); return r.items; };

  it("builds targets from B and E, skips cells outside the edge", () => {
    const { targets, results } = planTargets(parse("cm1;P.moon.garden;B.100.100.ship.3.1.1;E.100.100.flag.n.2;E.100.100.tree.n.2;B.10.10.house.1.1.1;E.101.100.flag.n.2;B.101.100.dock.2.2.2"), area);
    expect(targets.length).toBe(2);
    expect(targets[0]).toMatchObject({ x: 100, y: 100, style: "ship", parts: [{ part: "tree", side: "n", h: 2 }] }); // same side: later E wins
    expect(results.map((r) => r.code ?? "ok")).toEqual(["ok", "ok", "ok", "ok", "outside_edge", "no_target", "ok"]);
  });

  it("progress counts target cells whose building has the same style; height, palette and seed may differ", () => {
    const targets = [
      { x: 1, y: 1, style: "ship", h: 3, pal: 1, seed: 1, parts: [] },
      { x: 2, y: 1, style: "dock", h: 3, pal: 1, seed: 1, parts: [] },
      { x: 3, y: 1, style: "tower", h: 3, pal: 1, seed: 1, parts: [] },
    ];
    const world: Record<string, string> = { "1,1": "ship", "2,1": "house" };
    expect(planDone(targets, (x, y) => world[`${x},${y}`] ?? null)).toBe(1);
    world["2,1"] = "dock"; world["3,1"] = "tower";
    expect(planDone(targets, (x, y) => world[`${x},${y}`] ?? null)).toBe(3);
  });

  it("a plan stays active when built and ends after 7 days without a newly matching cell", () => {
    expect(planState("active", NOW, NOW + DAY)).toBe("active");
    expect(planState("active", NOW, NOW + 7 * DAY - 1)).toBe("active");
    expect(planState("active", NOW, NOW + 7 * DAY)).toBe("expired");
    expect(planState("completed", NOW, NOW + 30 * DAY)).toBe("completed"); // old history rows keep their status
  });

  it("limits: 5 new plans per network per day, 200 active plans", () => {
    expect(planCaps(4, 10)).toBeNull();
    expect(planCaps(5, 10)).toMatch(/5 new plans/);
    expect(planCaps(0, LIMITS.maxActivePlans)).toMatch(/200 active plans/);
  });
});

function approved(city: ReturnType<typeof makeCity>["city"], team: string) {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, ?, ?, ?, 'approved')", id, `pub-${id.slice(6, 12)}`, team, NOW, NOW);
  return city.visitRow(id)!;
}
async function line(city: ReturnType<typeof makeCity>["city"], team: string, l: string, now = NOW) {
  return (await city.runLine(approved(city, team), l, now).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

describe("plans in the city", () => {
  it("start a plan from one chat, help it from another, watch progress and the ghost", async () => {
    const { city, sockets } = makeCity();
    const ws = new FakeSocket();
    sockets.push(ws);
    city.subscribe(ws as never, { c: [[1, 1]], ov: 0 });

    const r = await line(city, "claude", "cm1;T.claude;P.sunrise.harbor;B.100.100.ship.3.1.1;B.101.100.dock.3.1.1;E.101.100.flag.n.3;B.102.100.fountain.3.1.1");
    expect(r.ok).toBe(true);
    expect(r.plan).toMatchObject({ name: "Sunrise Harbor", total: 3, done: 0 });
    const code = r.plan.code as string;
    expect(code).toMatch(/^[A-Za-z0-9_-]{6}$/);
    expect(ws.messages().some((m) => m.t === "g")).toBe(true); // the ghost reached the viewer

    let d = (await city.planDetail(code).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.missing.length).toBe(3);
    expect(d.missing_kit).toContain("E.101.100.flag.n.3");

    // a second chat (another team) builds two of the cells: normal B commands
    const h = await line(city, "gemini", "cm1;B.100.100.ship.9.5.5;B.101.100.dock.2.2.2", NOW + 1000);
    expect(h.applied).toBe(2);
    d = (await city.planDetail(code).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.done).toBe(2);
    expect(d.help).toEqual({ gemini: 2 });
    expect(d.missing.map((m: { x: number }) => m.x)).toEqual([102]);
    expect(ws.messages().filter((m) => m.t === "plan").pop()).toMatchObject({ p: code, done: 2, total: 3 });

    // a different style on a target cell does not count
    await line(city, "gemini", "cm1;B.102.100.house.3.1.1", NOW + 2000);
    d = (await city.planDetail(code).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.done).toBe(2);

    // the last cell completes it; the ghost is removed from the layer
    await line(city, "chatgpt", "cm1;B.102.100.fountain.1.1.1", NOW + 12 * 60_000);
    d = (await city.planDetail(code).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d.status).toBe("active"); // a built plan is defended art: it stays active
    expect(d.done).toBe(3);
    expect(d.missing_kit).toEqual([]);
    expect(d.help).toEqual({ gemini: 2, chatgpt: 1 });
    expect(ws.messages().some((m) => m.t === "gdel" && m.p === code)).toBe(false);

    // someone paints over a plan cell: it is missing again, with its kit line
    await line(city, "claude", "cm1;B.101.100.house.3.1.1", NOW + 13 * 60_000);
    d = (await city.planDetail(code).json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(d).toMatchObject({ status: "active", done: 2, total: 3 });
    expect(d.missing_kit).toEqual(["B.101.100.dock.3.1.1", "E.101.100.flag.n.3"]);
  });

  it("the chunk carries the ghosts of active plans only", async () => {
    const { city } = makeCity();
    const r = await line(city, "claude", "cm1;P.moon.garden;B.100.100.ship.3.1.1");
    const ws = new FakeSocket();
    city.subscribe(ws as never, { c: [[1, 1]], ov: 0 });
    const ghosts = ws.messages()[0].ghosts as { x: number; p: string; n: string }[];
    expect(ghosts).toEqual([expect.objectContaining({ x: 100, p: r.plan.code, n: "Moon Garden" })]);
  });

  it("plans may overlap each other and existing buildings", async () => {
    const { city } = makeCity();
    await line(city, "claude", "cm1;B.100.100.house.3.1.1");
    const a = await line(city, "claude", "cm1;P.moon.garden;B.100.100.ship.3.1.1;B.101.100.dock.3.1.1");
    const b = await line(city, "gemini", "cm1;P.star.harbor;B.100.100.ship.3.1.1;B.103.100.arch.3.1.1");
    expect(a.ok && b.ok).toBe(true);
    expect(a.plan.code).not.toBe(b.plan.code);
    await line(city, "chatgpt", "cm1;B.100.100.ship.3.1.1", NOW + 11 * 60_000); // helps both at once
    const da = (await city.planDetail(a.plan.code).json()) as { done: number };
    const db = (await city.planDetail(b.plan.code).json()) as { done: number };
    expect([da.done, db.done]).toEqual([1, 1]);
  });

  it("a plan ends after 7 days without progress and leaves the ghost layer", async () => {
    const { city, sockets } = makeCity();
    const ws = new FakeSocket();
    sockets.push(ws);
    const r = await line(city, "claude", "cm1;P.moon.garden;B.100.100.ship.3.1.1;B.101.100.dock.3.1.1");
    city.maybePurge(NOW + 6 * DAY);
    expect(((await city.planDetail(r.plan.code).json()) as { status: string }).status).toBe("active");
    city.lastPurge = 0;
    city.maybePurge(NOW + 7 * DAY + 1000);
    expect(((await city.planDetail(r.plan.code).json()) as { status: string }).status).toBe("expired");
    expect(ws.messages().some((m) => m.t === "gdel" && m.p === r.plan.code)).toBe(true);
    // history is kept for 14 days after it ended, then removed
    expect(city.sql.exec("SELECT COUNT(*) AS n FROM plans").toArray()[0].n).toBe(1);
    city.lastPurge = 0;
    city.maybePurge(NOW + 7 * DAY + 1000 + 15 * DAY);
    expect(city.sql.exec("SELECT COUNT(*) AS n FROM plans").toArray()[0].n).toBe(0);
  });

  it("refuses a plan that would make a banned shape, and cells outside the edge", async () => {
    const { city } = makeCity();
    const cells: string[] = [];
    BANNED_PATTERNS[0].forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "X") cells.push(`B.${90 + c}.${90 + r}.house.3.1.1`); }));
    const bad = await line(city, "claude", `cm1;P.moon.garden;${cells.join(";")}`);
    expect(bad).toMatchObject({ ok: false, code: "banned_layout" });
    const out = await line(city, "claude", "cm1;P.moon.garden;B.10.10.house.3.1.1");
    expect(out).toMatchObject({ ok: false, code: "empty_plan" });
    expect(out.results[1].code).toBe("outside_edge");
  });
});
