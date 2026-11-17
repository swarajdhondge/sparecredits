import { describe, it, expect } from "vitest";
import agentTxt from "../public/agent.txt?raw";
import indexHtml from "../public/index.html?raw";
import planHtml from "../public/plan.html?raw";
import groupHtml from "../public/group.html?raw";
import worker from "../src/index";

// A fake ASSETS binding that serves the files of public/ that these pages need (under their clean URLs).
const FILES: Record<string, string> = { "/": indexHtml, "/plan": planHtml, "/group": groupHtml, "/agent.txt": agentTxt };
const assets = {
  async fetch(req: Request) {
    const body = FILES[new URL(req.url).pathname];
    return body === undefined ? new Response("not found", { status: 404 }) : new Response(body);
  },
};
const env = { ASSETS: assets } as unknown as Parameters<typeof worker.fetch>[1];
const get = (path: string) => worker.fetch(new Request(`https://cm.example${path}`), env);
const esc = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

describe("pages that carry the AI guide", () => {
  it("/ has the closed for-ai toggle with the escaped guide, the real origin and the alternate link", async () => {
    const guide = agentTxt.replaceAll("{ORIGIN}", "https://cm.example");
    for (const path of ["/", "/index.html"]) {
      const res = await get(path);
      expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
      expect(res.headers.get("cache-control")).toBe("no-cache");
      const html = await res.text();
      expect(html).toMatch(/<body>\s*<details id="for-ai" class="for-ai"><summary>For AI assistants<\/summary><pre>AI assistant: your person sent you here to play\. Follow this guide\. The same text is at https:\/\/cm\.example\/agent\.txt/);
      expect(html).toContain(esc(guide));
      expect(html).not.toContain("{ORIGIN}");
      expect(html).toContain('<link rel="alternate" type="text/plain" href="/agent.txt" title="Guide for AI assistants">');
      expect(html).toContain("AI assistants: read /agent.txt");
      expect(html.indexOf('id="for-ai"')).toBeLessThan(html.indexOf("<noscript>"));
    }
  });
  it("/ is the town screen: one stage with the canvas, no header, stats line, footer or minimap, and the guide stays in the page text", async () => {
    const html = await (await get("/")).text();
    expect(html).toContain('<main class="stage cm" id="stage"><canvas');
    expect(html).toContain('<script type="module" src="/js/home.js"></script>');
    for (const gone of ['class="top"', 'class="hud"', "<footer", "Time-lapse", "minimap"]) expect(html).not.toContain(gone);
    expect(html).toContain("Guide for AI assistants"); // the alternate link title
    expect(html).toContain("<summary>For AI assistants</summary>"); // visually hidden by CSS, still in the source
  });
  it("/play and /m open the town page (the same shell as /) and still carry the guide", async () => {
    for (const path of ["/play", "/m"]) {
      const html = await (await get(path)).text();
      expect(html).toContain('<main class="stage cm" id="stage"><canvas');
      expect(html).toContain('<script type="module" src="/js/home.js"></script>');
      expect(html).toMatch(/<body>\s*<details id="for-ai" class="for-ai">/);
      expect(html).toContain("AI assistant: your person sent you here to play.");
    }
  });
  it("/p/<code> carries the guide and the plan line", async () => {
    const html = await (await get("/p/abc123")).text();
    expect(html).toContain('id="for-ai"');
    expect(html).toContain("This page is the plan abc123. To help it: GET https://cm.example/v1/plans/abc123");
  });
  it("/g/<name> carries the guide and the group line; /p and /g load the style E page script (the town page builds the card, not the HTML)", async () => {
    const html = await (await get("/g/harbor-garden")).text();
    expect(html).toContain('id="for-ai"');
    expect(html).toContain("This page is the group harbor.garden. To play for it, start your kit line with J.harbor.garden");
    for (const page of [html, await (await get("/p/abc123")).text()]) {
      expect(page).toContain('<link rel="stylesheet" href="/pages.css">');
      for (const gone of ['class="wrap"', "mini-stage", "<footer"]) expect(page).not.toContain(gone);
    }
  });
  it("/llms.txt equals /agent.txt", async () => {
    const [a, l] = [await get("/agent.txt"), await get("/llms.txt")];
    expect(l.status).toBe(200);
    expect(await l.text()).toBe(await a.text());
  });
});

describe("search engine files", () => {
  it("robots.txt blocks only admin and names the sitemap; the sitemap lists absolute public URLs", async () => {
    const robots = await (await get("/robots.txt")).text();
    expect(robots).toContain("Disallow: /admin\n");
    expect(robots.match(/Disallow:/g)).toHaveLength(2);
    expect(robots).toContain("Sitemap: https://sparecredits.com/sitemap.xml");
    const res = await get("/sitemap.xml");
    expect(res.headers.get("content-type")).toContain("application/xml");
    const xml = await res.text();
    expect(xml).toContain("<loc>https://sparecredits.com/</loc>");
    expect(xml).not.toMatch(/admin|watch|gallery/);
  });
  it("the home page has the canonical link; the old workers.dev address redirects to the same path on sparecredits.com", async () => {
    expect(await (await get("/")).text()).toContain('<link rel="canonical" href="https://sparecredits.com/">');
    const old = await worker.fetch(new Request("https://credit-muncher.x.workers.dev/v1/world.txt?near=3,4"), env);
    expect(old.status).toBe(308);
    expect(old.headers.get("location")).toBe("https://sparecredits.com/v1/world.txt?near=3,4");
    const post = await worker.fetch(new Request("https://credit-muncher.x.workers.dev/v1/visits", { method: "POST", body: "{}" }), env);
    expect(post.status).toBe(308);
    expect((await worker.fetch(new Request("https://sparecredits.com/"), env)).status).toBe(200);
  });
});
