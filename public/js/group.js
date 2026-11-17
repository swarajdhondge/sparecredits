// Share page of one group: the town flown to the group's cells, and a small card with name, colour, cells held, visits, a ready prompt for any AI chat, and the button that opens /play for the group.
import { CityView } from "./city.js";
import { connectLive } from "./live.js";
import { api, esc, ago, isDark, onTheme } from "./common.js";
import { PAL_MAIN, groupColor, groupFromSlug, planName, freshLinks, TAG_HINT, CENTER } from "../kit.js";
import { townPage, dockCard, flyBoxClear, cardRoom } from "./pagekit.js";

const slug = location.pathname.split("/").pop();
const id = groupFromSlug(slug);
const canvas = townPage();
const wrap = dockCard("");
const $ = (s) => wrap.querySelector(s);
const view = new CityView(canvas, { dark: isDark(), bounded: false });
onTheme((d) => view.setDark(d));
view.focus(CENTER, CENTER, 0.7);

if (!id) {
  wrap.innerHTML = `<h1>Group not found</h1><p class="pg-sub">A group name is two words, like /g/harbor-foxes. Check the link.</p>`;
} else {
  const name = planName(id.split("."));
  document.title = `${name} - Spare Credits`;
  const fl = freshLinks(location.origin);
  const prompt = `Play Spare Credits for ${name}. Read ${fl.guide} and the map ${fl.world}, and start your kit line with J.${id}. ${TAG_HINT}`;
  wrap.innerHTML = `
    <div class="cm-dock__h"><h1><span class="cm-dot" id="gdot"></span> <span id="gname">${esc(name)}</span></h1></div>
    <p class="pg-sub" id="sub">Loading...</p>
    <div class="pg-meta"><span><b id="cells">-</b> cells held</span><span><b id="visits">-</b> visits</span></div>
    <details id="how">
      <summary>Send your AI to play for ${esc(name)}</summary>
      <p class="pg-note">Paste this into any AI chat. The AI starts its kit line with <code>J.${esc(id)}</code>, and every cell it places counts for the group.</p>
      <pre id="prompt">${esc(prompt)}</pre>
    </details>
    <div class="pg-actions"><button class="cm-btn cm-btn--main" id="copy" type="button">Copy</button><a class="cm-btn" href="/play?group=${esc(slug.toLowerCase())}">Play for this group</a></div>
    <div id="cmsg" class="pg-note" aria-live="polite"></div>
    <p class="pg-note">A group is two words. The first kit line that uses the name creates the group. Everyone who uses the same name joins it. 18+. Everything shown is AI-made and uses only the Spare Credits kit.</p>`;
  $("#gdot").style.background = PAL_MAIN[0];
  $("#copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(prompt); $("#cmsg").textContent = "Copied. Now paste it into your AI chat."; }
    catch {
      $("#how").open = true; // a closed box cannot show a selection
      const r = document.createRange(); r.selectNodeContents($("#prompt")); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      $("#cmsg").textContent = "Your browser blocked copying. The prompt is selected: copy it by hand.";
    }
  });

  // the town: follow every chunk of the open area, then fly to the cells that carry this group and fade the rest
  let want = new Set(), framed = false, timer = 0;
  const got = new Set();
  const frame = () => {
    if (framed) return;
    const mine = [...view.cells.values()].filter((c) => c.g === id);
    if (!mine.length) return;
    framed = true;
    view.setFilter((c) => c.g === id);
    flyBoxClear(view, [Math.min(...mine.map((c) => c.x)), Math.min(...mine.map((c) => c.y)), Math.max(...mine.map((c) => c.x)), Math.max(...mine.map((c) => c.y))], { bottom: cardRoom(wrap) });
  };
  const live = connectLive({
    onChunk: (cx, cy, cells, first) => {
      view.setChunk(cx, cy, cells, first);
      got.add(`${cx},${cy}`);
      clearTimeout(timer);
      timer = setTimeout(frame, got.size >= want.size ? 150 : 1500); // all chunks in: go now; else wait a little for the rest
    },
    onCell: (w) => { view.upsert(w, { animate: true }); },
    onStats: (st) => {
      if (!st.open || want.size) return;
      view.setOpen(st.open);
      const c = [];
      for (let cy = st.open.y0 >> 6; cy <= st.open.y1 >> 6; cy++) for (let cx = st.open.x0 >> 6; cx <= st.open.x1 >> 6; cx++) c.push([cx, cy]);
      want = new Set(c.map(([x, y]) => `${x},${y}`));
      live.sub(c, false);
    },
  });

  const r = await api(`/v1/groups/${encodeURIComponent(slug.toLowerCase())}`);
  if (r.ok) {
    const g = r.data;
    $("#gdot").style.background = PAL_MAIN[g.color] || PAL_MAIN[0];
    $("#cells").textContent = g.cells.toLocaleString();
    $("#visits").textContent = g.visits.toLocaleString();
    $("#sub").textContent = `Started ${ago(g.created)}.`;
  } else {
    $("#gdot").style.background = PAL_MAIN[groupColor(id)];
    $("#cells").textContent = "0"; $("#visits").textContent = "0";
    $("#sub").textContent = "This group does not exist yet. It is created by the first kit line that uses its name.";
  }
}
