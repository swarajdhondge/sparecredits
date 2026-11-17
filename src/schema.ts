// Database schema and migrations for the City object. Pure SQL, no Cloudflare imports, so tests can run it on any SQLite.
import { CHUNK_SHIFT, growRings, openArea } from "../public/kit.js";

/** The part of SqlStorage this file needs. */
export interface SqlLike {
  exec(query: string, ...bindings: unknown[]): { toArray(): Record<string, unknown>[] };
}

export const SCHEMA_VERSION = 10;
/** v1 -> v2: the grid grew from 100 to 200 cells wide, so every old coordinate moves by this much. */
export const SHIFT_V2 = 50;
// v2 -> v3: events.gone (1 = hidden from replays and the time-lapse) and the events_xy index. No event row is deleted or edited.
// v3 -> v4: events.prev (the cell before the event, for admin undo; NULL on older events) and the audit table. No row is deleted or edited.
// v4 -> v5: visits.ip_hash (the daily-salted hash, '' on older visits) and the bans and frozen tables. No row is deleted or edited.
// v5 -> v6: cells.shape (the shapes of a free 3D model or the pixels of a picture; NULL on every older cell). No row is deleted or edited.
// v6 -> v7: the votes_ip index (one vote per network, cell, day and type). No row is deleted or edited.
// v7 -> v8: the seasons table and the netwin table (one command window per network). No row is deleted or edited.
// v8 -> v9: the groups table and the grp column on visits, cells and events (NULL on every older row), with the cells_grp index. No row is deleted or edited.
// v9 -> v10: cells.tags (the K words of a build like "tree.lantern"; NULL on every older cell) and the partial cells_tags index. No row is deleted or edited.

const num = (v: unknown) => Number(v);

function getMeta(s: SqlLike, k: string): string | null {
  const r = s.exec("SELECT v FROM meta WHERE k = ?", k).toArray();
  return r.length ? String(r[0].v) : null;
}
function setMeta(s: SqlLike, k: string, v: string) {
  s.exec("INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
}

function hasColumn(s: SqlLike, table: string, col: string): boolean {
  return s.exec(`PRAGMA table_info(${table})`).toArray().some((r) => r.name === col);
}
function hasTable(s: SqlLike, table: string): boolean {
  return s.exec("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", table).toArray().length > 0;
}

/** Create every table that does not exist yet (new layout). Safe to run on every start. */
export function createTables(s: SqlLike) {
  s.exec(`CREATE TABLE IF NOT EXISTS cells (
    x INTEGER NOT NULL, y INTEGER NOT NULL, cx INTEGER NOT NULL DEFAULT 0, cy INTEGER NOT NULL DEFAULT 0,
    style TEXT, h INTEGER NOT NULL DEFAULT 0, pal INTEGER NOT NULL DEFAULT 0,
    seed INTEGER NOT NULL DEFAULT 0, parts TEXT NOT NULL DEFAULT '', sign TEXT, claim INTEGER NOT NULL DEFAULT 0,
    team TEXT NOT NULL, built_at INTEGER NOT NULL DEFAULT 0, team_at INTEGER NOT NULL DEFAULT 0, sign_at INTEGER NOT NULL DEFAULT 0,
    last_like INTEGER NOT NULL, likes INTEGER NOT NULL DEFAULT 0, downs INTEGER NOT NULL DEFAULT 0, reports INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0, visit TEXT NOT NULL, shape TEXT, grp TEXT, tags TEXT, PRIMARY KEY (x, y))`);
  s.exec(`CREATE INDEX IF NOT EXISTS cells_grp ON cells (grp)`);
  s.exec(`CREATE INDEX IF NOT EXISTS cells_tags ON cells (tags) WHERE tags IS NOT NULL`);
  s.exec(`CREATE INDEX IF NOT EXISTS cells_like ON cells (last_like)`);
  s.exec(`CREATE INDEX IF NOT EXISTS cells_chunk ON cells (cx, cy)`);
  s.exec(`CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY, pub TEXT NOT NULL UNIQUE, team TEXT NOT NULL, created INTEGER NOT NULL, approved_at INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL, cmd_total INTEGER NOT NULL DEFAULT 0, applied INTEGER NOT NULL DEFAULT 0,
    win_start INTEGER NOT NULL DEFAULT 0, win_count INTEGER NOT NULL DEFAULT 0, last_move INTEGER NOT NULL DEFAULT 0, ip_hash TEXT NOT NULL DEFAULT '', grp TEXT)`);
  s.exec(`CREATE INDEX IF NOT EXISTS visits_move ON visits (last_move)`);
  s.exec(`CREATE TABLE IF NOT EXISTS events (
    seq INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, pub TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL,
    cmd TEXT NOT NULL, team TEXT NOT NULL, gone INTEGER NOT NULL DEFAULT 0, prev TEXT, grp TEXT)`);
  s.exec(`CREATE INDEX IF NOT EXISTS events_pub ON events (pub)`);
  s.exec(`CREATE INDEX IF NOT EXISTS events_xy ON events (x, y)`);
  s.exec(`CREATE TABLE IF NOT EXISTS votes (
    x INTEGER NOT NULL, y INTEGER NOT NULL, day TEXT NOT NULL, type TEXT NOT NULL, device TEXT NOT NULL, ip_hash TEXT NOT NULL,
    PRIMARY KEY (x, y, day, type, device))`);
  s.exec(`CREATE INDEX IF NOT EXISTS votes_ip ON votes (x, y, day, type, ip_hash)`);
  s.exec(`CREATE TABLE IF NOT EXISTS ipday (day TEXT NOT NULL, ip_hash TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (day, ip_hash, kind))`);
  s.exec(`CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '')`);
  s.exec(`CREATE TABLE IF NOT EXISTS bans (day TEXT NOT NULL, ip_hash TEXT NOT NULL, PRIMARY KEY (day, ip_hash))`);
  s.exec(`CREATE TABLE IF NOT EXISTS frozen (id INTEGER PRIMARY KEY AUTOINCREMENT, x0 INTEGER NOT NULL, y0 INTEGER NOT NULL, x1 INTEGER NOT NULL, y1 INTEGER NOT NULL, ts INTEGER NOT NULL)`);
  // weekly seasons: end_seq is NULL while the season runs; scores is JSON {teams:{team:cells}, groups:[]} stored when it ends
  s.exec(`CREATE TABLE IF NOT EXISTS seasons (num INTEGER PRIMARY KEY, starts INTEGER NOT NULL, ends INTEGER NOT NULL, end_seq INTEGER, scores TEXT NOT NULL DEFAULT '')`);
  // the command window of one network (salted ip hash): start of the window and commands used in it
  s.exec(`CREATE TABLE IF NOT EXISTS netwin (ip_hash TEXT PRIMARY KEY, start INTEGER NOT NULL, n INTEGER NOT NULL)`);
  // word-named groups: id is "word1.word2", color a palette index 0-15 from the name, visits = visits that joined. Never deleted.
  s.exec(`CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, created INTEGER NOT NULL, color INTEGER NOT NULL, visits INTEGER NOT NULL DEFAULT 0)`);
  s.exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  // one character per 4 x 4 block of cells, for the zoomed-out overview (only non-empty blocks)
  s.exec(`CREATE TABLE IF NOT EXISTS blocks (b INTEGER PRIMARY KEY, ch TEXT NOT NULL)`);
  // shared plans: a ghost outline of a big build that anyone can help to fill
  s.exec(`CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, team TEXT NOT NULL, created INTEGER NOT NULL,
    status TEXT NOT NULL, last_progress INTEGER NOT NULL, done INTEGER NOT NULL DEFAULT 0, total INTEGER NOT NULL,
    help TEXT NOT NULL DEFAULT '{}', ended INTEGER NOT NULL DEFAULT 0)`);
  s.exec(`CREATE TABLE IF NOT EXISTS plan_cells (
    plan TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL, cx INTEGER NOT NULL, cy INTEGER NOT NULL,
    style TEXT NOT NULL, h INTEGER NOT NULL, pal INTEGER NOT NULL, seed INTEGER NOT NULL, parts TEXT NOT NULL DEFAULT '',
    PRIMARY KEY (plan, x, y))`);
  s.exec(`CREATE INDEX IF NOT EXISTS plan_cells_xy ON plan_cells (x, y)`);
  s.exec(`CREATE INDEX IF NOT EXISTS plan_cells_chunk ON plan_cells (cx, cy)`);
}

/** Overview character for claim-only blocks, by team (order of TEAMS). A block with a building uses the palette as a hex digit. */
export const CLAIM_CHARS = ["g", "h", "i", "j"];
export const blockIndex = (x: number, y: number, grid: number) => (y >> 2) * (grid >> 2) + (x >> 2);

/** Recompute the stored overview character of the block that holds (x, y). "" means an empty block. */
export function refreshBlock(s: SqlLike, x: number, y: number, grid: number, teams: string[]): { b: number; ch: string; changed: boolean } {
  const x0 = (x >> 2) << 2, y0 = (y >> 2) << 2;
  let best: { h: number; ch: string } | null = null;
  const rows: Record<string, unknown>[] = [];
  for (let cx = x0; cx < x0 + 4; cx++) { // one lookup per column: reads only the 16 cells of the block
    rows.push(...s.exec(
      "SELECT style, h, pal, claim, team FROM cells WHERE x = ? AND y BETWEEN ? AND ? AND hidden = 0 AND (style IS NOT NULL OR claim = 1)",
      cx, y0, y0 + 3,
    ).toArray());
  }
  for (const r of rows) {
    const cand = r.style
      ? { h: num(r.h) + 100, ch: num(r.pal).toString(16) }
      : { h: 0, ch: CLAIM_CHARS[Math.max(0, teams.indexOf(String(r.team)))] };
    if (!best || cand.h > best.h) best = cand;
  }
  const b = blockIndex(x, y, grid);
  const ch = best ? best.ch : "";
  const old = s.exec("SELECT ch FROM blocks WHERE b = ?", b).toArray();
  const oldCh = old.length ? String(old[0].ch) : "";
  if (ch === oldCh) return { b, ch, changed: false };
  if (ch) s.exec("INSERT INTO blocks (b, ch) VALUES (?, ?) ON CONFLICT(b) DO UPDATE SET ch = excluded.ch", b, ch);
  else s.exec("DELETE FROM blocks WHERE b = ?", b);
  return { b, ch, changed: true };
}

/** Rebuild the whole overview from the cells (used once by the migration). */
export function rebuildBlocks(s: SqlLike, grid: number, teams: string[]) {
  s.exec("DELETE FROM blocks");
  const seen = new Set<number>();
  for (const r of s.exec("SELECT x, y FROM cells WHERE hidden = 0 AND (style IS NOT NULL OR claim = 1)").toArray()) {
    const b = blockIndex(num(r.x), num(r.y), grid);
    if (seen.has(b)) continue;
    seen.add(b);
    refreshBlock(s, num(r.x), num(r.y), grid, teams);
  }
}

/** Shift the x and y of one command string like "B.12.7.tower.5.3.42" by `by`. Other text is returned unchanged. */
export function shiftCmd(cmd: string, by: number): string {
  const m = /^([A-Za-z])\.(\d+)\.(\d+)(\..*)?$/.exec(cmd);
  if (!m) return cmd;
  return `${m[1]}.${Number(m[2]) + by}.${Number(m[3]) + by}${m[4] || ""}`;
}

/**
 * Bring the database to SCHEMA_VERSION. Runs inside `tx` (a transaction), once: the version is recorded in meta.
 * v1 -> v2: every row of cells, votes and events moves by +50 on x and y, nothing is deleted, cx/cy are filled,
 * the open area is sized to hold every existing row, and the overview blocks are built.
 * v2 -> v3: only the events.gone column and the events_xy index are added.
 * v3 -> v4: only the events.prev column and the audit table are added.
 * v4 -> v5: only the visits.ip_hash column and the bans and frozen tables are added.
 * v5 -> v6: only the cells.shape column is added.
 * v6 -> v7: only the votes_ip index is added (createTables does it).
 * v7 -> v8: only the seasons and netwin tables are added (createTables does it).
 * v8 -> v9: only the groups table, the grp columns and the cells_grp index are added.
 * v9 -> v10: only the cells.tags column and the cells_tags index are added.
 */
export function ensureSchema(s: SqlLike, tx: (fn: () => void) => void, grid: number, teams: string[]) {
  const v1 = hasTable(s, "cells") && !hasColumn(s, "cells", "cx"); // old layout, never migrated
  tx(() => {
    if (v1) {
      s.exec("ALTER TABLE cells ADD COLUMN cx INTEGER NOT NULL DEFAULT 0");
      s.exec("ALTER TABLE cells ADD COLUMN cy INTEGER NOT NULL DEFAULT 0");
    }
    if (hasTable(s, "events") && !hasColumn(s, "events", "gone")) s.exec("ALTER TABLE events ADD COLUMN gone INTEGER NOT NULL DEFAULT 0");
    if (hasTable(s, "events") && !hasColumn(s, "events", "prev")) s.exec("ALTER TABLE events ADD COLUMN prev TEXT");
    if (hasTable(s, "visits") && !hasColumn(s, "visits", "ip_hash")) s.exec("ALTER TABLE visits ADD COLUMN ip_hash TEXT NOT NULL DEFAULT ''");
    if (hasTable(s, "cells") && !hasColumn(s, "cells", "shape")) s.exec("ALTER TABLE cells ADD COLUMN shape TEXT");
    for (const t of ["cells", "visits", "events"]) if (hasTable(s, t) && !hasColumn(s, t, "grp")) s.exec(`ALTER TABLE ${t} ADD COLUMN grp TEXT`);
    if (hasTable(s, "cells") && !hasColumn(s, "cells", "tags")) s.exec("ALTER TABLE cells ADD COLUMN tags TEXT");
    createTables(s);
    if (Number(getMeta(s, "schema") || 0) >= SCHEMA_VERSION) return;
    if (v1) {
      // +1000 first, then -(1000 - 50): the two steps never collide with a row that has not moved yet
      s.exec("UPDATE cells SET x = x + 1000, y = y + 1000");
      s.exec(`UPDATE cells SET x = x - ${1000 - SHIFT_V2}, y = y - ${1000 - SHIFT_V2}`);
      s.exec("UPDATE votes SET x = x + 1000, y = y + 1000");
      s.exec(`UPDATE votes SET x = x - ${1000 - SHIFT_V2}, y = y - ${1000 - SHIFT_V2}`);
      s.exec("UPDATE events SET x = x + ?, y = y + ?", SHIFT_V2, SHIFT_V2);
      for (const e of s.exec("SELECT seq, cmd FROM events").toArray()) {
        s.exec("UPDATE events SET cmd = ? WHERE seq = ?", shiftCmd(String(e.cmd), SHIFT_V2), e.seq);
      }
      s.exec(`UPDATE cells SET cx = x >> ${CHUNK_SHIFT}, cy = y >> ${CHUNK_SHIFT}`);
      rebuildBlocks(s, grid, teams);
      // the open area must hold every old row, so nothing sits outside the city edge
      const ext = s.exec("SELECT MIN(x) AS a, MAX(x) AS b, MIN(y) AS c, MAX(y) AS d FROM cells").toArray()[0];
      if (ext && ext.a !== null) {
        let k = 0;
        for (;;) {
          const a = openArea(k);
          if ((num(ext.a) >= a.x0 && num(ext.b) <= a.x1 && num(ext.c) >= a.y0 && num(ext.d) <= a.y1) || a.x1 - a.x0 + 1 >= grid) break;
          k++;
        }
        const n = num(s.exec("SELECT COUNT(*) AS n FROM cells WHERE style IS NOT NULL AND hidden = 0").toArray()[0].n);
        setMeta(s, "open", String(growRings(k, n)));
      }
    }
    setMeta(s, "schema", String(SCHEMA_VERSION));
  });
}
