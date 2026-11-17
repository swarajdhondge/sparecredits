// Screen check: every screen at phone and desktop size, Day and Night, with one tool call per set.
// One tool call has about a minute, so the check runs as 4 sets: phone-light, phone-dark, desktop-light, desktop-dark (about 35 s each).
// For each set: navigate the Playwright MCP browser to <server>/?set=<set> (local `wrangler dev` or the live URL; add &only=town,menu
// for some screens only), then run the tool `browser_run_code_unsafe` with `filename: "scripts/screens.js"`.
// It saves PNGs to .playwright-mcp/screens/ in your checkout (delete the folder afterwards) and returns one line per screen,
// with any page error, sideways scroll or overlap of floating parts (cm-glass, cm-play) found there.
// It only reads: it never ticks 18+, never presses Place, never posts anything.
async (page) => {
  const start = new URL(page.url()), base = start.origin;
  const SETS = { "phone-light": [390, 844], "phone-dark": [390, 844], "desktop-light": [1440, 900], "desktop-dark": [1440, 900] };
  const set = start.searchParams.get("set"), only = start.searchParams.get("only")?.split(",");
  if (!base.startsWith("http") || !SETS[set]) return `Navigate to <server>/?set=<set> first; sets: ${Object.keys(SETS).join(", ")}.`;
  const [size, theme] = set.split("-"), [w, h] = SETS[set];
  // The Playwright MCP may write only under the checkout, so the folder is absolute. Change this one line to your checkout path.
  const dir = "/absolute/path/to/sparecredits/.playwright-mcp/screens";
  const get = async (p) => { try { return await (await fetch(base + p)).json(); } catch { return null; } };
  const plan = (await get("/v1/plans"))?.plans?.[0]?.code;
  const group = (await get("/v1/groups"))?.groups?.[0]?.slug;

  const wait = (ms) => page.waitForTimeout(ms);
  const click = (sel) => page.evaluate((s) => { const e = document.querySelector(s); if (e) e.click(); return !!e; }, sel);
  // Each screen: a name, a path, and what to do on the page before the screenshot.
  const all = [
    ["town", "/", async () => {}],
    ["menu", "/", () => click("#b-menu")],
    ["scores", "/", () => click("#b-score")],
    ["find", "/", () => click("#b-find")],
    ["label", "/", async () => { await click("#b-find"); await wait(400); await click(".cm-rc"); }],
    ["dock-1", "/play", async () => {}],
    ["dock-2", "/play", () => click('.cm-teams [data-v="chatgpt"]')],
    ["dock-3", "/m#cm1;T.chatgpt;B.100.100.bakery.3.4.217", async () => {}],
    ["seasons", "/seasons", async () => {}],
    ["groups", "/seasons#groups", async () => {}],
    ["gallery", "/gallery", async () => {}],
    ["agent", "/agent", async () => {}],
    ["terms", "/terms", async () => {}],
    ["privacy", "/privacy", async () => {}],
    ["contact", "/contact", async () => {}],
    ["refunds", "/refunds", async () => {}],
    ["timelapse", "/timelapse", async () => {}],
    ...(plan ? [["plan", `/p/${plan}`, async () => {}]] : []),
    ...(group ? [["group", `/g/${group}`, async () => {}]] : []),
  ];
  const screens = only ? all.filter(([n]) => only.includes(n)) : all;

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message || e).slice(0, 120)));
  const out = [];
  await page.setViewportSize({ width: w, height: h });
  for (const [name, path, act] of screens) {
    errors.length = 0;
    const [p, hash] = path.split("#");
    await page.goto(`${base}${p}${p.includes("?") ? "&" : "?"}theme=${theme}${hash ? "#" + hash : ""}`);
    await wait(1500); // chunks, fonts and the first frames
    await act();
    await wait(500);
    const file = `${dir}/${size}-${theme}-${name}.png`;
    await page.screenshot({ path: file });
    const found = await page.evaluate(() => {
      const notes = [];
      const sw = document.scrollingElement.scrollWidth;
      if (sw > innerWidth + 1) notes.push(`sideways scroll ${sw}px`);
      const shown = (e) => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05; };
      const parts = [...document.querySelectorAll(".cm-glass, .cm-play")].filter(shown).filter((e) => !e.parentElement.closest(".cm-glass"));
      const label = (e) => e.id || e.getAttribute("aria-label") || [...e.classList].slice(0, 2).join(".");
      for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
        const a = parts[i].getBoundingClientRect(), b = parts[j].getBoundingClientRect();
        const x = Math.min(a.right, b.right) - Math.max(a.left, b.left), y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (x > 4 && y > 4) notes.push(`overlap ${label(parts[i])} / ${label(parts[j])}`);
      }
      return notes;
    });
    const notes = [...found, ...errors.map((e) => `error: ${e}`)];
    out.push(`${notes.length ? "CHECK" : "ok   "} ${size} ${theme} ${name}${notes.length ? ": " + notes.join("; ") : ""}`);
  }
  return `${set}: ${out.length} screens, PNGs in ${dir}/\n` + out.join("\n");
}
