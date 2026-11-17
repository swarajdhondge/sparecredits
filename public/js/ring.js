// The living ring of the town (decoration only, never a rule): a road round the open area, a harbour with boats along its south side, lamps,
// walkers in team colours and a few birds. It sits outside the open area and grows with it. Every cell inside the open area stays buildable.
// Ambient drawing is skipped below the detail zoom, and walkers are capped (MAX_WALKERS).
import { TEAMS, CHUNK_SHIFT } from "../kit.js";
import { TEAM_COLORS, prepFree, drawFree } from "./buildings.js";

const ROAD = 1; // cells of road round the open area
const HARBOUR = 3; // cells of water south of the road (the south side is +y)
const MAX_WALKERS = 24;
const MAX_RING_WALKERS = 10;
const HOP = 12; // world px: how high a walker hops when a build lands beside it
const SL = 46; // thickness of the slab (world px)
const BOAT = "r-3-2-0-10-12-3-a64_t-7-7-3-2-2-14-ddd_c-4-5-6-8-6-10-{c}"; // a sailboat in kit shapes; {c} is the sail colour
const SAILS = ["e75", "47c", "4a8", "c57"];
const SKIN = "#f1c9a5";
const mod = (a, n) => ((a % n) + n) % n;

export class Ring {
  /** decor false: only the slab under the open area (no road, harbour or ambient things). */
  constructor(view, decor = true) {
    this.v = view; this.decor = decor;
    this.road = decor ? ROAD : 0; this.harb = decor ? HARBOUR : 0;
    this.inside = []; // walkers on free cells of the town (stateful)
    this.boats = SAILS.map((c) => prepFree("free", BOAT.replace("{c}", c)));
    this.last = 0; this.spawnAt = 0;
    this.lamps = []; // lamp points on screen this frame (world px), for the night light
    this.share = null; this.shareRev = -1; // team share for the shirts
  }

  /** The slab and the ground of the ring: [u0, u1, v0, v1] in grid corner coordinates. */
  extent(a) { return [a.x0 - this.road, a.x1 + 1 + this.road, a.y0 - this.road, a.y1 + 1 + this.road + this.harb]; }

  /** Cumulative team share (0 to 1) for walker shirts: the view's own share (setTeamShare) or the teams of the cells it holds. */
  teamAt(f) {
    const v = this.v;
    if (!this.share || (!v.shareSet && this.shareRev !== v.rev)) {
      this.shareRev = v.rev;
      const n = { claude: 0, chatgpt: 0, gemini: 0, other: 0 };
      if (v.shareSet) Object.assign(n, v.shareSet);
      else for (const c of v.cells.values()) if (c.b) n[TEAMS.includes(c.team) ? c.team : "other"]++;
      const tot = TEAMS.reduce((s, t) => s + (n[t] || 0), 0) || 1;
      let acc = 0;
      this.share = TEAMS.map((t) => (acc += (n[t] || 0) / tot));
    }
    const i = this.share.findIndex((s) => f <= s);
    return TEAMS[i < 0 ? TEAMS.length - 1 : i];
  }

  // ---------- slab and ground ----------
  /** Shadow, slab sides and the flat top of the whole slab (open area, road and harbour). */
  slab(th, look) {
    const v = this.v, ctx = v.ctx, a = v.openV, [u0, u1, v0, v1] = this.extent(a);
    const { cs, sn } = v.tr;
    const E = [v.proj(u0, v0), v.proj(u1, v0), v.proj(u1, v1), v.proj(u0, v1)];
    const path = (pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
    ctx.fillStyle = th.shadow;
    path(E.map(([x, y]) => [x, y + SL + 30]));
    ctx.fill();
    // the harbour is the last HARBOUR cells of v: its sides are the colour of water
    const hv = v1 - this.harb; // v where the water starts
    const side = (p, q, nu, nv, f0, f1) => { // an edge from p to q with outward normal (nu, nv); f0..f1 = the part (0..1) that is harbour on a side edge, or null
      if (nu * sn + nv * cs <= 1e-6) return;
      const left = -(nu * cs - nv * sn) > 0, base = left ? th.slabSide : th.slabSide2, water = look.waterSide;
      const quad = (s0, s1, col) => {
        const P = [p[0] + (q[0] - p[0]) * s0, p[1] + (q[1] - p[1]) * s0], Q = [p[0] + (q[0] - p[0]) * s1, p[1] + (q[1] - p[1]) * s1];
        path([P, Q, [Q[0], Q[1] + SL], [P[0], P[1] + SL]]); ctx.fillStyle = col; ctx.fill();
      };
      if (f0 == null) quad(0, 1, base);
      else { if (f0 > 0) quad(0, f0, base); quad(f0, f1, water); if (f1 < 1) quad(f1, 1, base); }
    };
    const fw = (hv - v0) / (v1 - v0); // the fraction along a side edge (u fixed, v from v0 to v1) where the water starts
    side(E[0], E[1], 0, -1, null); // v0 edge (north)
    side(E[1], E[2], 1, 0, fw, 1); // u1 edge (east)
    side(E[2], E[3], 0, 1, this.harb ? 0 : null, 1); // v1 edge (south): all harbour
    side(E[3], E[0], -1, 0, 0, 1 - fw); // u0 edge, from v1 back to v0: the water is the first part
    path(E); ctx.fillStyle = th.grass[0]; ctx.fill();
  }

  /** The road and the harbour on top of the slab (the open area's own grass is drawn after this). */
  ground(th, look, now, z) {
    const v = this.v, ctx = v.ctx, a = v.openV, [u0, u1, v0, v1] = this.extent(a);
    const pts = (rect) => [v.proj(rect[0], rect[2]), v.proj(rect[1], rect[2]), v.proj(rect[1], rect[3]), v.proj(rect[0], rect[3])];
    const path = (P) => { ctx.moveTo(P[0][0], P[0][1]); for (let i = 1; i < 4; i++) ctx.lineTo(P[i][0], P[i][1]); ctx.closePath(); };
    const roadOut = [u0, u1, v0, v1 - HARBOUR], roadIn = [a.x0, a.x1 + 1, a.y0, a.y1 + 1];
    // the road: the band between two rectangles
    ctx.beginPath(); path(pts(roadOut)); path(pts(roadIn).reverse());
    ctx.fillStyle = look.rail; ctx.fill("evenodd");
    // the harbour
    const water = [u0, u1, v1 - HARBOUR, v1];
    ctx.beginPath(); path(pts(water)); ctx.fillStyle = look.water; ctx.fill();
    ctx.lineJoin = "round";
    if (z >= 0.4) {
      // dashed centre line of the road
      const mid = [u0 + ROAD / 2, u1 - ROAD / 2, v0 + ROAD / 2, v1 - HARBOUR - ROAD / 2];
      ctx.save(); ctx.setLineDash([9, 8]); ctx.strokeStyle = v.dark ? "rgba(255,240,200,0.35)" : "rgba(255,250,235,0.8)"; ctx.lineWidth = 2;
      ctx.beginPath(); path(pts(mid)); ctx.stroke(); ctx.restore();
      // tile lines and slow shimmer on the water
      ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1 / Math.min(1, z + 0.3);
      ctx.beginPath();
      for (let u = u0; u <= u1; u++) { const p = v.proj(u, v1 - HARBOUR), q = v.proj(u, v1); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      for (let r = v1 - HARBOUR; r <= v1; r++) { const p = v.proj(u0, r), q = v.proj(u1, r); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); }
      ctx.stroke();
      {
        ctx.lineWidth = 1.8; ctx.lineCap = "round";
        for (let iu = Math.ceil(u0); iu < u1; iu++) for (let iv = v1 - HARBOUR; iv < v1; iv++) {
          const h = ((iu * 73856093) ^ (iv * 19349663)) >>> 0;
          if (h & 3) continue;
          const off = ((v.motion ? now / 2600 : 0) + (h % 97) / 97) % 1;
          ctx.strokeStyle = `rgba(255,255,255,${0.55 * Math.sin(off * Math.PI)})`;
          const p = v.proj(iu + 0.2 + off * 0.3, iv + 0.5), q = v.proj(iu + 0.5 + off * 0.3, iv + 0.5);
          ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke();
        }
        ctx.lineCap = "butt";
      }
    }
    ctx.strokeStyle = th.edge; ctx.lineWidth = 3; ctx.beginPath(); path(pts([u0, u1, v0, v1])); ctx.stroke();
  }

  // ---------- things that stand in the town (painter order) ----------
  /** A point on the road loop that is `e` cells outside the open area, at distance s along it (clockwise from the north corner). Returns [u, v]. */
  onLoop(a, e, s) {
    const u0 = a.x0 - e, u1 = a.x1 + 1 + e, v0 = a.y0 - e, v1 = a.y1 + 1 + e, w = u1 - u0, h = v1 - v0, L = 2 * (w + h);
    s = mod(s, L);
    if (s < w) return [u0 + s, v0];
    if (s < w + h) return [u1, v0 + (s - w)];
    if (s < 2 * w + h) return [u1 - (s - w - h), v1];
    return [u0, v1 - (s - 2 * w - h)];
  }
  loopLength(a, e) { return 2 * ((a.x1 + 1 - a.x0 + 2 * e) + (a.y1 + 1 - a.y0 + 2 * e)); }

  /** How high (world px) a walker at (u, w) hops: people within 2.5 cells of a landing build jump once when it lands (design: walkers hop). */
  hopOf(u, w, now) {
    let hop = 0;
    for (const d of this.v.dusts) {
      const t = (now - d.t) / 600;
      if (t > 0 && t < 1 && Math.hypot(d.x + 0.5 - u, d.y + 0.5 - w) < 2.5) hop = Math.max(hop, HOP * Math.sin(t * Math.PI));
    }
    return hop;
  }

  /** The ambient things in view for this frame: [{depth, kind, u, v, ...}] (sorted by depth later). Lamps are also kept for the night light. */
  items(now, z, vis) {
    const v = this.v, a = v.openV, out = [], motion = v.motion;
    this.lamps.length = 0;
    const inView = (u, w) => { const [x, y] = v.proj(u, w); return x > vis.left - 60 && x < vis.right + 60 && y > vis.top - 90 && y < vis.bot + 60 ? [x, y] : null; };
    const depth = (u, w) => v.depthOf(u, w);
    const [u0, u1, v0, v1] = this.extent(a);
    // lamps: along the outer edge of the road, about every 3 cells
    const Ll = this.loopLength(a, 0.9), nL = Math.max(8, Math.floor(Ll / 3.2));
    for (let i = 0; i < nL; i++) {
      const [u, w] = this.onLoop(a, 0.9, (i / nL) * Ll);
      const p = inView(u, w);
      if (p) { out.push({ depth: depth(u, w), kind: "lamp", x: p[0], y: p[1] }); this.lamps.push(p); }
    }
    // walkers on the road: both lanes, both directions
    const L = this.loopLength(a, 0.5), nR = Math.min(MAX_RING_WALKERS, Math.max(3, Math.round(L / 14)));
    for (let i = 0; i < nR; i++) {
      const fr = (i * 0.6180339887) % 1, dir = i % 2 ? 1 : -1, e = i % 2 ? 0.3 : 0.7;
      const Le = this.loopLength(a, e), s = fr * Le + (motion ? dir * (0.35 + 0.25 * ((i * 7) % 5) / 5) * now / 1000 : 0);
      const [u, w] = this.onLoop(a, e, s), p = inView(u, w);
      if (p) out.push({ depth: depth(u, w), kind: "walker", x: p[0], y: p[1], team: this.teamAt((i + 0.5) / (nR + this.inside.length || 1)), ph: i, moving: motion, hop: motion ? this.hopOf(u, w, now) : 0 });
    }
    // walkers inside the town, on free cells
    for (const w of this.inside) {
      const p = inView(w.u, w.v);
      if (p) out.push({ depth: depth(w.u, w.v), kind: "walker", x: p[0], y: p[1], team: w.team, ph: w.id, moving: !w.wait, hop: motion ? this.hopOf(w.u, w.v, now) : 0 });
    }
    // boats in the harbour
    const width = a.x1 + 1 - a.x0, nB = 2 + (width >= 60 ? 1 : 0) + (width >= 100 ? 1 : 0);
    for (let i = 0; i < nB; i++) {
      const bu = u0 + 1.5 + ((i + 0.5) / nB) * (u1 - u0 - 3) + (motion ? 1.1 * Math.sin(now / 5200 + i * 2.1) : 0);
      const bv = v1 - HARBOUR + 1.2 + (i % 2) * 0.8 + (motion ? 0.25 * Math.sin(now / 3100 + i) : 0);
      const p = inView(bu, bv);
      if (p && this.boats[i % this.boats.length]) out.push({ depth: depth(bu, bv), kind: "boat", x: p[0], y: p[1] + (motion ? 2.2 * Math.sin(now / 700 + i) : 0), fr: this.boats[i % this.boats.length] });
    }
    out.sort((p, q) => p.depth - q.depth);
    return out;
  }

  /** Draw one ambient item (camera transform is set). */
  drawItem(it, now, th, look) {
    const v = this.v, ctx = v.ctx;
    if (it.kind === "lamp") {
      ctx.strokeStyle = "#4a5163"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(it.x, it.y); ctx.lineTo(it.x, it.y - 17); ctx.stroke(); ctx.lineCap = "butt";
      ctx.fillStyle = v.dark ? look.light : "#f2efe6"; ctx.beginPath(); ctx.arc(it.x, it.y - 19, 3.2, 0, 7); ctx.fill();
      ctx.strokeStyle = v.dark ? look.outline : "rgba(58,42,26,0.5)"; ctx.lineWidth = 0.8; ctx.stroke();
    } else if (it.kind === "walker") {
      const bob = it.moving ? Math.abs(Math.sin(now / 140 + it.ph)) * 1.6 : 0, y = it.y - bob - it.hop;
      ctx.fillStyle = TEAM_COLORS[it.team] || "#888"; ctx.strokeStyle = look.outline; ctx.lineWidth = 0.9;
      ctx.beginPath(); ctx.roundRect(it.x - 2.8, y - 9.5, 5.6, 9, 2.4); ctx.fill(); ctx.stroke();
      ctx.fillStyle = SKIN; ctx.beginPath(); ctx.arc(it.x, y - 12.4, 2.7, 0, 7); ctx.fill(); ctx.stroke();
    } else if (it.kind === "boat") {
      ctx.save(); ctx.translate(it.x, it.y);
      ctx.fillStyle = "rgba(255,255,255,0.22)"; ctx.beginPath(); ctx.ellipse(0, 4, 26, 9, 0, 0, 7); ctx.fill(); // wake
      drawFree(ctx, it.fr, { dark: v.dark, now, motion: false, phi: v.phi, outline: look.outline, light: look.light, scale: v.bakeScale() });
      ctx.restore();
    }
  }

  /** Night: soft light round every lamp (the camera transform is set; call with the "lighter" blend). */
  nightLamps(z, look) {
    const ctx = this.v.ctx, [r, g, b] = hexRgb(look.light);
    for (const [x, y] of this.lamps) {
      const gr = ctx.createRadialGradient(x, y - 19, 0, x, y - 19, 24); gr.addColorStop(0, `rgba(${r},${g},${b},0.5)`); gr.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y - 19, 24, 0, 7); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.scale(1, 0.5);
      const gg = ctx.createRadialGradient(0, 0, 0, 0, 0, 40); gg.addColorStop(0, `rgba(${r},${g},${b},0.22)`); gg.addColorStop(1, `rgba(${r},${g},${b},0)`);
      ctx.fillStyle = gg; ctx.beginPath(); ctx.arc(0, 0, 40, 0, 7); ctx.fill(); ctx.restore();
    }
  }

  // ---------- walkers on free cells ----------
  freeCell(x, y) {
    const v = this.v, o = v.open;
    if (x < o.x0 || x > o.x1 || y < o.y0 || y > o.y1) return false;
    if (v.loaded.size && !v.loaded.has((y >> CHUNK_SHIFT) * 8 + (x >> CHUNK_SHIFT))) return false;
    const c = v.cell(x, y);
    if (c && (c.b || c.claim || c.sign)) return false;
    if (v.ghosts.size && v.ghostAt(x, y)) return false;
    return this.nearBuild(x, y);
  }
  /** Walkers stay within 2 cells of a build, never out on empty grass. */
  nearBuild(x, y) {
    for (let dx = -2; dx <= 2; dx++) for (let dy = -2; dy <= 2; dy++) { const c = this.v.cell(x + dx, y + dy); if (c && c.b) return true; }
    return false;
  }

  /** Move the walkers on free cells (screen centre = where the person looks, so they are in view). */
  step(now, z) {
    const v = this.v, dt = Math.min(64, now - this.last) / 1000;
    this.last = now;
    if (z < v.detailZoom || !v.motion) return;
    const [cu, cv] = v.unproj(...v.toWorld(v.W / 2, v.H / 2));
    const want = Math.min(MAX_WALKERS - MAX_RING_WALKERS, 14);
    for (const w of this.inside) {
      if (Math.hypot(w.u - cu, w.v - cv) > 22 || !this.freeCell(Math.floor(w.u), Math.floor(w.v))) w.dead = true;
    }
    this.inside = this.inside.filter((w) => !w.dead);
    let tries = 0, near = null;
    if (this.inside.length < want && now - this.spawnAt > 400) { // the built cells near the view: walkers start beside one
      this.spawnAt = now; near = [];
      for (const c of v.cells.values()) if (c.b && Math.abs(c.x - cu) < 14 && Math.abs(c.y - cv) < 14) near.push(c);
    }
    while (near && near.length && this.inside.length < want && tries++ < 8) {
      const b = near[Math.floor(Math.random() * near.length)], gx = b.x + Math.floor(Math.random() * 5) - 2, gy = b.y + Math.floor(Math.random() * 5) - 2;
      if (!this.freeCell(gx, gy)) continue;
      this.inside.push({ id: Math.floor(Math.random() * 1e4), u: gx + 0.5, v: gy + 0.5, tu: gx + 0.5, tv: gy + 0.5, wait: Math.random() * 2, sp: 0.5 + Math.random() * 0.5, team: this.teamAt(Math.random()) });
    }
    for (const w of this.inside) {
      if (w.wait > 0) { w.wait -= dt; continue; }
      const du = w.tu - w.u, dv = w.tv - w.v, d = Math.hypot(du, dv);
      if (d < 0.03) {
        const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => this.freeCell(Math.floor(w.u) + a, Math.floor(w.v) + b));
        if (!n.length || Math.random() < 0.3) { w.wait = 1 + Math.random() * 2.5; continue; }
        const [a, b] = n[Math.floor(Math.random() * n.length)];
        w.tu = Math.floor(w.u) + a + 0.5; w.tv = Math.floor(w.v) + b + 0.5;
        continue;
      }
      const s = Math.min(d, w.sp * dt);
      w.u += (du / d) * s; w.v += (dv / d) * s;
    }
  }

  // ---------- birds ----------
  drawBirds(now, look) {
    const v = this.v, ctx = v.ctx, a = v.openV, n = 3 + (a.x1 - a.x0 > 60 ? 1 : 0) + (a.x1 - a.x0 > 100 ? 1 : 0);
    const cu = (a.x0 + a.x1 + 1) / 2, cv = (a.y0 + a.y1 + 1) / 2, rad = (a.x1 - a.x0 + 1) * 0.32;
    ctx.strokeStyle = v.dark ? "rgba(240,235,220,0.7)" : "rgba(58,42,26,0.7)"; ctx.lineWidth = 1.7; ctx.lineCap = "round";
    for (let i = 0; i < n; i++) {
      const ang = now * (i % 2 ? 0.00008 : -0.00006) * (1 + i * 0.13) + i * 2.1, r = rad * (0.5 + 0.18 * i);
      const [x, y0] = v.proj(cu + Math.cos(ang) * r, cv + Math.sin(ang) * r), y = y0 - 110 - 18 * Math.sin(now / 900 + i);
      const f = Math.sin(now / 110 + i) * 3.4, s = 7;
      ctx.beginPath(); ctx.moveTo(x - s, y - f); ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.3, x, y); ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.3, x + s, y - f); ctx.stroke();
    }
    ctx.lineCap = "butt";
  }
}

function hexRgb(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; }
