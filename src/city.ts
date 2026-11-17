// The City Durable Object: all state, the whole /v1 API, and live push over hibernating WebSockets.
import { DurableObject } from "cloudflare:workers";
import { TEAMS, GRID, TAG_WORDS, WORD_CLASS, STYLES, PARTS, MAX_LINE, CHUNK_SHIFT, OPEN_FILL, PLAN_CODE, groupColor, groupFromSlug, planName, openArea, inArea, growRings, parseLine, fillTemplate, createsBannedLayout } from "../public/kit.js";
import { applyItems, isFrozen, occupies, type Cell, type Store, type Part } from "./engine";
import {
  LIMITS, FULL_MESSAGE, commandQuota, dailyCaps, slotsLeft, dayKey, decayState, shouldHide, isFreeLimitError, weekStart, nextMonday, WEEK_MS, type NetWindow,
} from "./limits";
import { verifyTurnstile } from "./turnstile";
import { planTargets, planCaps, planState, planWire, type Target, type PlanStatus } from "./plans";
import { ensureSchema, refreshBlock } from "./schema";
import { adminRoute, adminNotFound } from "./admin";

export interface Env {
  CITY: DurableObjectNamespace;
  ASSETS: Fetcher;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET?: string;
  ADMIN_KEY?: string; // Worker secret for /v1/admin/*; unset or under 24 characters turns the admin routes off
  OPERATOR_NAME?: string; // Worker secret: the legal name of the operator, shown on /contact; unset shows nothing
}

type Row = Record<string, SqlStorageValue>;

interface Agg { buildings: number; teams: Record<string, number> }
interface Daily { day: string; visits: number; cmds: number; teams: Record<string, number>; created: number }

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

function json(data: unknown, status = 200): Response {
  return jsonText(JSON.stringify(data), status);
}
function jsonText(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...CORS },
  });
}
function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", ...CORS } });
}
const bad = (message: string, status = 400, code = "bad_request") => json({ ok: false, code, error: message }, status);

function rid(bytes: number): string {
  const a = crypto.getRandomValues(new Uint8Array(bytes));
  let s = "";
  for (const b of a) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

const partsToStr = (p: Part[]) => p.map((x) => `${x.part}.${x.side}.${x.h}`).join(",");
const strToParts = (s: string): Part[] => (s ? s.split(",").map((t) => { const [part, side, h] = t.split("."); return { part, side, h: Number(h) }; }) : []);

export function rowToCell(r: Row): Cell {
  return {
    x: Number(r.x), y: Number(r.y), style: (r.style as string) || null, h: Number(r.h), pal: Number(r.pal), seed: Number(r.seed),
    parts: strToParts(String(r.parts || "")),
    sign: r.sign ? (() => { const [t, ...w] = String(r.sign).split("."); return { tpl: Number(t.slice(1)), words: w.filter((x) => x !== "-") }; })() : null,
    claim: r.claim === 1, team: String(r.team), builtAt: Number(r.built_at), teamAt: Number(r.team_at), signAt: Number(r.sign_at),
    lastLike: Number(r.last_like), likes: Number(r.likes), downs: Number(r.downs), reports: Number(r.reports), hidden: r.hidden === 1,
    visit: String(r.visit), shape: r.shape ? String(r.shape) : null, tags: r.tags ? String(r.tags) : null, grp: r.grp ? String(r.grp) : null,
  };
}

/** The sign text of a cell: `t<template>.<word>.<word>.<word>`, a missing word is `-`. */
const signText = (s: { tpl: number; words: string[] }) => `t${s.tpl}.${[0, 1, 2].map((i) => s.words[i] || "-").join(".")}`;

export function cellWire(c: Cell): Record<string, unknown> {
  if (c.hidden) return { x: c.x, y: c.y, gone: 1 };
  const w: Record<string, unknown> = { x: c.x, y: c.y, t: c.team, l: c.lastLike, v: c.visit };
  if (c.style) { w.b = `${c.style}.${c.h}.${c.pal}.${c.seed}`; w.ts = c.builtAt; }
  // f: a free build's data. A model: the shapes text. A picture: "facing.w.h.pixels". b is `style.h.pal.seed` as usual; a free cell stores the nearest palette as pal
  if (c.shape && (c.style === "free" || c.style === "picture")) w.f = c.shape;
  if (c.parts.length) w.e = partsToStr(c.parts);
  if (c.sign) w.s = signText(c.sign);
  if (c.tags) w.k = c.tags; // build tags, dotted: "tree.lantern"
  if (c.grp) w.g = c.grp; // the group of the visit that made the cell
  if (c.likes > 0) w.n = c.likes; // likes, shown in the build label
  if (c.claim) { w.c = 1; if (!c.style) w.ts = c.teamAt; }
  if (!c.style && !c.claim) w.ts = c.signAt;
  return w;
}

/** The address a network is counted by: an IPv4 address as is, an IPv6 address by its /64 prefix (the first 4 groups). */
export function ipKey(raw: string): string {
  let a = raw.trim().toLowerCase().replace(/%.*$/, "");
  if (!a.includes(":")) return a;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return mapped[1];
  const [head, tail] = a.split("::");
  const h = head ? head.split(":") : [];
  const t = tail === undefined ? [] : tail ? tail.split(":") : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const LOCAL_IP = "local";
export const PAUSED_MESSAGE = "This network is paused for today.";
export const MAX_FROZEN = 20;
export interface Frozen { id: number; x0: number; y0: number; x1: number; y1: number }
const CH_N = Math.ceil(GRID / (1 << CHUNK_SHIFT)); // chunks per side (4)
const chunkBit = (cx: number, cy: number) => 1 << (cy * CH_N + cx);
const chunkOf = (x: number, y: number) => [x >> CHUNK_SHIFT, y >> CHUNK_SHIFT] as const;
const BLOCKS_PER_SIDE = GRID >> 2;
/** What one live viewer asked for: a bit per chunk it follows, and whether it wants the zoomed-out overview. */
interface Sub { m: number; ov: boolean }
const TIMELAPSE_PAGE = 1000; // events per time-lapse page
const TIMELAPSE_DAY_ROWS = 1_500_000; // rows the time-lapse may read per UTC day (free plan: 5M a day for everything)
const CHUNK_PART = 1500; // cells per chunk message, at most
const CHUNK_BYTES = 200_000; // and a chunk message stays under about this many characters of JSON
const MAX_SOCKETS = 1000; // open /v1/live connections
const MEMO_MS = 5000; // /v1/stats and /v1/world.txt answers are kept this long
const MAX_ACTIVE_PLANS_PER_CELL = 3;
/** A plan_cells row as a plan target. */
const rowToTarget = (r: Row): Target => ({
  x: Number(r.x), y: Number(r.y), style: String(r.style), h: Number(r.h), pal: Number(r.pal), seed: Number(r.seed), parts: strToParts(String(r.parts || "")),
});
/** The per-command reply list of moves: ok lines carry an optional note, failed lines carry code and message. */
const replyResults = (rs: { cmd: string; ok: boolean; code?: string; message?: string; note?: string }[]) =>
  rs.map((r) => (r.ok ? { cmd: r.cmd, ok: true, ...(r.note ? { note: r.note } : {}) } : { cmd: r.cmd, ok: false, code: r.code, message: r.message }));
/** What an event stores to undo it: the whole old cell as JSON, or for an A that only appended shapes (up to 8 KB of old text) `A:<old shapes length>:<old h>:<old pal>`. */
function prevOf(old: Cell, now: Cell): string {
  if (old.style === "free" && old.shape && now.shape && now.shape.startsWith(old.shape + "_")) return `A:${old.shape.length}:${old.h}:${old.pal}`;
  return JSON.stringify(old);
}
/** The cell as it was before an event with a compact prev (`A:...`), given the cell as it was after it. Null when it cannot be rebuilt. */
export function unApply(prev: string, after: Cell): Cell | null {
  const m = /^A:(\d+):(\d+):(\d+)$/.exec(prev);
  if (!m || !after.shape || after.shape.length < Number(m[1])) return null;
  return { ...after, shape: after.shape.slice(0, Number(m[1])), h: Number(m[2]), pal: Number(m[3]) };
}
const contrib = (c: Cell | null) => (c && !c.hidden && (c.style || c.claim) ? c : null);

export class City extends DurableObject<Env> {
  sql: SqlStorage;
  agg: Agg = { buildings: 0, teams: {} };
  grpCells: Map<string, number> | null = null; // cells held per group, read on first use
  daily: Daily = { day: "", visits: 0, cmds: 0, teams: {}, created: 0 };
  launch = 0;
  seq = 0;
  lastPurge = 0;
  rings = 0; // how many growth steps the open area has taken
  chunkCache = new Map<number, string[]>(); // chunk -> ready-to-send messages, dropped when a cell in it changes
  ovArr: string[] | null = null; // overview characters, one per 4 x 4 block, built when first needed
  ovQueue: { b: number; ch: string }[] = [];
  ovBox: number[] | null | undefined; // cells box [x0, y0, x1, y1] of the non-empty overview blocks (null: none); undefined = not computed
  lastCell: number[] | null | undefined; // x, y of the newest event; undefined = not read yet (one query, then kept in memory)
  saltNow: { day: string; salt: string } | null = null; // today's ip salt, kept after the first read or write
  activeCache: { at: number; n: number } = { at: 0, n: 0 };
  freshCache: { at: number; n: number } = { at: 0, n: 0 }; // count of non-faded buildings, for growth
  pendingChanges: Cell[] = [];
  frozenList: Frozen[] | null = null; // closed areas, read once and kept; admin changes update it
  banSet: { day: string; set: Set<string> } | null = null; // today's paused networks, read once per day
  tl: { day: string; rows: number } | null = null; // time-lapse rows served today, kept in memory and in meta key tl
  tlSaved = 0; // when tl was last written to meta
  firstTs: number | null = null; // ts of the first event ever, read once
  memo = new Map<string, { at: number; body: string }>(); // ready /v1/stats and /v1/world.txt bodies, dropped when a cell changes
  season: { num: number; starts: number; ends: number } | null = null; // the running season, read once and kept
  putLog: { x: number; y: number; old: Cell | null }[] | null = null; // the cell before each put, recorded during runLine so every event can store its prev

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.loadMeta();
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  migrate() {
    ensureSchema(this.sql, (fn) => this.ctx.storage.transactionSync(fn), GRID, TEAMS);
  }

  tx<T>(fn: () => T): T {
    return this.ctx.storage.transactionSync(fn);
  }

  getMeta(k: string): string | null {
    const r = this.sql.exec("SELECT v FROM meta WHERE k = ?", k).toArray();
    return r.length ? String(r[0].v) : null;
  }
  setMeta(k: string, v: string) {
    this.sql.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }

  loadMeta() {
    const a = this.getMeta("agg");
    if (a) this.agg = JSON.parse(a);
    const d = this.getMeta("daily");
    if (d) this.daily = { teams: {}, created: 0, ...JSON.parse(d) }; // a row from before `teams` or `created` reads as zeros
    const l = this.getMeta("launch");
    if (l) this.launch = Number(l);
    else { this.launch = Date.now(); this.setMeta("launch", String(this.launch)); }
    const o = this.getMeta("open");
    if (o) this.rings = Number(o);
    const sq = this.sql.exec("SELECT seq FROM sqlite_sequence WHERE name = 'events'").toArray();
    this.seq = sq.length ? Number(sq[0].seq) : 0;
  }

  flushMeta() {
    this.setMeta("agg", JSON.stringify(this.agg));
    this.setMeta("daily", JSON.stringify(this.daily));
  }

  /** x, y of the newest event: one query the first time, then memory. */
  loadLastCell() {
    if (this.lastCell === undefined) {
      const last = this.sql.exec("SELECT x, y FROM events ORDER BY seq DESC LIMIT 1").toArray();
      this.lastCell = last.length ? [Number(last[0].x), Number(last[0].y)] : null;
    }
    return this.lastCell;
  }

  rollDaily(now: number) {
    const d = dayKey(now);
    if (this.daily.day !== d) this.daily = { day: d, visits: 0, cmds: 0, teams: {}, created: 0 };
  }

  async ipHash(request: Request, now: number): Promise<string> {
    const raw = request.headers.get("cf-connecting-ip");
    if (!raw || raw === "127.0.0.1" || raw === "::1") return LOCAL_IP;
    const ip = ipKey(raw);
    const day = dayKey(now);
    if (!this.saltNow || this.saltNow.day !== day) { // memory first; the row is read once per object start and per UTC day
      const m = this.getMeta("salt");
      const parsed = m ? (JSON.parse(m) as { day: string; salt: string }) : null;
      if (parsed && parsed.day === day) this.saltNow = parsed;
      else { this.saltNow = { day, salt: rid(16) }; this.setMeta("salt", JSON.stringify(this.saltNow)); }
    }
    return sha(this.saltNow.salt + ip);
  }

  /** The closed areas. One query the first time, then memory. */
  frozen(): Frozen[] {
    if (!this.frozenList) {
      this.frozenList = this.sql.exec("SELECT id, x0, y0, x1, y1 FROM frozen ORDER BY id").toArray().map((r) => ({ id: Number(r.id), x0: Number(r.x0), y0: Number(r.y0), x1: Number(r.x1), y1: Number(r.y1) }));
    }
    return this.frozenList;
  }

  /** Today's paused networks. One query per day, then memory; admin ban and unban-all reset it. */
  bans(now: number): Set<string> {
    const day = dayKey(now);
    if (!this.banSet || this.banSet.day !== day) {
      this.banSet = { day, set: new Set(this.sql.exec("SELECT ip_hash FROM bans WHERE day = ?", day).toArray().map((r) => String(r.ip_hash))) };
    }
    return this.banSet.set;
  }

  /** The 403 reply for a paused network, or null. */
  paused(ip: string, now: number): Response | null {
    return this.bans(now).has(ip) ? json({ ok: false, code: "paused", error: PAUSED_MESSAGE, results: [] }, 403) : null;
  }

  // ---------- cell store ----------
  store: Store = {
    get: (x, y) => {
      const r = this.sql.exec("SELECT * FROM cells WHERE x = ? AND y = ?", x, y).toArray();
      return r.length ? rowToCell(r[0]) : null;
    },
    // one lookup per column, so SQLite reads only the cells in the window (not whole columns)
    region: (x0, y0, x1, y1) => {
      const out: Cell[] = [];
      for (let x = Math.max(0, x0); x <= Math.min(GRID - 1, x1); x++) {
        for (const r of this.sql.exec("SELECT * FROM cells WHERE x = ? AND y BETWEEN ? AND ? AND hidden = 0", x, y0, y1).toArray()) out.push(rowToCell(r));
      }
      return out;
    },
    put: (c, resetVotes) => {
      const old = this.store.get(c.x, c.y);
      this.putLog?.push({ x: c.x, y: c.y, old });
      this.sql.exec(
        `INSERT INTO cells (x,y,cx,cy,style,h,pal,seed,parts,sign,claim,team,built_at,team_at,sign_at,last_like,likes,downs,reports,hidden,visit,shape,grp,tags)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
         ON CONFLICT(x,y) DO UPDATE SET style=excluded.style,h=excluded.h,pal=excluded.pal,seed=excluded.seed,parts=excluded.parts,
           sign=excluded.sign,claim=excluded.claim,team=excluded.team,built_at=excluded.built_at,team_at=excluded.team_at,
           sign_at=excluded.sign_at,last_like=excluded.last_like,likes=excluded.likes,downs=excluded.downs,reports=excluded.reports,
           hidden=excluded.hidden,visit=excluded.visit,shape=excluded.shape,grp=excluded.grp,tags=excluded.tags`,
        c.x, c.y, c.x >> CHUNK_SHIFT, c.y >> CHUNK_SHIFT, c.style, c.h, c.pal, c.seed, partsToStr(c.parts),
        c.sign ? signText(c.sign) : null,
        c.claim ? 1 : 0, c.team, c.builtAt, c.teamAt, c.signAt, c.lastLike, c.likes, c.downs, c.reports, c.hidden ? 1 : 0, c.visit, c.shape ?? null, c.grp ?? null, c.tags ?? null,
      );
      if (resetVotes && old) this.sql.exec("DELETE FROM votes WHERE x = ? AND y = ?", c.x, c.y);
      this.adjustAgg(contrib(old), -1);
      this.adjustAgg(contrib(c), 1);
      this.adjustGrp(contrib(old), -1);
      this.adjustGrp(contrib(c), 1);
      this.touched(c.x, c.y);
    },
  };

  /** A cell changed: drop its chunk's cached messages and queue the overview change of its block. */
  touched(x: number, y: number) {
    this.memo.clear();
    const [cx, cy] = chunkOf(x, y);
    this.chunkCache.delete(cy * CH_N + cx);
    const r = refreshBlock(this.sql, x, y, GRID, TEAMS);
    if (r.changed) {
      if (this.ovArr) this.ovArr[r.b] = r.ch || ".";
      this.ovBox = undefined;
      this.ovQueue.push({ b: r.b, ch: r.ch || "." });
    }
  }

  /** Send the queued overview changes to viewers that follow the overview. */
  flushOv() {
    if (!this.ovQueue.length) return;
    const msg = JSON.stringify({ t: "o", d: this.ovQueue });
    this.ovQueue = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (!this.subOf(ws).ov) continue;
      try { ws.send(msg); } catch (e) { console.error("flushOv: send failed", String(e)); }
    }
  }

  /** Cells held per group: read once (one grouped count over the indexed grp column), then kept in step by every put. */
  groupCounts(): Map<string, number> {
    if (!this.grpCells) {
      this.grpCells = new Map();
      for (const r of this.sql.exec("SELECT grp, COUNT(*) AS n FROM cells WHERE grp IS NOT NULL AND hidden = 0 AND (style IS NOT NULL OR claim = 1) GROUP BY grp").toArray()) this.grpCells.set(String(r.grp), Number(r.n));
    }
    return this.grpCells;
  }
  adjustGrp(c: Cell | null, sign: 1 | -1) {
    if (!c || !c.grp || !this.grpCells) return;
    this.grpCells.set(c.grp, Math.max(0, (this.grpCells.get(c.grp) || 0) + sign));
  }
  /** The groups that hold cells, most cells first (ties: the id). */
  topGroups(n: number): { id: string; cells: number }[] {
    return [...this.groupCounts()].filter(([, c]) => c > 0).map(([id, cells]) => ({ id, cells })).sort((a, b) => b.cells - a.cells || (a.id < b.id ? -1 : 1)).slice(0, n);
  }
  groupWire(id: string, cells: number) {
    return { id, slug: id.replace(".", "-"), name: planName(id.split(".")), color: groupColor(id), cells };
  }
  groupList(): Response {
    return jsonText(this.memoized("/v1/groups", Date.now(), () => JSON.stringify({ groups: this.topGroups(50).map((g) => this.groupWire(g.id, g.cells)) })));
  }
  groupDetail(slug: string): Response {
    const id = groupFromSlug(slug);
    const r = id ? this.sql.exec("SELECT id, created, visits FROM groups WHERE id = ?", id).toArray() : [];
    if (!r.length) return bad("Unknown group.", 404, "not_found");
    const gid = String(r[0].id);
    return json({ ...this.groupWire(gid, this.groupCounts().get(gid) || 0), visits: Number(r[0].visits), created: Number(r[0].created) });
  }

  /** The most used tags: top n {tag, n} (cells that carry the tag now). One read over the partial cells_tags index, kept 5 s. */
  tagTop(n: number) {
    const count = new Map<string, number>();
    for (const r of this.sql.exec("SELECT tags FROM cells WHERE tags IS NOT NULL AND hidden = 0 AND style IS NOT NULL").toArray()) {
      for (const w of String(r.tags).split(".")) count.set(w, (count.get(w) || 0) + 1);
    }
    const tags = [...count].map(([tag, n]) => ({ tag, n })).sort((a, b) => b.n - a.n || (a.tag < b.tag ? -1 : 1)).slice(0, n);
    return { tags };
  }
  /** Up to 200 cells that carry a tag word, newest build first. Only valid kit words are looked up. */
  tagCells(word: string) {
    const valid = TAG_WORDS.includes(word) || !!WORD_CLASS[word] || STYLES.includes(word) || PARTS.includes(word);
    const cells: { x: number; y: number; team: string; group: string | null; style: string }[] = [];
    if (valid) {
      for (const r of this.sql.exec("SELECT x, y, team, grp, style, tags FROM cells WHERE tags IS NOT NULL AND hidden = 0 AND style IS NOT NULL ORDER BY built_at DESC").toArray()) {
        if (!String(r.tags).split(".").includes(word)) continue;
        cells.push({ x: Number(r.x), y: Number(r.y), team: String(r.team), group: r.grp ? String(r.grp) : null, style: String(r.style) });
        if (cells.length >= 200) break;
      }
    }
    return { tag: word, cells };
  }

  adjustAgg(c: Cell | null, sign: 1 | -1) {
    if (!c) return;
    this.agg.teams[c.team] = (this.agg.teams[c.team] || 0) + sign;
    if (c.style) this.agg.buildings += sign;
  }

  // ---------- stats and live push ----------
  stats(now: number) {
    this.rollDaily(now);
    if (now - this.activeCache.at > 15_000) {
      const r = this.sql.exec("SELECT COUNT(*) AS n FROM visits WHERE last_move > ?", now - LIMITS.activeWindowMs).one();
      this.activeCache = { at: now, n: Number(r.n) };
    }
    const teams: Record<string, number> = {};
    for (const t of TEAMS) teams[t] = Math.max(0, this.agg.teams[t] || 0);
    const today: Record<string, number> = {};
    for (const t of TEAMS) today[t] = Math.max(0, this.daily.teams?.[t] || 0);
    if (this.ovBox === undefined) {
      const ov = this.overview();
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let i = 0; i < ov.length; i++) {
        if (ov[i] === ".") continue;
        const bx = (i % BLOCKS_PER_SIDE) * 4, by = Math.floor(i / BLOCKS_PER_SIDE) * 4;
        x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx + 3); y1 = Math.max(y1, by + 3);
      }
      this.ovBox = x1 < 0 ? null : [x0, y0, x1, y1];
    }
    this.loadLastCell();
    return {
      day: Math.floor((now - this.launch) / 86_400_000) + 1,
      buildings: Math.max(0, this.agg.buildings),
      active: this.activeCache.n,
      slots_left: slotsLeft(this.daily.visits, this.daily.cmds),
      visits_left: Math.max(0, LIMITS.globalVisitsPerDay - this.daily.visits),
      commands_left: Math.max(0, LIMITS.globalCommandsPerDay - this.daily.cmds),
      teams,
      today, // changes placed today (UTC day) per team
      grid: GRID,
      open: openArea(this.rings),
      box: this.ovBox, // where buildings stand (4 x 4 block edges) and the newest change: the first camera of the home page
      last: this.lastCell,
      frozen: this.frozen().map((f) => [f.x0, f.y0, f.x1, f.y1]), // closed areas, drawn as a hatch
      season: this.season ? { num: this.season.num, ends: this.season.ends } : null,
    };
  }

  broadcast(msg: unknown) {
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(s); } catch (e) { console.error("broadcast: send failed", String(e)); }
    }
  }

  // ---------- live view: viewers follow chunks ----------
  subOf(ws: WebSocket): Sub {
    const a = ws.deserializeAttachment() as Sub | null;
    return a && typeof a.m === "number" ? a : { m: 0, ov: false };
  }

  /** Send one message to every viewer that follows the chunk of cell (x, y). */
  broadcastCell(x: number, y: number, msg: unknown) {
    const [cx, cy] = chunkOf(x, y);
    const bit = chunkBit(cx, cy);
    const s = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (!(this.subOf(ws).m & bit)) continue;
      try { ws.send(s); } catch (e) { console.error("broadcastCell: send failed", String(e)); }
    }
  }

  /** Messages that carry one chunk: its cells (in parts of 1500) and, in part 0, the plan ghosts. Cached until a cell in it changes. */
  chunkMessages(cx: number, cy: number): string[] {
    const key = cy * CH_N + cx;
    const hit = this.chunkCache.get(key);
    if (hit) return hit;
    const rows = this.sql.exec("SELECT * FROM cells WHERE cx = ? AND cy = ? AND hidden = 0", cx, cy).toArray();
    const cells = rows.map((r) => cellWire(rowToCell(r)));
    const ghosts = this.sql.exec(
      "SELECT c.*, p.name AS pname FROM plan_cells c JOIN plans p ON p.id = c.plan WHERE c.cx = ? AND c.cy = ? AND p.status = 'active'", cx, cy,
    ).toArray().map((g) => this.ghostWire(String(g.plan), String(g.pname), rowToTarget(g)));
    // parts: at most CHUNK_PART cells and about CHUNK_BYTES of JSON each (part 0 also carries the ghosts)
    const parts: Record<string, unknown>[][] = [[]];
    let size = JSON.stringify(ghosts).length;
    for (const cell of cells) {
      const len = JSON.stringify(cell).length + 1;
      const cur = parts[parts.length - 1];
      if (cur.length && (cur.length >= CHUNK_PART || size + len > CHUNK_BYTES)) { parts.push([]); size = 0; }
      parts[parts.length - 1].push(cell);
      size += len;
    }
    const n = parts.length;
    const out = parts.map((pc, i) => JSON.stringify({ t: "chunk", cx, cy, seq: this.seq, i, of: n, cells: pc, ...(i === 0 ? { ghosts } : {}) }));
    this.chunkCache.set(key, out);
    return out;
  }

  /** The overview: one character per 4 x 4 block, '.' for an empty block. */
  overview(): string {
    if (!this.ovArr) {
      const arr = new Array<string>(BLOCKS_PER_SIDE * BLOCKS_PER_SIDE).fill(".");
      for (const r of this.sql.exec("SELECT b, ch FROM blocks").toArray()) arr[Number(r.b)] = String(r.ch);
      this.ovArr = arr;
    }
    return this.ovArr.join("");
  }

  /** A viewer says which chunks it follows. It gets only the chunks that are new to it. One incoming message per pan or zoom stop. */
  subscribe(ws: WebSocket, msg: { c?: unknown; ov?: unknown }) {
    let m = 0;
    if (Array.isArray(msg.c)) {
      for (const pair of msg.c.slice(0, CH_N * CH_N)) {
        const [cx, cy] = Array.isArray(pair) ? pair : [];
        if (Number.isInteger(cx) && Number.isInteger(cy) && cx >= 0 && cy >= 0 && cx < CH_N && cy < CH_N) m |= chunkBit(cx, cy);
      }
    }
    const ov = msg.ov === 1 || msg.ov === true;
    const old = this.subOf(ws);
    for (let cy = 0; cy < CH_N; cy++) {
      for (let cx = 0; cx < CH_N; cx++) {
        const bit = chunkBit(cx, cy);
        if ((m & bit) && !(old.m & bit)) for (const part of this.chunkMessages(cx, cy)) ws.send(part);
      }
    }
    if (ov && !old.ov) ws.send(JSON.stringify({ t: "ov", w: BLOCKS_PER_SIDE, d: this.overview() }));
    ws.serializeAttachment({ m, ov } satisfies Sub); // recorded only after every send worked, so a failed send is retried by the next sub
  }

  // ---------- routing ----------
  async fetch(request: Request): Promise<Response> {
    const now = Date.now();
    try {
      if (request.method === "OPTIONS") {
        if (new URL(request.url).pathname.startsWith("/v1/admin/")) return adminNotFound();
        return new Response(null, { status: 204, headers: CORS });
      }
      this.rollDaily(now);
      this.rollSeason(now);
      this.maybePurge(now);
      return await this.route(request, now);
    } catch (e) {
      console.error("city: request failed", request.method, new URL(request.url).pathname, String(e));
      if (isFreeLimitError(e)) return json({ ok: false, code: "full", error: FULL_MESSAGE }, 503);
      return json({ ok: false, code: "server_error", error: "Something went wrong on our side. Try again in a minute." }, 500);
    }
  }

  origin = "";

  async route(request: Request, now: number): Promise<Response> {
    const url = new URL(request.url);
    this.origin = url.origin;
    const p = url.pathname;
    const m = request.method;

    if (p === "/v1/live") {
      if (request.headers.get("upgrade") !== "websocket") return bad("Expected a WebSocket connection.", 426, "upgrade_required");
      if (this.ctx.getWebSockets().length >= MAX_SOCKETS) return bad("Too many viewers right now. Try again in a minute.", 503, "busy");
      const pair = new WebSocketPair();
      const [client, server] = [pair[0], pair[1]];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ m: 0, ov: false } satisfies Sub);
      server.send(JSON.stringify({ t: "stats", ...this.stats(now) }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (p.startsWith("/v1/admin/")) return adminRoute(this, this.env.ADMIN_KEY, request, url, now);
    if (p === "/v1/health" && m === "GET") return json({ ok: true });
    if (p === "/v1/stats" && m === "GET") return jsonText(this.memoized(p + url.search, now, () => JSON.stringify(this.stats(now))));
    if (p === "/v1/world.txt" && m === "GET") return text(this.memoized(p + url.search, now, () => this.worldText(url, now)));
    if (p === "/v1/visits" && m === "POST") return this.createVisit(request, now);
    if (p === "/v1/bundle" && m === "POST") return this.bundle(request, now);
    if (p === "/v1/timelapse" && m === "GET") return this.timelapse(url, now);
    if (p === "/v1/seasons" && m === "GET") return jsonText(this.memoized(p, now, () => JSON.stringify(this.seasonsList())));
    if (p === "/v1/groups" && m === "GET") return this.groupList();
    if (p === "/v1/tags" && m === "GET") return jsonText(this.memoized(p, now, () => JSON.stringify(this.tagTop(50))));
    const tm = /^\/v1\/tags\/([A-Za-z]+)$/.exec(p);
    if (tm && m === "GET") return jsonText(this.memoized("/v1/tags/" + tm[1].toLowerCase(), now, () => JSON.stringify(this.tagCells(tm[1].toLowerCase()))));
    const gm = /^\/v1\/groups\/([A-Za-z]+-[A-Za-z]+)$/.exec(p);
    if (gm && m === "GET") return this.groupDetail(gm[1]);
    if (p === "/v1/plans" && m === "GET") return this.planList();
    const pm = /^\/v1\/plans\/([A-Za-z0-9_-]{6})$/.exec(p);
    if (pm && m === "GET" && PLAN_CODE.test(pm[1])) return this.planDetail(pm[1]);
    if (p === "/v1/rate" && m === "POST") return this.vote(request, now, "rate");
    if (p === "/v1/report" && m === "POST") return this.vote(request, now, "report");

    let mm = /^\/v1\/visits\/([\w-]{10,64})(?:\/(approve|moves))?$/.exec(p);
    if (mm) {
      const [, id, action] = mm;
      if (!action && m === "GET") return this.visitInfo(id, now);
      if (action === "approve" && m === "POST") return this.approve(request, id, now);
      if (action === "moves" && m === "POST") return this.moves(request, id, now);
    }
    mm = /^\/v1\/replay\/([\w-]{6,64})$/.exec(p);
    if (mm && m === "GET") return this.replay(mm[1]);
    return bad("Not found.", 404, "not_found");
  }

  // ---------- visits ----------
  /** A body as text, or null when it is longer than `max` bytes. Stops reading at max + 1 bytes, so a chunked body is bounded too. */
  async readCapped(request: Request, max: number): Promise<string | null> {
    if (!request.body) return "";
    const reader = request.body.getReader();
    const dec = new TextDecoder();
    let n = 0, out = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.byteLength;
      if (n > max) { await reader.cancel().catch(() => {}); return null; }
      out += dec.decode(value, { stream: true });
    }
    return out + dec.decode();
  }

  /** A ready body kept for MEMO_MS; `touched` and admin closing or opening areas drop it. */
  memoized(key: string, now: number, make: () => string): string {
    const hit = this.memo.get(key);
    if (hit && now - hit.at < MEMO_MS && now >= hit.at) return hit.body;
    if (this.memo.size >= 200) this.memo.clear();
    const body = make();
    this.memo.set(key, { at: now, body });
    return body;
  }

  async readJson(request: Request, max = 4096): Promise<Record<string, unknown> | null> {
    const t = await this.readCapped(request, max);
    if (t === null) return null;
    try {
      const v = JSON.parse(t);
      return v && typeof v === "object" ? v : null;
    } catch {
      return null;
    }
  }

  visitRow(id: string): Row | null {
    const r = this.sql.exec("SELECT * FROM visits WHERE id = ?", id).toArray();
    return r.length ? r[0] : null;
  }

  visitStatus(v: Row, now: number): "pending" | "approved" | "expired" {
    if (v.status === "expired") return "expired"; // ended by an admin undo
    if (v.status === "pending") return now - Number(v.created) > LIMITS.pendingTtlMs ? "expired" : "pending";
    return now > Number(v.approved_at) + LIMITS.visitTtlMs ? "expired" : "approved";
  }

  async createVisit(request: Request, now: number): Promise<Response> {
    const body = await this.readJson(request);
    const team = String(body?.team ?? "");
    if (!TEAMS.includes(team)) return bad(`team must be one of: ${TEAMS.join(", ")}`, 400, "bad_team");
    const ip = await this.ipHash(request, now);
    const stop = this.paused(ip, now);
    if (stop) return stop;
    const cap = dailyCaps(0, this.daily.visits, this.daily.cmds);
    if (cap) return json({ ok: false, code: "full", error: cap }, 429);
    if (this.daily.created >= 3 * LIMITS.globalVisitsPerDay) return json({ ok: false, code: "full", error: FULL_MESSAGE }, 429);
    if (this.ipCount(ip, "create", now) >= LIMITS.ipCreatesPerDay) return json({ ok: false, code: "limit", error: "Too many new visits from this network today. Come back after 00:00 UTC." }, 429);
    const id = rid(18);
    const pub = rid(8);
    this.sql.exec("INSERT INTO visits (id, pub, team, created, status) VALUES (?, ?, ?, ?, 'pending')", id, pub, team, now);
    this.bumpIp(ip, "create", now);
    this.daily.created++;
    this.flushMeta();
    const origin = new URL(request.url).origin;
    return json({ id, pub, watch_url: `${origin}/watch/${id}`, status: "pending" }, 201);
  }

  ipCount(ip: string, kind: string, now: number): number {
    if (ip === LOCAL_IP) return 0; // no Cloudflare header: local dev, so the per-IP caps do not apply
    const r = this.sql.exec("SELECT n FROM ipday WHERE day = ? AND ip_hash = ? AND kind = ?", dayKey(now), ip, kind).toArray();
    return r.length ? Number(r[0].n) : 0;
  }
  bumpIp(ip: string, kind: string, now: number) {
    this.sql.exec("INSERT INTO ipday (day, ip_hash, kind, n) VALUES (?, ?, ?, 1) ON CONFLICT(day, ip_hash, kind) DO UPDATE SET n = n + 1", dayKey(now), ip, kind);
  }

  visitInfo(id: string, now: number): Response {
    const v = this.visitRow(id);
    if (!v) return bad("Unknown visit.", 404, "not_found");
    const status = this.visitStatus(v, now);
    return json({
      pub: v.pub, team: v.team, status,
      expires_at: status === "pending" ? null : Number(v.approved_at) + LIMITS.visitTtlMs,
      commands_used: Number(v.cmd_total), applied: Number(v.applied),
      commands_left: Math.max(0, LIMITS.perVisitTotal - Number(v.cmd_total)),
      slots_left: slotsLeft(this.daily.visits, this.daily.cmds),
    });
  }

  async approve(request: Request, id: string, now: number): Promise<Response> {
    const body = await this.readJson(request);
    if (!body || body.age_confirmed !== true) return bad("You must confirm you are 18 or older.", 400, "age_required");
    const ip = await this.ipHash(request, now);
    const stop = this.paused(ip, now);
    if (stop) return stop;
    const v = this.visitRow(id);
    if (!v) return bad("Unknown visit.", 404, "not_found");
    const st = this.visitStatus(v, now);
    if (st === "approved") return json({ ok: true, status: "approved" });
    if (st === "expired") return bad("This visit expired. Ask your AI to start a new one.", 410, "expired");
    const cap = dailyCaps(this.ipCount(ip, "visit", now), this.daily.visits, this.daily.cmds);
    if (cap) return json({ ok: false, code: "full", error: cap }, 429);
    const ok = await verifyTurnstile(this.env.TURNSTILE_SECRET, body.turnstile_token, request.headers.get("cf-connecting-ip"), new URL(request.url).hostname);
    if (!ok) return bad("The human check failed. Reload the page and try again.", 403, "turnstile");
    // conditional: a second approve that waited on the human check at the same time must not count the visit twice
    const upd = this.sql.exec("UPDATE visits SET status = 'approved', approved_at = ?, ip_hash = ? WHERE id = ? AND status = 'pending'", now, ip, id);
    if (upd.rowsWritten === 0) return json({ ok: true, status: "approved" });
    this.bumpIp(ip, "visit", now);
    this.daily.visits++;
    this.flushMeta();
    this.broadcast({ t: "stats", ...this.stats(now) });
    return json({ ok: true, status: "approved" });
  }

  async moves(request: Request, id: string, now: number): Promise<Response> {
    const ip = await this.ipHash(request, now);
    const stop = this.paused(ip, now);
    if (stop) return stop;
    const v = this.visitRow(id);
    if (!v) return bad("Unknown visit.", 404, "not_found");
    const st = this.visitStatus(v, now);
    if (st === "pending") return bad("Waiting for your person to approve. Ask them to open the watch link and confirm.", 403, "pending");
    if (st === "expired") return bad("This visit expired. Start a new visit.", 410, "expired");
    const raw = await this.readCapped(request, MAX_LINE + 200);
    if (raw === null) return bad(`Line is longer than ${MAX_LINE} characters.`, 413, "too_long");
    let line = raw;
    if (line.trimStart().startsWith("{")) {
      try { line = String((JSON.parse(line) as { line?: unknown }).line ?? ""); } catch { /* fall through, parser rejects */ }
    }
    return this.runLine(v, line, now, ip);
  }

  /** Quota, caps, apply, persist, broadcast. Used by moves and bundle. */
  runLine(v: Row, line: string, now: number, ip = LOCAL_IP, already?: ReturnType<typeof parseLine>): Response {
    const parsed = already ?? parseLine(line);
    if (!parsed.ok) return json({ ok: false, code: parsed.code, error: parsed.message, results: [] }, 400);
    if (parsed.plan) return this.createPlan(v, parsed.items, now, ip);
    const capLeft = LIMITS.globalCommandsPerDay - this.daily.cmds;
    if (capLeft <= 0) return json({ ok: false, code: "full", error: FULL_MESSAGE, results: [] }, 429);
    // J: the first one on a visit sets its group (creates it when new); a different name later is refused
    const jItem = parsed.items.find((it) => it.ok && it.cmd.v === "J");
    let grp: string | null = v.grp ? String(v.grp) : null;
    if (jItem && jItem.ok && jItem.cmd.v === "J") {
      const id = jItem.cmd.id;
      if (grp && grp !== id) return json({ ok: false, code: "group_set", error: `This visit already plays for the group ${grp}. A visit has one group. Start a new visit to use ${id}.`, results: [] }, 400);
      if (!grp) {
        const exists = this.sql.exec("SELECT 1 FROM groups WHERE id = ?", id).toArray().length > 0;
        if (!exists && this.ipCount(ip, "group", now) >= LIMITS.groupsPerIpPerDay) {
          return json({ ok: false, code: "limit", error: `Limit: ${LIMITS.groupsPerIpPerDay} new groups per day from one network. Join an existing group, or come back after 00:00 UTC.`, results: [] }, 429);
        }
        this.tx(() => {
          if (exists) this.sql.exec("UPDATE groups SET visits = visits + 1 WHERE id = ?", id);
          else this.sql.exec("INSERT INTO groups (id, created, color, visits) VALUES (?, ?, ?, 1)", id, now, groupColor(id));
          this.sql.exec("UPDATE visits SET grp = ? WHERE id = ?", id, v.id);
          if (!exists) this.bumpIp(ip, "group", now);
        });
        this.memo.clear();
        grp = id;
      }
    }
    // T (team), J (group) and K (tags) do not count toward the quotas.
    const quotaCount = parsed.items.filter((it) => !(it.ok && (it.cmd.v === "T" || it.cmd.v === "J" || it.cmd.v === "K"))).length;
    const q = commandQuota(Number(v.cmd_total), this.netWindow(ip), now, quotaCount);
    const allowed = Math.min(q.allowed, capLeft);
    const used = Math.min(allowed, quotaCount);
    const team = String(v.team);
    const pub = String(v.pub);
    const changes: { cell: Cell; seq: number }[] = [];
    this.putLog = [];
    let lr: ReturnType<typeof applyItems>;
    try {
      lr = this.ctx.storage.transactionSync(() => {
        const r = applyItems(this.store, { team, pub, grp, now, open: openArea(this.rings), frozen: this.frozen() }, parsed.items, allowed, q.reason, q.code);
        let pi = 0;
        for (const res of r.results) {
          if (!res.changed) continue;
          const lg = this.putLog![pi++]; // one put per changed result, in order: the cell as it was just before this command
          let prev: string | null = null;
          if (lg && lg.x === res.changed.x && lg.y === res.changed.y) prev = lg.old ? prevOf(lg.old, res.changed) : "empty";
          else console.error("runLine: put log does not match the result", res.cmd);
          const ev = this.sql.exec("INSERT INTO events (ts, pub, x, y, cmd, team, prev, grp) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING seq", now, pub, res.changed.x, res.changed.y, res.canon ?? res.cmd, team, prev, grp).one();
          this.seq = Number(ev.seq);
          this.lastCell = [res.changed.x, res.changed.y];
          changes.push({ cell: res.changed, seq: this.seq });
        }
        this.sql.exec("UPDATE visits SET cmd_total = cmd_total + ?, applied = applied + ?, last_move = ? WHERE id = ?", used, r.applied, now, v.id);
        if (used > 0) this.saveNetWindow(ip, q.net);
        this.daily.cmds += r.applied;
        this.daily.teams[team] = (this.daily.teams[team] || 0) + r.applied;
        this.growOpenArea(now);
        this.flushMeta();
        return r;
      });
    } finally {
      this.putLog = null;
    }
    this.activeCache.at = 0;
    for (const ch of changes) if (ch.cell.style) this.planProgress(ch.cell, team, now);
    for (const ch of changes) this.broadcastCell(ch.cell.x, ch.cell.y, { t: "c", seq: ch.seq, team, cell: cellWire(ch.cell) });
    this.flushOv();
    if (changes.length) this.broadcast({ t: "stats", ...this.stats(now) });
    const results = replyResults(lr.results);
    const skipped = results.filter((r) => !r.ok).map((r) => `${r.cmd}: ${r.message}`);
    const summary = `Applied ${lr.applied} of ${lr.results.length}.` + (skipped.length ? ` Skipped: ${skipped.join(" | ")}` : "");
    return json({
      ok: true, applied: lr.applied, results, summary,
      commands_left: Math.max(0, LIMITS.perVisitTotal - Number(v.cmd_total) - used),
      pub,
      ...(grp ? { group: grp } : {}),
    });
  }

  // ---------- per-network wait ----------
  /** The command window of a network, or null. One small row per network; old rows are purged hourly. */
  netWindow(ip: string): NetWindow | null {
    const r = this.sql.exec("SELECT start, n FROM netwin WHERE ip_hash = ?", ip).toArray();
    return r.length ? { start: Number(r[0].start), n: Number(r[0].n) } : null;
  }
  saveNetWindow(ip: string, w: NetWindow) {
    this.sql.exec("INSERT INTO netwin (ip_hash, start, n) VALUES (?, ?, ?) ON CONFLICT(ip_hash) DO UPDATE SET start = excluded.start, n = excluded.n", ip, w.start, w.n);
  }

  // ---------- seasons ----------
  /** Start the first season (at the first run) or roll to the next one when the running season has reached its end. Lazy: any request calls it.
   * The map is never reset. The ended season keeps the cells held per team at that moment and the last event seq before its end. */
  rollSeason(now: number) {
    if (!this.season) {
      const cur = this.sql.exec("SELECT num, starts, ends FROM seasons WHERE end_seq IS NULL ORDER BY num DESC LIMIT 1").toArray();
      if (cur.length) this.season = { num: Number(cur[0].num), starts: Number(cur[0].starts), ends: Number(cur[0].ends) };
      else {
        const last = this.sql.exec("SELECT MAX(num) AS n FROM seasons").one();
        const num = Number(last.n || 0) + 1;
        this.season = { num, starts: now, ends: nextMonday(now) };
        this.sql.exec("INSERT INTO seasons (num, starts, ends) VALUES (?, ?, ?)", num, this.season.starts, this.season.ends);
      }
    }
    if (now < this.season.ends) return;
    const old = this.season;
    // the last event before the end: the scan runs back from the newest row and stops at the first match
    const endRow = this.sql.exec("SELECT seq FROM events WHERE ts < ? ORDER BY seq DESC LIMIT 1", old.ends).toArray();
    const teams: Record<string, number> = {};
    for (const t of TEAMS) teams[t] = Math.max(0, this.agg.teams[t] || 0);
    const starts = weekStart(now);
    const next = { num: old.num + 1, starts, ends: starts + WEEK_MS };
    this.tx(() => {
      this.sql.exec("UPDATE seasons SET end_seq = ?, scores = ? WHERE num = ?", endRow.length ? Number(endRow[0].seq) : 0, JSON.stringify({ teams, groups: this.topGroups(10) }), old.num);
      this.sql.exec("INSERT INTO seasons (num, starts, ends) VALUES (?, ?, ?)", next.num, next.starts, next.ends);
    });
    this.season = next;
    this.memo.clear();
  }

  seasonsList() {
    const past = this.sql.exec("SELECT num, starts, ends, end_seq, scores FROM seasons WHERE end_seq IS NOT NULL ORDER BY num DESC LIMIT 200").toArray();
    return {
      current: this.season ? { num: this.season.num, starts: this.season.starts, ends: this.season.ends } : null,
      past: past.map((r) => ({ num: Number(r.num), starts: Number(r.starts), ends: Number(r.ends), end_seq: Number(r.end_seq), scores: JSON.parse(String(r.scores || "{}")) })),
    };
  }

  // ---------- shared plans ----------
  planRow(id: string): Row | null {
    const r = this.sql.exec("SELECT * FROM plans WHERE id = ?", id).toArray();
    return r.length ? r[0] : null;
  }
  planCells(id: string): Target[] {
    return this.sql.exec("SELECT * FROM plan_cells WHERE plan = ? ORDER BY y, x", id).toArray().map(rowToTarget);
  }
  /** Target cells of a plan whose cell holds no building of the planned style yet. */
  planMissing(id: string): Target[] {
    return this.sql.exec(
      `SELECT * FROM plan_cells p WHERE p.plan = ? AND NOT EXISTS
         (SELECT 1 FROM cells c WHERE c.x = p.x AND c.y = p.y AND c.style = p.style AND c.hidden = 0) ORDER BY p.y, p.x`, id,
    ).toArray().map(rowToTarget);
  }
  planDoneCount(id: string): number {
    return Number(this.sql.exec(
      "SELECT COUNT(*) AS n FROM plan_cells p JOIN cells c ON c.x = p.x AND c.y = p.y WHERE p.plan = ? AND c.style = p.style AND c.hidden = 0", id,
    ).one().n);
  }
  planInfo(r: Row) {
    return { code: String(r.id), name: String(r.name), team: String(r.team), created: Number(r.created), status: String(r.status), done: Number(r.done), total: Number(r.total), help: JSON.parse(String(r.help || "{}")) as Record<string, number> };
  }
  ghostWire(code: string, name: string, t: Target) {
    return { ...planWire(t), p: code, n: name };
  }
  /** Tell viewers about plan ghosts: each viewer gets only the ghosts in chunks it follows. */
  sendGhosts(code: string, name: string, cells: Target[]) {
    for (const t of cells) this.chunkCache.delete((t.y >> CHUNK_SHIFT) * CH_N + (t.x >> CHUNK_SHIFT));
    for (const ws of this.ctx.getWebSockets()) {
      const sub = this.subOf(ws);
      const g = cells.filter((t) => sub.m & chunkBit(t.x >> CHUNK_SHIFT, t.y >> CHUNK_SHIFT)).map((t) => this.ghostWire(code, name, t));
      if (!g.length) continue;
      try { ws.send(JSON.stringify({ t: "g", g })); } catch (e) { console.error("sendGhosts: send failed", String(e)); }
    }
  }
  endPlan(r: Row, status: PlanStatus, now: number) {
    const code = String(r.id);
    this.sql.exec("UPDATE plans SET status = ?, ended = ? WHERE id = ?", status, now, code);
    for (const t of this.planCells(code)) this.chunkCache.delete((t.y >> CHUNK_SHIFT) * CH_N + (t.x >> CHUNK_SHIFT));
    this.broadcast({ t: "gdel", p: code });
  }

  /** A line that starts with P: make a plan (a ghost of a big build) instead of building. Costs one command of the visit. */
  createPlan(v: Row, items: import("../public/kit.js").ParsedItem[], now: number, ip: string): Response {
    const q = commandQuota(Number(v.cmd_total), this.netWindow(ip), now, 1);
    if (q.allowed < 1) return json({ ok: false, code: q.code, error: q.reason || "Rate limit.", results: [] }, 429);
    if (this.daily.cmds >= LIMITS.globalCommandsPerDay) return json({ ok: false, code: "full", error: FULL_MESSAGE, results: [] }, 429);
    const active = Number(this.sql.exec("SELECT COUNT(*) AS n FROM plans WHERE status = 'active'").one().n);
    const cap = planCaps(this.ipCount(ip, "plan", now), active);
    if (cap) return json({ ok: false, code: "limit", error: cap, results: [] }, 429);
    const area = openArea(this.rings);
    const { targets, results } = planTargets(items, area, this.frozen());
    const nameItem = items.find((it) => it.ok && it.cmd.v === "P");
    const name = nameItem && nameItem.ok && nameItem.cmd.v === "P" ? nameItem.cmd.name : "Plan";
    if (!targets.length) return json({ ok: false, code: "empty_plan", error: "No valid B command is inside the open area.", results }, 400);
    // the banned-shape check also covers plan targets: the finished plan must not make a banned layout
    const occ = new Set(targets.map((t) => `${t.x},${t.y}`));
    for (const t of targets) {
      for (const c of this.store.region(t.x - 4, t.y - 4, t.x + 4, t.y + 4)) if (occupies(c)) occ.add(`${c.x},${c.y}`);
    }
    for (const t of targets) {
      if (createsBannedLayout((x, y) => occ.has(`${x},${y}`), t.x, t.y)) {
        return json({ ok: false, code: "banned_layout", error: "That layout is not allowed. Change the plan.", results }, 400);
      }
    }
    for (const t of targets) {
      const busy = Number(this.sql.exec("SELECT COUNT(*) AS n FROM plan_cells c JOIN plans p ON p.id = c.plan WHERE c.x = ? AND c.y = ? AND p.status = 'active'", t.x, t.y).one().n);
      if (busy >= MAX_ACTIVE_PLANS_PER_CELL) {
        return json({ ok: false, code: "plan_cell_busy", error: `The cell ${t.x},${t.y} is already in ${MAX_ACTIVE_PLANS_PER_CELL} active plans. Pick other cells or wait for a plan to end.`, results }, 409);
      }
    }
    const team = String(v.team);
    const code = rid(4);
    this.ctx.storage.transactionSync(() => {
      this.sql.exec("INSERT INTO plans (id, name, team, created, status, last_progress, total) VALUES (?, ?, ?, ?, 'active', ?, ?)", code, name, team, now, now, targets.length);
      for (const t of targets) {
        this.sql.exec("INSERT INTO plan_cells (plan, x, y, cx, cy, style, h, pal, seed, parts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
          code, t.x, t.y, t.x >> CHUNK_SHIFT, t.y >> CHUNK_SHIFT, t.style, t.h, t.pal, t.seed, partsToStr(t.parts));
      }
      const done = this.planDoneCount(code);
      this.sql.exec("UPDATE plans SET done = ? WHERE id = ?", done, code);
      this.sql.exec("UPDATE visits SET cmd_total = cmd_total + 1, applied = applied + 1, last_move = ? WHERE id = ?", now, v.id);
      this.saveNetWindow(ip, q.net);
      this.daily.cmds += 1;
      this.bumpIp(ip, "plan", now);
      this.flushMeta();
    });
    this.activeCache.at = 0;
    const row = this.planRow(code)!;
    this.sendGhosts(code, name, targets);
    this.broadcast({ t: "plan", p: code, done: Number(row.done), total: targets.length, status: "active" });
    const origin = this.origin;
    return json({
      ok: true, applied: 1, plan: { code, name, url: `${origin}/p/${code}`, total: targets.length, done: Number(row.done) },
      results: replyResults(results),
      summary: `Plan "${name}" started with ${targets.length} cells. Share ${origin}/p/${code} so other AIs can help.`,
      commands_left: Math.max(0, LIMITS.perVisitTotal - Number(v.cmd_total) - 1),
      pub: String(v.pub),
    });
  }

  /** After builds: update the progress of plans whose target cells were just built or overwritten. A built plan stays active; an overwritten cell counts as missing again. */
  planProgress(cell: Cell, team: string, now: number) {
    const rows = this.sql.exec(
      "SELECT p.* FROM plan_cells c JOIN plans p ON p.id = c.plan WHERE c.x = ? AND c.y = ? AND p.status = 'active'", cell.x, cell.y,
    ).toArray();
    for (const r of rows) {
      const code = String(r.id);
      const done = this.planDoneCount(code);
      const help = JSON.parse(String(r.help || "{}")) as Record<string, number>;
      const mine = this.sql.exec("SELECT 1 FROM plan_cells WHERE plan = ? AND x = ? AND y = ? AND style = ?", code, cell.x, cell.y, cell.style).toArray().length > 0;
      if (mine) help[team] = (help[team] || 0) + 1;
      const progressed = done > Number(r.done);
      this.sql.exec("UPDATE plans SET done = ?, help = ?, last_progress = ? WHERE id = ?", done, JSON.stringify(help), progressed ? now : Number(r.last_progress), code);
      this.broadcast({ t: "plan", p: code, done, total: Number(r.total), status: "active" });
    }
  }

  planList(): Response {
    const rows = this.sql.exec("SELECT * FROM plans WHERE status = 'active' ORDER BY created DESC LIMIT 30").toArray();
    return json({ plans: rows.map((r) => ({ ...this.planInfo(r), url: `${this.origin}/p/${r.id}` })) });
  }

  planDetail(code: string): Response {
    const r = this.planRow(code);
    if (!r) return bad("Unknown plan.", 404, "not_found");
    const info = this.planInfo(r);
    const cells = this.planCells(code);
    const missing = info.status === "active" ? this.planMissing(code) : [];
    const kit = (t: Target) => [`B.${t.x}.${t.y}.${t.style}.${t.h}.${t.pal}.${t.seed}`, ...t.parts.map((p) => `E.${t.x}.${t.y}.${p.part}.${p.side}.${p.h}`)];
    return json({
      ...info, url: `${this.origin}/p/${code}`,
      cells: cells.map(planWire),
      missing: missing.map((t) => ({ x: t.x, y: t.y, kit: kit(t) })),
      missing_kit: missing.flatMap(kit),
    });
  }

  /** Grow the open area by whole rings while 70% of it holds buildings. Call inside the write transaction. */
  growOpenArea(now: number) {
    if (growRings(this.rings, Math.max(0, this.agg.buildings)) === this.rings) return;
    if (now - this.freshCache.at >= 60_000) { // recount at most once a minute: many faded buildings keep agg.buildings over the threshold
      this.freshCache = { at: now, n: Number(this.sql.exec("SELECT COUNT(*) AS n FROM cells WHERE style IS NOT NULL AND hidden = 0 AND last_like > ?", now - LIMITS.fadeAfterMs).one().n) }; // faded buildings do not count
    }
    const fresh = this.freshCache.n;
    const k = growRings(this.rings, fresh);
    if (k === this.rings) return;
    this.rings = k;
    this.setMeta("open", String(k));
  }

  async bundle(request: Request, now: number): Promise<Response> {
    const body = await this.readJson(request, MAX_LINE + 2048 + 512); // a full line, a Turnstile token (up to 2048) and the other fields
    if (!body) return bad("Send JSON with line, team, age_confirmed and turnstile_token.");
    if (body.age_confirmed !== true) return bad("You must confirm you are 18 or older.", 400, "age_required");
    const team = String(body.team ?? "");
    if (!TEAMS.includes(team)) return bad(`team must be one of: ${TEAMS.join(", ")}`, 400, "bad_team");
    const line = String(body.line ?? "");
    const parsed = parseLine(line);
    if (!parsed.ok) return json({ ok: false, code: parsed.code, error: parsed.message, results: [] }, 400);
    const ip = await this.ipHash(request, now);
    const stop = this.paused(ip, now);
    if (stop) return stop;
    const cap = dailyCaps(this.ipCount(ip, "visit", now), this.daily.visits, this.daily.cmds);
    if (cap) return json({ ok: false, code: "full", error: cap }, 429);
    const ok = await verifyTurnstile(this.env.TURNSTILE_SECRET, body.turnstile_token, request.headers.get("cf-connecting-ip"), new URL(request.url).hostname);
    if (!ok) return bad("The human check failed. Reload the page and try again.", 403, "turnstile");
    const id = rid(18);
    const pub = rid(8);
    this.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status, ip_hash) VALUES (?, ?, ?, ?, ?, 'approved', ?)", id, pub, team, now, now, ip);
    this.bumpIp(ip, "visit", now);
    this.daily.visits++;
    this.flushMeta();
    return this.runLine(this.visitRow(id)!, line, now, ip, parsed);
  }

  replay(pub: string): Response {
    const v = this.sql.exec("SELECT team, created, approved_at FROM visits WHERE pub = ?", pub).toArray();
    // the visits row is purged after 14 days; the events stay, and then give the team and the time
    const first = v.length ? [] : this.sql.exec("SELECT team, ts FROM events WHERE pub = ? ORDER BY seq LIMIT 1", pub).toArray();
    if (!v.length && !first.length) return bad("Unknown visit.", 404, "not_found");
    const ev = this.sql.exec("SELECT seq, ts, x, y, cmd FROM events WHERE pub = ? AND gone = 0 ORDER BY seq LIMIT 100", pub).toArray();
    const team = v.length ? v[0].team : first[0].team;
    const at = v.length ? Number(v[0].approved_at) || Number(v[0].created) : Number(first[0].ts);
    return json({ pub, team, at, events: ev.map((e) => ({ seq: e.seq, ts: e.ts, x: e.x, y: e.y, cmd: e.cmd })) });
  }

  /** Pages of 1,000 visible events for /timelapse. The client asks with after = 0, then with the `next` it got.
   * A full page (1,000 events and more after it) is cached by the browser for a year. An admin can hide events later, which
   * changes old pages; that is accepted: a hidden thing may still play for a person who already loaded that page. */
  timelapse(url: URL, now: number): Response {
    const day = dayKey(now);
    if (!this.tl) {
      const t = this.getMeta("tl");
      this.tl = t ? (JSON.parse(t) as { day: string; rows: number }) : { day, rows: 0 };
    }
    if (this.tl.day !== day) this.tl = { day, rows: 0 };
    if (this.tl.rows >= TIMELAPSE_DAY_ROWS) return bad("The time-lapse is resting today. Come back after 00:00 UTC.", 429, "resting");
    const a = Number(url.searchParams.get("after") ?? 0);
    const after = Number.isSafeInteger(a) && a > 0 ? a : 0;
    const u = Number(url.searchParams.get("until") ?? 0); // optional: stop at this event seq (a season's end_seq)
    const until = Number.isSafeInteger(u) && u > 0 ? u : Number.MAX_SAFE_INTEGER;
    const rows = this.sql.exec("SELECT seq, ts, x, y, cmd, team FROM events WHERE seq > ? AND seq <= ? AND gone = 0 ORDER BY seq LIMIT ?", after, until, TIMELAPSE_PAGE + 1).toArray();
    const full = rows.length > TIMELAPSE_PAGE;
    const events = (full ? rows.slice(0, TIMELAPSE_PAGE) : rows).map((e) => ({ seq: e.seq, ts: e.ts, x: e.x, y: e.y, cmd: e.cmd, team: e.team }));
    this.tl.rows += rows.length;
    // persist at most once a minute: every page request writing a row would eat the daily write limit the builds need
    if (now - this.tlSaved >= 60_000) { this.setMeta("tl", JSON.stringify(this.tl)); this.tlSaved = now; }
    if (this.firstTs === null) {
      const f = this.sql.exec("SELECT ts FROM events ORDER BY seq LIMIT 1").toArray();
      if (f.length) this.firstTs = Number(f[0].ts);
    }
    const res = json({ ok: true, events, next: full ? events[events.length - 1].seq : null, first_ts: this.firstTs, last_seq: this.seq });
    if (full) res.headers.set("cache-control", "public, max-age=31536000, immutable");
    return res;
  }

  // ---------- votes ----------
  async vote(request: Request, now: number, type: "rate" | "report"): Promise<Response> {
    const body = await this.readJson(request);
    if (!body) return bad("Send JSON.");
    const ip = await this.ipHash(request, now);
    const stop = this.paused(ip, now);
    if (stop) return stop;
    const x = Number(body.x), y = Number(body.y);
    const device = String(body.device ?? "");
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= GRID || y >= GRID) return bad("x and y must be cells 0-199.");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(device)) return bad("device must be a random id of 8-64 letters or digits.");
    let like = 0;
    if (type === "rate") {
      if (body.vote !== 1 && body.vote !== -1) return bad("vote must be 1 or -1.");
      like = body.vote as number;
    }
    const cell = this.store.get(x, y);
    if (!cell || cell.hidden || (!cell.style && !cell.claim && !cell.sign)) return bad("Nothing is there.", 404, "not_found");
    if (this.ipCount(ip, "vote", now) >= LIMITS.votesPerIpPerDay) return json({ ok: false, code: "limit", error: "Too many votes today from this network." }, 429);
    const day = dayKey(now);
    if (type === "report") {
      const same = this.sql.exec("SELECT 1 FROM votes WHERE x = ? AND y = ? AND type = 'report' AND ip_hash = ?", x, y, ip).toArray();
      if (same.length) return json({ ok: false, code: "duplicate", error: "You already reported this cell." }, 409);
    }
    if (type === "rate" && ip !== LOCAL_IP) { // one vote per network, cell and day, whatever device id it sends
      const same = this.sql.exec("SELECT 1 FROM votes WHERE x = ? AND y = ? AND day = ? AND type = 'rate' AND ip_hash = ?", x, y, day, ip).toArray();
      if (same.length) return json({ ok: false, code: "duplicate", error: "You already did this for this cell today." }, 409);
    }
    const ins = this.sql.exec("INSERT OR IGNORE INTO votes (x, y, day, type, device, ip_hash) VALUES (?, ?, ?, ?, ?, ?)", x, y, day, type, device, ip);
    if (ins.rowsWritten === 0) return json({ ok: false, code: "duplicate", error: "You already did this for this cell today." }, 409);
    this.bumpIp(ip, "vote", now);
    const c = { ...cell };
    if (type === "report") c.reports++;
    else if (like > 0) { c.likes++; c.lastLike = now; }
    else c.downs++;
    const hide = shouldHide(c.likes, c.downs, c.reports, c.style);
    if (hide) c.hidden = true;
    this.store.put(c);
    if (hide) {
      this.sql.exec("UPDATE events SET gone = 1 WHERE x = ? AND y = ? AND seq <= ?", x, y, this.seq);
      this.flushMeta();
      this.broadcastCell(x, y, { t: "c", seq: this.seq, cell: { x, y, gone: 1 } });
      this.broadcast({ t: "stats", ...this.stats(now) });
    } else if (like > 0) {
      this.broadcastCell(x, y, { t: "c", seq: this.seq, cell: cellWire(c) });
    }
    this.flushOv();
    return json({ ok: true, hidden: hide });
  }

  // ---------- world.txt ----------
  worldText(url: URL, now: number): string {
    const area = openArea(this.rings);
    let nx = Math.round((area.x0 + area.x1) / 2), ny = Math.round((area.y0 + area.y1) / 2);
    const near = url.searchParams.get("near");
    const nm = near ? /^(\d{1,3}),(\d{1,3})$/.exec(near) : null;
    if (nm) { nx = Number(nm[1]); ny = Number(nm[2]); }
    else {
      const last = this.loadLastCell();
      if (last) { nx = last[0]; ny = last[1]; }
    }
    nx = Math.max(area.x0, Math.min(area.x1, nx)); // the view stays inside the open area, where free cells exist
    ny = Math.max(area.y0, Math.min(area.y1, ny));
    const R = 10;
    const cells = this.store.region(nx - R, ny - R, nx + R, ny + R);
    const dist = (c: { x: number; y: number }) => Math.max(Math.abs(c.x - nx), Math.abs(c.y - ny)) * 1000 + Math.abs(c.x - nx) + Math.abs(c.y - ny);
    cells.sort((a, b) => dist(a) - dist(b));
    const st = this.stats(now);
    const topG = this.topGroups(5);
    const head = [
      `Spare Credits world, kit cm1. Open area: x ${area.x0}-${area.x1}, y ${area.y0}-${area.y1} (${area.x1 - area.x0 + 1} x ${area.y1 - area.y0 + 1} cells, inside a ${GRID}x${GRID} grid). Commands outside it are refused ("outside the city edge"). It grows by 5 cells on every side when ${Math.round(OPEN_FILL * 100)}% of it holds buildings. Day ${st.day}. Slots left today: ${st.slots_left}.`,
      `Team cells: ${TEAMS.map((t) => `${t} ${st.teams[t]}`).join(", ")}. Buildings: ${st.buildings}.`,
      ...(topG.length ? [`Top groups: ${topG.map((g) => `${g.id} ${g.cells}`).join(", ")}`] : []),
      `View centered on ${nx},${ny} (radius ${R}). Lines below are kit values; "by" is the team.`,
    ];
    const body: string[] = [];
    const occupied = new Set<string>();
    for (const c of cells) {
      occupied.add(`${c.x},${c.y}`);
      const faded = (decayState(c.lastLike, now) === "faded" ? " faded" : "") + (c.grp ? ` for ${c.grp}` : "") + (c.tags && c.style ? ` tags ${c.tags}` : "");
      if (c.style === "free") body.push(`F.${c.x}.${c.y} free 3D model, ${c.shape ? c.shape.split("_").length : 0} shapes, height ${c.h} by ${c.team}${faded}`);
      else if (c.style === "picture") { const pic = c.shape ? c.shape.split(".") : []; body.push(`G.${c.x}.${c.y} free picture, ${pic[1]}x${pic[2]} facing ${pic[0]}, height ${c.h} by ${c.team}${faded}`); }
      else if (c.style) body.push(`B.${c.x}.${c.y}.${c.style}.${c.h}.${c.pal}.${c.seed} by ${c.team}${faded}`);
      for (const p of c.parts) body.push(`E.${c.x}.${c.y}.${p.part}.${p.side}.${p.h}`);
      if (c.sign) body.push(`S.${c.x}.${c.y}.${signText(c.sign)}  (${fillTemplate(c.sign.tpl, c.sign.words)})`);
      if (c.claim) body.push(`C.${c.x}.${c.y} by ${c.team}${c.grp ? ` for ${c.grp}` : ""}`);
    }
    const frozen = this.frozen();
    const free: string[] = [];
    for (let r = 0; r <= R && free.length < 36; r++) {
      for (let dy = -r; dy <= r && free.length < 36; dy++) {
        for (let dx = -r; dx <= r && free.length < 36; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = nx + dx, y = ny + dy;
          if (!inArea(area, x, y) || occupied.has(`${x},${y}`) || isFrozen(frozen, x, y)) continue;
          free.push(`${x}.${y}`);
        }
      }
    }
    const tail = [`Free cells nearby (x.y): ${free.join(" ")}`];
    const plans = this.sql.exec("SELECT id, name, done, total FROM plans WHERE status = 'active' ORDER BY created DESC LIMIT 5").toArray();
    if (plans.length) tail.push(`Open plans (help one: GET ${this.origin}/v1/plans/<code> lists its missing cells; start one with a P line): ` + plans.map((r) => `${r.id} "${r.name}" ${r.done}/${r.total}`).join(", "));
    let out = head.join("\n") + "\nThings here:\n";
    const budget = 3900 - out.length - tail.join("\n").length - 40;
    let used = 0;
    let cut = 0;
    for (const l of body) {
      if (used + l.length + 1 > budget) { cut++; continue; }
      out += l + "\n";
      used += l.length + 1;
    }
    if (!body.length) out += "(empty, every cell is free)\n";
    if (cut) out += `(${cut} farther lines left out)\n`;
    return out + tail.join("\n") + "\n";
  }

  // ---------- housekeeping ----------
  maybePurge(now: number) {
    if (now - this.lastPurge < 3_600_000) return;
    this.lastPurge = now;
    const idle = this.sql.exec("SELECT * FROM plans WHERE status = 'active' AND last_progress < ?", now - LIMITS.planIdleMs).toArray();
    for (const r of idle) this.endPlan(r, planState("active", Number(r.last_progress), now), now);
    const old = now - LIMITS.retainMs;
    this.sql.exec("DELETE FROM plan_cells WHERE plan IN (SELECT id FROM plans WHERE status != 'active' AND ended < ?)", old);
    this.sql.exec("DELETE FROM plans WHERE status != 'active' AND ended < ?", old);
    this.sql.exec("DELETE FROM visits WHERE created < ?", old);
    this.sql.exec("DELETE FROM votes WHERE day < ?", dayKey(old));
    this.sql.exec("DELETE FROM bans WHERE day < ?", dayKey(now));
    this.sql.exec("DELETE FROM ipday WHERE day < ?", dayKey(now - 2 * 86_400_000));
    this.sql.exec("DELETE FROM netwin WHERE start < ?", now - LIMITS.netWindowMs);
  }

  // The only message a viewer sends is {t:"sub", c:[[cx,cy],...], ov:0|1}: one per pan or zoom stop (incoming messages are billed 20:1).
  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    if (typeof message !== "string" || message.length > 600) return;
    try {
      const msg = JSON.parse(message) as { t?: string; c?: unknown; ov?: unknown };
      if (msg && msg.t === "sub") this.subscribe(ws, msg);
    } catch (e) {
      console.error("webSocketMessage: bad message", String(e));
    }
  }
  webSocketClose(ws: WebSocket, code: number) {
    try { ws.close(code === 1005 ? 1000 : code); } catch { /* already closed */ }
  }
  webSocketError(ws: WebSocket) {
    try { ws.close(1011); } catch { /* already closed */ }
  }
}

