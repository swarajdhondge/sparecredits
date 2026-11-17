// Admin routes (/v1/admin/*): one key, no CORS, every action in the audit table. Nothing here deletes a cell or an event.
import { GRID } from "../public/kit.js";
import type { Cell } from "./engine";
import { cellWire, rowToCell, unApply, MAX_FROZEN, type City } from "./city";
import { dayKey } from "./limits";

const WRONG_KEYS_PER_DAY = 10;
const MIN_KEY = 24;

const reply = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (error: string, status: number, code: string) => reply({ ok: false, code, error }, status);

/** Same body as an unknown route, and no CORS headers. */
export const adminNotFound = () => fail("Not found.", 404, "not_found");

const digest = async (s: string) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)));

/** Constant time: hash both, then XOR every byte with no early exit. */
async function sameKey(given: string, secret: string): Promise<boolean> {
  const a = await digest(given), b = await digest(secret);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

const audit = (city: City, now: number, action: string, target: string, detail = "") =>
  city.sql.exec("INSERT INTO audit (ts, action, target, detail) VALUES (?, ?, ?, ?)", now, action, target, detail);

function cellArg(x: unknown, y: unknown): { x: number; y: number } | null {
  const cx = Number(x), cy = Number(y);
  return Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cy >= 0 && cx < GRID && cy < GRID ? { x: cx, y: cy } : null;
}

export async function adminRoute(city: City, key: string | undefined, request: Request, url: URL, now: number): Promise<Response> {
  if (!key || key.length < MIN_KEY) return adminNotFound();
  const ip = await city.ipHash(request, now);
  // counted here, not with ipCount: that one skips the local address, and this guard must work in dev and in tests too
  const wrong = Number(city.sql.exec("SELECT n FROM ipday WHERE day = ? AND ip_hash = ? AND kind = 'admin'", dayKey(now), ip).toArray()[0]?.n ?? 0);
  if (wrong >= WRONG_KEYS_PER_DAY) return fail("Too many wrong keys from this network today. Try again after 00:00 UTC.", 429, "limit");
  const given = /^Bearer (.+)$/.exec(request.headers.get("authorization") || "")?.[1] ?? "";
  if (!(await sameKey(given, key))) {
    city.bumpIp(ip, "admin", now);
    audit(city, now, "login_failed", ip);
    return fail("Wrong key.", 401, "unauthorized");
  }

  const p = url.pathname.slice("/v1/admin".length);
  const m = request.method;
  if (m === "GET" && p === "/cell") return cellInfo(city, url);
  if (m === "GET" && p === "/visit") return visitInfo(city, url);
  if (m === "GET" && p === "/audit") {
    const rows = city.sql.exec("SELECT id, ts, action, target, detail FROM audit ORDER BY id DESC LIMIT 200").toArray();
    return reply({ ok: true, rows });
  }
  if (m === "GET" && p === "/bans") return reply({ ok: true, day: dayKey(now), count: city.bans(now).size });
  if (m === "GET" && p === "/frozen") return reply({ ok: true, areas: city.frozen() });
  if (m === "GET" && p === "/hidden") return hiddenList(city);
  if (m === "POST" && (p === "/ban" || p === "/unban-all" || p === "/freeze" || p === "/unfreeze")) {
    const body = await city.readJson(request);
    if (!body) return fail("Send JSON.", 400, "bad_request");
    if (p === "/ban") return ban(city, body, now);
    if (p === "/unban-all") return unbanAll(city, now);
    return p === "/freeze" ? freeze(city, body, now) : unfreeze(city, body, now);
  }
  if (m === "POST" && (p === "/hide" || p === "/restore" || p === "/undo-visit")) {
    const body = await city.readJson(request);
    if (!body) return fail("Send JSON.", 400, "bad_request");
    if (p === "/undo-visit") return undoVisit(city, body, now);
    const c = cellArg(body.x, body.y);
    if (!c) return fail(`x and y must be cells 0-${GRID - 1}.`, 400, "bad_request");
    return p === "/hide" ? hide(city, c, now) : restore(city, c, now);
  }
  return adminNotFound();
}

const eventRows = (city: City, where: string, arg: unknown[], order: string, limit: number) =>
  city.sql.exec(`SELECT seq, ts, pub, x, y, cmd, team, gone FROM events WHERE ${where} ORDER BY seq ${order} LIMIT ${limit}`, ...arg).toArray();

function cellInfo(city: City, url: URL): Response {
  const c = cellArg(url.searchParams.get("x"), url.searchParams.get("y"));
  if (!c) return fail(`x and y must be cells 0-${GRID - 1}.`, 400, "bad_request");
  const cell = city.store.get(c.x, c.y);
  const events = eventRows(city, "x = ? AND y = ?", [c.x, c.y], "DESC", 20).map(({ x: _x, y: _y, ...e }) => e);
  const wire = cell ? { ...cellWire({ ...cell, hidden: false }), likes: cell.likes, downs: cell.downs, reports: cell.reports, hidden: cell.hidden } : null;
  return reply({ ok: true, x: c.x, y: c.y, cell: wire, events });
}

/** The newest 200 hidden cells (by last touch; the hide time is not stored when reports hide a cell: 2 for free builds and pictures, 3 for others), for the admin map markers. Never sent to the public. */
function hiddenList(city: City): Response {
  const cells = city.sql.exec("SELECT * FROM cells WHERE hidden = 1 ORDER BY last_like DESC LIMIT 200").toArray().map((r) => {
    const c = rowToCell(r);
    return { ...cellWire({ ...c, hidden: false }), reports: c.reports, downs: c.downs };
  });
  return reply({ ok: true, cells });
}

function visitInfo(city: City, url: URL): Response {
  const pub = url.searchParams.get("pub") || "";
  if (!/^[\w-]{6,64}$/.test(pub)) return fail("pub must be a visit code.", 400, "bad_request");
  const v = city.sql.exec("SELECT team, created, approved_at, status FROM visits WHERE pub = ?", pub).toArray();
  const total = Number(city.sql.exec("SELECT COUNT(*) AS n FROM events WHERE pub = ?", pub).one().n);
  if (!v.length && !total) return fail("Unknown visit.", 404, "not_found");
  const events = eventRows(city, "pub = ?", [pub], "ASC", 200);
  const at = v.length ? Number(v[0].approved_at) || Number(v[0].created) : Number(events[0].ts);
  return reply({ ok: true, pub, team: v.length ? v[0].team : events[0].team, at, status: v.length ? v[0].status : "purged", total, events });
}

/** Tell the viewers about changed cells: the cell, the overview, the stats, and the progress of plans that aim at the cell. */
function pushLive(city: City, cells: Cell[], now: number) {
  for (const c of cells) {
    city.broadcastCell(c.x, c.y, { t: "c", seq: city.seq, cell: cellWire(c) });
    for (const r of city.sql.exec("SELECT p.id, p.total FROM plan_cells c JOIN plans p ON p.id = c.plan WHERE c.x = ? AND c.y = ? AND p.status = 'active'", c.x, c.y).toArray()) {
      const done = city.planDoneCount(String(r.id));
      city.sql.exec("UPDATE plans SET done = ? WHERE id = ?", done, r.id);
      city.broadcast({ t: "plan", p: String(r.id), done, total: Number(r.total), status: "active" });
    }
  }
  city.flushOv();
  city.broadcast({ t: "stats", ...city.stats(now) });
}

function hide(city: City, c: { x: number; y: number }, now: number): Response {
  const cell = city.store.get(c.x, c.y);
  if (!cell) return fail("Nothing is stored in that cell.", 404, "not_found");
  const next = { ...cell, hidden: true };
  city.tx(() => {
    city.store.put(next);
    city.sql.exec("UPDATE events SET gone = 1 WHERE x = ? AND y = ? AND seq <= ?", c.x, c.y, city.seq);
    city.flushMeta();
    audit(city, now, "hide", `${c.x},${c.y}`);
  });
  pushLive(city, [next], now);
  return reply({ ok: true });
}

function restore(city: City, c: { x: number; y: number }, now: number): Response {
  const cell = city.store.get(c.x, c.y);
  if (!cell) return fail("Nothing is stored in that cell.", 404, "not_found");
  const next = { ...cell, hidden: false, reports: 0, downs: 0, lastLike: now };
  city.tx(() => {
    city.store.put(next);
    city.sql.exec("DELETE FROM votes WHERE x = ? AND y = ?", c.x, c.y); // so people can vote again; the only delete an admin action does
    city.sql.exec("UPDATE events SET gone = 0 WHERE x = ? AND y = ?", c.x, c.y);
    city.flushMeta();
    audit(city, now, "restore", `${c.x},${c.y}`);
  });
  pushLive(city, [next], now);
  return reply({ ok: true });
}

function undoVisit(city: City, body: Record<string, unknown>, now: number): Response {
  const pub = String(body.pub ?? "");
  if (!/^[\w-]{6,64}$/.test(pub)) return fail("pub must be a visit code.", 400, "bad_request");
  const events = city.sql.exec("SELECT seq, x, y, prev FROM events WHERE pub = ? ORDER BY seq ASC", pub).toArray();
  if (!events.length) return fail("That visit has no changes.", 404, "not_found");
  const cells = new Map<string, { x: number; y: number }>();
  for (const e of events) cells.set(`${e.x},${e.y}`, { x: Number(e.x), y: Number(e.y) });
  let restored = 0, hidden = 0, skipped = 0;
  const changed: Cell[] = [];
  city.tx(() => {
    for (const f of cells.values()) {
      // the cell's events, newest first: the newest run by this visit is what the visit did last; the state before its oldest event is the result.
      // Only seq and pub are scanned; prev (up to 8 KB) is read for the run's events, oldest first, until one holds the whole cell.
      const run: number[] = []; // seqs of the run, oldest first; empty: the newest event is not by this visit
      for (const e of city.sql.exec("SELECT seq, pub FROM events WHERE x = ? AND y = ? ORDER BY seq DESC", f.x, f.y).toArray()) {
        if (e.pub !== pub) break;
        run.unshift(Number(e.seq));
      }
      const cur = city.store.get(f.x, f.y);
      if (!run.length || !cur) { skipped++; continue; } // a later visit changed this cell: leave it alone
      const patches: string[] = []; // compact prevs (A) before the first whole-cell prev, oldest first
      let whole: string | null | undefined; // undefined: every event of the run is compact, so the cell now is the base
      for (const seq of run) {
        const p = city.sql.exec("SELECT prev FROM events WHERE seq = ?", seq).one().prev;
        if (typeof p === "string" && p.startsWith("A:")) { patches.push(p); continue; }
        whole = p === null ? null : String(p);
        break;
      }
      let next: Cell | null = null;
      if (whole === undefined) next = cur;
      else if (whole && whole !== "empty") {
        try { next = JSON.parse(whole) as Cell; } catch (e) { console.error("undoVisit: bad prev", pub, f.x, f.y, String(e)); }
      }
      for (let i = patches.length - 1; next && i >= 0; i--) next = unApply(patches[i], next);
      if (next) restored++;
      else { next = { ...cur, hidden: true }; hidden++; } // empty ground, an old event with no prev, or unreadable prev: hide the cell, keep the row
      city.store.put(next);
      if (next.hidden) city.sql.exec("UPDATE events SET gone = 1 WHERE x = ? AND y = ? AND seq <= ?", f.x, f.y, city.seq);
      changed.push(next);
    }
    city.sql.exec("UPDATE events SET gone = 1 WHERE pub = ?", pub);
    city.sql.exec("UPDATE visits SET status = 'expired' WHERE pub = ?", pub);
    city.flushMeta();
    audit(city, now, "undo_visit", pub, `restored ${restored}, hidden ${hidden}, skipped ${skipped}`);
  });
  pushLive(city, changed, now);
  return reply({ ok: true, restored, hidden, skipped });
}

function ban(city: City, body: Record<string, unknown>, now: number): Response {
  const pub = String(body.pub ?? "");
  if (!/^[\w-]{6,64}$/.test(pub)) return fail("pub must be a visit code.", 400, "bad_request");
  const v = city.sql.exec("SELECT ip_hash, approved_at FROM visits WHERE pub = ?", pub).toArray()[0];
  // the hash has a daily salt: from an earlier day it no longer matches the network
  if (!v || !v.ip_hash || dayKey(Number(v.approved_at)) !== dayKey(now)) return fail("The network of that visit is no longer known, so it cannot be paused.", 409, "unknown_network");
  city.tx(() => {
    city.sql.exec("INSERT OR IGNORE INTO bans (day, ip_hash) VALUES (?, ?)", dayKey(now), v.ip_hash);
    audit(city, now, "ban", pub);
  });
  city.banSet = null;
  return reply({ ok: true, count: city.bans(now).size });
}

function unbanAll(city: City, now: number): Response {
  city.tx(() => {
    city.sql.exec("DELETE FROM bans WHERE day = ?", dayKey(now));
    audit(city, now, "unban_all", dayKey(now));
  });
  city.banSet = null;
  return reply({ ok: true });
}

function freeze(city: City, body: Record<string, unknown>, now: number): Response {
  const [x0, y0, x1, y1] = [body.x0, body.y0, body.x1, body.y1].map(Number);
  const cells = [x0, y0, x1, y1];
  if (!cells.every((n) => Number.isInteger(n) && n >= 0 && n < GRID) || x0 > x1 || y0 > y1) return fail(`x0, y0, x1 and y1 must be cells 0-${GRID - 1}, with x0 <= x1 and y0 <= y1.`, 400, "bad_request");
  if (city.frozen().length >= MAX_FROZEN) return fail(`At most ${MAX_FROZEN} areas can be closed. Open one again first.`, 409, "limit");
  city.tx(() => {
    const id = Number(city.sql.exec("INSERT INTO frozen (x0, y0, x1, y1, ts) VALUES (?, ?, ?, ?, ?) RETURNING id", x0, y0, x1, y1, now).one().id);
    audit(city, now, "freeze", `${x0},${y0}-${x1},${y1}`);
    city.frozenList = [...city.frozen(), { id, x0, y0, x1, y1 }];
  });
  city.memo.clear();
  city.broadcast({ t: "stats", ...city.stats(now) });
  return reply({ ok: true });
}

function unfreeze(city: City, body: Record<string, unknown>, now: number): Response {
  const id = Number(body.id);
  const a = city.frozen().find((f) => f.id === id);
  if (!a) return fail("Unknown closed area.", 404, "not_found");
  city.tx(() => {
    city.sql.exec("DELETE FROM frozen WHERE id = ?", id);
    audit(city, now, "unfreeze", `${a.x0},${a.y0}-${a.x1},${a.y1}`);
  });
  city.frozenList = city.frozen().filter((f) => f.id !== id);
  city.memo.clear();
  city.broadcast({ t: "stats", ...city.stats(now) });
  return reply({ ok: true });
}
