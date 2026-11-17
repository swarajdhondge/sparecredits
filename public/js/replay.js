// Replay of one visit: the town fills the screen, a small dock-style card has Play / Pause, the scrubber, the speed and the share link.
import { CityView } from "./city.js";
import { isDark, onTheme, api, TEAM_LABELS, esc, ago } from "./common.js";
import { applyCmd } from "./playback.js";
import { parseCommand, fillTemplate, aAn, PALETTES, CENTER } from "../kit.js";
import { townPage, dockCard } from "./pagekit.js";

const pub = location.pathname.split("/").pop();
const canvas = townPage();
const wrap = dockCard(`
  <div class="cm-dock__h"><h1 id="title">Replay</h1></div>
  <p class="pg-sub" id="sub"></p>
  <div class="pg-play" id="ctl"><button type="button" class="cm-btn" id="toggle" style="min-width:84px">Pause</button><input class="pg-range" id="scrub" type="range" min="0" max="0" value="0" aria-label="Position in the replay"><button type="button" class="cm-ic" id="speed" aria-label="Speed">1x</button></div>
  <div class="pg-actions" id="acts"><button type="button" class="cm-btn" id="copy">Copy link</button><a class="cm-btn" id="open" href="/">Open the city</a></div>
  <details id="mv" hidden><summary>The moves</summary><ul class="list" id="moves"></ul></details>
  <p class="pg-note">18+. Everything shown is AI-made and uses only the Spare Credits kit.</p>`);
const $ = (s) => wrap.querySelector(s);

const view = new CityView(canvas, { dark: isDark(), bounded: false, bots: true });
onTheme((d) => view.setDark(d));
view.on("botat", (w) => view.flyTo(w.x, w.y, Math.max(view.cam.z, 1.1))); // the camera follows the bot
view.focus(CENTER, CENTER, 0.7);
const stats = await api("/v1/stats");
if (stats.ok && stats.data.open) view.setOpen(stats.data.open, false);

const r = await api(`/v1/replay/${encodeURIComponent(pub)}`);
if (!r.ok) {
  $("#title").textContent = "Visit not found";
  $("#sub").textContent = r.data?.error || "The link may be wrong.";
  $("#ctl").hidden = $("#acts").hidden = true;
} else {
  const { team, events, at } = r.data;
  $("#title").textContent = `A visit by ${team === "other" ? "another AI" : "a " + (TEAM_LABELS[team] || "AI")}`;
  $("#sub").textContent = `${events.length} change${events.length === 1 ? "" : "s"}, ${ago(at)}. AI-made.`;
  const parsed = events.map((e) => ({ e, c: parseCommand(e.cmd) })).filter((x) => x.c.ok).map((x) => ({ e: x.e, cmd: x.c.cmd }));
  const first = parsed[0]?.cmd;
  if (first) $("#open").href = `/?at=${first.x},${first.y}`;

  const describe = (c) => {
    if (c.v === "B") return `Built ${(aAn(c.style) + " " + c.style).trim()}, ${c.h} high, ${PALETTES[c.pal]} colors (${c.x},${c.y})`;
    if (c.v === "E") return `Added ${(aAn(c.part) + " " + c.part).trim()} on the ${{ n: "north", e: "east", s: "south", w: "west" }[c.side]} side (${c.x},${c.y})`;
    if (c.v === "S") return `Put up a sign: "${fillTemplate(c.tpl, c.words)}" (${c.x},${c.y})`;
    if (c.v === "F") return `Built a 3D model of ${c.shapes.length} shapes (${c.x},${c.y})`;
    if (c.v === "A") return `Added ${c.shapes.length} shapes to a 3D model (${c.x},${c.y})`;
    if (c.v === "G") return `${c.more ? "Added to a picture" : "Made a picture"} (${c.x},${c.y})`;
    return `Claimed a cell (${c.x},${c.y})`;
  };
  $("#moves").innerHTML = parsed.map((p) => `<li><code>${esc(p.e.cmd)}</code><span>${esc(describe(p.cmd))}</span></li>`).join("");
  $("#mv").hidden = !parsed.length;

  const n = parsed.length, scrub = $("#scrub"), SPEEDS = [1, 2, 4];
  scrub.max = String(n);
  let timer = 0, state = new Map(), shown = 0, playing = false, speed = 1;
  const base = Math.max(300, Math.min(1200, 10000 / Math.max(1, n))); // ms per change at 1x
  const paint = () => { scrub.value = String(shown); $("#toggle").textContent = playing ? "Pause" : shown >= n ? "Play again" : "Play"; };
  function stop() { clearTimeout(timer); playing = false; paint(); }
  function tick() {
    if (shown >= n) { stop(); return; }
    const { cmd, e } = parsed[shown++];
    const w = applyCmd(state, cmd, e.ts, team, pub);
    if (w) {
      view.upsert({ ...w }, { animate: true });
      if (!view.bots || shown === 1) view.focus(cmd.x, cmd.y, Math.max(view.cam.z, 1.1));
    }
    if (shown >= n) { stop(); return; }
    paint();
    timer = setTimeout(tick, base / speed);
  }
  function play() {
    clearTimeout(timer);
    if (shown >= n) { view.setCells([]); state = new Map(); shown = 0; }
    playing = true;
    if (n) tick(); else stop();
  }
  // jump to the state after the first k changes, no animation (the scrubber)
  function seek(k) {
    state = new Map();
    for (let i = 0; i < k; i++) applyCmd(state, parsed[i].cmd, parsed[i].e.ts, team, pub);
    shown = k;
    view.setCells([...state.values()].map((w) => ({ ...w })));
    const c = k ? parsed[k - 1].cmd : first;
    if (c) view.focus(c.x, c.y, Math.max(view.cam.z, 1.1));
    paint();
  }
  let was = false;
  scrub.addEventListener("pointerdown", () => { was = playing; clearTimeout(timer); playing = false; });
  scrub.addEventListener("input", () => { seek(+scrub.value); });
  scrub.addEventListener("change", () => { if (was) { was = false; if (shown < n) { playing = true; timer = setTimeout(tick, base / speed); } else paint(); } else paint(); });
  $("#toggle").onclick = () => { if (playing) stop(); else play(); };
  $("#speed").onclick = (ev) => { speed = SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]; ev.currentTarget.textContent = `${speed}x`; };
  $("#copy").onclick = async (ev) => {
    try { await navigator.clipboard.writeText(location.href); ev.target.textContent = "Copied"; }
    catch { ev.target.textContent = "Select the address bar to copy"; }
    setTimeout(() => { ev.target.textContent = "Copy link"; }, 2000);
  };
  setTimeout(play, 400);
}
