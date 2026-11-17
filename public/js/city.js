// The city canvas: isometric toy-town view that turns (90 degree snaps and free twist), with pan, zoom (mouse, touch, pinch), a landing animation and live updates.
import { GRID, CENTER, CHUNK_SHIFT, readPicture, openArea, TEAM_LABELS, STYLES, PARTS, SIDES, TEMPLATES, WORD_CLASSES, TEAMS } from "../kit.js";
import { drawBuilding, drawSign, PAL, TEAM_COLORS, prepFree, drawFree, glowOf, startBakeFrame } from "./buildings.js";
import { Bots } from "./bots.js";
import { Ring } from "./ring.js";
import { K, trig, project, unproject, snapRot, isSnap, normRot } from "./turn.js";
const DAY = 86400000;
const THEME = {
  light: {
    bgTop: "#fdf1dc", bgBot: "#f6d9bb", sea: "rgba(120,190,215,0.0)",
    fog: "rgba(226,222,210,0.85)", fogLine: "rgba(150,140,120,0.45)", post: "#a87b4c", rail: "#d1a56f",
    grass: ["#bfe3a0", "#bde19e", "#c2e5a4", "#bbdf9c", "#b6db97", "#b3d894", "#b9dd9a", "#b1d791"],
    slabSide: "#c49a68", slabSide2: "#a98050", edge: "#9fcf86", shadow: "rgba(120,80,40,0.16)", label: "#fffaf0", labelText: "#3a2a1a",
    hatch: "rgba(150,70,40,0.45)", hatchFill: "rgba(150,70,40,0.10)",
  },
  dark: {
    bgTop: "#10152c", bgBot: "#222a50", sea: "rgba(0,0,0,0)",
    fog: "rgba(34,40,78,0.8)", fogLine: "rgba(160,170,230,0.3)", post: "#6a5240", rail: "#8a6c50",
    grass: ["#38573f", "#37553d", "#3a5941", "#35523b", "#33513a", "#305036", "#365840", "#2e4c35"],
    slabSide: "#5a4636", slabSide2: "#45342a", edge: "#44694b", shadow: "rgba(0,0,0,0.35)", label: "#2b3158", labelText: "#f3ecdc",
    hatch: "rgba(255,225,170,0.45)", hatchFill: "rgba(255,225,170,0.08)",
  },
};

const hash2 = (x, y) => { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177 | 0; return (h ^ (h >>> 16)) >>> 0; };
const key = (x, y) => y * GRID + x;
export const worldOf = (gx, gy) => [(gx - gy) * 32, (gx + gy + 1) * 16];
/** World position of a grid corner (u, v are cell coordinates, may be fractions). */
export const cornerOf = (u, v) => [(u - v) * 32, (u + v) * 16];
/** Colour of one overview character (a palette hex digit, or g..j for a team). */
/** How many pieces (shapes, or picture rows) of the old free build the new one keeps at its start. */
function freeKept(old, c) {
  if (!isFree(old) || !isFree(c) || old.b.style !== c.b.style) return 0;
  if (c.b.style === "free") return c.f.startsWith(old.f + "_") ? old.f.split("_").length : 0;
  const o = readPicture(old.f), n = readPicture(c.f);
  return o && n && o.facing === n.facing && o.w === n.w && o.h === n.h ? Math.floor(o.pixels.length / o.w) : 0;
}
export const isFree = (c) => !!c.b && (c.b.style === "free" || c.b.style === "picture");
/** The prepared free build of a cell (made once, on first use); null when the wire has no usable data. */
export const freeOf = (c) => (c.free === undefined ? (c.free = prepFree(c.b.style, c.f)) : c.free);
const BLOCKS = GRID >> 2;
export const ovColor = (ch) => (ch >= "g" ? TEAM_COLORS[TEAMS[ch.charCodeAt(0) - 103]] || "#888" : PAL[parseInt(ch, 16)][1]);
const BAKE_STEPS = [0.35, 0.5, 0.7, 1, 1.4, 2, 2.8, 4]; // zoom steps free builds are baked at
const MAX_FREE_ANIMS = 30; // animated free cells drawn per frame; the rest are drawn at rest (baked)
const DETAIL_ZOOM = 0.5; // the lowest zoom the home page opens at: buildings are drawn in full detail (drawBuilding from 0.3, the grid from 0.55) and cells are 32 px wide
const OV_ZOOM = 0.25; // below this zoom the home page shows the one-colour-per-4x4 overview
const DEFAULT_OPEN = openArea(0);
const C0 = GRID / 2; // the grid centre: the town turns about it
const TURN_MS = 540; // a 90 degree turn
const DROP = 140, HOP = 14; // world px: a new build drops in from this high; the builds beside it hop this high
const bounce = (t) => { const n = 7.5625, d = 2.75; if (t < 1 / d) return n * t * t; if (t < 2 / d) return n * (t -= 1.5 / d) * t + 0.75; if (t < 2.5 / d) return n * (t -= 2.25 / d) * t + 0.9375; return n * (t -= 2.625 / d) * t + 0.984375; };
/** "#rrggbb" or "#rrggbbaa" and an opacity -> rgba(). */
/** Ink line width for free builds: baked layers are drawn at the bake scale, so the line follows that. */
const o_lw = (v) => { const sc = v.bakeScale(), z = sc ? sc / v.dpr : v.cam.z; return Math.max(0.8, Math.min(1.4, z)) / z; };
const hexA = (h, a) => `rgba(${parseInt(h.slice(1, 3), 16)},${parseInt(h.slice(3, 5), 16)},${parseInt(h.slice(5, 7), 16)},${a})`;
/** The order 0..n-1 sorted by depth (a counting sort on depth to 1/16 cell: the cells in view are already nearly in order). */
function sortByDepth(n, dp) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { if (dp[i] < lo) lo = dp[i]; if (dp[i] > hi) hi = dp[i]; }
  const scale = Math.min(16, 60000 / Math.max(1e-6, hi - lo)), B = Math.ceil((hi - lo) * scale) + 2;
  const cnt = new Int32Array(B + 1), out = new Int32Array(n);
  for (let i = 0; i < n; i++) cnt[Math.round((dp[i] - lo) * scale) + 1]++;
  for (let b = 1; b <= B; b++) cnt[b] += cnt[b - 1];
  for (let i = 0; i < n; i++) out[cnt[Math.round((dp[i] - lo) * scale)]++] = i;
  return out;
}

export function parseWire(w) {
  const cell = { x: w.x, y: w.y, team: w.t || "other", l: w.l || Date.now(), ts: w.ts || 0, visit: w.v, g: w.g || null, k: w.k ? w.k.split(".") : [], claim: !!w.c, b: null, parts: [], sign: null, f: w.f || null };
  if (w.b) {
    const [style, h, pal, seed] = w.b.split(".");
    cell.b = { style, h: +h, pal: +pal, seed: +seed };
  }
  if (w.e) cell.parts = w.e.split(",").map((t) => { const [part, side, h] = t.split("."); return { part, side, h: +h }; });
  if (w.s) { const [t, ...words] = w.s.split("."); cell.sign = { tpl: +t.slice(1), words: words.filter((x) => x !== "-") }; }
  return cell;
}

export class CityView {
  constructor(canvas, opts = {}) {
    this.cv = canvas;
    this.ctx = canvas.getContext("2d");
    this.cells = new Map();
    this.opts = { interactive: true, bounded: true, overview: false, bots: false, living: true, mine: null, ...opts }; // bots: builder bots place live changes; mine(visitCode) says if a bot is the person's own; living: the road, harbour, boats, walkers, lamps and birds round the town
    this.bots = this.opts.bots ? new Bots(this) : null;
    this.open = { ...DEFAULT_OPEN }; // the open area (target)
    this.openV = { ...DEFAULT_OPEN }; // the open area as drawn (moves smoothly to the target when the city grows)
    this.openAnim = null; this.openSet = false;
    this.ghosts = new Map(); // cell key -> Map(plan code -> ghost): the plans that want a building there
    this.loaded = new Set(); // chunks whose cells this view holds
    this.frozen = []; // closed areas [x0, y0, x1, y1], drawn as a hatch
    this.ovRev = 0; this.afterDraw = null; // ovRev counts overview changes; afterDraw is an optional hook at the end of draw (the small map)
    this.rev = 0; this.fb = null; this.fbRev = -1; // rev counts cell changes; fb = overview colours of blocks whose tallest loaded cell is a free build
    this.motion = true; // false: moving parts stand still (hidden tab, prefers-reduced-motion)
    this.mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    this.ov = null; // overview characters, one per 4 x 4 block
    this.lastSig = ""; this.viewTimer = 0;
    const [cx0, cy0] = worldOf(CENTER, CENTER);
    this.cam = { x: cx0, y: cy0, z: 0.6 };
    this.dark = opts.dark ?? false;
    this.dpr = 1;
    this.W = 300; this.H = 300;
    this.dirty = true;
    this.anims = 0;
    this.handlers = {};
    this.selected = null;
    this.labels = [];
    this.dusts = [];
    this.fixedMinZoom = null;
    this.fly = null; // a glide of the camera (flyTo): { f, o, t0, ms }
    this.slide = null; // inertia after a drag: { vx, vy, t0, last } (world px per ms)
    this.moved = false; // true once the person pans or zooms
    this.overlay = null; // optional (ctx, toScreen) => void, drawn last in screen pixels (the admin page draws markers); toScreen(gx, gy) is the centre of a cell
    this.rot = 0; this.tr = trig(0); this.phi = Math.PI / 4; this.rotA = null; this.snapped = true; // the view angle (0 = classic), its cos/sin, and a running turn { from, to, t0, dur }
    this.filter = null; this.plotAt = null; this.shareSet = null; this.box = null; // search fade, the glowing plot, the team share of the walkers
    this.look = null; this.glows = []; this.detailZoom = DETAIL_ZOOM; // colours read from the page tokens; blinking parts to light at night
    this.vb = { gx: new Int16Array(4096), gy: new Int16Array(4096), cx: new Float32Array(4096), cy: new Float32Array(4096), dp: new Float32Array(4096) }; // the cells in view
    this.lastDraw = 0; this.ambient = false; // ambient: the living ring is moving, so the canvas redraws at about 30 fps even with no other change
    this.ring = new Ring(this, this.opts.living);
    this.resize();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement || canvas);
    if (this.opts.interactive) this.bindInput();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Listen to "pick" (cell, {sx, sy}), "hover" (cell), "view", "botgo", "botat", "built" (cell: a live change landed), "jump" ("town": the T key) and "frame" (after every drawn frame: move pinned labels here). Returns a function that removes the listener. */
  on(name, fn) { (this.handlers[name] ||= []).push(fn); return () => { this.handlers[name] = this.handlers[name].filter((f) => f !== fn); }; }
  emit(name, ...a) { for (const f of this.handlers[name] || []) f(...a); }

  destroy() { cancelAnimationFrame(this.raf); this.ro.disconnect(); this.bots?.destroy(); }

  resize() {
    const r = (this.cv.parentElement || this.cv).getBoundingClientRect();
    this.dpr = Math.min(2.5, window.devicePixelRatio || 1);
    this.W = Math.max(50, r.width);
    this.H = Math.max(50, r.height);
    this.cv.width = Math.round(this.W * this.dpr);
    this.cv.height = Math.round(this.H * this.dpr);
    this.cv.style.width = this.W + "px";
    this.cv.style.height = this.H + "px";
    this.clamp();
    this.dirty = true;
  }

  setDark(d) { if (this.dark !== d) { this.dark = d; this.look = null; this.dirty = true; } }

  // ---------- data ----------
  setCells(wires) {
    this.cells.clear(); this.bots?.clear(); this.rev++;
    for (const w of wires) if (!w.gone) { const c = parseWire(w); this.cells.set(key(c.x, c.y), c); }
    this.dirty = true;
  }
  /** Replace all cells of one chunk (the server sent it in one or more parts). */
  setChunk(cx, cy, wires, first = true) {
    if (first) {
      for (const [k, c] of this.cells) if ((c.x >> CHUNK_SHIFT) === cx && (c.y >> CHUNK_SHIFT) === cy) this.cells.delete(k);
    }
    this.loaded.add(cy * 8 + cx); this.rev++;
    for (const w of wires) if (!w.gone) { const c = parseWire(w); this.cells.set(key(c.x, c.y), c); }
    this.dirty = true;
  }
  // ---------- plan ghosts ----------
  /** A chunk arrived with its ghosts: replace the ghosts of that chunk. */
  setGhosts(cx, cy, list) {
    for (const k of this.ghosts.keys()) {
      if (((k % GRID) >> CHUNK_SHIFT) === cx && (Math.floor(k / GRID) >> CHUNK_SHIFT) === cy) this.ghosts.delete(k);
    }
    this.addGhosts(list);
  }
  addGhosts(list) {
    for (const w of list || []) {
      const [style, h, pal, seed] = w.b.split(".");
      const g = { x: w.x, y: w.y, p: w.p, n: w.n, style, h: +h, pal: +pal, seed: +seed, parts: w.e ? w.e.split(",").map((t) => { const [part, side, hh] = t.split("."); return { part, side, h: +hh }; }) : [] };
      const k = key(g.x, g.y);
      if (!this.ghosts.has(k)) this.ghosts.set(k, new Map());
      this.ghosts.get(k).set(g.p, g);
    }
    this.dirty = true;
  }
  delGhosts(code) {
    for (const [k, m] of this.ghosts) { m.delete(code); if (!m.size) this.ghosts.delete(k); }
    this.dirty = true;
  }
  /** The ghost to draw on a cell: none when a building of the planned style already stands there. */
  ghostAt(x, y) {
    const m = this.ghosts.get(key(x, y));
    if (!m) return null;
    const have = this.cells.get(key(x, y))?.b?.style;
    let pick = null;
    for (const g of m.values()) if (g.style !== have) pick = g;
    return pick;
  }
  /** Set the closed areas from the stats (a list of [x0, y0, x1, y1]). */
  setFrozen(list) {
    const next = Array.isArray(list) ? list : [];
    if (JSON.stringify(next) === JSON.stringify(this.frozen)) return;
    this.frozen = next; this.dirty = true;
  }
  /** Colour of overview block i: the most used colour of a free build when that is the tallest loaded cell of the block, else the server's character. */
  blockColor(i) {
    if (this.fbRev !== this.rev) {
      this.fbRev = this.rev; this.fb = new Map();
      const best = new Map();
      for (const c of this.cells.values()) {
        if (!c.b) continue;
        const bi = (c.y >> 2) * BLOCKS + (c.x >> 2), o = best.get(bi);
        if (!o || c.b.h > o.h) best.set(bi, { h: c.b.h, c });
      }
      for (const [bi, o] of best) if (isFree(o.c)) { const fr = freeOf(o.c); if (fr) this.fb.set(bi, fr.main); }
    }
    return this.fb.get(i) || ovColor(this.ov[i]);
  }
  setOverview(str) { this.ov = str.split(""); this.ovRev++; this.dirty = true; }
  patchOverview(list) {
    if (!this.ov) return;
    for (const { b, ch } of list) this.ov[b] = ch;
    this.ovRev++; this.dirty = true;
  }
  /** Set the open area. The first call sets it at once; later calls (the city grew) slide the edge outwards. */
  setOpen(a, animate = true) {
    if (!a) return;
    if (this.openSet && a.x0 === this.open.x0 && a.x1 === this.open.x1 && a.y0 === this.open.y0 && a.y1 === this.open.y1) return;
    const first = !this.openSet;
    this.openSet = true;
    this.open = { ...a };
    if (first || !animate) { this.openV = { ...a }; this.openAnim = null; }
    else this.openAnim = { from: { ...this.openV }, t: performance.now() };
    this.clamp(); this.dirty = true;
  }
  upsert(w, { animate = false } = {}) {
    if (this.bots && animate && this.bots.add(w)) return; // a bot places it when it arrives
    this.place(w, animate);
  }
  /** Put one wire on the map now (label = the "by a Claude" label, off for a change a bot placed). */
  place(w, animate = false, label = true) {
    if (w.gone) { this.cells.delete(key(w.x, w.y)); this.rev++; this.bots?.drop(w.x, w.y); this.dirty = true; return; }
    const c = parseWire(w);
    const old = this.cells.get(key(c.x, c.y));
    const changed = !old || old.b?.style !== c.b?.style || old.b?.seed !== c.b?.seed || old.parts.length !== c.parts.length || (!!old.sign !== !!c.sign) || old.claim !== c.claim || old.team !== c.team || old.f !== c.f;
    c.from = old && old.f && c.f ? freeKept(old, c) : 0; // pieces of the old free build that the new one keeps (the bot does not build them again)
    this.cells.set(key(c.x, c.y), c); this.rev++;
    if (animate && changed) {
      const now = performance.now(), land = now + 700;
      c.pop = now; // the build drops in; the ripple starts when it lands, and the builds on the 8 cells round it hop once
      if (label) { c.labelUntil = now + 5200; this.labels.push(c); }
      this.dusts.push({ x: c.x, y: c.y, t: land });
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nb = (dx || dy) && this.cells.get(key(c.x + dx, c.y + dy));
        if (nb && nb.b) nb.hopAt = land + Math.hypot(dx, dy) * 90;
      }
      this.emit("built", c); // a new build is live: the town screen shows its bubble
    } else if (old) { c.pop = old.pop; c.labelUntil = old.labelUntil; c.build = old.build; c.hopAt = old.hopAt; }
    this.dirty = true;
  }
  remove(x, y) { this.cells.delete(key(x, y)); this.rev++; this.dirty = true; }
  /** The bot starts to build a free cell: its shapes (or picture rows) show one after the other. Returns the build time in ms at normal
   * speed (0: nothing to build, the cell is not a free build). all = build it from the first piece (Show), not from what it had before. */
  startBuild(x, y, speed = 1, all = false) {
    const c = this.cell(x, y);
    if (!c || !isFree(c)) return 0;
    const fr = freeOf(c);
    if (!fr) return 0;
    const from = all ? 0 : Math.min(c.from || 0, fr.items), n = fr.items - from;
    if (n <= 0) return 0;
    const ms = fr.kind === "picture" ? 2000 * n / fr.items : Math.min(8000, 60 * n); // about 60 ms a shape, 8 s at most; a picture takes 2 s
    c.build = { t0: performance.now(), dur: ms / speed, from, total: fr.items };
    c.pop = 0; this.dirty = true;
    return ms;
  }
  cell(x, y) { return this.cells.get(key(x, y)) || null; }
  select(x, y) { this.selected = x == null ? null : { x, y }; this.dirty = true; }

  // ---------- turning ----------
  /** The view angle in radians, 0 to 2 pi. 0 is the classic view; turning right (clockwise) adds. A 90 degree snap is a multiple of pi / 2. */
  get angle() { return normRot(this.rot); }
  /** Turn the view to `rot` about the screen point (sx, sy): the grid point under it stays there. */
  setRot(rot, sx = this.W / 2, sy = this.H / 2) {
    const [u, v] = this.unproj(...this.toWorld(sx, sy));
    this.rot = isSnap(rot) ? snapRot(rot) : rot; this.tr = trig(this.rot);
    const [nx, ny] = this.proj(u, v);
    this.cam.x = nx - (sx - this.W / 2) / this.cam.z; this.cam.y = ny - (sy - this.H / 2) / this.cam.z;
    this.moved = true; this.clamp(); this.dirty = true;
  }
  /** Turn the view one 90 degree step (dir -1 = left, +1 = right), animated. Pressing again before the end adds another step. */
  turn(dir) {
    this.slide = null;
    const base = this.rotA ? this.rotA.to : snapRot(this.rot);
    this.rotA = { from: this.rot, to: base + (dir < 0 ? -1 : 1) * Math.PI / 2, t0: performance.now(), dur: this.mq && this.mq.matches ? 1 : TURN_MS };
    this.dirty = true;
  }
  /** Set the box [x0, y0, x1, y1] of cells that hold buildings (the stats `box`) and the newest change [x, y] (`last`): what home() frames. */
  setBox(box, last) { this.box = box || null; if (last) this.last = last; }
  /** The camera for the home view at angle `rot`: the built cells and 3 cells round them (at least 10 cells wide; out to the road and harbour on a side where
   * that margin reaches the edge of the open area), fitted to the screen. Returns {u, v, z} (grid point and zoom). The zoom never goes below the detail zoom
   * (builds stay drawn builds); a town too big for that shows the newest change instead of the empty middle of a spread-out town. */
  homeTarget(rot) {
    const a = this.open, tr = trig(rot);
    let b = this.box;
    if (!b) {
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const c of this.cells.values()) if (c.b) { x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y); }
      b = x1 >= 0 ? [x0, y0, x1, y1] : [(a.x0 + a.x1) >> 1, (a.y0 + a.y1) >> 1, (a.x0 + a.x1) >> 1, (a.y0 + a.y1) >> 1];
    }
    let u0 = b[0] - 3, u1 = b[2] + 4, v0 = b[1] - 3, v1 = b[3] + 4;
    for (const [lo, hi, c] of [[u0, u1, "u"], [v0, v1, "v"]]) {
      const grow = Math.max(0, 10 - (hi - lo)) / 2;
      if (c === "u") { u0 = lo - grow; u1 = hi + grow; } else { v0 = lo - grow; v1 = hi + grow; }
    }
    const e = this.ring.extent(a);
    if (u0 <= a.x0) u0 = e[0]; if (v0 <= a.y0) v0 = e[2]; if (u1 >= a.x1 + 1) u1 = e[1]; if (v1 >= a.y1 + 1) v1 = e[3];
    const P = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => project(u, v, tr.cs, tr.sn, C0));
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 24, h = Math.max(...ys) - Math.min(...ys) + 150; // room for the tall builds
    const fitZ = Math.min(1.5, this.W / w, this.H / h);
    if (fitZ < DETAIL_ZOOM && this.last) return { u: this.last[0] + 0.5, v: this.last[1] + 0.5, z: Math.max(this.minZoom, DETAIL_ZOOM) };
    const z = Math.max(this.minZoom, DETAIL_ZOOM, fitZ); // never below the detail zoom: builds stay drawn builds
    const [u, v] = unproject((Math.max(...xs) + Math.min(...xs)) / 2, (Math.max(...ys) + Math.min(...ys)) / 2 - 40, tr.cs, tr.sn, C0);
    return { u, v, z };
  }
  /** Show the whole town: the nearest 90 degree snap, the built cells and a margin centred and fitted (see homeTarget). */
  home(ms = 700) {
    this.moved = true; this.stopMotion();
    const to = snapRot(this.rotA ? this.rotA.to : this.rot), now = performance.now(), t = this.homeTarget(to);
    if (to !== this.rot) this.rotA = { from: this.rot, to, t0: now, dur: this.mq && this.mq.matches ? 1 : TURN_MS };
    const [fu, fv] = this.unproj(this.cam.x, this.cam.y);
    this.fly = { fu, fv, fz: this.cam.z, tu: t.u, tv: t.v, tz: t.z, t0: now, ms };
    this.dirty = true;
  }
  /** Fade: cells for which fn(cell) is false draw at 16% (the search). null shows everything. */
  setFilter(fn) { this.filter = typeof fn === "function" ? fn : null; this.dirty = true; }
  /** The glowing plot (Play) on cell (x, y); setPlot(null) removes it. */
  setPlot(x, y) { this.plotAt = x == null || y == null ? null : { x, y }; this.dirty = true; }
  /** The team share the walkers' shirts follow: {claude, chatgpt, gemini, other} counts. null = the teams of the cells this view holds. */
  setTeamShare(s) { this.shareSet = s || null; if (this.ring) this.ring.share = null; }

  // ---------- camera ----------
  proj(u, v) { return project(u, v, this.tr.cs, this.tr.sn, C0); }
  unproj(wx, wy) { return unproject(wx, wy, this.tr.cs, this.tr.sn, C0); }
  /** World px of the centre of cell (gx, gy) at the current angle (gx, gy may be fractions). */
  worldOf(gx, gy) { return this.proj(gx + 0.5, gy + 0.5); }
  /** Grid corner point -> how far it is towards the viewer (cells): the painter order of the town. */
  depthOf(u, v) { return (u - C0) * this.tr.sn + (v - C0) * this.tr.cs; }
  /** The baked-layer scale of free builds now (drawn from baked canvases only on a 90 degree snap); undefined when the view is turning. */
  bakeScale() { return this.snapped ? (BAKE_STEPS.find((s) => s >= this.cam.z * 0.92) ?? BAKE_STEPS[BAKE_STEPS.length - 1]) * this.dpr : undefined; }

  /** World box of the town on the slab (as drawn, at the current angle). */
  bounds() {
    const a = this.openV, [u0, u1, v0, v1] = this.ring ? this.ring.extent(a) : [a.x0, a.x1 + 1, a.y0, a.y1 + 1];
    const P = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]].map(([u, v]) => this.proj(u, v));
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    return { l: Math.min(...xs), r: Math.max(...xs), t: Math.min(...ys), b: Math.max(...ys) };
  }
  get minZoom() {
    if (this.fixedMinZoom != null) return this.fixedMinZoom;
    const b = this.bounds();
    return Math.max(0.02, Math.min(this.W / (b.r - b.l + 200), this.H / (b.b - b.t + 100)));
  }
  clamp() {
    const z = this.cam.z = Math.max(this.minZoom, Math.min(3.2, this.cam.z));
    if (!this.opts.bounded) return;
    const b = this.bounds();
    const hw = this.W / 2 / z * 0.5, hh = this.H / 2 / z * 0.4;
    const x0 = b.l - 100 + hw, x1 = b.r + 100 - hw, y0 = b.t - 100 + hh, y1 = b.b - hh;
    this.cam.x = x0 > x1 ? (b.l + b.r) / 2 : Math.max(x0, Math.min(x1, this.cam.x));
    this.cam.y = y0 > y1 ? (b.t + b.b) / 2 : Math.max(y0, Math.min(y1, this.cam.y));
  }
  focus(gx, gy, zoom) {
    const [x, y] = this.worldOf(gx, gy);
    this.cam.x = x; this.cam.y = y - 30;
    if (zoom) this.cam.z = zoom;
    this.clamp(); this.dirty = true;
  }
  /** Where the camera ends for world point (x, y) at zoom z, after the clamp (focus and flyTo end here). */
  aim(x, y, z) {
    const s = { ...this.cam };
    this.cam.x = x; this.cam.y = y; this.cam.z = z;
    this.clamp();
    const o = { ...this.cam };
    Object.assign(this.cam, s);
    return o;
  }
  /** Glide the camera to a target {x, y, z} (world px at the current angle; ease in and out). The glide follows the grid point, so it still
   * ends on the right place when the view turns meanwhile. Any drag, pinch, wheel, key or zoom button stops it. */
  glide(o, ms = 600) {
    this.slide = null;
    const [fu, fv] = this.unproj(this.cam.x, this.cam.y), [tu, tv] = this.unproj(o.x, o.y);
    this.fly = { fu, fv, fz: this.cam.z, tu, tv, tz: o.z, t0: performance.now(), ms }; this.dirty = true;
  }
  /** Like focus(), but as a glide. Without a zoom the zoom stays. */
  flyTo(gx, gy, zoom, ms = 600) { const [x, y] = this.worldOf(gx, gy); this.glide(this.aim(x, y - 30, zoom || this.cam.z), ms); }
  /** Glide to world point (x, y), same zoom (a tap on the small map). */
  flyWorld(x, y, ms = 600) { this.moved = true; this.glide(this.aim(x, y, this.cam.z), ms); }
  /** Move the camera to world point (x, y) now (a drag on the small map). */
  panTo(x, y) { this.moved = true; this.stopMotion(); this.cam.x = x; this.cam.y = y; this.clamp(); this.dirty = true; }
  /** The padded world box (at the current angle) of the cells [x0, y0, x1, y1]: from the centres of its four corner cells. */
  cellsExtent(x0, y0, x1, y1) {
    const P = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => this.worldOf(x, y));
    const xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
    return { l: Math.min(...xs) - 40, r: Math.max(...xs) + 40, t: Math.min(...ys) - 130, b: Math.max(...ys) + 24 };
  }
  /** Glide to show the whole cell box [x0, y0, x1, y1] with a little room (on a narrow screen this can go under OV_ZOOM: the overview then shows the town as colour blocks). */
  flyBox(box, ms = 700) {
    const { l, r, t, b } = this.cellsExtent(...box);
    const z = Math.max(this.minZoom, Math.min(1.4, this.W / ((r - l) * 1.15), this.H / ((b - t) * 1.15)));
    this.glide(this.aim((l + r) / 2, (t + b) / 2, z), ms);
  }
  stopMotion() { this.fly = null; this.slide = null; }
  defaultZoom() { return Math.max(0.5, Math.min(1.1, this.W / 760)); }
  /** Fit all current cells with padding (used by watch and replay views). */
  fit(pad = 1.6, only = null) {
    const list = [...this.cells.values()].filter((c) => !only || only(c));
    if (!list.length) { this.focus(CENTER, CENTER, this.defaultZoom()); return; }
    this.fitPoints(list, pad, 1.4);
  }
  /** The first camera of the home page, set once from the stats (box = cells that hold buildings, last = newest change). Fits the box at detail zoom if it fits on screen, else centres on the newest change (homeTarget). */
  openOn(box, last) {
    if (box) this.box = box;
    if (last) this.last = last;
    if (!this.moved && box) {
      const t = this.homeTarget(this.rot);
      const [x, y] = this.proj(t.u, t.v); this.cam.x = x; this.cam.y = y; this.cam.z = t.z; this.clamp();
    }
    this.lastSig = ""; this.dirty = true; // the page held back its chunk subscription until now: send it for the new view
  }
  /** Fit the view to a list of grid points {x, y}. */
  fitPoints(points, pad = 1.5, maxZ = 1.4) {
    if (!points.length) return;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (const c of points) {
      const [wx, wy] = this.worldOf(c.x, c.y);
      x0 = Math.min(x0, wx - 40); x1 = Math.max(x1, wx + 40); y0 = Math.min(y0, wy - 130); y1 = Math.max(y1, wy + 24);
    }
    const z = Math.min(this.W / ((x1 - x0) * pad), this.H / ((y1 - y0) * pad), maxZ);
    this.cam.x = (x0 + x1) / 2; this.cam.y = (y0 + y1) / 2; this.cam.z = Math.max(this.minZoom, z);
    this.clamp(); this.dirty = true;
  }
  toWorld(sx, sy) { return [(sx - this.W / 2) / this.cam.z + this.cam.x, (sy - this.H / 2) / this.cam.z + this.cam.y]; }
  /** The cell under screen point (sx, sy) at any angle: null outside the grid. */
  cellAt(sx, sy) {
    const [wx, wy] = this.toWorld(sx, sy);
    const [u, v] = this.unproj(wx, wy), { cs, sn } = this.tr;
    // a tall building is drawn over the ground behind it: test the cells in front of the point, up to 9 cells towards the viewer (a 130 px build
    // reaches 6 cells at the classic angle), and take the frontmost whose drawn box holds the point
    // (box: 32 world px either side of the centre, from the ground up to the drawn height c.top, else an estimate from the height)
    const eu = u + sn * 9, ev = v + cs * 9;
    const x0 = Math.max(0, Math.floor(Math.min(u, eu)) - 1), x1 = Math.min(GRID - 1, Math.floor(Math.max(u, eu)) + 1);
    const y0 = Math.max(0, Math.floor(Math.min(v, ev)) - 1), y1 = Math.min(GRID - 1, Math.floor(Math.max(v, ev)) + 1);
    let best = null, bd = -Infinity;
    for (let qx = x0; qx <= x1; qx++) {
      for (let qy = y0; qy <= y1; qy++) {
        const c = this.cells.get(key(qx, qy));
        if (!c || !(c.b || c.sign)) continue;
        const [cwx, cwy] = this.worldOf(qx, qy);
        const top = c.top || (c.b ? c.b.h * 14 + 30 : 30);
        if (Math.abs(wx - cwx) > 32 || wy < cwy - top || wy > cwy + 16) continue;
        const d = this.depthOf(qx + 0.5, qy + 0.5);
        if (d > bd) { bd = d; best = { x: qx, y: qy }; }
      }
    }
    if (best) return best;
    const gx = Math.floor(u), gy = Math.floor(v);
    return gx >= 0 && gy >= 0 && gx < GRID && gy < GRID ? { x: gx, y: gy } : null;
  }
  screenOf(gx, gy, up = 0) {
    const [wx, wy] = this.worldOf(gx, gy);
    return [(wx - this.cam.x) * this.cam.z + this.W / 2, (wy - up - this.cam.y) * this.cam.z + this.H / 2];
  }
  /** The screen point [sx, sy] (px in the canvas) of the top of the build on cell (x, y), at any angle: where a label pins. For an empty cell: its centre. */
  cellScreen(x, y) {
    const c = this.cells.get(key(x, y));
    const fr = c && isFree(c) ? freeOf(c) : null;
    const top = !c ? 0 : c.top || (fr ? fr.top : c.b ? c.b.h * 14 + 30 : 30);
    return this.screenOf(x, y, top);
  }

  zoomAt(sx, sy, factor) {
    this.moved = true; this.stopMotion();
    const [wx, wy] = this.toWorld(sx, sy);
    this.cam.z *= factor;
    this.cam.z = Math.max(this.minZoom, Math.min(3.2, this.cam.z));
    this.cam.x = wx - (sx - this.W / 2) / this.cam.z;
    this.cam.y = wy - (sy - this.H / 2) / this.cam.z;
    this.clamp(); this.dirty = true;
  }

  bindInput() {
    const cv = this.cv;
    cv.style.touchAction = "none";
    const ptrs = new Map();
    let moved = 0, startPt = null, pinch = null, wasPinch = false, stopped = false, vel = null, spin = false, twisted = false;
    cv.addEventListener("contextmenu", (e) => e.preventDefault()); // right-drag turns the town
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      ptrs.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
      if (ptrs.size === 1) { stopped = !!(this.fly || this.slide); wasPinch = false; vel = null; twisted = false; spin = e.pointerType === "mouse" && (e.button === 2 || e.shiftKey); } // a touch that only stops a slide is not a tap
      this.stopMotion();
      if (ptrs.size === 1) { moved = 0; startPt = { x: e.offsetX, y: e.offsetY }; }
      if (ptrs.size === 2) { wasPinch = true; const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, a: Math.atan2(b.y - a.y, b.x - a.x), acc: 0, on: false }; }
    });
    cv.addEventListener("pointermove", (e) => {
      const p = ptrs.get(e.pointerId);
      if (!p) { this.emit("hover", this.cellAt(e.offsetX, e.offsetY)); return; }
      const nx = e.offsetX, ny = e.offsetY;
      if (ptrs.size === 1 && spin) { // right-drag or Shift-drag: turn about the screen centre
        this.setRot(this.rot + (nx - p.x) * 0.012);
        moved += Math.abs(nx - p.x) + Math.abs(ny - p.y); twisted = true;
      } else if (ptrs.size === 1) {
        this.cam.x -= (nx - p.x) / this.cam.z; this.cam.y -= (ny - p.y) / this.cam.z;
        this.moved = true;
        moved += Math.abs(nx - p.x) + Math.abs(ny - p.y);
        const t = performance.now(), dt = vel ? Math.max(1, t - vel.t) : 0; // smoothed drag speed, world px per ms
        vel = { t, vx: dt ? 0.6 * ((p.x - nx) / this.cam.z / dt) + 0.4 * vel.vx : 0, vy: dt ? 0.6 * ((p.y - ny) / this.cam.z / dt) + 0.4 * vel.vy : 0 };
        this.clamp(); this.dirty = true;
      } else if (ptrs.size === 2 && pinch) {
        p.x = nx; p.y = ny;
        const [a, b] = [...ptrs.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        this.moved = true;
        this.cam.x -= (mx - pinch.mx) / this.cam.z; this.cam.y -= (my - pinch.my) / this.cam.z;
        if (pinch.d > 0) this.zoomAt(mx, my, d / pinch.d);
        const ang = Math.atan2(b.y - a.y, b.x - a.x);
        let da = ang - pinch.a; da = ((da + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        pinch.acc += da;
        if (!pinch.on && Math.abs(pinch.acc) > 0.12) pinch.on = true; // a small wobble of a pinch does not turn the town
        if (pinch.on) { this.setRot(this.rot + da, mx, my); twisted = true; }
        pinch = { d, mx, my, a: ang, acc: pinch.acc, on: pinch.on }; moved += 20;
        this.clamp(); this.dirty = true;
      }
      p.x = nx; p.y = ny;
    });
    const up = (e) => {
      const had = ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (had && ptrs.size === 0 && twisted && !this.rotA) { // a free twist that ends near a 90 degree snap settles on it
        const near = snapRot(this.rot);
        if (!isSnap(this.rot) && Math.abs(this.rot - near) < 0.12) this.rotA = { from: this.rot, to: near, t0: performance.now(), dur: 220 };
      }
      if (had && ptrs.size === 0 && moved >= 8 && !wasPinch && !spin && vel && e.type === "pointerup" && performance.now() - vel.t < 80 && Math.hypot(vel.vx, vel.vy) > 0.05) {
        this.slide = { vx: vel.vx, vy: vel.vy, t0: performance.now(), last: performance.now() }; this.dirty = true; // inertia
      }
      if (had && ptrs.size === 0 && moved < 8 && !stopped && !spin && startPt && e.type === "pointerup") {
        const c = this.cellAt(startPt.x, startPt.y);
        this.emit("pick", c, { sx: startPt.x, sy: startPt.y });
      }
    };
    cv.addEventListener("pointerup", up);
    cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.zoomAt(e.offsetX, e.offsetY, Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)));
    }, { passive: false });
    cv.addEventListener("dblclick", (e) => this.zoomAt(e.offsetX, e.offsetY, 1.6));
    cv.tabIndex = 0;
    cv.addEventListener("keydown", (e) => {
      const s = 60 / this.cam.z;
      this.moved = true; this.stopMotion();
      if (e.key === "t" || e.key === "T") { this.emit("jump", "town"); e.preventDefault(); return; }
      if (e.key === "q" || e.key === "Q") { this.turn(-1); e.preventDefault(); return; }
      if (e.key === "e" || e.key === "E") { this.turn(1); e.preventDefault(); return; }
      if (e.key === "ArrowLeft") this.cam.x -= s; else if (e.key === "ArrowRight") this.cam.x += s;
      else if (e.key === "ArrowUp") this.cam.y -= s; else if (e.key === "ArrowDown") this.cam.y += s;
      else if (e.key === "+" || e.key === "=") this.zoomAt(this.W / 2, this.H / 2, 1.25);
      else if (e.key === "-") this.zoomAt(this.W / 2, this.H / 2, 0.8);
      else return;
      e.preventDefault(); this.clamp(); this.dirty = true;
    });
  }

  // ---------- drawing ----------
  frame(t) {
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
    const now = performance.now();
    if (this.openAnim) {
      const p = Math.min(1, (now - this.openAnim.t) / 900), e = 1 - Math.pow(1 - p, 3), f = this.openAnim.from, o = this.open;
      for (const k of ["x0", "y0", "x1", "y1"]) this.openV[k] = f[k] + (o[k] - f[k]) * e;
      if (p >= 1) this.openAnim = null;
      this.dirty = true;
    }
    if (this.rotA) { // a 90 degree turn (or the settle after a free twist)
      const r = this.rotA, p = Math.min(1, (now - r.t0) / r.dur), e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
      this.setRot(r.from + (r.to - r.from) * e);
      if (p >= 1) this.rotA = null;
    }
    this.moveCamera(now);
    const animating = this.anims > 0 || this.labels.length > 0 || this.dusts.length > 0 || this.selected || !!this.bots?.active || !!this.plotAt || !!this.rotA;
    if (!this.dirty && !animating && !(this.ambient && now - this.lastDraw >= 33)) return; // the living ring alone redraws at about 30 fps
    this.dirty = false;
    this.lastDraw = now;
    this.draw(now);
  }

  /** One step of a glide or of drag inertia (about 400 ms, slowing down). */
  moveCamera(now) {
    const f = this.fly, s = this.slide;
    if (f) {
      const p = Math.min(1, (now - f.t0) / f.ms), e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2;
      if (p >= 1) { const [x, y] = this.proj(f.tu, f.tv); this.cam.x = x; this.cam.y = y; this.cam.z = f.tz; this.fly = null; this.clamp(); }
      else {
        const [x, y] = this.proj(f.fu + (f.tu - f.fu) * e, f.fv + (f.tv - f.fv) * e);
        this.cam.x = x; this.cam.y = y; this.cam.z = f.fz * Math.pow(f.tz / f.fz, e);
      }
      this.dirty = true;
    } else if (s) {
      const el = now - s.t0, dt = Math.min(50, now - s.last), k = Math.max(0, 1 - el / 400);
      s.last = now;
      this.cam.x += s.vx * k * dt; this.cam.y += s.vy * k * dt;
      this.clamp(); this.dirty = true;
      if (el >= 400) this.slide = null;
    }
  }

  /** The colours the town reads from the page tokens (--outline, --night-light, --map-water, ...), with the design's values as fallback. */
  readLook() {
    const cs = getComputedStyle(document.documentElement), d = this.dark;
    const v = (n, def) => { const x = cs.getPropertyValue("--" + n).trim(); return /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(x) ? x : def; };
    this.look = {
      outline: v("outline", d ? "#050816bf" : "#3a2a1a99"), light: v("night-light", "#ffd66e"),
      water: v("map-water", d ? "#1f4566" : "#86c9dc"), waterSide: v("map-water-side", d ? "#1d3a57" : "#5fa9c4"),
      skyTop: v("map-sky-top", d ? "#10152c" : "#fdf1dc"), skyBot: v("map-sky-bottom", d ? "#222a50" : "#f6d9bb"),
      accent: v("accent", "#e8704f"), accent2: v("accent2", "#4f9e86"), rail: v("map-rail", d ? "#8a6c50" : "#d1a56f"),
    };
  }

  draw(now) {
    this.motion = !document.hidden && !(this.mq && this.mq.matches);
    if (!this.look) this.readLook();
    const look = this.look;
    this.bots?.step(now);
    const { ctx, W, H, dpr } = this;
    const th = this.dark ? THEME.dark : THEME.light;
    const z = this.cam.z, { cs, sn } = this.tr;
    this.phi = Math.PI / 4 + this.rot; this.snapped = isSnap(this.rot);
    this.lw = Math.max(0.8, Math.min(1.4, z)) / z; // the ink line: about 1 screen px at any zoom
    this.ink = look.outline;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, look.skyTop || th.bgTop); g.addColorStop(1, look.skyBot || th.bgBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    this.drawSky(now, th);

    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (W / 2 - this.cam.x * z), dpr * (H / 2 - this.cam.y * z));
    const a = this.openV, P = (u, v) => this.proj(u, v);
    const A = P(a.x0, a.y0), B = P(a.x1 + 1, a.y0), C = P(a.x1 + 1, a.y1 + 1), D = P(a.x0, a.y1 + 1);
    // slab under the open area (with the road and the harbour round it), then the open area's own grass
    this.ring.slab(th, look);
    const ovMode = this.opts.overview && z < OV_ZOOM;
    const decor = this.ring.decor && !ovMode;
    if (decor) this.ring.ground(th, look, now, z);
    ctx.beginPath(); ctx.moveTo(A[0], A[1]); ctx.lineTo(B[0], B[1]); ctx.lineTo(C[0], C[1]); ctx.lineTo(D[0], D[1]); ctx.closePath(); ctx.fillStyle = th.grass[0]; ctx.fill();
    ctx.strokeStyle = th.edge; ctx.lineWidth = 5; ctx.lineJoin = "round"; ctx.stroke();

    const r = this.gridRange();
    this.noteView(r, ovMode);
    this.glows.length = 0;
    this.anims = 0;
    if (ovMode) {
      this.ambient = false;
      this.drawOverview(th);
      this.drawFence("back", a, z, th); this.drawFence("front", a, z, th);
    } else {
    const detail = z >= 0.3;
    const grid = z >= 0.55;
    const ambient = decor && z >= DETAIL_ZOOM; // boats, walkers, lamps and birds: only from the detail zoom
    const tNow = Date.now();
    const { gxMin, gxMax, gyMin, gyMax, left, right, top, bot } = r;
    // the four corners of a cell, from its centre (the same for every cell at this angle)
    const Q = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([du, dv]) => [(du * cs - dv * sn) * K, (du * sn + dv * cs) * K / 2]);
    const Qc = Q.map(([x, y]) => [x * 0.875, y * 0.875]);

    // the cells in view: grid position, world position and depth (how far towards the viewer)
    let n = 0;
    let vb = this.vb;
    for (let gx = gxMin; gx <= gxMax; gx++) {
      const U = gx + 0.5 - C0;
      for (let gy = gyMin; gy <= gyMax; gy++) {
        const V = gy + 0.5 - C0, cx = (U * cs - V * sn) * K, cy = (U * sn + V * cs) * K / 2 + 32 * C0;
        if (cx < left - 64 || cx > right + 64 || cy < top - 60 || cy > bot) continue;
        if (n >= vb.gx.length) { this.growVb(); vb = this.vb; }
        vb.gx[n] = gx; vb.gy[n] = gy; vb.cx[n] = cx; vb.cy[n] = cy; vb.dp[n] = U * sn + V * cs; n++;
      }
    }
    const { gx: vgx, gy: vgy, cx: vcx, cy: vcy, dp: vdp } = this.vb; // (growVb may have replaced them)
    // pass 1: ground
    for (let i = 0; i < n; i++) {
      const gx = vgx[i], gy = vgy[i], cx = vcx[i], cy = vcy[i];
      const h = hash2(gx, gy);
      ctx.fillStyle = th.grass[((gx + gy) & 1) * 4 + (h & 3)];
      ctx.beginPath(); ctx.moveTo(cx + Q[0][0], cy + Q[0][1]); ctx.lineTo(cx + Q[1][0], cy + Q[1][1]); ctx.lineTo(cx + Q[2][0], cy + Q[2][1]); ctx.lineTo(cx + Q[3][0], cy + Q[3][1]); ctx.closePath(); ctx.fill();
      const c = this.cells.get(key(gx, gy));
      if (c && c.claim) {
        ctx.fillStyle = TEAM_COLORS[c.team] || "#888"; ctx.globalAlpha = this.dark ? 0.38 : 0.34;
        ctx.beginPath(); ctx.moveTo(cx + Qc[0][0], cy + Qc[0][1]); ctx.lineTo(cx + Qc[1][0], cy + Qc[1][1]); ctx.lineTo(cx + Qc[2][0], cy + Qc[2][1]); ctx.lineTo(cx + Qc[3][0], cy + Qc[3][1]); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
      }
    }
    if (grid) {
      ctx.strokeStyle = this.dark ? "rgba(255,255,255,0.05)" : "rgba(60,90,40,0.10)"; ctx.lineWidth = 1 / z;
      ctx.beginPath();
      for (let i = 0; i < n; i++) { const cx = vcx[i], cy = vcy[i]; ctx.moveTo(cx + Q[3][0], cy + Q[3][1]); ctx.lineTo(cx + Q[2][0], cy + Q[2][1]); ctx.lineTo(cx + Q[1][0], cy + Q[1][1]); }
      ctx.stroke();
    }
    if (this.frozen.length) this.drawFrozen(r, th);
    if (this.plotAt) this.drawPlot(now, look);
    this.drawFence("back", a, z, th);
    // pass 2: objects and the ambient things in painter order (depth = towards the viewer)
    this.freeAnims = 0; // animated free cells drawn this frame; past MAX_FREE_ANIMS the rest are drawn at rest
    startBakeFrame();
    const items = ambient ? (this.ring.step(now, z), this.ring.items(now, z, { left, right, top, bot })) : [];
    let ai = 0;
    const ord = sortByDepth(n, vdp), near = this.nearSet();
    for (let k = 0; k < n; k++) {
      const i = ord[k], dpv = vdp[i];
      while (ai < items.length && items[ai].depth < dpv - 1e-6) this.ring.drawItem(items[ai++], now, th, look);
      const gx = vgx[i], gy = vgy[i], cx = vcx[i], cy = vcy[i];
      const c = this.cells.get(key(gx, gy));
      const occupied = c && (c.b || c.claim || c.sign);
      const ghost = this.ghosts.size ? this.ghostAt(gx, gy) : null;
      if (!occupied) {
        if (detail && !(c && c.sign) && !ghost && near.has(key(gx, gy))) this.deco(gx, gy, cx, cy, z);
        if (!c) { if (ghost) this.drawGhost(ghost, cx, cy, z, now); continue; }
      }
      this.drawCell(c, cx, cy, now, tNow, z, th);
      if (ghost) this.drawGhost(ghost, cx, cy, z, now);
    }
    while (ai < items.length) this.ring.drawItem(items[ai++], now, th, look);
    this.drawFence("front", a, z, th);
    if (ambient) this.ring.drawBirds(now, look);
    if (this.dark && z >= 0.3) this.drawNight(now, z, look, ambient);
    this.ambient = ambient && this.motion;
    }
    // ripples, selection
    this.drawEffects(now, z, th, look);
    this.bots?.draw(now, z, th);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawLabels(now, th);
    this.bots?.labels(th);
    this.overlay?.(ctx, (gx, gy) => this.screenOf(gx, gy));
    this.afterDraw?.();
    this.emit("frame");
  }

  /** Keys of the cells within 3 cells of a build: trees, flowers and rocks grow only there. Cached until the cells change. */
  nearSet() {
    if (this.nearRev === this.rev && this.nearS) return this.nearS;
    const set = new Set();
    for (const c of this.cells.values()) {
      if (!c.b) continue;
      for (let dx = -3; dx <= 3; dx++) for (let dy = -3; dy <= 3; dy++) set.add(key(c.x + dx, c.y + dy));
    }
    this.nearRev = this.rev; this.nearS = set;
    return set;
  }

  /** Grow the buffers of the cells in view. */
  growVb() {
    const o = this.vb, n = o.gx.length * 2;
    const g = (A, T) => { const x = new T(n); x.set(A); return x; };
    this.vb = { gx: g(o.gx, Int16Array), gy: g(o.gy, Int16Array), cx: g(o.cx, Float32Array), cy: g(o.cy, Float32Array), dp: g(o.dp, Float32Array) };
  }

  /** Night: light the town in --night-light: lamps along the road and the blinking parts of models (tall ones sweep a soft beam). */
  drawNight(now, z, look, ambient) {
    const ctx = this.ctx, [r, g, b] = [1, 3, 5].map((i) => parseInt(look.light.slice(i, i + 2), 16));
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    if (ambient) this.ring.nightLamps(z, look);
    for (const o of this.glows) {
      const pts = glowOf(o.fr, now, this.phi, o.seed);
      if (!pts) continue;
      for (const p of pts) {
        const x = o.cx + p.x, y = o.cy + p.y + o.lift, gr = ctx.createRadialGradient(x, y, 0, x, y, 34);
        gr.addColorStop(0, `rgba(${r},${g},${b},0.55)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, 34, 0, 7); ctx.fill();
        if (p.beam) {
          const bg = ctx.createLinearGradient(x, y, o.cx + (p.beam[0] + p.beam[2]) / 2, o.cy + o.lift + (p.beam[1] + p.beam[3]) / 2);
          bg.addColorStop(0, `rgba(${r},${g},${b},0.42)`); bg.addColorStop(1, `rgba(${r},${g},${b},0)`);
          ctx.fillStyle = bg; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(o.cx + p.beam[0], o.cy + p.beam[1] + o.lift); ctx.lineTo(o.cx + p.beam[2], o.cy + p.beam[3] + o.lift); ctx.closePath(); ctx.fill();
        }
      }
    }
    ctx.restore();
  }

  /** The glowing plot: a soft glow, a pulsing fill and a walking dashed outline in the accent colour. */
  drawPlot(now, look) {
    const ctx = this.ctx, { x, y } = this.plotAt, pulse = 0.5 + 0.5 * Math.sin(now / 300);
    const c = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]].map(([u, v]) => this.proj(u, v));
    const [cx, cy] = this.worldOf(x, y), inset = (k) => c.map(([px, py]) => [cx + (px - cx) * k, cy + (py - cy) * k]);
    const path = (P) => { ctx.beginPath(); P.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); };
    ctx.save();
    ctx.translate(cx, cy); ctx.scale(1, 0.5);
    const gr = ctx.createRadialGradient(0, 0, 0, 0, 0, 78); gr.addColorStop(0, hexA(look.accent, 0.3 + 0.12 * pulse)); gr.addColorStop(1, hexA(look.accent, 0));
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(0, 0, 78, 0, 7); ctx.fill();
    ctx.restore();
    ctx.fillStyle = hexA(look.accent, 0.18 + 0.14 * pulse); path(c); ctx.fill();
    ctx.save(); ctx.setLineDash([6, 5]); ctx.lineDashOffset = -now / 40; ctx.strokeStyle = look.accent; ctx.lineWidth = 2.5; path(inset(0.88)); ctx.stroke(); ctx.restore();
  }

  /** The cells in view, as a box of grid coordinates cut to the open area, and the world box on screen. */
  gridRange() {
    const { W, H } = this;
    const pad = 300;
    const [wx0, wy0] = this.toWorld(0, 0), [wx1, wy1] = this.toWorld(W, H);
    const left = Math.min(wx0, wx1) - 40, right = Math.max(wx0, wx1) + 40, top = Math.min(wy0, wy1) - 40, bot = Math.max(wy0, wy1) + pad;
    const corners = [[left, top], [right, top], [left, bot], [right, bot]].map(([x, y]) => this.unproj(x, y));
    const a = this.openV;
    const gxMin = Math.max(Math.ceil(a.x0 - 0.5), Math.floor(Math.min(...corners.map((c) => c[0])))), gxMax = Math.min(Math.floor(a.x1 + 0.5), Math.ceil(Math.max(...corners.map((c) => c[0]))));
    const gyMin = Math.max(Math.ceil(a.y0 - 0.5), Math.floor(Math.min(...corners.map((c) => c[1])))), gyMax = Math.min(Math.floor(a.y1 + 0.5), Math.ceil(Math.max(...corners.map((c) => c[1]))));
    return { gxMin, gxMax, gyMin, gyMax, left, right, top, bot };
  }

  /** Tell the page which chunks are in view (or that the overview is shown). Waits 250 ms so one pan gives one message. */
  noteView(r, ovMode) {
    const list = [];
    if (!ovMode && r.gxMax >= r.gxMin && r.gyMax >= r.gyMin) {
      for (let cy = r.gyMin >> CHUNK_SHIFT; cy <= r.gyMax >> CHUNK_SHIFT; cy++) for (let cx = r.gxMin >> CHUNK_SHIFT; cx <= r.gxMax >> CHUNK_SHIFT; cx++) list.push([cx, cy]);
    }
    const sig = (ovMode ? "o" : "d") + list.map((p) => p.join(",")).join(";");
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => this.emit("view", { c: list, ov: ovMode }), 250);
  }

  /** Closed areas: a light diagonal hatch over the ground of those cells (under the buildings). */
  drawFrozen({ left, right, top, bot }, th) {
    const { ctx } = this;
    ctx.save();
    for (const [x0, y0, x1, y1] of this.frozen) {
      const P = [this.proj(x0, y0), this.proj(x1 + 1, y0), this.proj(x1 + 1, y1 + 1), this.proj(x0, y1 + 1)];
      ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath();
      ctx.save(); ctx.clip();
      ctx.fillStyle = th.hatchFill; ctx.fillRect(left, top, right - left, bot - top);
      ctx.strokeStyle = th.hatch; ctx.lineWidth = 3; ctx.beginPath();
      for (let x = left - (bot - top); x < right; x += 14) { ctx.moveTo(x, top); ctx.lineTo(x + (bot - top), bot); }
      ctx.stroke(); ctx.restore();
    }
    ctx.restore();
  }

  drawOverview(_th) {
    if (!this.ov) return;
    const ctx = this.ctx;
    const W = GRID >> 2;
    for (let i = 0; i < this.ov.length; i++) {
      const ch = this.ov[i];
      if (ch === ".") continue;
      const col = this.blockColor(i);
      const bx = (i % W) * 4, by = Math.floor(i / W) * 4;
      const p0 = this.proj(bx + 0.25, by + 0.25), p1 = this.proj(bx + 3.75, by + 0.25), p2 = this.proj(bx + 3.75, by + 3.75), p3 = this.proj(bx + 0.25, by + 3.75);
      ctx.fillStyle = col; ctx.globalAlpha = this.dark ? 0.8 : 0.9;
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** The fence on the city edge. "back" = the two far sides (drawn before the buildings), "front" = the two near sides. */
  drawFence(which, a, z, th) {
    const ctx = this.ctx, { cs, sn } = this.tr;
    const C = [this.proj(a.x0, a.y0), this.proj(a.x1 + 1, a.y0), this.proj(a.x1 + 1, a.y1 + 1), this.proj(a.x0, a.y1 + 1)];
    const NRM = [[0, -1], [1, 0], [0, 1], [-1, 0]]; // outward normals of the four sides (grid u, v)
    ctx.lineCap = "round";
    for (let i = 0; i < 4; i++) {
      if ((NRM[i][0] * sn + NRM[i][1] * cs > 0) !== (which === "front")) continue;
      const p = C[i], q = C[(i + 1) % 4];
      if (z >= 0.4) {
        const n = Math.max(1, Math.round(Math.hypot(q[0] - p[0], (q[1] - p[1]) * 2) / 64));
        ctx.strokeStyle = th.rail; ctx.lineWidth = 2.2;
        for (const h of [5, 10]) { ctx.beginPath(); ctx.moveTo(p[0], p[1] - h); ctx.lineTo(q[0], q[1] - h); ctx.stroke(); }
        ctx.strokeStyle = th.post; ctx.lineWidth = 3.4;
        ctx.beginPath();
        for (let k = 0; k <= n; k++) { const x = p[0] + (q[0] - p[0]) * k / n, y = p[1] + (q[1] - p[1]) * k / n; ctx.moveTo(x, y); ctx.lineTo(x, y - 13); }
        ctx.stroke();
      } else {
        ctx.strokeStyle = th.post; ctx.lineWidth = Math.max(3, 2.2 / z);
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
      }
    }
    ctx.lineCap = "butt";
  }


  drawSky(now, th) {
    const { ctx, W, H } = this;
    // a few soft clouds that drift a little with the camera
    ctx.fillStyle = this.dark ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.6)";
    const seeds = [[0.1, 0.12, 60], [0.55, 0.07, 80], [0.85, 0.2, 50], [0.3, 0.85, 70], [0.75, 0.9, 55]];
    for (const [fx, fy, r] of seeds) {
      const x = ((fx * W - this.cam.x * 0.05 * this.cam.z) % (W + 200) + W + 200) % (W + 200) - 100, y = fy * H;
      ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.32, 0, 0, 7); ctx.ellipse(x + r * 0.5, y - r * 0.1, r * 0.6, r * 0.3, 0, 0, 7); ctx.fill();
    }
    if (this.dark) {
      for (let i = 0; i < 60; i++) {
        const h = hash2(i, 7);
        ctx.fillStyle = `rgba(255,255,240,${0.4 + 0.4 * (this.motion ? Math.sin(now / 900 + i) : 0.5)})`;
        ctx.fillRect((h % 1000) / 1000 * W, ((h >> 10) % 1000) / 1000 * H * 0.75, 1.6, 1.6);
      }
    }
  }

  deco(gx, gy, cx, cy, z) {
    const h = hash2(gx * 3 + 1, gy * 5 + 2);
    const r = (h % 1000) / 1000;
    const ctx = this.ctx;
    if (r > 0.34 || z < 0.3) return;
    const ox = ((h >> 10) % 20) - 10, oy = ((h >> 15) % 10) - 5;
    const x = cx + ox, y = cy + oy;
    const d = this.dark;
    ctx.strokeStyle = this.ink; ctx.lineWidth = this.lw; ctx.lineJoin = "round";
    if (r < 0.1) {
      const s = 0.55 + ((h >> 8) % 30) / 100;
      ctx.fillStyle = d ? "#4a3a2c" : "#8a6a48"; ctx.fillRect(x - 1.2 * s, y - 7 * s, 2.4 * s, 7 * s); ctx.strokeRect(x - 1.2 * s, y - 7 * s, 2.4 * s, 7 * s);
      if ((h >> 4) & 1) {
        ctx.fillStyle = d ? "#2f6a46" : "#4fa35f"; ctx.beginPath(); ctx.moveTo(x - 7 * s, y - 5 * s); ctx.lineTo(x, y - 21 * s); ctx.lineTo(x + 7 * s, y - 5 * s); ctx.fill(); ctx.stroke();
        ctx.fillStyle = d ? "#3a7f55" : "#66bb73"; ctx.beginPath(); ctx.moveTo(x - 5 * s, y - 11 * s); ctx.lineTo(x, y - 25 * s); ctx.lineTo(x + 5 * s, y - 11 * s); ctx.fill(); ctx.stroke();
      } else {
        const blossom = ((h >> 20) % 5) === 0;
        ctx.fillStyle = d ? (blossom ? "#8a5a78" : "#357a4c") : blossom ? "#f2a5bc" : "#58b265";
        ctx.beginPath(); ctx.ellipse(x, y - 12 * s, 8 * s, 7 * s, 0, 0, 7); ctx.fill(); ctx.stroke();
        ctx.fillStyle = d ? (blossom ? "#a46b90" : "#438f5a") : blossom ? "#f8bfd0" : "#74c97b";
        ctx.beginPath(); ctx.ellipse(x - 2 * s, y - 14 * s, 5 * s, 4.5 * s, 0, 0, 7); ctx.fill(); ctx.stroke();
      }
    } else if (r < 0.16) {
      ctx.fillStyle = d ? "#2f6a46" : "#5fb36a"; ctx.beginPath(); ctx.ellipse(x, y - 3, 5.5, 3.6, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = d ? "#3b7f56" : "#79c983"; ctx.beginPath(); ctx.ellipse(x - 1.5, y - 4.2, 3.2, 2.3, 0, 0, 7); ctx.fill(); ctx.stroke();
    } else if (r < 0.3) {
      const cols = d ? ["#c5738a", "#c9a85a", "#8f78c8"] : ["#ff8aa0", "#ffd166", "#b99cff", "#ffffff"];
      for (let i = 0; i < 3; i++) { ctx.fillStyle = cols[(h >> (3 + i)) % cols.length]; ctx.beginPath(); ctx.arc(x + (i - 1) * 5, y + (i % 2) * 2, 1.7, 0, 7); ctx.fill(); }
    } else {
      ctx.fillStyle = d ? "#6c6f7e" : "#b6b4ac"; ctx.beginPath(); ctx.ellipse(x, y - 2, 4.5, 3, 0, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = d ? "#82859a" : "#cfcdc4"; ctx.beginPath(); ctx.ellipse(x - 1, y - 3, 2.6, 1.6, 0, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  drawCell(c, cx, cy, now, tNow, z, th) {
    const ctx = this.ctx;
    const faded = tNow - c.l >= 7 * DAY;
    ctx.save();
    ctx.translate(cx, cy);
    if (faded) ctx.globalAlpha = 0.5;
    if (this.filter && !this.filter(c)) ctx.globalAlpha *= 0.16; // the search: what does not match fades
    let lift = 0;
    if (c.pop && !c.build) { // a new build drops in with a bounce (the ripple is drawn on the ground)
      const p = (now - c.pop) / 700;
      if (p < 1 && this.motion) {
        this.anims++;
        lift = -DROP * (1 - bounce(Math.max(0, p)));
        ctx.globalAlpha *= Math.min(1, Math.max(0, p) * 6);
      } else c.pop = 0;
    }
    if (c.hopAt) { // the builds next to a landing hop once
      const u = (now - c.hopAt) / 420;
      if (u >= 1 || !this.motion) c.hopAt = 0;
      else { this.anims++; if (u > 0) lift -= HOP * Math.sin(u * Math.PI); }
    }
    ctx.translate(0, lift);
    if (c.b) {
      if (isFree(c)) this.drawFreeCell(c, cx, cy + lift, now, z);
      else if (z < 0.3) this.drawLod(c);
      else c.top = drawBuilding(ctx, { ...c.b, parts: c.parts }, { dark: this.dark, light: this.look.light, outline: this.look.outline, lw: this.lw }).top;
    }
    if (c.claim) {
      const col = TEAM_COLORS[c.team] || "#888";
      const px = 0, py = 16 * 0.84;
      ctx.strokeStyle = "#5a4a40"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(px - 30 * 0.4, py - 4); ctx.lineTo(px - 30 * 0.4, py - 26); ctx.stroke();
      ctx.fillStyle = col; ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = 0.8;
      ctx.beginPath(); ctx.moveTo(px - 12, py - 26); ctx.lineTo(px - 1, py - 22); ctx.lineTo(px - 12, py - 18); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
    if (c.sign) {
      ctx.save();
      ctx.translate(c.b ? 26 : 0, c.b ? 14 : 8);
      drawSign(ctx, c.sign, { dark: this.dark, detail: z >= 0.7, outline: this.look.outline, lw: this.lw });
      ctx.restore();
    }
    ctx.restore();
  }

  /** A free build (3D model or picture). While the bot builds it, the pieces show one after the other; else it is copied from a baked canvas
   * (only when the view is on a 90 degree snap: while it turns, it is drawn unbaked). It turns with the town; its box faces light up at night. */
  drawFreeCell(c, cx, cy, now, z) {
    const fr = freeOf(c);
    if (!fr || z < 0.3) { this.drawLod(c); return; }
    const motion = this.motion && !(fr.moving && this.freeAnims >= MAX_FREE_ANIMS);
    if (c.seed === undefined) c.seed = hash2(c.x, c.y) % 997;
    const o = { dark: this.dark, now, motion, phi: this.phi, outline: this.look.outline, light: this.look.light, seed: c.seed, lw: o_lw(this) };
    let anim = fr.moving && motion;
    if (anim) this.freeAnims++;
    if (c.build) {
      const p = (now - c.build.t0) / c.build.dur, n = c.build.total - c.build.from;
      if (p >= 1) c.build = null;
      else {
        const k = Math.min(n, Math.floor(Math.max(0, p) * n) + 1); // pieces shown so far (the one being placed included)
        o.upTo = c.build.from + k;
        o.pop = Math.min(1, (p * n - (k - 1)) * 2); // the newest piece settles in the first half of its slot
        anim = true;
      }
    }
    if (o.upTo == null) o.scale = this.bakeScale();
    drawFree(this.ctx, fr, o);
    c.top = fr.top;
    if (anim) this.anims++;
    if (this.dark && fr.blink && this.glows.length < 40) this.glows.push({ fr, cx, cy, lift: 0, seed: c.seed });
  }


  /** A plan ghost: the planned building, see-through, with a dashed outline on the ground. It is clearly "not built yet". */
  drawGhost(g, cx, cy, z, now) {
    const ctx = this.ctx;
    const col = PAL[(g.p.charCodeAt(0) + g.p.charCodeAt(1)) % 16][1];
    ctx.save();
    ctx.translate(cx, cy);
    if (z >= 0.3) {
      ctx.globalAlpha = 0.34;
      drawBuilding(ctx, { style: g.style, h: g.h, pal: g.pal, seed: g.seed, parts: g.parts }, { dark: this.dark, outline: this.look.outline, lw: this.lw });
      ctx.globalAlpha = 1;
    }
    // dashed outline, walking slowly so it reads as "in progress"
    ctx.setLineDash([7, 5]); ctx.lineDashOffset = -(now / 90) % 12;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(2, 1.6 / z);
    ctx.fillStyle = col; ctx.globalAlpha = 0.14;
    ctx.beginPath(); ctx.moveTo(0, -15); ctx.lineTo(30, 0); ctx.lineTo(0, 15); ctx.lineTo(-30, 0); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.95; ctx.stroke();
    ctx.restore();
    this.anims++;
  }

  drawLod(c) {
    const ctx = this.ctx;
    const fr = isFree(c) ? freeOf(c) : null;
    const pal = fr ? [fr.main, fr.main] : PAL[c.b.pal % 16];
    const H = (10 + c.b.h * 5.5) * 0.9;
    const d = this.dark ? 0.65 : 1;
    const sh = (hx, f) => { const r = parseInt(hx.slice(1, 3), 16), g = parseInt(hx.slice(3, 5), 16), b = parseInt(hx.slice(5, 7), 16); return `rgb(${(r * f * d) | 0},${(g * f * d) | 0},${(b * f * d) | 0})`; };
    const P = (u, v, zz) => [(u - v) * 32, (u + v) * 16 - zz];
    const poly = (pts, fill) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = this.ink; ctx.lineWidth = this.lw; ctx.stroke(); };
    const s = 0.3;
    poly([P(-s, s, 0), P(s, s, 0), P(s, s, H), P(-s, s, H)], sh(pal[0], 1));
    poly([P(s, s, 0), P(s, -s, 0), P(s, -s, H), P(s, s, H)], sh(pal[0], 0.78));
    poly([P(-s, -s, H), P(s, -s, H), P(s, s, H), P(-s, s, H)], sh(pal[1], 1.05));
    c.top = H;
  }

  drawEffects(now, z, th, look) {
    const ctx = this.ctx;
    this.dusts = this.dusts.filter((d) => now - d.t < 1100);
    if (this.motion) {
      for (const d of this.dusts) { // the ripple on the ground where a build landed
        const p = (now - d.t) / 1100;
        if (p < 0) continue;
        const [cx, cy] = this.worldOf(d.x, d.y), r = (0.4 + p * 1.6) * K;
        ctx.save(); ctx.globalAlpha = 1 - p; ctx.strokeStyle = look.accent2; ctx.lineWidth = 2.5 / Math.min(1, z + 0.3);
        ctx.beginPath(); ctx.ellipse(cx, cy, r, r / 2, 0, 0, 7); ctx.stroke(); ctx.restore();
      }
    }
    if (this.selected) {
      const { x, y } = this.selected, pulse = 0.5 + 0.5 * Math.sin(now / 260);
      const P = [this.proj(x, y), this.proj(x + 1, y), this.proj(x + 1, y + 1), this.proj(x, y + 1)];
      ctx.strokeStyle = this.dark ? "#ffe9a8" : "#ff7a3d"; ctx.lineWidth = (2.2 + pulse) / Math.min(1, z + 0.3);
      ctx.beginPath(); P.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py))); ctx.closePath(); ctx.stroke();
    }
  }


  drawLabels(now, th) {
    const ctx = this.ctx;
    this.labels = this.labels.filter((c) => c.labelUntil > now);
    for (const c of this.labels) {
      const [sx, sy] = this.screenOf(c.x, c.y, (c.top || 40) + 6);
      if (sx < -80 || sx > this.W + 80 || sy < -30 || sy > this.H + 80) continue;
      const left = c.labelUntil - now;
      const a = Math.min(1, left / 700) * Math.min(1, (now - (c.labelUntil - 5200)) / 250);
      this.pill(sx, sy, `by ${c.team === "other" ? "another AI" : "a " + (TEAM_LABELS[c.team] || "AI")}`, TEAM_COLORS[c.team] || "#888", a, th);
    }
  }

  /** A label pill with a team dot; its bottom is 2 px above (sx, sy). */
  pill(sx, sy, text, col, a, th) {
    const ctx = this.ctx;
    ctx.font = "700 11px ui-rounded, system-ui, sans-serif";
    const w = ctx.measureText(text).width + 22;
    ctx.globalAlpha = a;
    ctx.fillStyle = th.label; ctx.strokeStyle = "rgba(0,0,0,0.18)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(sx - w / 2, sy - 22, w, 20, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(sx - w / 2 + 11, sy - 12, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = th.labelText; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(text, sx - w / 2 + 18, sy - 11.5);
    ctx.globalAlpha = 1;
  }
}

/** Dev-only: a made-up town for screenshots (?demo). Not real data. */
export function demoCells(n = 240) {
  let s = 12345;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const out = [];
  const used = new Set();
  const now = Date.now();
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.pow(rnd(), 0.7) * 14;
    const x = Math.round(CENTER + Math.cos(a) * r), y = Math.round(CENTER + Math.sin(a) * r * 0.9);
    if (used.has(key(x, y))) continue;
    used.add(key(x, y));
    const team = TEAMS[Math.floor(rnd() * 4)];
    const roll = rnd();
    const w = { x, y, t: team, l: now - Math.floor(rnd() * 3) * DAY, v: "demo", ts: now - 1e6 };
    if (roll < 0.78) {
      w.b = `${STYLES[Math.floor(rnd() * 24)]}.${1 + Math.floor(rnd() * 9)}.${Math.floor(rnd() * 16)}.${Math.floor(rnd() * 1000)}`;
      const np = rnd() < 0.5 ? 0 : 1 + Math.floor(rnd() * 3);
      const sides = [...SIDES].sort(() => rnd() - 0.5);
      w.e = Array.from({ length: np }, (_, k) => `${PARTS[Math.floor(rnd() * 16)]}.${sides[k]}.${1 + Math.floor(rnd() * 9)}`).join(",");
      if (!w.e) delete w.e;
      if (rnd() < 0.12) w.l = now - 8 * DAY;
    } else if (roll < 0.9) {
      const tpl = 1 + Math.floor(rnd() * 12);
      const need = TEMPLATES[tpl - 1].match(/\{\d\}/g).length;
      const safe = ["places", "things", "weather", "silly"];
      const ws = Array.from({ length: 3 }, (_, k) => (k < need ? (WORD_CLASSES[safe[Math.floor(rnd() * 4)]][Math.floor(rnd() * 20)]) : "-"));
      w.s = `t${tpl}.${ws.join(".")}`;
    } else w.c = 1;
    out.push(w);
  }
  return out;
}
