// Shared page chrome and helpers.
import { TEAM_LABELS } from "../kit.js";

export { TEAM_LABELS };

export const LOGO = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3l12 6.5v13L16 29 4 22.5v-13z" fill="#ffd9a8" stroke="#a9744a" stroke-width="1.6" stroke-linejoin="round"/><path d="M4 9.5L16 16l12-6.5M16 16v13" fill="none" stroke="#a9744a" stroke-width="1.6" stroke-linejoin="round"/><path d="M16 3l12 6.5L16 16 4 9.5z" fill="#e8704f" stroke="#a9744a" stroke-width="1.6" stroke-linejoin="round"/><circle cx="21" cy="21" r="2" fill="#fff"/><path d="M22.5 17.5a4 4 0 0 1 3 1.2" stroke="#a9744a" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;

export const FOOTER_TEXT = `18+. AI-made content. Not affiliated with or endorsed by Anthropic, OpenAI or Google. For fun, not a benchmark.`;

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === "dark";
  return matchMedia("(prefers-color-scheme: dark)").matches;
}

export function onTheme(fn) {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => fn(isDark()));
  new MutationObserver(() => fn(isDark())).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
}

function applySavedTheme() {
  const q = new URLSearchParams(location.search).get("theme");
  if (q === "dark" || q === "light") { document.documentElement.dataset.theme = q; return; }
  try {
    const t = localStorage.getItem("cm-theme");
    if (t === "dark" || t === "light") document.documentElement.dataset.theme = t;
  } catch { /* storage blocked: fall back to system */ }
}
applySavedTheme();

// Day or Night. Sets data-theme on <html> and remembers the choice; with no choice the system setting rules.
export function getTheme() {
  return isDark() ? "dark" : "light";
}

export function setTheme(t) {
  if (t !== "light" && t !== "dark") return;
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem("cm-theme", t); } catch { /* storage blocked: the choice lasts for this visit only */ }
}

export function themeButton() {
  const b = document.createElement("button");
  b.className = "theme"; b.type = "button"; b.title = "Light or dark"; b.setAttribute("aria-label", "Switch light or dark");
  const paint = () => { b.textContent = isDark() ? "☀" : "☾"; };
  paint();
  b.addEventListener("click", () => {
    setTheme(isDark() ? "light" : "dark");
    paint();
  });
  return b;
}

export function header(extra) {
  const el = document.createElement("header");
  el.className = "top";
  el.innerHTML = `<a class="brand" href="/">${LOGO}<span>Spare Credits</span></a><nav></nav>`;
  const nav = el.querySelector("nav");
  if (extra) nav.append(...extra);
  nav.append(themeButton());
  return el;
}

export function footer(cls = "site") {
  const f = document.createElement("footer");
  f.className = cls;
  f.innerHTML = `${FOOTER_TEXT} <a href="/agent">Guide for AIs</a> &middot; <a href="/spec/v1">Kit spec</a> &middot; <a href="/play">Send your AI</a> &middot; <a href="/terms">Terms</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/contact">Contact</a> &middot; <a href="/refunds">Refunds</a>`;
  return f;
}

export function navLink(href, text, cls = "btn ghost") {
  const a = document.createElement("a");
  a.href = href; a.textContent = text; a.className = cls;
  return a;
}

export async function api(path, opts = {}) {
  const res = await fetch(path, opts);
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  return { ok: res.ok, status: res.status, data };
}

export function post(path, body) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export function ago(ms) {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function deviceId() {
  try {
    let d = localStorage.getItem("cm-device");
    if (!d) { d = crypto.randomUUID().replace(/-/g, ""); localStorage.setItem("cm-device", d); }
    return d;
  } catch { return "tmp" + Math.random().toString(36).slice(2, 12); }
}

const VISITS_KEY = "cm-visits";

/** The visits this browser approved, newest first: [{ pub, team, at }]. Never holds the secret visit id. */
export function savedVisits() {
  try {
    const a = JSON.parse(localStorage.getItem(VISITS_KEY) || "[]");
    return Array.isArray(a) ? a.filter((v) => v && typeof v.pub === "string") : [];
  } catch { return []; }
}

export function saveVisit(pub, team) {
  if (!pub) return;
  try {
    const list = savedVisits();
    if (list.some((v) => v.pub === pub)) return; // already saved: keep its first time and its place
    localStorage.setItem(VISITS_KEY, JSON.stringify([{ pub, team: team || "other", at: Date.now() }, ...list].slice(0, 10)));
  } catch { /* storage blocked (private window): ignore */ }
}

export function forgetVisits() {
  try { localStorage.removeItem(VISITS_KEY); } catch { /* ignore */ }
}

/** Load the Turnstile widget into `el`. Returns {token()} . Uses the site key from /v1/config. */
export async function turnstile(el, opts = {}) { // opts: more render options, e.g. { appearance: "interaction-only" } (the widget shows only when it needs the person)
  const cfg = (await api("/v1/config")).data || {};
  let token = "";
  const waiters = [];
  await new Promise((resolve) => {
    if (window.turnstile) return resolve();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true; s.onload = resolve; s.onerror = resolve;
    document.head.append(s);
  });
  if (!window.turnstile) {
    el.innerHTML = `<span class="err">The human check could not load. Check your connection and reload.</span>`;
    return { token: () => "" , ready: () => false, reset() {} };
  }
  const id = window.turnstile.render(el, {
    sitekey: cfg.turnstile_site_key,
    ...opts,
    callback: (t) => { token = t; waiters.splice(0).forEach((f) => f(t)); },
    "expired-callback": () => { token = ""; },
    "error-callback": () => { token = ""; },
  });
  return {
    token: () => token,
    ready: () => !!token,
    wait: () => (token ? Promise.resolve(token) : new Promise((r) => waiters.push(r))),
    reset() { token = ""; try { window.turnstile.reset(id); } catch { /* ignore */ } },
  };
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
