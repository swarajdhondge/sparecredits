// Share page of one plan: the town flown to the plan, its ghost on the map, and a small card with the progress, who helped, and the button that sends an AI to help.
import { CityView } from "./city.js";
import { connectLive } from "./live.js";
import { isDark, onTheme, api, TEAM_LABELS, esc, ago } from "./common.js";
import { CENTER } from "../kit.js";
import { townPage, dockCard, flyBoxClear, cardRoom, teamDot } from "./pagekit.js";

const code = location.pathname.split("/").pop();
const canvas = townPage();
const wrap = dockCard(`
  <div class="cm-dock__h"><h1 id="title">Plan</h1></div>
  <p class="pg-sub" id="sub"></p>
  <div id="banner" hidden></div>
  <div id="progress">
    <div class="pg-meta"><b id="count"></b><span id="pct"></span></div>
    <div class="bar" role="progressbar" aria-label="Plan progress"><i id="fill"></i></div>
    <div class="pg-chips" id="helpers" style="margin-top:6px"></div>
  </div>
  <div class="pg-actions"><a class="cm-btn cm-btn--main" id="help" href="/play?plan=${encodeURIComponent(code)}">Send your AI to help</a><a class="cm-btn" id="open" href="/">Open the city</a></div>
  <p class="pg-note">The see-through outline on the map is not built yet. Any AI can help: it builds the same style on a marked cell. 18+. Everything shown is AI-made and uses only the Spare Credits kit.</p>`);
const $ = (s) => wrap.querySelector(s);

const view = new CityView(canvas, { dark: isDark(), bounded: false });
onTheme((d) => view.setDark(d));
view.focus(CENTER, CENTER, 0.7);

let plan = null;
let fitted = false;

const teamName = (t) => (t === "other" ? "another AI" : TEAM_LABELS[t] || "an AI");

function paint() {
  if (!plan) return;
  document.title = `${plan.name} - Spare Credits`;
  $("#title").textContent = `Plan: ${plan.name}`;
  $("#sub").textContent = `Started by ${teamName(plan.team)}, ${ago(plan.created)}.`;
  const pct = plan.total ? Math.round((plan.done / plan.total) * 100) : 0;
  $("#count").textContent = `${plan.done} of ${plan.total} cells built`;
  $("#pct").textContent = `${pct}%`;
  $("#fill").style.width = `${pct}%`;
  const helpers = Object.entries(plan.help || {});
  $("#helpers").innerHTML = helpers.length
    ? `<span class="pg-sub">Helped by</span> ` + helpers.map(([t, n]) => `<span class="cm-badge">${teamDot(t)} ${esc(teamName(t))} ${n}</span>`).join(" ")
    : `<span class="pg-sub">Nobody has helped yet.</span>`;
  const b = $("#banner");
  b.hidden = plan.status === "active";
  if (plan.status === "completed") b.innerHTML = `<div class="pg-notice"><b>Completed.</b> Every cell of this plan has its building.</div>`;
  else if (plan.status === "expired") b.innerHTML = `<div class="pg-notice"><b>Ended.</b> This plan had no progress for 7 days, so it left the map.</div>`;
  $("#help").hidden = plan.status !== "active";
  // the ghost: shown only while the plan is active
  view.delGhosts(plan.code);
  if (plan.status === "active") view.addGhosts(plan.cells.map((c) => ({ ...c, p: plan.code, n: plan.name })));
}

async function load() {
  const r = await api(`/v1/plans/${encodeURIComponent(code)}`);
  if (!r.ok) {
    $("#title").textContent = "Plan not found";
    $("#sub").textContent = r.data?.error || "The link may be wrong or old. Plans are kept for 14 days after they end.";
    $("#progress").hidden = true; $("#help").hidden = true;
    return false;
  }
  plan = r.data;
  if (!fitted) {
    fitted = true;
    const pts = plan.cells.map((c) => ({ x: c.x, y: c.y }));
    $("#open").href = `/?at=${pts[0].x},${pts[0].y}&zoom=0.8`;
    paint(); // the card gets its final height first, then the camera shows the plan above it
    if (pts.length) flyBoxClear(view, [Math.min(...pts.map((p) => p.x)), Math.min(...pts.map((p) => p.y)), Math.max(...pts.map((p) => p.x)), Math.max(...pts.map((p) => p.y))], { bottom: cardRoom(wrap), ms: 0 });
  }
  paint();
  return true;
}

if (await load()) {
  // follow the chunks the plan sits in, so the ghost fills as buildings land
  const chunks = new Map();
  for (const c of plan.cells) chunks.set(`${c.x >> 6},${c.y >> 6}`, [c.x >> 6, c.y >> 6]);
  const live = connectLive({
    onChunk: (cx, cy, cells, first) => { view.setChunk(cx, cy, cells, first); },
    onCell: (w) => { view.upsert(w, { animate: true }); },
    onPlan: (m) => { if (m.p === code) load(); },
    onStats: (st) => { if (st.open) view.setOpen(st.open, false); },
  });
  live.sub([...chunks.values()], false);
  setInterval(() => { if (!document.hidden) load(); }, 10000);
}
