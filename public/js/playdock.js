// The Play dock on the town screen (style E PlayDock card; plan L1, L4, L5).
// Step 1 who builds for you, step 2 describe it or send a photo (Copy the message for the person's AI chat),
// step 3 paste the link and Place. The plot glows on the town; Place moves the pasted build onto it. Nothing is remembered.
import { post, turnstile, saveVisit, esc } from "./common.js";
import { parseLine, extractKitLine, moveLine, inArea, openArea, groupFromSlug, planName, CENTER, TEAMS } from "../kit.js";
import { playMessage } from "./playprompt.js";
import * as I from "./icons.js";

const NAME = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", other: "Another AI" };
const WHO = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", other: "another AI" }; // inside a sentence
// A line with no T: guess the AI from where the link came from. ChatGPT adds utm_source=chatgpt.com; other chats may send a referrer.
const SOURCE_TEAMS = [["chatgpt", "chatgpt"], ["openai", "chatgpt"], ["claude", "claude"], ["anthropic", "claude"], ["gemini", "gemini"], ["perplexity", "other"], ["grok", "other"]];
const steps = (n) => `<span class="cm-steps" aria-label="Step ${n} of 3">${[1, 2, 3].map((i) => `<i class="${i <= n ? "is-on" : ""}"></i>`).join("")}</span>`;
const closeBtn = `<button type="button" class="cm-ib cm-ib--sm" data-a="close" aria-label="Close">${I.ICON_CLOSE}</button>`;
const backBtn = `<button type="button" class="cm-ib cm-ib--sm" data-a="back" aria-label="Back">${I.ICON_BACK}</button>`;
const fresh = () => ({ step: 1, team: "", mode: "idea", idea: "", copied: false, text: "", agree: false, err: "", busy: false, plot: null, auto: true, result: null });

/** host: { stage, view, ready(): are the town stats here, box(): the built box, seeIt(x, y), close() }. */
export function createPlayDock({ stage, view, ready, box, seeIt, close }) {
  const params = new URLSearchParams(location.search);
  const groupId = groupFromSlug(params.get("group") || "");
  const planCode = /^[A-Za-z0-9_-]{6}$/.test(params.get("plan") || "") ? params.get("plan") : "";
  let st = fresh(), plan = null, world = "", worldAt = 0, widget = null, opened = false, needFly = false, copyT = 0;

  const el = document.createElement("div");
  el.className = "cm-dock cm-glass town-dock";
  el.setAttribute("role", "group");
  el.setAttribute("aria-label", "Send your AI");
  el.hidden = true;
  el.innerHTML = `
    <section data-p="1">
      <div class="cm-dock__h">Who builds for you?<span style="flex:1"></span>${steps(1)}${closeBtn}</div>
      <div class="cm-teams">${TEAMS.map((t) => `<button type="button" class="cm-team" data-a="team" data-v="${t}" style="--tc:var(--team-${t})"><span class="cm-team__av"></span>${NAME[t]}</button>`).join("")}</div>
    </section>
    <section data-p="2">
      <div class="cm-dock__h">${backBtn}<div class="cm-seg"><button type="button" data-a="mode" data-v="idea">Describe it</button><button type="button" data-a="mode" data-v="photo">From a photo</button></div><span style="flex:1"></span>${steps(2)}${closeBtn}</div>
      <p class="cm-note town-dock__note" data-r="ctx" hidden></p>
      <div class="cm-row"><input class="cm-fld" data-r="idea" maxlength="60" autocomplete="off" placeholder="a red lighthouse by the water"><p class="town-dock__photo" data-r="photo" hidden></p><button type="button" class="cm-btn cm-btn--main" data-a="copy" data-r="copy">Copy</button></div>
      <div class="cm-msg" data-r="msg"></div>
      <textarea class="cm-fld town-dock__fall" data-r="fall" rows="3" readonly hidden aria-label="The message to copy"></textarea>
    </section>
    <section data-p="3">
      <div class="cm-dock__h">${backBtn}<span data-r="h3"></span><span style="flex:1"></span>${steps(3)}${closeBtn}</div>
      <div class="cm-row"><input class="cm-fld" data-r="link" autocomplete="off" spellcheck="false" placeholder="https://…/m#cm1;…"><button type="button" class="cm-btn cm-btn--main" data-a="place" data-r="place" disabled>Place</button></div>
      <div class="town-dock__chk"><label><input type="checkbox" data-r="age"><span>I am 18 or older</span></label><div class="town-dock__ts" data-r="ts"></div></div>
      <div class="town-dock__by" role="group" aria-label="Made by"><span>Made by</span>${TEAMS.map((t) => `<button type="button" class="cm-chip town-dock__chip" data-a="by" data-v="${t}" aria-label="${NAME[t]}" aria-pressed="false"><span class="cm-dot" style="background:var(--team-${t})"></span>${t === "other" ? "Other" : NAME[t]}</button>`).join("")}</div>
      <p class="cm-note" data-r="grp" hidden></p>
      <p class="cm-err" role="alert" data-r="err" hidden></p>
    </section>
    <section data-p="placing"><div class="cm-dock__h" role="status"><span class="cm-spin"></span>Placing your build on the plot</div></section>
    <section data-p="done">
      <div class="cm-dock__h" role="status"><span class="town-dock__ok">${I.ICON_DONE}</span><span data-r="done"></span><span style="flex:1"></span>${closeBtn}</div>
      <div class="cm-row town-dock__acts" data-r="acts"></div>
      <p class="cm-note" data-r="skipped" hidden></p>
    </section>`;
  stage.append(el);
  const r = (k) => el.querySelector(`[data-r="${k}"]`);
  const sections = [...el.querySelectorAll("section")];
  const who = () => WHO[st.team] || WHO.other;

  // ---------- the plot ----------
  const area = () => (view.openSet ? view.open : openArea(0));
  const isBuild = (x, y) => !!view.cell(x, y)?.b;
  function setPlot(x, y) {
    st.plot = x == null ? null : { x, y };
    view.setPlot(x ?? null, y ?? null);
  }
  function pickPlot() { // a free cell near the middle of the built area
    const b = box(), a = area();
    const cx = Math.round(b ? (b[0] + b[2]) / 2 : CENTER), cy = Math.round(b ? (b[1] + b[3]) / 2 : CENTER);
    let best = null, bd = Infinity;
    for (let rad = 0; rad < 40 && !best; rad++) {
      for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const x = cx + dx, y = cy + dy;
        if (!inArea(a, x, y) || isBuild(x, y)) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { x, y }; }
      }
    }
    if (best) { st.auto = true; setPlot(best.x, best.y); ensureVisible(); }
  }
  function ensureVisible() {
    if (!st.plot) return;
    const p = view.cellScreen(st.plot.x, st.plot.y), pad = 40;
    if (p[0] < pad || p[0] > view.W - pad || p[1] < 70 || p[1] > view.H - el.offsetHeight - 40) view.flyTo(st.plot.x, st.plot.y, Math.max(view.cam.z, view.defaultZoom()));
  }

  // ---------- the paste and the message ----------
  const fromHash = () => {
    let h = location.hash.replace(/^#/, "");
    try { h = decodeURIComponent(h); } catch { /* keep raw */ }
    return h.trim().replace(/[.,)\]>"'*]+$/, ""); // chats sometimes glue punctuation to the end of a link
  };
  const message = () => playMessage({ origin: location.origin, team: st.team, groupId, plan, world, idea: st.idea.trim().replace(/["\n\r]/g, " "), photo: st.mode === "photo" });
  async function fetchPlan() {
    if (!planCode || plan) return;
    try {
      const res = await fetch(`/v1/plans/${planCode}`, { cache: "no-store" });
      plan = res.ok ? await res.json() : null;
    } catch (e) { console.warn("plan: could not load", planCode, e); }
    if (plan && plan.status !== "active") plan = null; // an ended plan: the message is the normal one
    paint();
  }
  async function fetchWorld() {
    try {
      const near = plan && plan.missing.length ? `?near=${plan.missing[0].x},${plan.missing[0].y}` : "";
      const res = await fetch(`/v1/world.txt${near}`, { cache: "no-store" });
      if (res.ok) { world = (await res.text()).trim(); worldAt = Date.now(); }
    } catch (e) { console.warn("world: could not load, using the old copy", e); }
  }

  // ---------- painting ----------
  function show(p) {
    st.step = p;
    if (p === 3 && !st.team) st.team = "claude"; // as the old /m page: the first team
    for (const s of sections) s.hidden = s.dataset.p !== String(p);
    paint();
    if (p === 3) ensureWidget();
  }
  function paint() {
    if (!opened) return;
    for (const b of el.querySelectorAll('[data-a="mode"]')) b.classList.toggle("is-on", b.dataset.v === st.mode);
    const photo = st.mode === "photo";
    r("idea").hidden = photo;
    r("photo").hidden = !photo;
    r("photo").textContent = `Attach your photo in ${who()}'s chat and send this. It rebuilds it from kit shapes.`;
    r("idea").setAttribute("aria-label", `What should ${who()} build?`);
    r("copy").innerHTML = st.copied ? `${I.ICON_DONE}Copied` : "Copy";
    r("msg").textContent = message();
    const ctx = groupId ? `You are sending your AI to play for the group ${planName(groupId.split("."))}.` : plan ? `You are sending your AI to help the plan "${plan.name}".` : "";
    r("ctx").hidden = !ctx;
    r("ctx").textContent = ctx;
    r("h3").textContent = `Paste ${who()}'s link`;
    for (const b of el.querySelectorAll('[data-a="by"]')) { const on = b.dataset.v === st.team; b.classList.toggle("is-on", on); b.setAttribute("aria-pressed", String(on)); }
    r("link").setAttribute("aria-label", `The link ${who()} sent`);
    r("link").classList.toggle("is-bad", !!st.err);
    r("err").hidden = !st.err;
    r("err").textContent = st.err;
    const g = lineGroup();
    r("grp").hidden = !g;
    r("grp").textContent = g ? `Group: ${g}` : "";
    syncPlace();
  }
  function lineTeam(text) {
    const p = text.trim() ? parseLine(extractKitLine(text) || "") : null;
    return p && p.ok && p.items[0]?.ok && p.items[0].cmd.v === "T" ? p.items[0].cmd.team : "";
  }
  function lineGroup() {
    const p = st.text.trim() ? parseLine(extractKitLine(st.text) || "") : null;
    const j = p && p.ok && p.items.find((i) => i.ok && i.cmd.v === "J");
    return j ? j.cmd.name : "";
  }
  function syncPlace() { r("place").disabled = !(st.text.trim() && st.agree) || st.busy; }

  // ---------- Turnstile: invisible, shows only when it needs the person ----------
  function ensureWidget() {
    if (widget) return;
    widget = turnstile(r("ts"), { appearance: "interaction-only" }); // a promise; place() awaits it
  }

  // ---------- copy ----------
  async function copy() {
    clearTimeout(copyT);
    if (st.team !== "claude" && st.team !== "chatgpt" && Date.now() - worldAt > 30000) { r("msg").textContent = "Getting the latest town…"; await fetchWorld(); }
    const text = message();
    r("msg").textContent = text;
    try {
      await navigator.clipboard.writeText(text);
      r("fall").hidden = true;
      st.copied = true;
      paint();
      copyT = setTimeout(() => { if (opened && st.step === 2) show(3); }, 1000); // on to step 3
    } catch (e) {
      console.warn("clipboard write failed: showing the message to copy by hand", e);
      r("fall").hidden = false;
      r("fall").value = text;
      r("fall").select();
      r("msg").textContent = "Your browser blocked copying. The message is selected: copy it by hand.";
    }
  }

  // ---------- place ----------
  function fail(msg) { st.err = msg; show(3); r("link").focus({ preventScroll: true }); }
  async function place() {
    if (st.busy) return;
    st.err = "";
    const text = st.text.trim();
    if (!text) return fail(`Paste the link ${who()} sent you first.`);
    const line = extractKitLine(text);
    if (!line) return fail(`That link has no build in it. Ask ${who()} to send the link again.`);
    const parsed = parseLine(line);
    if (!parsed.ok) return fail(parsed.message);
    if (!parsed.items.some((i) => i.ok)) return fail("No valid commands in this line.");
    const team = st.team; // the "Made by" chip: the line's T, else the source guess, else step 1, else Claude
    let send = line;
    if (st.plot) {
      const mv = moveLine(line, st.plot, area());
      if (!mv.ok) return fail(mv.code === "outside" ? "This build does not fit here. Pick a plot further in." : mv.message);
      send = mv.line;
    }
    st.busy = true;
    show("placing");
    const w = await widget;
    const token = w.token() || (await Promise.race([w.wait?.(), new Promise((res) => setTimeout(() => res(""), 8000))]));
    const res = await post("/v1/bundle", { line: send, team, age_confirmed: true, turnstile_token: token });
    st.busy = false;
    if (!res.ok) {
      w.reset();
      return fail(res.data?.error || "Could not place the moves.");
    }
    const d = res.data;
    saveVisit(d.pub, team);
    const hit = d.results.map((x) => (x.ok ? /^[A-Za-z]\.(\d+)\.(\d+)/.exec(x.cmd) : null)).find(Boolean);
    st.result = d;
    setPlot(null);
    r("done").textContent = d.plan ? `Plan "${d.plan.name}" started with ${d.plan.total} cells. Share its page so other AIs can help.` : `Done. ${d.applied} change${d.applied === 1 ? "" : "s"} placed.`;
    r("acts").innerHTML = `${hit ? `<button type="button" class="cm-btn cm-btn--main" data-a="see" data-x="${hit[1]}" data-y="${hit[2]}">See it</button>` : ""}${d.plan ? `<a class="cm-btn" href="/p/${esc(d.plan.code)}">Open the plan</a>` : ""}<a class="cm-btn" href="/v/${esc(d.pub)}">Replay and share</a>`;
    const bad = d.results.filter((x) => !x.ok);
    r("skipped").hidden = !bad.length;
    r("skipped").textContent = bad.length ? `${bad.length} skipped: ${bad[0].message}` : "";
    show("done");
    r("acts").querySelector("button,a")?.focus({ preventScroll: true });
  }

  // ---------- events ----------
  el.addEventListener("click", (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const a = b.dataset.a;
    if (a === "close") close();
    else if (a === "team") { st.team = b.dataset.v; st.copied = false; show(2); }
    else if (a === "by") { st.team = b.dataset.v; paint(); }
    else if (a === "back") show(st.step - 1 || 1);
    else if (a === "mode") { st.mode = b.dataset.v; st.copied = false; r("fall").hidden = true; paint(); }
    else if (a === "copy") copy();
    else if (a === "place") place();
    else if (a === "see") seeIt(+b.dataset.x, +b.dataset.y);
  });
  r("idea").addEventListener("input", () => { st.idea = r("idea").value; st.copied = false; paint(); });
  r("idea").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); copy(); } });
  r("link").addEventListener("input", () => {
    st.text = r("link").value; st.err = "";
    const t = lineTeam(st.text);
    if (t) st.team = t; // a leading T.team preselects the chip; the person can still change it
    paint();
  });
  r("link").addEventListener("keydown", (e) => { if (e.key === "Enter" && !r("place").disabled) { e.preventDefault(); place(); } });
  r("age").addEventListener("change", () => { st.agree = r("age").checked; syncPlace(); });

  // ---------- what home.js calls ----------
  return {
    /** Open the dock. step 1 from Play; step 3 with `text` (a /m link) puts the plot on the line's own first cell. */
    open({ step = 1, text = "", team = "" } = {}) {
      clearTimeout(copyT);
      st = fresh();
      opened = true;
      needFly = false;
      st.text = text; st.team = team;
      r("idea").value = ""; r("link").value = text; r("age").checked = false; r("fall").hidden = true;
      el.hidden = false;
      el.style.animation = "none"; void el.offsetWidth; el.style.animation = ""; // play the slide-up again
      show(step);
      if (text) {
        const first = parseLine(extractKitLine(text) || "");
        const c = first.ok && first.items.find((i) => i.ok && "x" in i.cmd);
        if (c) { st.auto = false; setPlot(c.cmd.x, c.cmd.y); needFly = true; }
      } else if (ready()) pickPlot();
      fetchPlan().then(() => { if (opened && st.step === 2) paint(); });
      if (!world) fetchWorld().then(() => paint());
    },
    close() {
      opened = false;
      clearTimeout(copyT);
      el.hidden = true;
      setPlot(null);
      st = fresh();
    },
    /** The town stats arrived: pick the first plot, or show the one a link names. */
    stats() {
      if (!opened) return;
      if (!st.plot && !st.result && st.auto && ready()) pickPlot();
      if (needFly && view.openSet) { needFly = false; ensureVisible(); }
    },
    /** After every frame: if a build landed on an automatic plot, pick another. */
    frame() {
      if (opened && st.auto && st.plot && !st.busy && isBuild(st.plot.x, st.plot.y)) pickPlot();
    },
    /** A tap on the town while the dock is open: a free cell inside the open area moves the plot. */
    tap(c) {
      if (!opened || st.busy || st.step === "done" || !c || !inArea(area(), c.x, c.y) || isBuild(c.x, c.y)) return;
      st.auto = false;
      setPlot(c.x, c.y);
    },
    get plot() { return st.plot; },
    get busy() { return st.busy; },
    teamGuess(line) { // for a /m link: the line's T, else a guess from where the link came from
      const t = lineTeam(line);
      if (t) return t;
      const src = `${params.get("utm_source") || ""} ${document.referrer || ""}`.toLowerCase();
      return SOURCE_TEAMS.find(([k]) => src.includes(k))?.[1] || ""; // empty: step 3 falls back to the step 1 team, else Claude
    },
    fromHash,
  };
}
