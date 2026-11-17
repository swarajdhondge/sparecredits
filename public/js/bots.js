// Builder bots (CityView option `bots`): one small flying bot per visit. A live change from a visit goes into its bot's queue and
// the cell changes on the map when the bot reaches it. The bot rests 60 s after its last change, then fades out.
import { TEAM_COLORS } from "./buildings.js";

const HOVER = 64; // world px the bot hovers above the ground, at least (it rises to stay above a tall building)
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const LABEL = { claude: "Claude AI", chatgpt: "ChatGPT AI", gemini: "Gemini AI" };

export class Bots {
  constructor(view) {
    this.v = view;
    this.m = new Map(); // visit code -> bot
    // rAF stops in a hidden tab: apply everything that waits, so no change stays unapplied
    this.onVis = () => { if (document.hidden) this.flush(); };
    document.addEventListener("visibilitychange", this.onVis);
  }
  destroy() { document.removeEventListener("visibilitychange", this.onVis); }
  get active() { return this.m.size > 0; }
  clear() { this.m.clear(); }

  /** A live change. True when a bot took it (the cell changes later); false when the caller must apply it now. */
  add(w) {
    if (document.hidden || w.gone || !w.v) return false;
    this.queue(w.v, w.t, [w], !!this.v.opts.mine?.(w.v));
    return true;
  }
  /** "Show" on the home page: the visit's bot plays its changes again in place. The items are ghosts: they pop a cell that
   * still carries this visit's code and never write cell data. events = [{x, y}]. */
  show(v, team, events) {
    this.queue(v, team, events.map((e) => ({ x: e.x, y: e.y, v, t: team, ghost: true })), true);
    this.m.get(v).built = new Set(); // free cells this show has built already: a later change of the same cell does not build it again
  }
  queue(v, team, items, mine) {
    let b = this.m.get(v);
    if (!b) this.m.set(v, (b = { v, q: [], cur: null, ph: "", t0: 0, dur: 0, h: HOVER, px: items[0].x, py: items[0].y, fx: items[0].x, fy: items[0].y, tx: items[0].x, ty: items[0].y, a: 1, rest: 0, f: 1, fresh: true }));
    b.team = team || "other";
    b.mine = mine;
    b.q.push(...items);
    if (b.ph === "rest" || b.ph === "fade") { b.ph = ""; b.a = 1; } // a new change wakes the bot
  }
  /** A cell was removed: its queued changes must not bring it back. */
  drop(x, y) {
    for (const b of this.m.values()) {
      b.q = b.q.filter((w) => !(w.x === x && w.y === y));
      if (b.cur && b.cur.x === x && b.cur.y === y) { b.cur = null; if (b.ph === "fly" || b.ph === "drop") b.ph = ""; }
    }
  }
  /** An older change never replaces a newer cell. */
  stale(w) { if (w.ghost) return false; const o = this.v.cell(w.x, w.y); return !!(o && o.ts && (w.ts || 0) < o.ts); }
  /** Apply the change the bot reached. Returns the time in ms (normal speed) the bot needs to build it piece by piece (0: a quick pop). */
  apply(b, animate) {
    const w = b.cur; b.cur = null;
    let ms = 0;
    if (!w) return ms;
    if (w.ghost) { // pop the cell again if it is still this visit's; no data change
      const c = this.v.cell(w.x, w.y);
      if (animate && c && c.visit === b.v) {
        const free = c.b && (c.b.style === "free" || c.b.style === "picture"), k = `${c.x},${c.y}`;
        if (free && !b.built?.has(k)) { ms = this.v.startBuild(c.x, c.y, b.f, true); b.built?.add(k); }
        const t = performance.now(); if (!free) c.pop = t;
        this.v.dusts.push({ x: c.x, y: c.y, t }); this.v.dirty = true;
      }
    } else {
      if (this.stale(w)) return ms;
      this.v.place(w, animate, false);
      if (animate) ms = this.v.startBuild(w.x, w.y, b.f);
    }
    if (animate) this.v.emit("botat", w);
    return ms;
  }
  flush() {
    const now = performance.now();
    for (const b of this.m.values()) {
      if (b.cur) this.apply(b, false);
      for (const w of b.q) { b.cur = w; this.apply(b, false); b.px = w.x; b.py = w.y; }
      b.q = []; b.ph = "rest"; b.rest = now + 60000; b.a = 1;
    }
    this.v.dirty = true;
  }

  step(now) {
    for (const [k, b] of this.m) {
      const c = this.v.cell(Math.round(b.px), Math.round(b.py)); // stay above the building under the bot
      b.h += (Math.max(HOVER, (c?.top || 0) + 26) - b.h) * 0.12;
      for (let guard = 0; guard < 4; guard++) {
        if (b.ph === "drop" || b.ph === "fly") {
          const p = Math.min(1, (now - b.t0) / b.dur);
          b.px = b.fx + (b.tx - b.fx) * ease(p); b.py = b.fy + (b.ty - b.fy) * ease(p);
          if (p < 1) break;
          const ms = this.apply(b, true); b.ph = "work"; b.t0 = now; b.dur = Math.max(400, ms) / b.f; // a free build keeps the bot at work until the last piece
        } else if (b.ph === "work") {
          if (now - b.t0 < b.dur) break;
          b.ph = "";
        } else if (b.ph === "") {
          b.f = b.q.length > 12 ? 3 : 1; // a long queue: work 3 times faster
          let w = b.q.shift();
          while (w && this.stale(w)) w = b.q.shift();
          if (!w) { b.ph = "rest"; b.rest = now + 60000; continue; }
          if (!w.ghost) this.v.emit("botgo", w); // the bot starts to work on this cell
          b.cur = w; b.t0 = now; b.fx = b.px; b.fy = b.py; b.tx = w.x; b.ty = w.y;
          if (b.fresh) { b.fresh = false; b.ph = "drop"; b.dur = 400 / b.f; } else { b.ph = "fly"; b.dur = Math.max(300, Math.min(900, 300 + Math.hypot(w.x - b.px, w.y - b.py) * 25)) / b.f; }
        } else if (b.ph === "rest") {
          if (now < b.rest) break;
          b.ph = "fade"; b.t0 = now;
        } else if (b.ph === "fade") {
          b.a = 1 - (now - b.t0) / 500;
          if (b.a <= 0) this.m.delete(k);
          break;
        } else break;
      }
    }
  }

  /** World drawing (camera transform is set): shadow and bot. */
  draw(now, z, th) {
    const ctx = this.v.ctx, dark = this.v.dark;
    for (const b of this.m.values()) {
      const [wx, wy] = this.v.worldOf(b.px, b.py); // the town may be turned
      const drop = b.ph === "drop" ? (1 - ease(Math.min(1, (now - b.t0) / b.dur))) * 160 : 0;
      const y = wy - b.h - drop - Math.sin(now / 520 + b.px) * 3, col = TEAM_COLORS[b.team] || TEAM_COLORS.other;
      ctx.save(); ctx.globalAlpha = Math.max(0, b.a);
      if (z < 0.3) { // far out: a pulsing dot
        ctx.fillStyle = col; ctx.strokeStyle = dark ? "#fff" : "#1b1020"; ctx.lineWidth = 1.5 / z;
        ctx.beginPath(); ctx.arc(wx, y, (5 + 1.5 * Math.sin(now / 300)) / z, 0, 7); ctx.fill(); ctx.stroke();
        ctx.restore(); continue;
      }
      ctx.fillStyle = th.shadow; ctx.globalAlpha *= 1.6 / (1 + (b.h + drop) / 60); // the higher, the fainter
      ctx.beginPath(); ctx.ellipse(wx, wy + 2, 11, 5, 0, 0, 7); ctx.fill(); ctx.globalAlpha = Math.max(0, b.a);
      ctx.translate(wx, y);
      const edge = dark ? "rgba(255,255,255,0.85)" : "rgba(27,16,32,0.8)";
      ctx.lineWidth = 1.6; ctx.strokeStyle = edge;
      ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(0, -22); ctx.moveTo(-7, 4); ctx.lineTo(7, 4); ctx.stroke(); // mast and skid
      const rw = 12 * Math.abs(Math.cos(now / 45)) + 2; // rotor
      ctx.beginPath(); ctx.moveTo(-rw, -22.5); ctx.lineTo(rw, -22.5); ctx.stroke();
      ctx.fillStyle = col; ctx.beginPath(); ctx.roundRect(-10, -17, 20, 19, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,0.32)"; ctx.beginPath(); ctx.roundRect(-7, -11, 14, 5, 2.5); ctx.fill(); // visor band
      const on = b.ph === "work" || b.ph === "drop" ? Math.sin(now / 110) > 0 : false; // the work light blinks while it builds
      ctx.fillStyle = on ? "#ffd84a" : "rgba(255,255,255,0.5)"; ctx.beginPath(); ctx.arc(0, -5, 2.2, 0, 7); ctx.fill();
      if (on) { ctx.globalAlpha *= 0.35; ctx.fillStyle = "#ffd84a"; ctx.beginPath(); ctx.arc(0, -5, 6, 0, 7); ctx.fill(); }
      ctx.restore();
    }
  }
  /** Screen drawing: the label pill above each bot. */
  labels(th) {
    const v = this.v;
    for (const b of this.m.values()) {
      const [sx, sy] = v.screenOf(b.px, b.py, b.h + 28 + (b.ph === "drop" ? (1 - ease(Math.min(1, (performance.now() - b.t0) / b.dur))) * 160 : 0));
      if (sx < -80 || sx > v.W + 80 || sy < -30 || sy > v.H + 80) continue;
      const name = b.team === "other" || !LABEL[b.team] ? (b.mine ? "AI" : "Another AI") : LABEL[b.team];
      v.pill(sx, sy, (b.mine ? "Your " : "") + name, TEAM_COLORS[b.team] || TEAM_COLORS.other, Math.max(0, b.a), th);
    }
  }
}
