// The town screen (style E, the Living town): the town is the whole screen; everything floating is small and sits 10px from the edges.
// Top bar (Menu, team score bar, Find), popovers, map controls, build label, map signals, Find with pins and result chips, and the Play dock.
import { CityView, demoCells } from "./city.js";
import { followCity } from "./live.js";
import { isDark, onTheme, getTheme, setTheme, post, deviceId, ago, savedVisits, esc } from "./common.js";
import { TEAMS, openArea, CENTER, extractKitLine } from "../kit.js";
import { createPlayDock } from "./playdock.js";
import * as I from "./icons.js";
import { renderMenu as renderMenuInto } from "./menu.js";

const demo = new URLSearchParams(location.search).has("demo");
document.body.classList.add("app");
const stage = document.getElementById("stage");
const canvas = stage.querySelector("canvas");

const NAME = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", other: "Another AI" };
const teamOf = (t) => (TEAMS.includes(t) ? t : "other");
const dot = (t) => `<span class="cm-dot" style="background:var(--team-${teamOf(t)})"></span>`;
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

stage.insertAdjacentHTML("beforeend", `
  <div class="town-head">
    <div class="cm-top" id="bar">
      <button type="button" class="cm-ib cm-glass" id="b-menu" aria-label="Menu" aria-expanded="false">${I.ICON_CRATE}</button>
      <button type="button" class="cm-score cm-glass" id="b-score" aria-label="Scores" aria-expanded="false">${TEAMS.map((t) => `<i style="background:var(--team-${t})"></i>`).join("")}</button>
      <button type="button" class="cm-ib cm-glass" id="b-find" aria-label="Find a build">${I.ICON_SEARCH}</button>
    </div>
    <div class="cm-top" id="fbar" hidden>
      <label class="cm-srch cm-glass">${I.ICON_SEARCH}<input id="q" type="search" placeholder="Lighthouse, Harbor, Gemini" aria-label="Find a build, a group or a team" autocomplete="off" enterkeyhint="search"></label>
      <button type="button" class="cm-ib cm-glass" id="b-fclose" aria-label="Close search">${I.ICON_CLOSE}</button>
    </div>
    <div class="town-chips" id="chips" hidden></div>
    <div class="cm-pop cm-glass town-pop town-pop--menu" id="pop-menu" hidden></div>
    <div class="cm-pop cm-glass town-pop town-pop--scores" id="pop-scores" hidden></div>
  </div>
  <div class="town-world" id="world"></div>
  <div class="cm-glass town-hint" id="hint"></div>
  <div class="cm-glass town-empty" id="empty" hidden>No builds yet. Press Play to make one.</div>
  <div class="town-ctl" id="ctl">
    <button type="button" class="cm-ib cm-glass" data-k="turn-l" aria-label="Turn left">${I.ICON_TURN_LEFT}</button>
    <button type="button" class="cm-ib cm-glass" data-k="turn-r" aria-label="Turn right">${I.ICON_TURN_RIGHT}</button>
    <button type="button" class="cm-ib cm-glass zoom" data-k="zin" aria-label="Zoom in">${I.ICON_ZOOM_IN}</button>
    <button type="button" class="cm-ib cm-glass zoom" data-k="zout" aria-label="Zoom out">${I.ICON_ZOOM_OUT}</button>
    <button type="button" class="cm-ib cm-glass" data-k="home" aria-label="Show the whole town">${I.ICON_WHOLE_TOWN}</button>
  </div>
  <a class="cm-play town-play" id="play" href="/play">Play</a>
  <div class="town-results" id="results" hidden></div>
  <div class="cm-glass town-conn" id="conn" role="status" hidden>Reconnecting…</div>`);
const $ = (id) => document.getElementById(id);
const [bar, fbar, chips, menuPop, scoresPop, world, hint, empty, ctl, play, results, conn, qInput, scoreBtn, menuBtn] =
  ["bar", "fbar", "chips", "pop-menu", "pop-scores", "world", "hint", "empty", "ctl", "play", "results", "conn", "q", "b-score", "b-menu"].map($);
const segs = [...scoreBtn.children];

hint.textContent = matchMedia("(pointer: fine)").matches ? "Drag · scroll to zoom · Q / E to turn · tap a build" : "Drag · pinch · twist to turn · tap a build";
const hideHint = () => hint.classList.add("is-off");
setTimeout(hideHint, 6000);
stage.addEventListener("pointerdown", hideHint);

const view = new CityView(canvas, { dark: isDark(), overview: true, bots: !demo, mine: (v) => savedVisits().some((s) => s.pub === v) });
view.focus(CENTER, CENTER, view.defaultZoom());
onTheme((d) => { view.setDark(d); if (state === "menu") renderMenu(); });

// ---------- what a build is called, who made it ----------
let mineCodes = new Set();
const refreshMine = () => { mineCodes = new Set(savedVisits().map((v) => v.pub)); };
const isBuild = (c) => !!c && !!c.b;
const nameOf = (c) => (c.k.length ? cap(c.k[0]) : c.b.style === "picture" ? "Picture" : c.b.style === "free" ? "3D model" : cap(c.b.style)); // L6
const groupOf = (c) => (c.g ? c.g.split(".").map(cap).join(" ") : "");
const timeOf = (c) => c.ts || c.l;
const isPhoto = (c) => c.k.includes("photo");
const isMine = (c) => !!c.visit && mineCodes.has(c.visit);
const builds = () => [...view.cells.values()].filter(isBuild).sort((a, b) => timeOf(b) - timeOf(a)); // newest first
const hay = (c) => [nameOf(c), ...c.k, NAME[teamOf(c.team)], teamOf(c.team), groupOf(c), c.b.style].join(" ").toLowerCase();

// ---------- state: idle | menu | scores | build | find | play ----------
let state = "idle", sel = null, more = false, flash = "", flashErr = "", flashT = 0, lastStats = null, topEdge = 56;
const acts = new Map(); // "x,y" -> { liked, nope, reported } for this visit
const dock = createPlayDock({
  stage, view,
  ready: () => !!lastStats,
  box: () => lastStats?.box || null,
  close: () => closeAll(),
  seeIt: async (x, y) => { // fly to the new build and open its label; wait a moment for the live change to arrive
    closeAll();
    view.flyTo(x, y, Math.max(view.cam.z, 0.9));
    for (let i = 0; i < 30 && !isBuild(view.cell(x, y)); i++) await new Promise((res) => setTimeout(res, 100));
    if (isBuild(view.cell(x, y))) select(x, y);
  },
});
const filt = { q: "", team: "all" };
let matches = [], matchSet = new Set(), seenRev = -1;

function setState(s) {
  state = s;
  stage.dataset.s = s;
  bar.hidden = s === "find";
  fbar.hidden = chips.hidden = results.hidden = s !== "find";
  menuPop.hidden = s !== "menu";
  scoresPop.hidden = s !== "scores";
  menuBtn.setAttribute("aria-expanded", String(s === "menu"));
  scoreBtn.setAttribute("aria-expanded", String(s === "scores"));
  ctl.classList.toggle("is-away", s !== "idle"); // the stack hides while a popover, Find or a label is open
  play.classList.toggle("is-away", s === "find" || s === "play");
  if (s !== "idle") hideHint();
  if (s !== "build") { sel = null; more = false; flash = flashErr = ""; view.select(null); }
  if (s !== "find") view.setFilter(null);
  if (s !== "play") dock.close();
  if (s === "menu") renderMenu();
  if (s === "scores") renderScores();
  refresh();
}
const closeAll = () => { if (state !== "idle") setState("idle"); };
function openPlay(opts) { // the Play dock: map controls and the Play button step away, the town shows the plot
  hideHint();
  setState("play");
  dock.open(opts);
}
play.addEventListener("click", (e) => { e.preventDefault(); openPlay(); });
const toggle = (s) => { if (state === s) { closeAll(); return; } setState(s); };

function select(x, y) {
  refreshMine();
  sel = { x, y }; more = false; flash = flashErr = "";
  setState("build");
  view.select(x, y);
}
function goTo(x, y) { // fly there and open its label
  view.flyTo(x, y, Math.max(view.cam.z, 0.9));
  select(x, y);
}

// ---------- score bar and popovers ----------
const left = (ends) => {
  const m = Math.max(0, Math.floor((ends - Date.now()) / 60000)), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
};
let prevTeams = null;
function paintScore() {
  const st = lastStats;
  if (!st) return;
  const n = TEAMS.map((t) => st.teams?.[t] || 0), total = n.reduce((a, b) => a + b, 0) || 1, bw = scoreBtn.offsetWidth || 220;
  TEAMS.forEach((t, i) => {
    const s = segs[i];
    s.style.flexGrow = Math.max(n[i], 0.4);
    s.textContent = (n[i] / total) * bw > 84 ? `${t === "other" ? "Other" : NAME[t]} ${n[i]}` : String(n[i]);
    if (prevTeams && n[i] > prevTeams[i]) { s.classList.remove("bump"); void s.offsetWidth; s.classList.add("bump"); } // the team scored
  });
  prevTeams = n;
  scoreBtn.setAttribute("aria-label", `${st.season ? `Season ${st.season.num}. ` : ""}${TEAMS.map((t, i) => `${NAME[t]} ${n[i]}`).join(", ")}. Open scores.`);
}
const renderMenu = () => renderMenuInto(menuPop); // the shared Menu (menu.js)
function renderScores() {
  const st = lastStats;
  const rows = TEAMS.map((t, i) => ({ t, i, n: st?.teams?.[t] || 0 })).sort((a, b) => b.n - a.n || a.i - b.i), mx = Math.max(1, ...rows.map((r) => r.n));
  scoresPop.innerHTML = `<p class="cm-pop__h">${st?.season ? `Season ${st.season.num} · ends in ${left(st.season.ends)} · most builds wins` : "Most builds wins"}</p>` +
    (st ? rows.map((r) => `<button type="button" class="cm-sc" style="--tc:var(--team-${r.t})" data-team="${r.t}">${dot(r.t)}<span>${NAME[r.t]}</span><span class="cm-sc__bar"><i style="width:${Math.round((r.n / mx) * 100)}%"></i></span><span>${r.n.toLocaleString()}</span></button>`).join("") : `<p class="cm-note">Loading…</p>`);
}
menuBtn.addEventListener("click", () => toggle("menu"));
scoreBtn.addEventListener("click", () => toggle("scores"));
menuPop.addEventListener("click", (e) => {
  const t = e.target.closest("[data-mode]")?.dataset.mode;
  if (t) { setTheme(t); renderMenu(); }
});
scoresPop.addEventListener("click", (e) => {
  const t = e.target.closest("[data-team]")?.dataset.team;
  if (t) openFind(t);
});

function paintStats(st) {
  lastStats = st;
  paintScore();
  if (state === "scores") renderScores();
  view.setBox(st.box, st.last);
  dock.stats();
  view.setTeamShare(st.teams);
  empty.hidden = (st.buildings || 0) > 0 || view.cells.size > 0;
}
new ResizeObserver(() => { topEdge = bar.getBoundingClientRect().bottom + 6; paintScore(); }).observe(bar);

// ---------- map controls ----------
ctl.addEventListener("click", (e) => {
  const k = e.target.closest("[data-k]")?.dataset.k;
  if (k === "turn-l") view.turn(-1);
  else if (k === "turn-r") view.turn(1);
  else if (k === "zin") view.zoomAt(view.W / 2, view.H / 2, 1.35);
  else if (k === "zout") view.zoomAt(view.W / 2, view.H / 2, 0.74);
  else if (k === "home") view.home();
});
view.on("jump", () => view.home()); // the T key

// ---------- find ----------
const CHIPS = [["all", "All"], ...TEAMS.map((t) => [t, NAME[t]]), ["photo", "From photos"], ["mine", "Mine"]];
chips.innerHTML = CHIPS.map(([v, n]) => `<button type="button" class="cm-chip cm-glass" data-team="${v}" aria-pressed="false">${TEAMS.includes(v) ? dot(v) : ""}${n}</button>`).join("");
function applyFilter() {
  refreshMine();
  const toks = filt.q.toLowerCase().split(/\s+/).filter(Boolean);
  const teamOk = (c) => filt.team === "all" || (filt.team === "photo" ? isPhoto(c) : filt.team === "mine" ? isMine(c) : teamOf(c.team) === filt.team);
  matches = builds().filter((c) => teamOk(c) && (!toks.length || ((h) => toks.every((t) => h.includes(t)))(hay(c))));
  matchSet = new Set(matches);
  view.setFilter(toks.length || filt.team !== "all" ? (c) => matchSet.has(c) : null); // the rest of the town fades
  seenRev = view.rev;
  for (const b of chips.children) { const on = b.dataset.team === filt.team; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); }
  results.innerHTML = matches.length
    ? matches.slice(0, 24).map((c) => `<button type="button" class="cm-rc cm-glass" data-x="${c.x}" data-y="${c.y}"><b>${dot(c.team)}${esc(nameOf(c))}</b><small>${esc([groupOf(c), ago(timeOf(c))].filter(Boolean).join(" · "))}</small></button>`).join("")
    : `<div class="cm-rc cm-glass is-empty">${filt.team === "mine" ? "No builds yet. Press Play to make one." : "Nothing matches. Try a team or a group."}</div>`;
  refresh();
}
function openFind(team = "all") {
  filt.q = ""; filt.team = team;
  qInput.value = "";
  setState("find");
  applyFilter();
  qInput.focus({ preventScroll: true });
}
$("b-find").addEventListener("click", () => openFind());
$("b-fclose").addEventListener("click", () => { closeAll(); });
qInput.addEventListener("input", () => { filt.q = qInput.value; applyFilter(); });
chips.addEventListener("click", (e) => {
  const t = e.target.closest("[data-team]")?.dataset.team;
  if (t) { filt.team = t; applyFilter(); }
});
results.addEventListener("click", (e) => {
  const b = e.target.closest("[data-x]");
  if (b) goTo(+b.dataset.x, +b.dataset.y);
});

// ---------- tags pinned to the town ----------
const KIND = { label: { tag: "div", cls: "" }, plot: { tag: "div", cls: "cm-tag--plot" }, pin: { tag: "button", cls: "cm-tag--pin" }, event: { tag: "button", cls: "cm-tag--event" } };
const tags = {};
function showTag(id, kind, html, data = "") {
  let t = tags[id];
  if (!t) { t = tags[id] = document.createElement("div"); t.className = "town-tag"; world.append(t); }
  t.hidden = false;
  const sig = kind + data + html;
  if (t._sig !== sig) {
    const k = KIND[kind];
    t._sig = sig;
    t.innerHTML = `<${k.tag}${k.tag === "button" ? ' type="button"' : ""} class="cm-tag ${k.cls} cm-glass"${data}>${html}</${k.tag}>`;
    t._w = t.firstChild.offsetWidth; t._h = t.firstChild.offsetHeight;
  }
  return t;
}
const hideTag = (id) => { if (tags[id]) tags[id].hidden = true; };
function place(t, p) { // above the point, 6px inside the screen, the stem still points at the build
  const w = t._w, x = clamp(p[0], w / 2 + 6, view.W - w / 2 - 6);
  t.firstChild.style.setProperty("--sx", clamp(p[0] - x, -w / 2 + 16, w / 2 - 16) + "px");
  t.style.transform = `translate(${x}px,${Math.max(p[1], t._h + 12 + topEdge)}px)`;
}
const onScreen = (p) => p[0] > 10 && p[0] < view.W - 10 && p[1] > topEdge + 30 && p[1] < view.H - 20;

function labelHtml(c) {
  const st = acts.get(`${c.x},${c.y}`) || {}, t = teamOf(c.team);
  const sub = [NAME[t], groupOf(c), ago(timeOf(c))].filter(Boolean).join(" · ");
  return `<div class="cm-tag__h">${dot(t)}${esc(nameOf(c))}${isPhoto(c) ? ' <span class="cm-badge">From a photo</span>' : ""}${isMine(c) ? ' <span class="cm-badge">Yours</span>' : ""}</div>
    <div class="cm-tag__s">${esc(sub)}</div>${flashErr ? `<p class="cm-err" role="alert">${esc(flashErr)}</p>` : ""}
    <div class="cm-tag__a"><button type="button" class="cm-ic${st.liked ? " is-on" : ""}" data-act="like" aria-pressed="${!!st.liked}" aria-label="Like">${I.ICON_LIKE}${Math.max(c.n || 0, st.liked ? 1 : 0)}</button>
    <button type="button" class="cm-ic" data-act="share" aria-label="Share">${I.ICON_SHARE}${flash === "share" ? "Copied" : ""}</button>
    ${more ? `<button type="button" class="cm-ic${st.nope ? " is-on" : ""}" data-act="nope">${st.nope ? "Shown less" : "Not for me"}</button><button type="button" class="cm-ic" data-act="report">${st.reported ? "Reported" : "Report"}</button>` : `<button type="button" class="cm-ic" data-act="more" aria-label="More">···</button>`}
    <span style="flex:1;min-width:8px"></span><button type="button" class="cm-ic" data-act="prev" aria-label="Previous build">${I.ICON_BACK}</button><button type="button" class="cm-ic" data-act="next" aria-label="Next build">${I.ICON_NEXT}</button></div>`;
}

// the newest live build: a bubble on it, or an arrow chip at the edge when it is off screen
let ev = null;
view.on("built", (c) => {
  if (!isBuild(c)) return;
  c.labelUntil = 0; // the bubble replaces the small "by a Claude" pill on the canvas
  ev = { x: c.x, y: c.y, team: teamOf(c.team), t0: performance.now() };
  setTimeout(refresh, 5300);
  refresh();
});
let edge = null;
const built = (name) => `built ${/^[aeiou]/i.test(name) ? "an" : "a"} ${name.toLowerCase()}`;
function refreshEvent(now) {
  const c = ev && now - ev.t0 < 5200 && state === "idle" ? view.cell(ev.x, ev.y) : null;
  if (!isBuild(c)) { hideTag("ev"); if (edge) edge.hidden = true; return; }
  const p = view.cellScreen(ev.x, ev.y), txt = `${NAME[ev.team]} ${built(nameOf(c))}`;
  if (onScreen(p)) {
    place(showTag("ev", "event", `<span class="cm-live"></span><b>${NAME[ev.team]}</b> ${esc(built(nameOf(c)))}`, ' data-act="ev"'), p);
    if (edge) edge.hidden = true;
    return;
  }
  hideTag("ev");
  if (!edge) { edge = document.createElement("button"); edge.type = "button"; edge.className = "cm-edge cm-glass town-edge"; edge.dataset.act = "ev-go"; world.append(edge); }
  const ang = Math.atan2(p[1] - view.H / 2, p[0] - view.W / 2), sig = txt + ang.toFixed(2);
  edge.hidden = false;
  if (edge._sig !== sig) { edge._sig = sig; edge.innerHTML = `<span class="cm-edge__ar" style="transform:rotate(${ang}rad)">${I.ICON_ARROW}</span>${esc(txt)}`; edge._w = edge.offsetWidth; edge._h = edge.offsetHeight; }
  edge.style.transform = `translate(${clamp(p[0] - edge._w / 2, 8, view.W - edge._w - 8)}px,${clamp(p[1] - edge._h / 2, topEdge, view.H - edge._h - 86)}px)`;
}

function refresh() {
  const now = performance.now();
  if (state === "build" && sel) {
    const c = view.cell(sel.x, sel.y);
    if (!isBuild(c)) { closeAll(); return; } // the build is gone
    place(showTag("sel", "label", labelHtml(c)), view.cellScreen(sel.x, sel.y));
  } else hideTag("sel");
  if (state === "play" && dock.plot) place(showTag("plot", "plot", dock.busy ? "Landing…" : "Your plot · tap to move"), view.cellScreen(dock.plot.x, dock.plot.y));
  else hideTag("plot");
  refreshEvent(now);
  if (state === "find") {
    if (view.rev !== seenRev) { applyFilter(); return; } // cells changed: search again
    const used = new Set();
    if (filt.q.trim() || filt.team !== "all") {
      for (const c of matches) {
        if (used.size >= 10) break;
        const p = view.cellScreen(c.x, c.y);
        if (!onScreen(p)) continue;
        const id = `pin:${c.x},${c.y}`;
        place(showTag(id, "pin", `${dot(c.team)}${esc(nameOf(c))}`, ` data-act="pin" data-x="${c.x}" data-y="${c.y}"`), p);
        used.add(id);
      }
    }
    for (const id of Object.keys(tags)) if (id.startsWith("pin:") && !used.has(id)) hideTag(id);
  } else for (const id of Object.keys(tags)) if (id.startsWith("pin:")) hideTag(id);
}
view.on("frame", refresh);
view.on("frame", () => dock.frame());

// ---------- label actions ----------
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch (err) {
    console.warn("clipboard write failed, trying the older way", err);
    const ta = document.createElement("textarea");
    ta.value = t; ta.style.cssText = "position:fixed;opacity:0"; document.body.append(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  }
}
async function vote(kind) {
  const c = sel && view.cell(sel.x, sel.y);
  if (!isBuild(c)) return;
  const k = `${c.x},${c.y}`, st = acts.get(k) || {};
  acts.set(k, st);
  const body = { x: c.x, y: c.y, device: deviceId() };
  if (kind !== "report") body.vote = kind === "like" ? 1 : -1;
  const r = await post(kind === "report" ? "/v1/report" : "/v1/rate", body);
  if (r.ok || r.status === 409) { // 409: this network already did it today
    flashErr = "";
    if (kind === "like") st.liked = true; else if (kind === "nope") st.nope = true; else st.reported = true;
  } else flashErr = r.data?.error || "Could not send. Try again.";
  refresh();
}
function step(dir) {
  const list = builds();
  if (!list.length) return;
  const i = sel ? list.findIndex((c) => c.x === sel.x && c.y === sel.y) : -1;
  const c = list[(i + dir + list.length) % list.length];
  goTo(c.x, c.y);
}
world.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const a = el.dataset.act;
  if (a === "pin") goTo(+el.dataset.x, +el.dataset.y);
  else if (a === "ev") { if (ev) select(ev.x, ev.y); }
  else if (a === "ev-go") { if (ev) goTo(ev.x, ev.y); }
  else if (a === "more") { more = true; refresh(); }
  else if (a === "prev") step(-1);
  else if (a === "next") step(1);
  else if (a === "like" || a === "nope" || a === "report") await vote(a);
  else if (a === "share" && sel) {
    const c = view.cell(sel.x, sel.y);
    const url = location.origin + (c?.visit ? `/v/${encodeURIComponent(c.visit)}` : `/?at=${sel.x},${sel.y}`);
    if (await copyText(url)) { flash = "share"; flashErr = ""; clearTimeout(flashT); flashT = setTimeout(() => { flash = ""; refresh(); }, 1800); } else flashErr = "Could not copy the link.";
    refresh();
  }
});

// ---------- the town: taps and keys ----------
view.on("pick", (c) => {
  if (state === "play") { dock.tap(c); return; } // a free cell moves the plot; a build opens no label while the dock is open
  if (c && isBuild(view.cell(c.x, c.y))) { select(c.x, c.y); return; }
  closeAll(); // tapping the empty town closes whatever is open
});
view.on("hover", (c) => { canvas.style.cursor = c && isBuild(view.cell(c.x, c.y)) ? "pointer" : "grab"; });
document.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape") { if (state !== "idle") { closeAll(); canvas.focus({ preventScroll: true }); } return; }
  if (e.target instanceof HTMLInputElement) { if (e.key === "Enter" && e.target === qInput && matches[0]) goTo(matches[0].x, matches[0].y); return; }
  if (e.defaultPrevented) return; // the canvas already took Q and E
  if (e.key === "/") { e.preventDefault(); openFind(); }
  else if (e.key === "n" || e.key === "N") setTheme(getTheme() === "dark" ? "light" : "dark");
  else if (e.key === "q" || e.key === "Q") view.turn(-1);
  else if (e.key === "e" || e.key === "E") view.turn(1);
});
canvas.focus({ preventScroll: true });

// ---------- the town's data ----------
if (demo) {
  view.setCells(demoCells());
  view.setOpen(openArea(0));
  paintStats({ slots_left: 5000, active: 3, buildings: view.cells.size, day: 1, teams: { claude: 60, chatgpt: 55, gemini: 40, other: 20 }, open: openArea(0), season: { num: 1, ends: Date.now() + 38 * 3600000 } });
  const q = new URLSearchParams(location.search);
  const at = /^(\d+),(\d+)$/.exec(q.get("at") || `${CENTER},${CENTER}`);
  view.focus(+at[1], +at[2], +q.get("zoom") || view.defaultZoom());
} else {
  // ?at=x,y (and ?zoom=) shows that place at once
  const atq = new URLSearchParams(location.search);
  const at = /^(\d+),(\d+)$/.exec(atq.get("at") || "");
  followCity(view, {
    ov: true, // the overview comes with the chunks, all the time
    at: at ? [+at[1], +at[2], +atq.get("zoom") || 1.2] : null, // applied when the open area is known
    onState: (ok) => { conn.hidden = ok; }, // a quiet chip, only while disconnected
    onStats: paintStats,
  });
}

// ---------- /play and /m open the town with the dock ----------
// /play: step 1. /m#cm1;...: step 3 with the line filled in and the plot on the line's own first cell.
function openLink() {
  const h = dock.fromHash(), line = extractKitLine(h) || h;
  openPlay({ step: 3, text: line, team: dock.teamGuess(line) });
}
const route = location.pathname.replace(/\/+$/, "");
if (route === "/play") openPlay();
else if (route === "/m") openLink();
window.addEventListener("hashchange", () => { if (route === "/m") openLink(); });
