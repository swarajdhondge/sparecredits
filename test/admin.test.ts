import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { makeCity, FakeSocket } from "./support/harness";

const NOW = Date.UTC(2026, 10, 9, 12, 0);
const MIN = 60_000;
const KEY = "test-admin-key-0123456789-abcdef";

type City = ReturnType<typeof makeCity>["city"];
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function makeAdminCity(db = new DatabaseSync(":memory:")) { return makeCity(db, { ADMIN_KEY: KEY }); }

async function admin(city: City, method: string, path: string, body?: unknown, o: { key?: string | null; now?: number; ip?: string } = {}) {
  const headers: Record<string, string> = {};
  const key = o.key === undefined ? KEY : o.key;
  if (key !== null) headers.authorization = `Bearer ${key}`;
  if (o.ip) headers["cf-connecting-ip"] = o.ip;
  const res = await city.route(new Request(`https://x.test/v1/admin${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), o.now ?? NOW);
  return { status: res.status, headers: res.headers, body: (await res.json()) as Json };
}

function visit(city: City, team = "claude") {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  const pub = `pub-${id.slice(6, 12)}`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, ?, ?, ?, 'approved')", id, pub, team, NOW, NOW);
  return { v: city.visitRow(id)!, pub };
}
async function build(city: City, line: string, now: number, v = visit(city)) {
  const r = (await city.runLine(v.v, line, now).json()) as Json;
  expect(r.ok).toBe(true);
  return { pub: v.pub, r };
}
const count = (city: City, t: string) => Number(city.sql.exec(`SELECT COUNT(*) AS n FROM ${t}`).one().n);
const auditActions = (city: City) => city.sql.exec("SELECT action FROM audit ORDER BY id").toArray().map((r) => r.action);
const cellOf = async (city: City, x: number, y: number, now = NOW) => (await admin(city, "GET", `/cell?x=${x}&y=${y}`, undefined, { now })).body.cell;

describe("admin login", () => {
  it("answers 404 on every admin route when ADMIN_KEY is unset or too short", async () => {
    for (const env of [{}, { ADMIN_KEY: "short-key" }]) {
      const { city } = makeCity(undefined, env);
      for (const [m, p] of [["GET", "/cell?x=100&y=100"], ["GET", "/visit?pub=abcdefgh"], ["GET", "/audit"], ["POST", "/hide"], ["POST", "/restore"], ["POST", "/undo-visit"]]) {
        const r = await admin(city, m, p, m === "POST" ? {} : undefined);
        expect([p, r.status]).toEqual([p, 404]);
        expect(r.body).toEqual({ ok: false, code: "not_found", error: "Not found." });
      }
      expect(count(city, "audit")).toBe(0);
    }
  });

  it("wrong or missing key gives 401; the 11th wrong try gives 429, also with the right key; each failure is audited", async () => {
    const { city } = makeAdminCity();
    expect((await admin(city, "GET", "/audit", undefined, { key: null })).status).toBe(401);
    for (let i = 1; i < 10; i++) expect((await admin(city, "GET", "/audit", undefined, { key: `wrong-key-${i}` })).status).toBe(401);
    expect(count(city, "audit")).toBe(10);
    expect((await admin(city, "GET", "/audit", undefined, { key: "wrong-key-11" })).status).toBe(429);
    expect((await admin(city, "GET", "/audit")).status).toBe(429); // right key, same network
    expect((await admin(city, "GET", "/audit", undefined, { ip: "9.9.9.9" })).status).toBe(200); // another network
    expect((await admin(city, "GET", "/audit", undefined, { now: NOW + 86_400_000 })).status).toBe(200); // ends at 00:00 UTC
    expect(city.sql.exec("SELECT COUNT(*) AS n FROM audit WHERE action = 'login_failed'").one().n).toBe(10);
    expect(JSON.stringify(city.sql.exec("SELECT * FROM audit").toArray())).not.toContain("wrong-key");
  });

  it("sends no CORS headers, answers OPTIONS with 404, and never caches", async () => {
    const { city } = makeAdminCity();
    for (const r of [await admin(city, "GET", "/audit"), await admin(city, "GET", "/audit", undefined, { key: "nope" }), await admin(city, "GET", "/nothing")]) {
      expect(r.headers.get("access-control-allow-origin")).toBeNull();
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    const opt = await city.fetch(new Request("https://x.test/v1/admin/hide", { method: "OPTIONS" }));
    expect(opt.status).toBe(404);
    expect(opt.headers.get("access-control-allow-origin")).toBeNull();
    const pub = await city.fetch(new Request("https://x.test/v1/health"));
    expect(pub.headers.get("access-control-allow-origin")).toBe("*"); // public routes are unchanged
  });
});

describe("hide and restore", () => {
  it("hide then restore returns the cell exactly; nothing is deleted; each action has one audit row", async () => {
    const { city } = makeAdminCity();
    const { pub } = await build(city, "cm1;B.100.100.bakery.4.3.217;E.100.100.chimney.n.4", NOW);
    const before = await cellOf(city, 100, 100);
    expect(before).toMatchObject({ b: "bakery.4.3.217", e: "chimney.n.4", hidden: false, likes: 0 });
    const [cells, events] = [count(city, "cells"), count(city, "events")];
    expect((await admin(city, "POST", "/hide", { x: 100, y: 100 })).status).toBe(200);
    expect(await cellOf(city, 100, 100)).toMatchObject({ hidden: true, b: "bakery.4.3.217" }); // admin still sees it
    expect(city.sql.exec("SELECT gone FROM events WHERE pub = ?", pub).toArray().map((e) => e.gone)).toEqual([1, 1]);
    expect([count(city, "cells"), count(city, "events")]).toEqual([cells, events]);
    expect(city.agg.buildings).toBe(0);
    expect((await admin(city, "POST", "/restore", { x: 100, y: 100 })).status).toBe(200);
    expect(await cellOf(city, 100, 100)).toEqual(before);
    expect(city.sql.exec("SELECT gone FROM events WHERE pub = ?", pub).toArray().map((e) => e.gone)).toEqual([0, 0]);
    expect(city.agg.buildings).toBe(1);
    expect(auditActions(city)).toEqual(["hide", "restore"]);
    const a = (await admin(city, "GET", "/audit")).body.rows as Json[];
    expect(a.map((r) => [r.action, r.target])).toEqual([["restore", "100,100"], ["hide", "100,100"]]);
  });

  it("three reports hide a cell; restore brings it back, clears the votes, and its events are gone = 0 again", async () => {
    const { city } = makeAdminCity();
    const { pub } = await build(city, "cm1;B.100.100.house.3.1.7", NOW);
    for (const [i, ip] of ["1.1.1.1", "2.2.2.2", "3.3.3.3"].entries()) {
      const res = await city.vote(new Request("https://x.test/v1/report", { method: "POST", body: JSON.stringify({ x: 100, y: 100, device: `device-${i}-aaaa` }), headers: { "cf-connecting-ip": ip } }), NOW, "report");
      expect(res.status).toBe(200);
    }
    expect(await cellOf(city, 100, 100)).toMatchObject({ hidden: true, reports: 3 });
    expect(city.sql.exec("SELECT gone FROM events WHERE pub = ?", pub).one().gone).toBe(1);
    await admin(city, "POST", "/restore", { x: 100, y: 100 });
    expect(await cellOf(city, 100, 100)).toMatchObject({ hidden: false, reports: 0, downs: 0, b: "house.3.1.7" });
    expect(city.sql.exec("SELECT gone FROM events WHERE pub = ?", pub).one().gone).toBe(0);
    expect(count(city, "votes")).toBe(0);
  });
});

describe("undo a visit", () => {
  it("puts back the prior building, hides a cell built on empty ground, and skips a cell a later visit rebuilt", async () => {
    const { city } = makeAdminCity();
    await build(city, "cm1;B.100.100.house.3.1.7;B.115.100.cottage.2.2.2", NOW);
    const old100 = await cellOf(city, 100, 100);
    const t1 = NOW + 11 * MIN;
    const bad = await build(city, "cm1;B.100.100.tower.5.3.42;B.108.108.shop.2.2.2;B.115.100.tower.5.3.43", t1);
    const t2 = t1 + 11 * MIN;
    await build(city, "cm1;B.115.100.bakery.4.3.217", t2); // a later visit rebuilds one of the three cells
    const [cells, events] = [count(city, "cells"), count(city, "events")];
    const r = await admin(city, "POST", "/undo-visit", { pub: bad.pub }, { now: t2 });
    expect(r.body).toEqual({ ok: true, restored: 1, hidden: 1, skipped: 1 });
    expect(await cellOf(city, 100, 100, t2)).toEqual(old100); // exactly as before, old visit and times included
    expect(await cellOf(city, 108, 108, t2)).toMatchObject({ hidden: true });
    expect(await cellOf(city, 115, 100, t2)).toMatchObject({ b: "bakery.4.3.217", hidden: false });
    expect([count(city, "cells"), count(city, "events")]).toEqual([cells, events]);
    expect(city.sql.exec("SELECT gone FROM events WHERE pub = ?", bad.pub).toArray().map((e) => e.gone)).toEqual([1, 1, 1]);
    expect(city.sql.exec("SELECT status FROM visits WHERE pub = ?", bad.pub).one().status).toBe("expired");
    expect(auditActions(city)).toEqual(["undo_visit"]);
    expect(city.agg.buildings).toBe(2); // 100,100 and 115,100
    const id = String(city.sql.exec("SELECT id FROM visits WHERE pub = ?", bad.pub).one().id);
    expect(city.visitStatus(city.visitRow(id)!, t2)).toBe("expired"); // the visit cannot send more moves
  });

  it("a visit that changed one cell twice ends at the state before its first change", async () => {
    const { city } = makeAdminCity();
    await build(city, "cm1;B.100.100.house.3.1.7;E.100.100.flag.e.2", NOW);
    const old = await cellOf(city, 100, 100);
    const t1 = NOW + 11 * MIN;
    const bad = await build(city, "cm1;B.100.100.tower.5.3.42;E.100.100.chimney.n.4;E.100.100.flag.w.2", t1);
    expect(count(city, "events")).toBe(5);
    const r = await admin(city, "POST", "/undo-visit", { pub: bad.pub }, { now: t1 });
    expect(r.body).toEqual({ ok: true, restored: 1, hidden: 0, skipped: 0 });
    expect(await cellOf(city, 100, 100, t1)).toEqual(old);
  });

  it("undoes a sign and a part that a visit added to another visit's building, and keeps the building", async () => {
    const { city } = makeAdminCity();
    await build(city, "cm1;B.100.100.house.3.1.7", NOW);
    const old = await cellOf(city, 100, 100);
    const bad = await build(city, "cm1;S.100.100.t2.sun;E.100.100.flag.e.2", NOW + MIN);
    expect(await cellOf(city, 100, 100, NOW + MIN)).toMatchObject({ s: "t2.sun.-.-", e: "flag.e.2" });
    const r = await admin(city, "POST", "/undo-visit", { pub: bad.pub }, { now: NOW + MIN });
    expect(r.body).toEqual({ ok: true, restored: 1, hidden: 0, skipped: 0 });
    expect(await cellOf(city, 100, 100, NOW + MIN)).toEqual(old); // building and its old visit kept, no sign, no part
  });

  it("A builds, B replaces, A adds a sign: undo A goes back to B's building; undo B is skipped", async () => {
    for (const first of ["A", "B"]) {
      const { city } = makeAdminCity();
      const a = await build(city, "cm1;B.100.100.house.3.1.7", NOW);
      const b = await build(city, "cm1;B.100.100.tower.5.3.42", NOW + 11 * MIN);
      const bBuilding = await cellOf(city, 100, 100, NOW + 11 * MIN);
      const t = NOW + 12 * MIN;
      await build(city, "cm1;S.100.100.t2.sun", t, { v: city.visitRow(String(city.sql.exec("SELECT id FROM visits WHERE pub = ?", a.pub).one().id))!, pub: a.pub });
      const r = await admin(city, "POST", "/undo-visit", { pub: first === "A" ? a.pub : b.pub }, { now: t });
      if (first === "A") {
        expect(r.body).toEqual({ ok: true, restored: 1, hidden: 0, skipped: 0 });
        expect(await cellOf(city, 100, 100, t)).toEqual(bBuilding);
      } else {
        expect(r.body).toEqual({ ok: true, restored: 0, hidden: 0, skipped: 1 });
        expect(await cellOf(city, 100, 100, t)).toMatchObject({ b: "tower.5.3.42", s: "t2.sun.-.-" });
      }
    }
  });

  it("hides the cell when the event has no prev (older than this version), and counts it under hidden", async () => {
    const { city } = makeAdminCity();
    const { pub } = await build(city, "cm1;B.100.100.house.3.1.7", NOW);
    city.sql.exec("UPDATE events SET prev = NULL");
    const r = await admin(city, "POST", "/undo-visit", { pub });
    expect(r.body).toEqual({ ok: true, restored: 0, hidden: 1, skipped: 0 });
    expect(await cellOf(city, 100, 100)).toMatchObject({ hidden: true });
    expect(count(city, "cells")).toBe(1);
  });

  it("recounts the progress of a plan that aims at the undone cell", async () => {
    const { city } = makeAdminCity();
    await city.runLine(visit(city).v, "cm1;P.test.plan;B.100.100.ship.3.1.1;B.101.100.dock.3.1.1", NOW);
    const bad = await build(city, "cm1;B.100.100.ship.3.1.1", NOW + MIN);
    expect(city.sql.exec("SELECT done FROM plans").one().done).toBe(1);
    await admin(city, "POST", "/undo-visit", { pub: bad.pub }, { now: NOW + MIN });
    expect(city.sql.exec("SELECT done FROM plans").one().done).toBe(0);
  });

  it("GET visit and cell show the events", async () => {
    const { city } = makeAdminCity();
    const { pub } = await build(city, "cm1;B.100.100.house.3.1.7;E.100.100.flag.e.2", NOW);
    const v = (await admin(city, "GET", `/visit?pub=${pub}`)).body;
    expect(v).toMatchObject({ pub, team: "claude", total: 2 });
    expect(v.events.map((e: Json) => e.cmd)).toEqual(["B.100.100.house.3.1.7", "E.100.100.flag.e.2"]);
    expect((await admin(city, "GET", "/cell?x=100&y=100")).body.events.length).toBe(2);
    expect((await admin(city, "GET", "/visit?pub=nothing-here")).status).toBe(404);
  });
});

describe("migration v3 -> v4", () => {
  it("keeps every event and cell, adds events.prev and the audit table", async () => {
    const db = new DatabaseSync(":memory:");
    const { city } = makeAdminCity(db);
    await build(city, "cm1;B.100.100.house.3.1.7;B.115.100.cottage.2.2.2", NOW);
    db.exec("ALTER TABLE events DROP COLUMN prev");
    db.exec("DROP TABLE audit");
    db.prepare("UPDATE meta SET v = '3' WHERE k = 'schema'").run();
    const before = { cells: db.prepare("SELECT * FROM cells ORDER BY x").all(), events: db.prepare("SELECT seq, ts, pub, x, y, cmd, team, gone FROM events ORDER BY seq").all() };
    const { sql } = makeAdminCity(db);
    expect(sql.exec("SELECT * FROM cells ORDER BY x").toArray()).toEqual(before.cells);
    expect(sql.exec("SELECT seq, ts, pub, x, y, cmd, team, gone FROM events ORDER BY seq").toArray()).toEqual(before.events);
    expect(before.events.length).toBe(2);
    expect(sql.exec("SELECT prev FROM events").toArray().map((e) => e.prev)).toEqual([null, null]);
    expect(sql.exec("SELECT COUNT(*) AS n FROM audit").one().n).toBe(0);
    expect(sql.exec("SELECT v FROM meta WHERE k = 'schema'").one().v).toBe("10");
  });
});

// ---------- A2: pause a network, close an area ----------
const DAY = 86_400_000;
const PAUSED = "This network is paused for today.";
const CLOSED = "This part of the city is closed for now. Pick another cell.";
afterEach(() => { vi.unstubAllGlobals(); });

/** A call on a public route from one network. */
async function pub(city: City, method: string, path: string, body: unknown, ip: string, now = NOW) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const res = await city.route(new Request(`https://x.test${path}`, { method, headers: { "cf-connecting-ip": ip }, body: method === "GET" ? undefined : text }), now);
  return { status: res.status, body: (await res.json()) as Json };
}
/** A visit that was approved through the real route from `ip` (the human check is stubbed). */
async function approved(city: City, ip: string, now = NOW) {
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ success: true })));
  const c = (await pub(city, "POST", "/v1/visits", { team: "claude" }, ip, now)).body;
  expect((await pub(city, "POST", `/v1/visits/${c.id}/approve`, { age_confirmed: true, turnstile_token: "t" }, ip, now)).status).toBe(200);
  return { id: String(c.id), pub: String(c.pub) };
}
const cityWith = () => makeCity(undefined, { ADMIN_KEY: KEY, TURNSTILE_SECRET: "s" });

describe("pause a network for the day", () => {
  it("a paused network gets 403 paused on all six routes; another network does not; the visits row holds only a hash", async () => {
    const { city } = cityWith();
    const a = await approved(city, "1.1.1.1");
    const pending = (await pub(city, "POST", "/v1/visits", { team: "claude" }, "1.1.1.1")).body;
    const row = JSON.stringify(city.sql.exec("SELECT * FROM visits WHERE pub = ?", a.pub).one());
    expect(row).not.toContain("1.1.1.1");
    expect(String(city.sql.exec("SELECT ip_hash FROM visits WHERE pub = ?", a.pub).one().ip_hash)).toMatch(/^[0-9a-f]{16}$/);
    const r = await admin(city, "POST", "/ban", { pub: a.pub });
    expect(r.body).toMatchObject({ ok: true, count: 1 });
    expect(JSON.stringify(city.sql.exec("SELECT * FROM audit").toArray())).not.toMatch(/[0-9a-f]{16}/);
    expect(JSON.stringify(city.sql.exec("SELECT * FROM bans").toArray())).not.toContain("1.1.1.1");
    const dev = { x: 100, y: 100, device: "device-12345678", vote: 1 };
    const calls: [string, string, unknown][] = [
      ["POST", "/v1/visits", { team: "claude" }],
      ["POST", `/v1/visits/${pending.id}/approve`, { age_confirmed: true, turnstile_token: "t" }],
      ["POST", "/v1/bundle", { line: "cm1;B.100.100.house.3.1.7", team: "claude", age_confirmed: true, turnstile_token: "t" }],
      ["POST", `/v1/visits/${a.id}/moves`, "cm1;B.100.100.house.3.1.7"],
      ["POST", "/v1/rate", dev],
      ["POST", "/v1/report", dev],
    ];
    for (const [m, p, b] of calls) {
      const res = await pub(city, m, p, b, "1.1.1.1");
      expect([p, res.status, res.body.code, res.body.error]).toEqual([p, 403, "paused", PAUSED]);
      expect([p, (await pub(city, m, p, b, "2.2.2.2")).body.code]).not.toContain("paused");
    }
    expect(count(city, "cells")).toBe(1); // only the other network's bundle built something
    expect(auditActions(city)).toEqual(["ban"]);
    expect((await admin(city, "GET", "/bans")).body).toMatchObject({ count: 1, day: "2026-11-09" });
  });

  it("is gone on the next UTC day, and maybePurge deletes old ban rows", async () => {
    const { city } = cityWith();
    const a = await approved(city, "1.1.1.1");
    await admin(city, "POST", "/ban", { pub: a.pub });
    expect((await pub(city, "POST", "/v1/visits", { team: "claude" }, "1.1.1.1", NOW + 11 * 3_600_000)).status).toBe(403);
    expect((await pub(city, "POST", "/v1/visits", { team: "claude" }, "1.1.1.1", NOW + DAY)).status).toBe(201);
    expect((await admin(city, "GET", "/bans", undefined, { now: NOW + DAY })).body.count).toBe(0);
    city.maybePurge(NOW + DAY);
    expect(count(city, "bans")).toBe(0);
  });

  it("unban-all removes today's bans and is audited", async () => {
    const { city } = cityWith();
    const a = await approved(city, "1.1.1.1");
    await admin(city, "POST", "/ban", { pub: a.pub });
    expect((await admin(city, "POST", "/unban-all", {})).body.ok).toBe(true);
    expect(count(city, "bans")).toBe(0);
    expect((await pub(city, "POST", "/v1/visits", { team: "claude" }, "1.1.1.1")).status).toBe(201);
    expect(auditActions(city)).toEqual(["ban", "unban_all"]);
  });

  it("gives 409 for a visit approved on an earlier day, an unapproved visit, and a visit that is gone", async () => {
    const { city } = cityWith();
    const a = await approved(city, "1.1.1.1");
    const r = await admin(city, "POST", "/ban", { pub: a.pub }, { now: NOW + DAY });
    expect(r.status).toBe(409);
    expect(r.body.error).toContain("no longer known");
    const pending = (await pub(city, "POST", "/v1/visits", { team: "claude" }, "1.1.1.1")).body;
    expect((await admin(city, "POST", "/ban", { pub: pending.pub })).status).toBe(409);
    expect((await admin(city, "POST", "/ban", { pub: "no-such-visit" })).status).toBe(409);
    expect(count(city, "bans")).toBe(0);
  });
});

describe("close an area", () => {
  const rect = (x0: number, y0: number, x1 = x0, y1 = y0) => ({ x0, y0, x1, y1 });

  it("refuses a build, extend, sign and claim inside; the same lines work after unfreeze; admin hide still works inside", async () => {
    const { city } = makeAdminCity();
    await build(city, "cm1;B.100.100.house.3.1.7", NOW);
    const f = await admin(city, "POST", "/freeze", rect(100, 100, 102, 102));
    expect(f.body.ok).toBe(true);
    const v = visit(city);
    const lines = ["B.101.101.house.3.1.7", "E.100.100.flag.e.2", "S.102.102.t2.sun", "C.101.100"];
    const run = async (now: number) => ((await city.runLine(v.v, `cm1;${lines.join(";")}`, now).json()) as Json).results as Json[];
    for (const r of await run(NOW + MIN)) expect(r).toMatchObject({ ok: false, code: "closed", message: CLOSED });
    expect((await admin(city, "POST", "/hide", { x: 100, y: 100 })).body.ok).toBe(true);
    expect((await admin(city, "POST", "/restore", { x: 100, y: 100 })).body.ok).toBe(true);
    const id = (await admin(city, "GET", "/frozen")).body.areas[0].id;
    expect((await admin(city, "POST", "/unfreeze", { id })).body.ok).toBe(true);
    expect((await run(NOW + 2 * MIN)).map((r) => r.ok)).toEqual([true, true, true, true]);
    expect(auditActions(city)).toContain("freeze");
    expect(auditActions(city)).toContain("unfreeze");
  });

  it("a plan target inside gets that target refused", async () => {
    const { city } = makeAdminCity();
    await admin(city, "POST", "/freeze", rect(101, 100));
    const res = (await city.runLine(visit(city).v, "cm1;P.test.plan;B.100.100.house.3.1.1;B.101.100.house.3.1.1", NOW).json()) as Json;
    expect(res.results[2]).toMatchObject({ ok: false, code: "closed", message: CLOSED });
    expect(res.plan.total).toBe(1);
  });

  it("world.txt lists no frozen cell as free", async () => {
    const { city } = makeAdminCity();
    const free = (t: string) => t.split("\n").find((l) => l.startsWith("Free cells"))!.split(": ")[1].split(" ");
    const url = new URL("https://x/world.txt?near=100,100");
    expect(free(city.worldText(url, NOW))).toContain("100.100");
    await admin(city, "POST", "/freeze", rect(99, 99, 101, 101));
    const t = city.worldText(url, NOW);
    for (const x of [99, 100, 101]) for (const y of [99, 100, 101]) expect(free(t)).not.toContain(`${x}.${y}`);
    expect(free(t)).toContain("98.98");
    expect(t.length).toBeLessThan(4096);
  });

  it("the 21st area gives 409; bad input gives 400; stats carries frozen and a change reaches viewers", async () => {
    const { city, sockets } = makeAdminCity();
    expect((await admin(city, "GET", "/frozen")).body.areas).toEqual([]);
    expect(city.stats(NOW).frozen).toEqual([]);
    const ws = new FakeSocket();
    sockets.push(ws);
    for (let i = 0; i < 20; i++) expect((await admin(city, "POST", "/freeze", rect(i, i))).status).toBe(200);
    expect((await admin(city, "POST", "/freeze", rect(50, 50))).status).toBe(409);
    expect(count(city, "frozen")).toBe(20);
    expect(city.stats(NOW).frozen[1]).toEqual([1, 1, 1, 1]);
    expect(ws.messages().at(-1)).toMatchObject({ t: "stats" });
    for (const b of [rect(5, 5, 4, 5), rect(0, 0, 200, 1), { x0: "a", y0: 0, x1: 1, y1: 1 }, rect(-1, 0)]) expect((await admin(city, "POST", "/freeze", b)).status).toBe(400);
    expect((await admin(city, "POST", "/unfreeze", { id: 9999 })).status).toBe(404);
  });
});

describe("hidden cells list", () => {
  it("needs the key, and is 404 when ADMIN_KEY is unset", async () => {
    const { city } = makeAdminCity();
    expect((await admin(city, "GET", "/hidden", undefined, { key: null })).status).toBe(401);
    expect((await admin(makeCity().city, "GET", "/hidden")).status).toBe(404);
  });

  it("lists a cell hidden by 3 reports and one hidden by admin, never sends them in the public chunk, and drops one after restore", async () => {
    const { city } = makeAdminCity();
    await build(city, "cm1;B.100.100.house.3.1.7", NOW);
    await build(city, "cm1;B.101.100.tower.2.2.5", NOW);
    await build(city, "cm1;B.102.100.house.1.1.1", NOW);
    for (const [i, ip] of ["1.1.1.1", "2.2.2.2", "3.3.3.3"].entries()) {
      await city.vote(new Request("https://x.test/v1/report", { method: "POST", body: JSON.stringify({ x: 100, y: 100, device: `device-${i}-aaaa` }), headers: { "cf-connecting-ip": ip } }), NOW, "report");
    }
    await admin(city, "POST", "/hide", { x: 101, y: 100 });
    const cells = (await admin(city, "GET", "/hidden")).body.cells as Json[];
    expect(cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(["100,100", "101,100"]);
    expect(cells.find((c) => c.x === 100)).toMatchObject({ b: "house.3.1.7", t: "claude", reports: 3 });
    expect(cells.find((c) => c.x === 101)).toMatchObject({ b: "tower.2.2.5", reports: 0 });
    const chunk = city.chunkMessages(100 >> 6, 100 >> 6).join("");
    expect(chunk).not.toContain("house.3.1.7");
    expect(chunk).not.toContain("tower.2.2.5");
    expect(chunk).toContain("house.1.1.1");
    await admin(city, "POST", "/restore", { x: 100, y: 100 });
    expect(((await admin(city, "GET", "/hidden")).body.cells as Json[]).map((c) => c.x)).toEqual([101]);
  });
});

describe("migration v4 -> v5", () => {
  it("keeps every visit, cell and event, and adds ip_hash, bans and frozen", async () => {
    const db = new DatabaseSync(":memory:");
    const { city } = makeAdminCity(db);
    await build(city, "cm1;B.100.100.house.3.1.7;B.115.100.cottage.2.2.2", NOW);
    db.exec("ALTER TABLE visits DROP COLUMN ip_hash");
    db.exec("DROP TABLE bans");
    db.exec("DROP TABLE frozen");
    db.prepare("UPDATE meta SET v = '4' WHERE k = 'schema'").run();
    const n = (t: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).all()[0].n);
    const before = [n("visits"), n("cells"), n("events")];
    const { sql } = makeAdminCity(db);
    expect(before).toEqual([1, 2, 2]);
    expect(["visits", "cells", "events"].map((t) => Number(sql.exec(`SELECT COUNT(*) AS n FROM ${t}`).one().n))).toEqual(before);
    expect(sql.exec("SELECT ip_hash FROM visits").one().ip_hash).toBe("");
    expect(sql.exec("SELECT COUNT(*) AS n FROM bans").one().n).toBe(0);
    expect(sql.exec("SELECT COUNT(*) AS n FROM frozen").one().n).toBe(0);
    expect(sql.exec("SELECT v FROM meta WHERE k = 'schema'").one().v).toBe("10");
  });
});
