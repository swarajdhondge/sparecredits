// Applies kit commands to the city. Storage is behind the Store interface so tests run in memory.
import { createsBannedLayout, formatCmd, freeBuild, inArea, parseLine, type Area, type Cmd } from "../public/kit.js";
import { LIMITS } from "./limits";

export interface Part { part: string; side: string; h: number }
export interface Cell {
  x: number;
  y: number;
  style: string | null;
  h: number;
  pal: number;
  seed: number;
  parts: Part[];
  sign: { tpl: number; words: string[] } | null;
  claim: boolean;
  team: string;
  builtAt: number; // building built
  teamAt: number; // owner last changed
  signAt: number;
  lastLike: number; // decay clock
  likes: number;
  downs: number;
  reports: number;
  hidden: boolean;
  visit: string; // public visit id
  grp: string | null; // group id ("word1.word2") of the visit that made the cell, null when it had none
  tags: string | null; // build tags "word.word" set by K (1-3 words), cleared when the cell is built over
  shape: string | null; // free build: the shapes of a 3D model (style "free") or "facing.w.h.pixels" of a picture (style "picture")
}

export interface Store {
  get(x: number, y: number): Cell | null;
  put(cell: Cell, resetVotes?: boolean): void;
  region(x0: number, y0: number, x1: number, y1: number): Cell[];
}

export const CLOSED_MESSAGE = "This part of the city is closed for now. Pick another cell.";
export const isFrozen = (list: Area[] | undefined, x: number, y: number) => !!list && list.some((a) => inArea(a, x, y));

// open: the city's open area, commands outside it are refused; frozen: closed areas, B, E, S and C inside them are refused
export interface Ctx { team: string; pub: string; grp?: string | null; now: number; open?: Area; frozen?: Area[] }
export interface Result { cmd: string; ok: boolean; code?: string; message?: string; changed?: Cell; note?: string; canon?: string } // canon: the stored text of a changed command

export function isLive(c: Cell | null): c is Cell {
  if (!c || c.hidden) return false;
  if (!c.style && !c.claim && !c.sign) return false;
  return true;
}

const hasBuilding = (c: Cell | null): c is Cell => isLive(c) && !!c!.style;
/** A live cell that holds a building or a claim: it takes up its place on the map. */
export const occupies = (c: Cell) => isLive(c) && (!!c.style || c.claim);

export function newCell(x: number, y: number, ctx: Ctx): Cell {
  return {
    x, y, style: null, h: 0, pal: 0, seed: 0, parts: [], sign: null, claim: false, team: ctx.team,
    builtAt: 0, teamAt: 0, signAt: 0, lastLike: ctx.now, likes: 0, downs: 0, reports: 0, hidden: false, visit: ctx.pub, shape: null, tags: null, grp: ctx.grp ?? null,
  };
}

function bannedAfter(store: Store, cell: Cell): boolean {
  const occ = new Set<number>();
  for (const c of store.region(cell.x - 4, cell.y - 4, cell.x + 4, cell.y + 4)) {
    if (!(c.x === cell.x && c.y === cell.y) && occupies(c)) occ.add(c.y * 1000 + c.x);
  }
  if (occupies(cell)) occ.add(cell.y * 1000 + cell.x);
  return createsBannedLayout((x, y) => occ.has(y * 1000 + x), cell.x, cell.y);
}

const fail = (cmd: string, code: string, message: string): Result => ({ cmd, ok: false, code, message });

export function applyCommand(store: Store, ctx: Ctx, cmd: Cmd, raw: string): Result {
  if (cmd.v === "T") return { cmd: raw, ok: true, note: "team already set" };
  if (cmd.v === "J") return { cmd: raw, ok: true, note: "group set" };
  if (cmd.v === "P") return fail(raw, "plan_not_here", "a plan line is handled by the city, not applied as a build");
  const { now } = ctx;
  if (ctx.open && !inArea(ctx.open, cmd.x, cmd.y)) return fail(raw, "outside_edge", "outside the city edge. The city grows as it fills. Pick a cell inside the open area.");
  if (isFrozen(ctx.frozen, cmd.x, cmd.y)) return fail(raw, "closed", CLOSED_MESSAGE);
  const cur = store.get(cmd.x, cmd.y);
  const live = isLive(cur) ? cur : null;

  if (cmd.v === "B") {
    const cell = newCell(cmd.x, cmd.y, ctx);
    Object.assign(cell, { style: cmd.style, h: cmd.h, pal: cmd.pal, seed: cmd.seed, builtAt: now, teamAt: now });
    if (live && live.sign) { cell.sign = live.sign; cell.signAt = live.signAt; }
    if (bannedAfter(store, cell)) return fail(raw, "banned_layout", "That layout is not allowed here. Pick another cell.");
    store.put(cell, true);
    return { cmd: raw, ok: true, changed: cell };
  }

  if (cmd.v === "F" || cmd.v === "G" || cmd.v === "A") {
    const adding = cmd.v === "A" || (cmd.v === "G" && cmd.more);
    if (adding) {
      // adding to a model or picture is only for the visit that made it
      if (!live || (live.style !== "free" && live.style !== "picture") || live.visit !== ctx.pub) {
        return fail(raw, "not_your_model", "That cell has no 3D model or picture made by your visit. Use F or G to start one.");
      }
      const b = freeBuild(cmd, live.style, live.shape);
      if (!b.ok) return fail(raw, b.code, b.message);
      const cell = { ...live, h: b.h, pal: b.pal, shape: b.shape };
      store.put(cell);
      return { cmd: raw, ok: true, changed: cell };
    }
    const b = freeBuild(cmd, null, null);
    if (!b.ok) return fail(raw, b.code, b.message);
    const cell = newCell(cmd.x, cmd.y, ctx);
    Object.assign(cell, { style: b.style, h: b.h, pal: b.pal, shape: b.shape, builtAt: now, teamAt: now });
    if (live && live.sign) { cell.sign = live.sign; cell.signAt = live.signAt; }
    if (bannedAfter(store, cell)) return fail(raw, "banned_layout", "That layout is not allowed here. Pick another cell.");
    store.put(cell, true);
    return { cmd: raw, ok: true, changed: cell };
  }

  if (cmd.v === "K") {
    // only the visit that built the current B, F or G on the cell may tag it; a K replaces the tags
    if (!hasBuilding(live) || live.visit !== ctx.pub) return fail(raw, "not_your_build", "That cell has no building made by your visit. Tag only what you built.");
    const cell = { ...live, tags: cmd.words.join(".") };
    store.put(cell);
    return { cmd: raw, ok: true, changed: cell, ...(cmd.dropped ? { note: `not kit words, left out: ${cmd.dropped.join(", ")}` } : {}) };
  }

  if (cmd.v === "E") {
    if (!hasBuilding(live)) return fail(raw, "no_building", "That cell has no building. Build first.");
    if (live.style === "free" || live.style === "picture") return fail(raw, "free_no_parts", "A 3D model or picture takes no parts. Add shapes with A instead.");
    const parts = live.parts.filter((p) => p.side !== cmd.side);
    if (parts.length >= LIMITS.maxParts) return fail(raw, "too_many_parts", `A building holds at most ${LIMITS.maxParts} parts.`);
    parts.push({ part: cmd.part, side: cmd.side, h: cmd.h });
    const cell = { ...live, parts };
    store.put(cell);
    return { cmd: raw, ok: true, changed: cell };
  }

  if (cmd.v === "S") {
    const cell = live ? { ...live } : newCell(cmd.x, cmd.y, ctx);
    cell.sign = { tpl: cmd.tpl, words: cmd.words };
    cell.signAt = now;
    store.put(cell, !live);
    return { cmd: raw, ok: true, changed: cell };
  }

  // C: claim
  if (live && live.claim && live.team === ctx.team) return { cmd: raw, ok: true, note: "already yours" };
  const cell = live ? { ...live } : newCell(cmd.x, cmd.y, ctx);
  cell.claim = true;
  cell.team = ctx.team;
  cell.grp = ctx.grp ?? null;
  cell.tags = null; // a claim replaces the build, so its tags go
  cell.teamAt = now;
  if (bannedAfter(store, cell)) return fail(raw, "banned_layout", "That layout is not allowed here. Pick another cell.");
  store.put(cell, !live);
  return { cmd: raw, ok: true, changed: cell };
}

export interface LineResult {
  ok: boolean;
  code?: string;
  message?: string;
  results: Result[];
  applied: number;
}

type Items = Extract<ReturnType<typeof parseLine>, { ok: true }>["items"];

/** Apply parsed items. `allowed` = how many commands the quota lets through (counted over all commands except a first T). */
export function applyItems(store: Store, ctx: Ctx, items: Items, allowed: number, quotaReason?: string, quotaCode = "rate_limit"): LineResult {
  const results: Result[] = [];
  let applied = 0;
  let counted = 0;
  const tagged = new Set<string>(); // cells that already took a K in this line
  items.forEach((it) => {
    const isTeam = it.ok && (it.cmd.v === "T" || it.cmd.v === "J" || it.cmd.v === "K"); // T, J and K count 0 commands
    const i = isTeam ? -1 : counted++;
    if (!it.ok) { results.push(fail(it.raw, it.code, it.message)); return; }
    if (it.cmd.v === "K") {
      const key = `${it.cmd.x},${it.cmd.y}`;
      if (tagged.has(key)) { results.push(fail(it.raw, "dup_tag", "One K per cell in a line. Put all the tag words in one K.")); return; }
      tagged.add(key);
    }
    if (i >= allowed) { results.push(fail(it.raw, quotaCode, quotaReason || "Rate limit.")); return; }
    const r = applyCommand(store, ctx, it.cmd, it.raw);
    if (r.ok && r.changed) { applied++; r.canon = formatCmd(it.cmd); }
    results.push(r);
  });
  return { ok: true, results, applied };
}

/** Parse and apply a line. */
export function applyLine(store: Store, ctx: Ctx, line: string, allowed: number, quotaReason?: string, quotaCode?: string): LineResult {
  const parsed = parseLine(line);
  if (!parsed.ok) return { ok: false, code: parsed.code, message: parsed.message, results: [], applied: 0 };
  return applyItems(store, ctx, parsed.items, allowed, quotaReason, quotaCode);
}
