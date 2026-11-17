import { describe, it, expect, vi, afterEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { makeCity, FakeSocket } from "./support/harness";
import { openArea, growRings, OPEN_START, MAX_RINGS, GRID } from "../public/kit.js";
import { newCell } from "../src/engine";

const NOW = Date.UTC(2026, 10, 9, 12, 0);

/** The v1 layout (100 x 100 grid, no chunk columns), as a deployed dev city has it. */
function makeV1(db: DatabaseSync) {
  db.exec(`CREATE TABLE cells (
    x INTEGER NOT NULL, y INTEGER NOT NULL, style TEXT, h INTEGER NOT NULL DEFAULT 0, pal INTEGER NOT NULL DEFAULT 0,
    seed INTEGER NOT NULL DEFAULT 0, parts TEXT NOT NULL DEFAULT '', sign TEXT, claim INTEGER NOT NULL DEFAULT 0,
    team TEXT NOT NULL, built_at INTEGER NOT NULL DEFAULT 0, team_at INTEGER NOT NULL DEFAULT 0, sign_at INTEGER NOT NULL DEFAULT 0,
    last_like INTEGER NOT NULL, likes INTEGER NOT NULL DEFAULT 0, downs INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0, visit TEXT NOT NULL, PRIMARY KEY (x, y))`);
  db.exec(`CREATE TABLE events (seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, pub TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, cmd TEXT NOT NULL, team TEXT NOT NULL)`);
  db.exec(`CREATE TABLE votes (x INTEGER NOT NULL, y INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, device TEXT NOT NULL, ip_hash TEXT NOT NULL, PRIMARY KEY (x, y, day, type, device))`);
  db.exec(`CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  const ins = db.prepare("INSERT INTO cells (x,y,style,h,pal,seed,team,last_like,claim,visit) VALUES (?,?,?,?,?,?,?,?,?,?)");
  // includes cells that would collide with each other when shifted one by one: (0,0)->(50,50) while (50,50) still exists
  const pts: [number, number][] = [[0, 0], [50, 50], [51, 50], [99, 99], [10, 90], [60, 60]];
  pts.forEach(([x, y], i) => ins.run(x, y, i === 3 ? null : "house", 3, i, 7, "claude", NOW, i === 3 ? 1 : 0, "pubA"));
  db.prepare("INSERT INTO events (ts,pub,x,y,cmd,team) VALUES (?,?,?,?,?,?)").run(NOW, "pubA", 50, 50, "B.50.50.house.3.1.7", "claude");
  db.prepare("INSERT INTO votes (x,y,day,type,device,ip_hash) VALUES (?,?,?,?,?,?)").run(50, 50, "2026-11-09", "rate", "dev-aaaa1111", "ip");
  return pts;
}

describe("migration v1 -> v2 (grid 100 -> 200)", () => {
  it("moves every row by +50, keeps every row, and runs once", () => {
    const db = new DatabaseSync(":memory:");
    const pts = makeV1(db);
    const { sql } = makeCity(db);
    const rows = sql.exec("SELECT x, y, cx, cy FROM cells ORDER BY x, y").toArray();
    expect(rows.length).toBe(pts.length); // count before = after
    expect(rows.map((r) => [r.x, r.y]).sort()).toEqual(pts.map(([x, y]) => [x + 50, y + 50]).sort());
    for (const r of rows) {
      expect(r.cx).toBe(Number(r.x) >> 6);
      expect(r.cy).toBe(Number(r.y) >> 6);
    }
    expect(sql.exec("SELECT cmd, x, y FROM events").toArray()[0]).toMatchObject({ cmd: "B.100.100.house.3.1.7", x: 100, y: 100 });
    expect(sql.exec("SELECT x, y FROM votes").toArray()[0]).toMatchObject({ x: 100, y: 100 });
    expect(sql.exec("SELECT v FROM meta WHERE k = 'schema'").toArray()[0].v).toBe("10");
    // the open area holds every old row (they sit at 50..149), nothing is left outside the city edge
    const open = Number(sql.exec("SELECT v FROM meta WHERE k = 'open'").toArray()[0].v);
    const a = openArea(open);
    for (const r of rows) expect(Number(r.x) >= a.x0 && Number(r.x) <= a.x1 && Number(r.y) >= a.y0 && Number(r.y) <= a.y1).toBe(true);
    // the overview has a block for each built or claimed cell
    expect(sql.exec("SELECT COUNT(*) AS n FROM blocks").toArray()[0].n).toBeGreaterThan(0);
  });

  it("is safe on restart: a second start does not shift again", () => {
    const db = new DatabaseSync(":memory:");
    const pts = makeV1(db);
    makeCity(db);
    const { sql } = makeCity(db); // the object starts again on the same storage
    makeCity(db);
    const rows = sql.exec("SELECT x, y FROM cells").toArray();
    expect(rows.length).toBe(pts.length);
    expect(rows.map((r) => [r.x, r.y]).sort()).toEqual(pts.map(([x, y]) => [x + 50, y + 50]).sort());
  });

  it("a new database starts at the newest version with the small open area", () => {
    const { sql, city } = makeCity();
    expect(sql.exec("SELECT v FROM meta WHERE k = 'schema'").toArray()[0].v).toBe("10");
    expect(city.rings).toBe(0);
    expect(city.stats(NOW).open).toEqual({ x0: 80, y0: 80, x1: 119, y1: 119 });
    expect(city.stats(NOW).box).toBeNull();
    expect(city.stats(NOW).last).toBeNull();
  });
});

describe("open area", () => {
  it("starts 40 x 40 in the middle and ends at the full grid", () => {
    expect(openArea(0)).toEqual({ x0: 80, y0: 80, x1: 119, y1: 119 });
    expect(openArea(1)).toEqual({ x0: 75, y0: 75, x1: 124, y1: 124 });
    expect(openArea(MAX_RINGS)).toEqual({ x0: 0, y0: 0, x1: GRID - 1, y1: GRID - 1 });
    expect(OPEN_START * OPEN_START).toBe(1600);
  });
  it("grows by one ring at 70% full (1120 of 1600), not before", () => {
    expect(growRings(0, 1119)).toBe(0);
    expect(growRings(0, 1120)).toBe(1);
    expect(growRings(1, 1120)).toBe(1); // ring 1 has 2500 cells, 1120 is far below 70%
    expect(growRings(0, 99999)).toBe(MAX_RINGS);
  });
});

function approvedVisit(city: ReturnType<typeof makeCity>["city"], team = "claude") {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, ?, ?, ?, 'approved')", id, `pub-${id.slice(6, 12)}`, team, NOW, NOW);
  return city.visitRow(id)!;
}
async function run(city: ReturnType<typeof makeCity>["city"], line: string, now = NOW) {
  const res = city.runLine(approvedVisit(city), line, now);
  return (await res.json()) as { ok: boolean; applied: number; results: { cmd: string; ok: boolean; code?: string; message?: string }[] };
}

describe("city edge in the live city", () => {
  it("refuses commands outside the open area, accepts inside", async () => {
    const { city } = makeCity();
    const r = await run(city, "cm1;B.10.10.house.3.1.7;C.79.100;S.120.100.t2.sun;B.100.100.house.3.1.7;B.80.80.cottage.2.2.2;B.119.119.cottage.2.2.2");
    expect(r.results.map((x) => x.code ?? "ok")).toEqual(["outside_edge", "outside_edge", "outside_edge", "ok", "ok", "ok"]);
    expect(r.results[0].message).toMatch(/outside the city edge/);
    expect(r.applied).toBe(3);
  });

  it("grows when 70% of the open cells hold a building, and then accepts the new ring", async () => {
    const { city } = makeCity();
    const a = openArea(0);
    const put = (x: number, y: number) => {
      const c = newCell(x, y, { team: "claude", pub: "p", now: NOW });
      Object.assign(c, { style: "house", h: 3, builtAt: NOW, teamAt: NOW });
      city.store.put(c);
    };
    let n = 0;
    for (let y = a.y0; y <= a.y1 && n < 1119; y++) for (let x = a.x0; x <= a.x1 && n < 1119; x++, n++) put(x, y);
    city.growOpenArea(NOW); // what each write transaction does at its end
    expect(city.rings).toBe(0);
    expect((await run(city, "cm1;B.78.100.house.3.1.7")).results[0].code).toBe("outside_edge");
    // the 1120th building (placed through the API) tips it over
    const r = await run(city, "cm1;B.119.119.house.3.1.7");
    expect(r.applied).toBe(1);
    expect(city.rings).toBe(1);
    expect(city.stats(NOW).open).toEqual(openArea(1));
    expect(city.getMeta("open")).toBe("1");
    expect((await run(city, "cm1;B.78.100.house.3.1.7")).results[0].ok).toBe(true);
  }, 30_000);
});

describe("commands_left", () => {
  it("the reply to a line shows the same commands_left as the visit info (a first T is free)", async () => {
    const { city } = makeCity();
    const v = approvedVisit(city);
    const res = city.runLine(v, "cm1;T.claude;B.100.100.bakery.3.4.217", NOW);
    expect(((await res.json()) as { commands_left: number }).commands_left).toBe(59);
    const info = (await city.visitInfo(String(v.id), NOW).json()) as { commands_left: number };
    expect(info.commands_left).toBe(59);
  });
});

describe("nothing is removed by age", () => {
  const DAY = 86_400_000;
  const put = (city: ReturnType<typeof makeCity>["city"], x: number, y: number, lastLike: number) => {
    const c = newCell(x, y, { team: "claude", pub: "p", now: NOW });
    Object.assign(c, { style: "house", h: 3, builtAt: lastLike, teamAt: lastLike, lastLike });
    city.store.put(c);
  };

  it("a building 30 days old with no like is still in the chunk message and in world.txt, faded", () => {
    const { city } = makeCity();
    put(city, 100, 100, NOW - 30 * DAY);
    put(city, 101, 100, NOW);
    const cells = city.chunkMessages(100 >> 6, 100 >> 6).flatMap((m) => (JSON.parse(m).cells ?? JSON.parse(m).d ?? []) as { x: number }[]);
    expect(cells.map((c) => c.x).sort()).toEqual([100, 101]);
    const lines = city.worldText(new URL("https://x/world.txt?near=100,100"), NOW).split("\n");
    expect(lines.find((l) => l.startsWith("B.100.100"))).toMatch(/ by claude faded$/);
    expect(lines.find((l) => l.startsWith("B.101.100"))).toMatch(/ by claude$/);
  });

  it("maybePurge deletes no cell because of age", () => {
    const { city } = makeCity();
    put(city, 100, 100, NOW - 60 * DAY);
    city.lastPurge = 0;
    city.maybePurge(NOW);
    expect(city.sql.exec("SELECT COUNT(*) AS n FROM cells").toArray()[0].n).toBe(1);
    expect(city.stats(NOW).buildings).toBe(1);
    expect(city.stats(NOW).box).toEqual([100, 100, 103, 103]);
  });

  it("faded buildings do not count toward growth", () => {
    const fill = (lastLike: number) => {
      const { city } = makeCity();
      const a = openArea(0);
      let n = 0;
      for (let y = a.y0; y <= a.y1 && n < 1120; y++) for (let x = a.x0; x <= a.x1 && n < 1120; x++, n++) put(city, x, y, lastLike);
      city.growOpenArea(NOW);
      return city.rings;
    };
    expect(fill(NOW - 8 * DAY)).toBe(0);
    expect(fill(NOW)).toBe(1);
  }, 30_000);
});

describe("history is kept", () => {
  const DAY = 86_400_000;
  type City = ReturnType<typeof makeCity>["city"];
  const count = (city: City, table: string) => Number(city.sql.exec(`SELECT COUNT(*) AS n FROM ${table}`).toArray()[0].n);
  const replayOf = async (city: City, pub: string) => {
    const res = city.replay(pub);
    return { status: res.status, body: (await res.json()) as { team: string; at: number; events: { x: number; y: number }[] } };
  };

  it("events from 15 days ago survive the purge, the visits row does not", async () => {
    const { city } = makeCity();
    const old = NOW - 15 * DAY;
    const v = approvedVisit(city);
    city.sql.exec("UPDATE visits SET created = ?, approved_at = ? WHERE id = ?", old, old, v.id);
    expect(((await city.runLine(city.visitRow(String(v.id))!, "cm1;B.100.100.house.3.1.7", old).json()) as { applied: number }).applied).toBe(1);
    city.lastPurge = 0;
    city.maybePurge(NOW);
    expect(count(city, "events")).toBe(1);
    expect(count(city, "visits")).toBe(0);
  });

  it("replay answers with the right team after the visits row is purged", async () => {
    const { city } = makeCity();
    const old = NOW - 15 * DAY;
    const v = approvedVisit(city, "gemini");
    city.sql.exec("UPDATE visits SET created = ?, approved_at = ? WHERE id = ?", old, old, v.id);
    await city.runLine(city.visitRow(String(v.id))!, "cm1;B.100.100.house.3.1.7", old).json();
    city.lastPurge = 0;
    city.maybePurge(NOW);
    expect(count(city, "visits")).toBe(0);
    const r = await replayOf(city, String(v.pub));
    expect(r.status).toBe(200);
    expect(r.body.team).toBe("gemini");
    expect(r.body.at).toBe(old);
    expect(r.body.events.length).toBe(1);
    expect((await replayOf(city, "pub-nothing-here")).status).toBe(404);
  });

  it("a cell hidden by 3 reports has its events gone, and replay leaves them out", async () => {
    const { city } = makeCity();
    const v = approvedVisit(city);
    await city.runLine(city.visitRow(String(v.id))!, "cm1;B.100.100.house.3.1.7;B.101.100.house.3.1.7", NOW).json();
    for (let i = 0; i < 3; i++) {
      const req = new Request("http://x/v1/report", { method: "POST", headers: { "cf-connecting-ip": `10.0.0.${i + 1}` }, body: JSON.stringify({ x: 100, y: 100, device: `device-${i}-aaaa` }) });
      const res = await city.vote(req, NOW, "report");
      expect(res.status).toBe(200);
    }
    const gone = city.sql.exec("SELECT x, gone FROM events ORDER BY seq").toArray();
    expect(gone.map((e) => [e.x, e.gone])).toEqual([[100, 1], [101, 0]]);
    expect((await replayOf(city, String(v.pub))).body.events.map((e) => e.x)).toEqual([101]);
  });

  it("migration from a v2 database keeps every event and adds gone and events_xy", () => {
    const db = new DatabaseSync(":memory:");
    makeV1(db);
    makeCity(db); // now a v3 database
    db.exec("ALTER TABLE events DROP COLUMN gone");
    db.exec("DROP INDEX events_xy");
    db.prepare("INSERT INTO events (ts,pub,x,y,cmd,team) VALUES (?,?,?,?,?,?)").run(NOW, "pubB", 120, 120, "B.120.120.house.3.1.7", "gemini");
    db.prepare("UPDATE meta SET v = '2' WHERE k = 'schema'").run();
    const before = db.prepare("SELECT seq, ts, pub, x, y, cmd, team FROM events ORDER BY seq").all();
    const { sql } = makeCity(db);
    expect(sql.exec("SELECT seq, ts, pub, x, y, cmd, team FROM events ORDER BY seq").toArray()).toEqual(before);
    expect(before.length).toBe(2);
    expect(sql.exec("SELECT gone FROM events").toArray().map((e) => e.gone)).toEqual([0, 0]);
    expect(sql.exec("SELECT 1 FROM sqlite_master WHERE name = 'events_xy'").toArray().length).toBe(1);
    expect(sql.exec("SELECT v FROM meta WHERE k = 'schema'").toArray()[0].v).toBe("10");
    // cells were not shifted a second time
    expect(sql.exec("SELECT MIN(x) AS a FROM cells").toArray()[0].a).toBe(50);
  });
});

describe("live chunks", () => {
  function fill(city: ReturnType<typeof makeCity>["city"], x: number, y: number) {
    const c = newCell(x, y, { team: "gemini", pub: "p", now: NOW });
    Object.assign(c, { style: "tower", h: 4, pal: 5, builtAt: NOW, teamAt: NOW });
    city.store.put(c);
    city.flushOv(); // nobody follows the overview yet: the queued change is dropped, like after a normal request
  }

  it("a viewer gets only the chunks it asked for, and only their changes", () => {
    const { city, sockets } = makeCity();
    fill(city, 70, 70); // chunk 1,1
    fill(city, 130, 70); // chunk 2,1
    fill(city, 10, 10); // chunk 0,0
    const ws = new FakeSocket();
    sockets.push(ws);
    city.subscribe(ws as never, { c: [[1, 1]], ov: 0 });
    let msgs = ws.messages();
    expect(msgs.map((m) => `${m.t}:${m.cx},${m.cy}`)).toEqual(["chunk:1,1"]);
    expect((msgs[0].cells as { x: number }[]).map((c) => c.x)).toEqual([70]);

    // asking again for the same chunk sends nothing new; adding a chunk sends just that chunk
    city.subscribe(ws as never, { c: [[1, 1], [2, 1]], ov: 0 });
    msgs = ws.messages();
    expect(msgs.map((m) => `${m.t}:${m.cx},${m.cy}`)).toEqual(["chunk:1,1", "chunk:2,1"]);

    // changes: only chunks the viewer follows
    city.broadcastCell(70, 70, { t: "c", n: 1 });
    city.broadcastCell(10, 10, { t: "c", n: 2 }); // chunk 0,0: not followed
    expect(ws.messages().filter((m) => m.t === "c").map((m) => m.n)).toEqual([1]);

    // leaving a chunk stops its changes
    city.subscribe(ws as never, { c: [[2, 1]], ov: 0 });
    city.broadcastCell(70, 70, { t: "c", n: 3 });
    expect(ws.messages().filter((m) => m.t === "c").map((m) => m.n)).toEqual([1]);
  });

  it("rejects bad chunk numbers and sends nothing for them", () => {
    const { city } = makeCity();
    const ws = new FakeSocket();
    city.subscribe(ws as never, { c: [[9, 9], [-1, 0], ["a", 1], "x"], ov: 0 });
    expect(ws.sent.length).toBe(0);
  });

  it("the overview is one small message, then small changes", async () => {
    const { city, sockets } = makeCity();
    fill(city, 70, 70);
    const ws = new FakeSocket();
    sockets.push(ws);
    city.subscribe(ws as never, { c: [], ov: 1 });
    const [ov] = ws.messages();
    expect(ov.t).toBe("ov");
    expect((ov.d as string).length).toBe((GRID / 4) * (GRID / 4));
    expect(ov.d).toContain("5"); // palette 5 of the tower at 70,70 (block 17,17)
    expect(ws.sent[0].length).toBeLessThan(2700);
    const r = await run(city, "cm1;B.100.100.house.3.9.7");
    expect(r.applied).toBe(1);
    const delta = ws.messages().find((m) => m.t === "o");
    expect(delta).toBeTruthy();
    expect((delta!.d as { b: number; ch: string }[])[0]).toEqual({ b: 25 * 50 + 25, ch: "9" });
    // no chunk message reaches an overview-only viewer
    expect(ws.messages().some((m) => m.t === "c")).toBe(false);
  });
});

describe("time-lapse pages", () => {
  type Page = { ok: boolean; events: { seq: number; cmd: string }[]; next: number | null; first_ts: number | null; last_seq: number };
  const get = async (city: ReturnType<typeof makeCity>["city"], after: number, now = NOW) => {
    const res = await city.route(new Request(`https://x.test/v1/timelapse?after=${after}`), now);
    return { res, body: (await res.json()) as Page };
  };
  function seed(n: number) {
    const m = makeCity();
    m.db.exec("BEGIN");
    const ins = m.db.prepare("INSERT INTO events (ts,pub,x,y,cmd,team,gone) VALUES (?,?,?,?,?,?,0)");
    for (let i = 0; i < n; i++) ins.run(NOW + i, "pubA", 100 + (i % 10), 100 + (i % 7), `C.${100 + (i % 10)}.${100 + (i % 7)}`, "claude");
    m.db.exec("COMMIT");
    m.city.seq = n;
    return m;
  }

  it("pages every visible event once, in order, and leaves out hidden cells", async () => {
    const { city, db } = seed(2500);
    db.exec("UPDATE events SET gone = 1 WHERE x = 109"); // one hidden cell column
    const want = (db.prepare("SELECT seq FROM events WHERE gone = 0 ORDER BY seq").all() as { seq: number }[]).map((r) => r.seq);
    const got: number[] = [], sizes: number[] = [], cache: (string | null)[] = [];
    let after = 0;
    for (;;) {
      const { res, body } = await get(city, after);
      expect(res.status).toBe(200);
      expect(body.events.length).toBeLessThanOrEqual(1000);
      sizes.push(body.events.length); cache.push(res.headers.get("cache-control"));
      got.push(...body.events.map((e) => e.seq));
      expect(body.first_ts).toBe(NOW);
      expect(body.last_seq).toBe(2500);
      if (body.next === null) break;
      after = body.next;
    }
    expect(got).toEqual(want);
    expect(want.length).toBe(2250);
    expect(sizes).toEqual([1000, 1000, 250]);
    expect(cache).toEqual(["public, max-age=31536000, immutable", "public, max-age=31536000, immutable", "no-store"]);
  });

  it("pages 2,500 visible events as 1000, 1000, 500", async () => {
    const { city } = seed(2500);
    const sizes: number[] = [];
    let after = 0, next: number | null = 0;
    while (next !== null) { const { body } = await get(city, after); sizes.push(body.events.length); next = body.next; after = next ?? 0; }
    expect(sizes).toEqual([1000, 1000, 500]);
  });

  it("an empty city answers no events and a null first_ts", async () => {
    const { body } = await get(makeCity().city, 0);
    expect(body).toMatchObject({ ok: true, events: [], next: null, first_ts: null, last_seq: 0 });
  });

  it("rests when the day budget is used, and answers again the next UTC day", async () => {
    const { city } = seed(5);
    await get(city, 0);
    city.tl = { day: "2026-11-09", rows: 1_500_000 };
    const r = await get(city, 0);
    expect(r.res.status).toBe(429);
    expect(r.body).toMatchObject({ ok: false, code: "resting", error: "The time-lapse is resting today. Come back after 00:00 UTC." });
    const next = await get(city, 0, NOW + 86_400_000);
    expect(next.res.status).toBe(200);
    expect(city.tl).toEqual({ day: "2026-11-10", rows: 5 });
  });
});

describe("less work per request", () => {
  const moves = (city: ReturnType<typeof makeCity>["city"], id: string, now: number) =>
    city.moves(new Request("http://x/v1/visits/x/moves", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" }, body: "cm1;C.100.100" }), id, now);

  it("reads the salt row once a day, and a new UTC day gives a new salt", async () => {
    const { city } = makeCity();
    const v = approvedVisit(city);
    let saltReads = 0;
    const exec = city.sql.exec.bind(city.sql);
    city.sql.exec = ((q: string, ...b: unknown[]) => {
      if (q.includes("meta WHERE k") && b[0] === "salt") saltReads++;
      return exec(q, ...b);
    }) as typeof city.sql.exec;
    for (let i = 0; i < 3; i++) expect((await moves(city, String(v.id), NOW + i)).status).toBe(200);
    expect(saltReads).toBeLessThanOrEqual(1);
    const req = new Request("http://x/", { headers: { "cf-connecting-ip": "203.0.113.7" } });
    const today = await city.ipHash(req, NOW);
    expect(await city.ipHash(req, NOW + 1000)).toBe(today);
    expect(await city.ipHash(req, Date.UTC(2026, 10, 10, 0, 0, 1))).not.toBe(today);
  });

  it("stores the canonical text of a command", async () => {
    const { city } = makeCity();
    await run(city, "cm1;T.claude;b.100.100.BAKERY.3.4.217");
    expect(city.sql.exec("SELECT cmd FROM events").toArray().map((e) => e.cmd)).toEqual(["B.100.100.bakery.3.4.217"]);
  });
});

describe("today per team", () => {
  type C = ReturnType<typeof makeCity>["city"];
  afterEach(() => vi.useRealTimers());
  const getStats = async (city: C) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW); // the route reads Date.now()
    return (await city.fetch(new Request("http://x/v1/stats"))).json() as Promise<{ today: Record<string, number>; teams: Record<string, number> }>;
  };
  const place = (city: C, team: string, line: string) => city.runLine(approvedVisit(city, team), line, NOW);

  it("counts the changes each team placed today, and a new City on the same database gives the same numbers", async () => {
    const { city, db } = makeCity();
    city.stats(NOW); // a request always starts the day before a line runs
    place(city, "claude", "cm1;B.100.100.house.3.1.7;B.101.100.house.3.1.7;B.102.100.house.3.1.7");
    place(city, "gemini", "cm1;B.100.102.house.3.1.7");
    const s = await getStats(city);
    expect(s.today).toEqual({ claude: 3, chatgpt: 0, gemini: 1, other: 0 });
    expect((await getStats(makeCity(db).city)).today).toEqual(s.today);
  });

  it("is all zero after 00:00 UTC and leaves teams unchanged", async () => {
    const { city } = makeCity();
    city.stats(NOW);
    place(city, "claude", "cm1;B.100.100.house.3.1.7");
    const before = await getStats(city);
    const next = city.stats(Date.UTC(2026, 10, 10, 0, 0, 1));
    expect(next.today).toEqual({ claude: 0, chatgpt: 0, gemini: 0, other: 0 });
    expect(next.teams).toEqual(before.teams);
  });

  it("loads a stored daily row without teams as zeros", () => {
    const { city, db } = makeCity();
    city.setMeta("daily", JSON.stringify({ day: "2026-11-09", visits: 2, cmds: 5 }));
    const again = makeCity(db).city;
    expect(again.stats(NOW).today).toEqual({ claude: 0, chatgpt: 0, gemini: 0, other: 0 });
    expect(again.daily.cmds).toBe(5);
  });
});
