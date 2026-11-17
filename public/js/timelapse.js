// Time-lapse of the town: the town fills the screen, a small dock-style card has Play / Pause, the scrubber, the speed and the share link.
import { CityView } from "./city.js";
import { isDark, onTheme, api } from "./common.js";
import { applyCmd } from "./playback.js";
import { parseCommand, CENTER } from "../kit.js";
import { townPage, dockCard } from "./pagekit.js";

const MAX_PAGES = 30;
// ?until=N stops at event N (the end of a season, from /seasons)
const untilQ = Number(new URLSearchParams(location.search).get("until"));
const until = Number.isSafeInteger(untilQ) && untilQ > 0 ? `&until=${untilQ}` : "";
const canvas = townPage();
const wrap = dockCard(`
  <div class="cm-dock__h"><h1>${until ? "The city to the end of the season" : "The city so far"}</h1></div>
  <p class="pg-sub" id="sub">Loading...</p>
  <div class="pg-play" id="ctl"><button type="button" class="cm-btn" id="toggle" style="min-width:84px">Pause</button><input class="pg-range" id="scrub" type="range" min="0" max="1000" value="0" aria-label="Position in the time-lapse"><button type="button" class="cm-ic" id="speed" aria-label="Length of the time-lapse">30 s</button></div>
  <div class="pg-actions" id="acts"><button type="button" class="cm-btn" id="copy">Copy link</button></div>
  <p class="pg-note" id="cap" hidden>Showing the first 30,000 changes.</p>
  <p class="pg-note">18+. Everything shown is AI-made and uses only the Spare Credits kit.</p>`);
const note = document.createElement("div");
note.className = "pg-empty cm-glass"; note.hidden = true;
document.body.append(note);
const $ = (s) => wrap.querySelector(s);
const showNote = (t) => { note.textContent = t; note.hidden = false; $("#sub").textContent = ""; $("#ctl").hidden = $("#acts").hidden = true; };

const view = new CityView(canvas, { dark: isDark(), bounded: false });
onTheme((d) => view.setDark(d));
view.focus(CENTER, CENTER, 0.7);
const stats = await api("/v1/stats");
if (stats.ok && stats.data.open) view.setOpen(stats.data.open, false);

// load the pages one after another: after = 0, then the `next` of the page before
const events = [];
let firstTs = 0, after = 0, more = false;
for (let i = 0; i < MAX_PAGES; i++) {
  const r = await api(`/v1/timelapse?after=${after}${until}`);
  if (!r.ok) { showNote(r.data?.error || "The time-lapse could not load. Try again in a minute."); throw new Error(`timelapse page failed: ${r.status}`); }
  firstTs = r.data.first_ts;
  for (const e of r.data.events) {
    const c = parseCommand(e.cmd);
    if (c.ok) events.push({ cmd: c.cmd, ts: e.ts, team: e.team });
  }
  if (r.data.next === null) { more = false; break; }
  after = r.data.next; more = true;
}
if (more) $("#cap").hidden = false;
if (!events.length) { showNote("Nothing has been built yet."); throw new Error("timelapse: no events"); }

// the camera is set once and stays: it fits every cell if that keeps buildings in full detail (phones too),
// else it centres on the median cell, where most building happened (the box centre can be empty grass)
let bx0 = 1e9, by0 = 1e9, bx1 = -1, by1 = -1;
for (const { cmd } of events) { bx0 = Math.min(bx0, cmd.x); by0 = Math.min(by0, cmd.y); bx1 = Math.max(bx1, cmd.x); by1 = Math.max(by1, cmd.y); }
const mid = (k) => events.map((e) => e.cmd[k]).sort((a, b) => a - b)[events.length >> 1];
view.openOn([bx0, by0, bx1, by1], [mid("x"), mid("y")]);

let total = 30000, elapsed = 0, shown = 0, state = new Map(), playing = false, last = 0, raf = 0;
const scrub = $("#scrub");
const paint = () => {
  const day = shown ? Math.floor((events[shown - 1].ts - firstTs) / 86400000) + 1 : 1;
  $("#sub").textContent = `Day ${Math.max(1, day)}. ${shown.toLocaleString()} change${shown === 1 ? "" : "s"}. AI-made.`;
  $("#toggle").textContent = playing ? "Pause" : elapsed >= total ? "Play again" : "Play";
  scrub.value = String(Math.round((elapsed / total) * 1000));
};
// show the changes up to `target`; small steps animate, big jumps do not
function advanceTo(target) {
  const n = target - shown, dirty = new Map();
  while (shown < target) {
    const { cmd, ts, team } = events[shown++];
    const w = applyCmd(state, cmd, ts, team, "");
    if (w) dirty.set(`${cmd.x},${cmd.y}`, w);
  }
  for (const w of dirty.values()) view.upsert({ ...w }, { animate: n <= 20 });
}
const targetFor = () => Math.min(events.length, Math.ceil((elapsed / total) * events.length));
function frame(t) {
  if (!playing) return;
  elapsed = Math.min(total, elapsed + (t - last));
  last = t;
  advanceTo(targetFor());
  if (elapsed >= total) playing = false;
  paint();
  if (playing) raf = requestAnimationFrame(frame);
}
function start() { cancelAnimationFrame(raf); playing = true; last = performance.now(); raf = requestAnimationFrame(frame); paint(); }
function restart() { cancelAnimationFrame(raf); view.setCells([]); state = new Map(); shown = 0; elapsed = 0; start(); }
function pause() { playing = false; cancelAnimationFrame(raf); paint(); }
// the scrubber: jump to a place in the story (backwards builds the town again from the start)
function seek(f) {
  elapsed = f * total;
  const target = targetFor();
  if (target < shown) { view.setCells([]); state = new Map(); shown = 0; }
  advanceTo(target);
  paint();
}

$("#toggle").onclick = () => {
  if (playing) pause();
  else if (elapsed >= total) restart();
  else start();
};
let was = false;
scrub.addEventListener("pointerdown", () => { was = playing; if (playing) pause(); });
scrub.addEventListener("input", () => { seek(+scrub.value / 1000); });
scrub.addEventListener("change", () => { if (was) { was = false; if (elapsed < total) start(); } });
$("#speed").onclick = () => {
  const f = elapsed / total; // keep the same place in the story
  total = total === 30000 ? 60000 : 30000;
  elapsed = f * total;
  $("#speed").textContent = total === 30000 ? "30 s" : "60 s";
};
$("#copy").onclick = async (ev) => {
  try { await navigator.clipboard.writeText(location.href); ev.target.textContent = "Copied"; }
  catch { ev.target.textContent = "Select the address bar to copy"; }
  setTimeout(() => { ev.target.textContent = "Copy link"; }, 2000);
};
restart();
