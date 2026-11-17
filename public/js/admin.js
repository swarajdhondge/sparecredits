// Private admin page: the live city map with a side panel. Click a cell or a marker to act on it, "Go to" in every list. The key stays in sessionStorage only.
import { CityView, parseWire } from "./city.js";
import { followCity } from "./live.js";
import { header, footer, api, esc, ago, isDark, onTheme, FOOTER_TEXT, TEAM_LABELS } from "./common.js";
import { CENTER, PALETTES, fillTemplate } from "../kit.js";

document.body.append(header());
const wrap = document.createElement("main");
wrap.className = "wrap";
const tools = document.createElement("div");
tools.className = "adm";
tools.hidden = true;
document.body.append(wrap, tools, footer());
wrap.innerHTML = `
  <h1>Admin</h1>
  <p class="muted" id="msg" role="status"></p>
  <form class="card" id="login" style="margin:12px 0">
    <label>Key <input type="password" id="key" autocomplete="off" required style="margin-left:8px;min-height:40px"></label>
    <button class="btn" type="submit" style="margin-left:8px">Sign in</button>
  </form>`;
tools.innerHTML = `
  <div class="adm-map" id="stage"></div>
  <aside class="adm-panel" id="panel">
    <section class="card" id="detail"><p class="muted">Click a cell or a red marker on the map.</p></section>
    <section class="card">
      <h2>Find a visit code</h2>
      <form class="row" id="visitForm"><input id="pub" required maxlength="200" placeholder="Code or replay link" style="min-height:40px;flex:1"><button class="btn" type="submit">Find</button></form>
    </section>
    <section class="card">
      <h2 id="hiddenTitle">Hidden (0)</h2>
      <div id="hiddenOut"></div>
    </section>
    <section class="card">
      <h2>Closed areas</h2>
      <div id="areaOut"></div>
      <div id="frozenOut"></div>
    </section>
    <section class="card">
      <h2>Paused networks</h2>
      <p id="banOut" class="muted"></p>
      <div class="row"><button class="btn ghost" data-act="unban" type="button">Unpause all</button></div>
      <div id="unbanConfirm" class="row" hidden>
        <span>Every paused network can build again today.</span>
        <button class="btn" data-act="unbanYes" type="button">Yes, unpause all</button><button class="btn ghost" data-act="unbanNo" type="button">Cancel</button>
      </div>
    </section>
    <section class="card">
      <h2>Audit log</h2>
      <button class="btn ghost" data-act="audit" type="button">Refresh</button>
      <div style="overflow-x:auto"><table id="auditOut"></table></div>
    </section>
    <p class="muted" style="font-size:12.5px">${esc(FOOTER_TEXT)}</p>
  </aside>`;
const $ = (s) => document.querySelector(s);

const store = {
  get() { try { return sessionStorage.getItem("cm-admin") || ""; } catch { return ""; } },
  set(v) { try { if (v) sessionStorage.setItem("cm-admin", v); else sessionStorage.removeItem("cm-admin"); } catch { /* storage blocked: the key stays in memory only */ } },
};
let key = store.get();
const say = (t, bad) => { $("#msg").textContent = t; $("#msg").className = bad ? "err" : "muted"; };
const when = (ts) => new Date(ts).toISOString().replace("T", " ").slice(0, 19) + " UTC";
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ----- state -----
let view = null, live = null;
let cur = null; // what the detail card shows: {kind: "cell", x, y} or {kind: "visit", pub}
let hidden = []; // hidden cells (wire + reports, downs) from GET /v1/admin/hidden
let vcells = []; // cells of the visit that is open: highlighted on the map
let area = null; // closing an area: {a, b, hover} (cells) while the person picks corners
let flash = null; // {r, until}: an area outline that blinks after "Go to"

function signedIn(on) { tools.hidden = !on; $("#login").hidden = on; }
function forget(text) {
  key = ""; store.set(""); signedIn(false); say(text, true);
  live?.close(); view?.destroy(); view = live = null; $("#stage").replaceChildren();
  cur = null; hidden = []; vcells = []; area = null; flash = null;
}

/** One call to the admin API. On 401, 404 or 429 it shows the server's message and forgets the key. */
async function call(path, body) {
  const opts = { headers: { authorization: `Bearer ${key}` } };
  if (body) { opts.method = "POST"; opts.headers["content-type"] = "application/json"; opts.body = JSON.stringify(body); }
  const r = await api(`/v1/admin${path}`, opts);
  // 404 "Not found." is the answer of a server with no admin key set; a missing cell or visit has its own message
  if (r.status === 401 || r.status === 429 || (r.status === 404 && r.data?.error === "Not found.")) { forget(r.data?.error || `Error ${r.status}`); return null; }
  if (!r.ok) { say(r.data?.error || `Error ${r.status}`, true); return null; }
  say("");
  return r.data;
}

const btn = (act, data, text, cls = "btn ghost small") =>
  `<button class="${cls}" type="button" data-act="${act}"${Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}>${text}</button>`;
const rectOf = (a, b) => [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)];

// ----- the map -----
function mapStart() {
  if (view) return;
  $("#stage").innerHTML = `<canvas aria-label="The shared city. Drag to pan, scroll or pinch to zoom."></canvas>
    <div class="conn" id="conn">Connecting...</div>
    <div class="zoom"><button type="button" data-act="zin" aria-label="Zoom in">+</button><button type="button" data-act="zout" aria-label="Zoom out">&minus;</button></div>`;
  view = new CityView($("#stage canvas"), { dark: isDark(), overview: true, living: false });
  view.focus(CENTER, CENTER, view.defaultZoom());
  live = followCity(view, { onState: (ok) => { const c = $("#conn"); if (c) { c.textContent = ok ? "Live" : "Reconnecting..."; c.style.opacity = ok ? 0.75 : 1; } } });
  view.overlay = drawOverlay;
  view.on("pick", (c) => { // a drag never gets here: CityView only reports a pick when the pointer barely moved
    if (!c) return;
    if (!area) return selectCell(c.x, c.y);
    if (!area.a) area.a = c; else if (!area.b) area.b = c; else return;
    renderArea(); view.dirty = true;
  });
  view.on("hover", (c) => {
    if (area?.a && !area.b && c) { area.hover = c; view.dirty = true; }
    $("#stage canvas").style.cursor = area ? "crosshair" : c && (view.cell(c.x, c.y) || hidden.some((h) => h.x === c.x && h.y === c.y)) ? "pointer" : "grab";
  });
}
onTheme((d) => view?.setDark(d));

/** Drawn over the map after everything else: the visit's cells, red rings on hidden cells, the area preview, the blinking area. */
function drawOverlay(ctx, at) {
  const z = view.cam.z;
  const poly = ([x0, y0, x1, y1], fill, stroke, w) => {
    ctx.beginPath();
    [at(x0 - 0.5, y0 - 0.5), at(x1 + 0.5, y0 - 0.5), at(x1 + 0.5, y1 + 0.5), at(x0 - 0.5, y1 + 0.5)].forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = stroke; ctx.lineWidth = w; ctx.stroke();
  };
  for (const c of vcells) poly([c.x, c.y, c.x, c.y], "rgba(60,120,255,0.28)", "#2a6df4", 2);
  for (const h of hidden) {
    const [sx, sy] = at(h.x, h.y), rx = Math.max(9, 30 * z);
    ctx.beginPath(); ctx.ellipse(sx, sy, rx, rx / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(224,36,36,0.18)"; ctx.fill();
    ctx.strokeStyle = "#e02424"; ctx.lineWidth = 3; ctx.stroke();
  }
  if (area?.a) {
    const b = area.b || area.hover || area.a;
    poly(rectOf(area.a, b), "rgba(232,112,79,0.25)", "#e8704f", 3);
  }
  if (flash) {
    if (performance.now() > flash.until) flash = null;
    else { poly(flash.r, "rgba(60,120,255,0.18)", "#2a6df4", 4); view.dirty = true; }
  }
}

function goTo(x, y) {
  view.moved = true;
  view.focus(x, y, Math.max(1, view.cam.z));
  selectCell(x, y);
}
/** Visit rows: move the camera and outline the cell, but keep the visit open in the panel. */
function look(x, y) {
  view.moved = true;
  view.focus(x, y, Math.max(1, view.cam.z));
  view.select(x, y);
}
function goToArea(r) {
  view.moved = true;
  view.focus((r[0] + r[2]) >> 1, (r[1] + r[3]) >> 1, Math.max(1, view.cam.z));
  flash = { r, until: performance.now() + 2500 };
  view.dirty = true;
}

// ----- the detail card -----
const evList = (events, go) => events.length
  ? `<ul class="list">${events.map((e) => `<li><code>${esc(e.cmd)}</code><span>${esc(e.team)}, ${esc(when(e.ts))}${go ? "" : `, visit ${esc(e.pub ?? "")}`}${e.gone ? ", hidden" : ""}</span>${go ? btn("look", { x: e.x, y: e.y }, "Go to") : btn("visit", { pub: e.pub ?? "" }, "Show visit")}</li>`).join("")}</ul>`
  : `<p class="muted">No changes.</p>`;

/** A cell in plain words, from its wire form. */
function words(w) {
  const c = parseWire(w), out = [];
  if (c.b) out.push(`${cap(c.b.style)}, ${c.b.h} high, palette ${PALETTES[c.b.pal]}`);
  if (c.parts.length) out.push(`Parts: ${c.parts.map((p) => `${p.part} (${p.side})`).join(", ")}`);
  if (c.sign) out.push(`Sign: "${fillTemplate(c.sign.tpl, c.sign.words)}"`);
  if (c.claim) out.push("Claimed");
  return { lines: out, by: `by ${c.team === "other" ? "another AI" : "a " + (TEAM_LABELS[c.team] || "AI")}, ${ago(c.ts || c.l)}`, visit: w.v };
}

async function selectCell(x, y) {
  view.select(x, y);
  vcells = [];
  cur = { kind: "cell", x, y };
  const d = await call(`/cell?x=${x}&y=${y}`);
  if (!d || cur?.kind !== "cell" || cur.x !== x || cur.y !== y) return;
  const c = d.cell;
  const w = c && words(c);
  $("#detail").innerHTML = !c ? `<h2>Cell ${x},${y}</h2><p class="muted">Nothing is stored here.</p>` : `
    <h2>Cell ${x},${y} ${c.hidden ? `<span class="err">hidden</span>` : `<span class="muted">visible</span>`}</h2>
    <p>${w.lines.map(esc).join("<br>") || "Empty ground"}</p>
    <p class="muted">${esc(w.by)}</p>
    <p class="muted">Likes ${esc(c.likes)}, downvotes ${esc(c.downs)}, reports ${esc(c.reports)}</p>
    <div class="row">
      <button class="btn" data-act="hide" type="button" ${c.hidden ? "disabled" : ""}>Hide</button>
      <button class="btn ghost" data-act="restore" type="button" ${c.hidden ? "" : "disabled"}>Restore</button>
      ${btn("visit", { pub: w.visit }, "Show this visit", "btn ghost")}
    </div>
    <h3>Last changes</h3>${evList(d.events)}`;
}

async function selectVisit(pub) {
  const d = await call(`/visit?pub=${encodeURIComponent(pub)}`);
  if (!d) return;
  cur = { kind: "visit", pub: d.pub };
  view.select(null);
  vcells = d.events.map((e) => ({ x: e.x, y: e.y }));
  view.dirty = true;
  const still = d.events.filter((e) => !e.gone).length;
  $("#detail").innerHTML = `
    <h2>Visit ${esc(d.pub)}</h2>
    <p>Team ${esc(d.team)}, ${esc(when(d.at))}, ${esc(d.total)} change${d.total === 1 ? "" : "s"}${d.total > d.events.length ? ` (first ${d.events.length} shown)` : ""}</p>
    <p class="muted">${still} of the shown changes are still visible. The blue cells on the map are this visit.</p>
    <div class="row"><button class="btn" data-act="undo" type="button">Undo this visit</button><button class="btn ghost" data-act="ban" type="button">Pause this network for today</button></div>
    <div id="banConfirm" class="row" hidden>
      <span>Everyone on the network of this visit gets "paused" until 00:00 UTC. Other networks are not affected.</span>
      <button class="btn" data-act="banYes" type="button">Yes, pause</button><button class="btn ghost" data-act="banNo" type="button">Cancel</button>
    </div>
    <div id="confirm" class="row" hidden>
      <span>This undoes ${esc(d.total)} change${d.total === 1 ? "" : "s"} and ends the visit. Cells that a later visit changed stay as they are.</span>
      <button class="btn" data-act="undoYes" type="button">Yes, undo</button><button class="btn ghost" data-act="undoNo" type="button">Cancel</button>
    </div>
    ${evList(d.events, true)}`;
}

// ----- lists -----
async function loadBans() {
  const d = await call("/bans");
  if (d) $("#banOut").textContent = `${d.count} network${d.count === 1 ? "" : "s"} paused for ${d.day} (until 00:00 UTC).`;
}

async function loadHidden() {
  const d = await call("/hidden");
  if (!d) return;
  hidden = d.cells;
  $("#hiddenTitle").textContent = `Hidden (${hidden.length})`;
  $("#hiddenOut").innerHTML = hidden.length
    ? `<ul class="list">${hidden.map((h) => `<li><span>${esc(words(h).lines[0] || "Cell")} <span class="muted">at ${esc(h.x)},${esc(h.y)}, ${esc(h.reports)} report${h.reports === 1 ? "" : "s"}</span></span>${btn("goto", { x: h.x, y: h.y }, "Go to")}</li>`).join("")}</ul>`
    : `<p class="muted">Nothing is hidden.</p>`;
  if (view) view.dirty = true;
}

async function loadFrozen() {
  const d = await call("/frozen");
  if (!d) return;
  $("#frozenOut").innerHTML = d.areas.length
    ? `<ul class="list">${d.areas.map((a) => `<li><code>${esc(a.x0)},${esc(a.y0)} to ${esc(a.x1)},${esc(a.y1)}</code>${btn("gotoArea", { x0: a.x0, y0: a.y0, x1: a.x1, y1: a.y1 }, "Go to")}${btn("unfreeze", { id: a.id }, "Open again")}</li>`).join("")}</ul>`
    : `<p class="muted">No area is closed.</p>`;
}

function renderArea() {
  $("#areaOut").innerHTML = !area ? `<div class="row">${btn("areaStart", {}, "Close an area", "btn")}</div>`
    : `<p class="muted">Click one corner, then the opposite corner.</p>
       <div class="row">${area.b ? btn("areaYes", {}, "Close it", "btn") : ""}${btn("areaCancel", {}, "Cancel")}</div>`;
}

async function loadAudit() {
  const d = await call("/audit");
  if (!d) return;
  const go = (r) => {
    const t = String(r.target);
    if (r.action === "undo_visit" || r.action === "ban") return btn("visit", { pub: t }, "Show this visit");
    const c = /^(\d+),(\d+)$/.exec(t), a = /^(\d+),(\d+)-(\d+),(\d+)$/.exec(t);
    if (c) return btn("goto", { x: c[1], y: c[2] }, "Go to");
    if (a) return btn("gotoArea", { x0: a[1], y0: a[2], x1: a[3], y1: a[4] }, "Go to");
    return "";
  };
  $("#auditOut").innerHTML = `<tr><th>When</th><th>Action</th><th>Target</th><th>Detail</th><th></th></tr>` +
    d.rows.map((r) => `<tr><td>${esc(when(r.ts))}</td><td>${esc(r.action)}</td><td>${esc(r.target)}</td><td>${esc(r.detail)}</td><td>${go(r)}</td></tr>`).join("");
}

// ----- buttons (one listener: every button has data-act, no inline handlers) -----
const refresh = () => Promise.all([loadHidden(), loadAudit()]);
/** Wait for the reloads (each clears the message), then say what happened. */
const done = async (text, ...ps) => { await Promise.all(ps); if (key) say(text); };
const acts = {
  zin: () => view.zoomAt(view.W / 2, view.H / 2, 1.35),
  zout: () => view.zoomAt(view.W / 2, view.H / 2, 0.74),
  goto: (d) => goTo(+d.x, +d.y),
  look: (d) => look(+d.x, +d.y),
  gotoArea: (d) => goToArea([+d.x0, +d.y0, +d.x1, +d.y1]),
  visit: (d) => selectVisit(d.pub),
  audit: loadAudit,
  async hide() { if (cur?.kind === "cell" && await call("/hide", { x: cur.x, y: cur.y })) done("Hidden.", selectCell(cur.x, cur.y), refresh()); },
  async restore() { if (cur?.kind === "cell" && await call("/restore", { x: cur.x, y: cur.y })) done("Restored.", selectCell(cur.x, cur.y), refresh()); },
  undo: () => { $("#confirm").hidden = false; },
  undoNo: () => { $("#confirm").hidden = true; },
  async undoYes() {
    const r = await call("/undo-visit", { pub: cur.pub });
    if (!r) return;
    done(`Undone: ${r.restored} cell${r.restored === 1 ? "" : "s"} put back, ${r.hidden} hidden, ${r.skipped} skipped.`, selectVisit(cur.pub), refresh());
  },
  ban: () => { $("#banConfirm").hidden = false; },
  banNo: () => { $("#banConfirm").hidden = true; },
  async banYes() {
    $("#banConfirm").hidden = true;
    const r = await call("/ban", { pub: cur.pub }); // on 409 call() shows the server's message
    if (r) done("This network is paused until 00:00 UTC.", loadBans(), loadAudit());
  },
  unban: () => { $("#unbanConfirm").hidden = false; },
  unbanNo: () => { $("#unbanConfirm").hidden = true; },
  async unbanYes() {
    $("#unbanConfirm").hidden = true;
    if (await call("/unban-all", {})) done("All networks are unpaused.", loadBans(), loadAudit());
  },
  areaStart: () => { area = {}; renderArea(); },
  areaCancel: () => { area = null; renderArea(); view.dirty = true; },
  async areaYes() {
    const [x0, y0, x1, y1] = rectOf(area.a, area.b);
    if (await call("/freeze", { x0, y0, x1, y1 })) { area = null; renderArea(); done("Area closed.", loadFrozen(), loadAudit()); }
  },
  async unfreeze(d) { if (await call("/unfreeze", { id: Number(d.id) })) done("Area is open again.", loadFrozen(), loadAudit()); },
};
document.addEventListener("click", (e) => {
  const b = e.target.closest?.("button[data-act]");
  if (b && acts[b.dataset.act]) acts[b.dataset.act](b.dataset);
});

$("#login").onsubmit = (e) => {
  e.preventDefault();
  key = $("#key").value;
  $("#key").value = "";
  store.set(key);
  start();
};
/** A visit code, or a replay link (/v/<code>). */
const codeOf = (s) => (/\/v\/([\w-]{6,64})/.exec(s) || /^([\w-]{6,64})$/.exec(s.trim()))?.[1];
$("#visitForm").onsubmit = (e) => {
  e.preventDefault();
  const pub = codeOf($("#pub").value);
  if (pub) selectVisit(pub); else say("That is not a visit code or a replay link.", true);
};

async function start() {
  if (!key) { signedIn(false); return; }
  signedIn(true);
  await loadAudit(); // the first call proves the key; a wrong key shows the server's message and signs out
  if (!key) return;
  renderArea();
  mapStart(); loadBans(); loadFrozen(); loadHidden();
}
start();
