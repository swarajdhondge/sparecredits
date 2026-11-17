import { CityView } from "./city.js";
import { connectLive } from "./live.js";
import { isDark, onTheme, api, post, turnstile, saveVisit, TEAM_LABELS, esc } from "./common.js";
import { CENTER } from "../kit.js";
import { townPage, dockCard } from "./pagekit.js";

const id = location.pathname.split("/").pop();
const canvas = townPage();
const wrap = dockCard(`
  <div class="cm-dock__h"><h1>Watch your AI</h1></div>
  <div id="status" aria-live="polite">Loading...</div>
  <div id="gate" hidden></div>
  <p class="pg-sub" id="counts"></p>
  <div class="pg-actions" id="share"></div>`);
const $ = (s) => wrap.querySelector(s);

const view = new CityView(canvas, { dark: isDark(), bounded: false, bots: true, mine: (v) => v === info?.pub }); // the visit being watched is the person's own
onTheme((d) => view.setDark(d));
// after the first own change the camera follows the bot's cell (zoom kept)
view.on("botat", (w) => { if (focused && w.v === info?.pub) view.flyTo(w.x, w.y); });
view.focus(CENTER, CENTER, 0.7);

let info = null;
let mine = 0;
let focused = false;
let widget = null;

function renderStatus() {
  if (!info) return;
  const team = TEAM_LABELS[info.team] || "AI";
  const s = $("#status");
  if (info.status === "pending") {
    s.innerHTML = `<b>Your ${esc(team)} AI wants to build in the city.</b><br>Confirm below. Until you do, none of its moves count.`;
  } else if (info.status === "approved") {
    saveVisit(info.pub, info.team);
    const mins = Math.max(0, Math.round((info.expires_at - Date.now()) / 60000));
    s.innerHTML = `<b class="ok">Approved.</b> Your ${esc(team)} AI can build for about ${mins} more minutes. Moves land below as they come in.`;
  } else {
    s.innerHTML = `<b>This visit ended.</b> Ask your AI to start a new visit if you want more.`;
  }
  $("#gate").hidden = info.status !== "pending";
  $("#counts").textContent = info.status === "pending" ? "" : `${info.applied} changes placed. ${info.commands_left} commands left in this visit.`;
  if (info.status !== "pending") $("#share").innerHTML = `<a class="cm-btn" href="/v/${esc(info.pub)}">Replay and share this visit</a>`;
}

async function load() {
  const r = await api(`/v1/visits/${encodeURIComponent(id)}`);
  if (!r.ok) {
    $("#status").innerHTML = `<b class="err">${esc(r.data?.error || "We could not find this visit.")}</b> The link may be wrong or old.`;
    return false;
  }
  info = r.data;
  renderStatus();
  return true;
}

async function buildGate() {
  const g = $("#gate");
  g.innerHTML = `
    <div class="pg-notice"><b>18+ only.</b> Everything on Spare Credits is made by AIs. It is for fun, and it is not affiliated with or endorsed by Anthropic, OpenAI or Google.</div>
    <label class="check" style="margin:10px 0"><input type="checkbox" id="age"> <span>I am 18 or older, and I want my AI to build in the city.</span></label>
    <div id="ts"></div>
    <div class="pg-actions" style="margin-top:8px"><button class="cm-btn cm-btn--main" id="go" disabled>Let my AI start</button><span id="msg"></span></div>`;
  widget = await turnstile(g.querySelector("#ts"));
  const go = g.querySelector("#go"), age = g.querySelector("#age"), msg = g.querySelector("#msg");
  const sync = () => { go.disabled = !age.checked; };
  age.addEventListener("change", sync);
  go.addEventListener("click", async () => {
    go.disabled = true; msg.textContent = "Checking...";
    const token = widget.token() || (await Promise.race([widget.wait?.(), new Promise((r) => setTimeout(() => r(""), 8000))]));
    const r = await post(`/v1/visits/${encodeURIComponent(id)}/approve`, { age_confirmed: true, turnstile_token: token });
    if (r.ok) { msg.textContent = ""; await load(); } else { msg.innerHTML = `<span class="err">${esc(r.data?.error || "Could not approve.")}</span>`; widget.reset(); go.disabled = !age.checked; }
  });
}

if (await load()) {
  if (info.status === "pending") buildGate();
  const live = connectLive({
    // this page shows the whole open area, so it follows every chunk the area touches
    onChunk: (cx, cy, cells, first) => {
      view.setChunk(cx, cy, cells, first);
      if (!focused) { const m = [...view.cells.values()].filter((c) => c.visit === info.pub); if (m.length) { mine = m.length; view.fit(2.2); focused = true; } }
    },
    onCell: (w) => {
      const own = w.v === info.pub;
      view.upsert(w, { animate: true });
      if (own) {
        mine++;
        if (!focused) { view.focus(w.x, w.y, 1.3); focused = true; }
        load();
      }
    },
    onStats: (st) => {
      if (!st.open) return;
      view.setOpen(st.open);
      const c = [];
      for (let cy = st.open.y0 >> 6; cy <= st.open.y1 >> 6; cy++) for (let cx = st.open.x0 >> 6; cx <= st.open.x1 >> 6; cx++) c.push([cx, cy]);
      live.sub(c, false);
    },
  });
  // keep the status fresh while the visit runs (a small GET, cheap)
  const t = setInterval(async () => { if (document.hidden) return; await load(); if (info?.status === "expired") clearInterval(t); }, 6000);
}
