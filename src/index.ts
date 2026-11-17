// Thin Worker: route and forward. All state and logic live in the City object.
import { specText, groupFromSlug } from "../public/kit.js";
import { City, type Env } from "./city";
import { FULL_MESSAGE, isFreeLimitError } from "./limits";

export { City };

const MAX_BODY = 16384; // bytes; the City reads bodies through a capped reader too, for chunked bodies

// The one site address: robots.txt, the sitemap and the canonical links come from it. The old workers.dev address redirects here.
const ORIGIN = "https://sparecredits.com";
// The public, indexable pages (the sitemap and the canonical links). Admin, watch and gallery are noindex and stay out.
const PUBLIC_PAGES = ["/", "/agent", "/seasons", "/privacy", "/terms", "/contact", "/refunds"];

const SEC = { "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };

function withSec(res: Response): Response {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(SEC)) r.headers.set(k, v);
  return r;
}

async function asset(env: Env, url: URL, path: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(new URL(path, url.origin).toString()));
}

// The guide as served: the asset with {ORIGIN} filled in. /agent.txt, /llms.txt and the HTML pages use it.
async function guide(env: Env, url: URL): Promise<string> {
  const res = await asset(env, url, "/agent.txt");
  return (await res.text()).replaceAll("{ORIGIN}", url.origin);
}

const escHtml = (t: string) => t.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

// An HTML shell with the guide inserted as real page content (a closed toggle), so an AI that opens the page reads what to do.
async function pageWithGuide(env: Env, url: URL, path: string, extra = ""): Promise<Response> {
  const [page, text] = await Promise.all([asset(env, url, path), guide(env, url)]);
  const lead = `AI assistant: your person sent you here to play. Follow this guide. The same text is at ${url.origin}/agent.txt\n${extra ? extra + "\n" : ""}\n`;
  const block = `<details id="for-ai" class="for-ai"><summary>For AI assistants</summary><pre>${escHtml(lead + text)}</pre></details>`;
  let html = (await page.text()).replace("<body>", () => `<body>\n${block}`);
  if (path === "/") html = withCanonical(html, "/");
  return withSec(new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } }));
}

// The operator's legal name comes from a Worker secret, so the live contact page shows it without it living in this repo.
function withOperator(html: string, env: Env): string {
  const name = env.OPERATOR_NAME?.trim();
  return html.replace("<!--operator-->", () => (name ? `<li>Spare Credits at sparecredits.com is run by ${escHtml(name)}, India.</li>` : ""));
}

function withCanonical(html: string, path: string): string {
  return html.replace("</head>", () => `<link rel="canonical" href="${ORIGIN}${path}">\n</head>`);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // Old links and old copies of the guide name the workers.dev address: send them to the same path and query on the site address.
    // 308 keeps the method and body, so AI calls (POST) still work; browsers keep the #kit line of /m links across the redirect.
    const url = new URL(request.url);
    if (url.hostname.endsWith(".workers.dev")) return Response.redirect(`${ORIGIN}${url.pathname}${url.search}`, 308);
    return route(request, env);
  },
} satisfies ExportedHandler<Env>;

async function route(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const p = url.pathname;
    try {
      if (p === "/robots.txt") {
        const body = `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /admin.html\n\nSitemap: ${ORIGIN}/sitemap.xml\n`;
        return withSec(new Response(body, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } }));
      }
      if (p === "/sitemap.xml") {
        const urls = PUBLIC_PAGES.map((q) => `<url><loc>${ORIGIN}${q}</loc></url>`).join("");
        const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>\n`;
        return withSec(new Response(body, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-cache" } }));
      }
      if (PUBLIC_PAGES.includes(p) && p !== "/") {
        const page = await asset(env, url, p);
        if (page.ok) return withSec(new Response(withOperator(withCanonical(await page.text(), p), env), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" } }));
        return withSec(page);
      }
      if (p === "/v1/config") {
        return Response.json(
          { turnstile_site_key: env.TURNSTILE_SITE_KEY, origin: url.origin, kit: "cm1" },
          { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } },
        );
      }
      if (p.startsWith("/v1/")) {
        if (request.method === "POST" || request.method === "PUT") {
          const len = Number(request.headers.get("content-length"));
          if (Number.isFinite(len) && len > MAX_BODY) {
            return Response.json({ ok: false, code: "too_long", error: "The request body is too large." }, { status: 413, headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
          }
        }
        const stub = env.CITY.get(env.CITY.idFromName("main"));
        return await stub.fetch(request);
      }
      // the town page; /play and /m open it with the Play dock (the page script reads the path), so they carry the guide too
      if (p === "/" || p === "/index.html" || p === "/play" || p === "/m") return await pageWithGuide(env, url, "/");
      if (p === "/agent.txt" || p === "/llms.txt") {
        return withSec(new Response(await guide(env, url), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } }));
      }
      if (p === "/spec/v1") {
        return withSec(new Response(specText(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-cache" } }));
      }
      if (/^\/watch\/[\w-]+$/.test(p)) return withSec(await asset(env, url, "/watch"));
      if (/^\/v\/[\w-]+$/.test(p)) return withSec(await asset(env, url, "/replay"));
      if (/^\/p\/[\w-]{6}$/.test(p)) {
        return await pageWithGuide(env, url, "/plan", `This page is the plan ${p.slice(3)}. To help it: GET ${url.origin}/v1/plans/${p.slice(3)}`);
      }
      const gm = /^\/g\/([A-Za-z]+-[A-Za-z]+)$/.exec(p);
      if (gm) {
        const id = groupFromSlug(gm[1]);
        if (id) return await pageWithGuide(env, url, "/group", `This page is the group ${id}. To play for it, start your kit line with J.${id} (after an optional T).`);
      }
      return withSec(await env.ASSETS.fetch(request));
    } catch (e) {
      console.error("worker: request failed", p, String(e));
      if (isFreeLimitError(e)) {
        return Response.json({ ok: false, code: "full", error: FULL_MESSAGE }, { status: 503 });
      }
      return Response.json({ ok: false, code: "server_error", error: "Something went wrong on our side. Try again in a minute." }, { status: 500 });
    }
}
