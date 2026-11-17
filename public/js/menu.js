// The shared Menu (style E): the crate Menu button and the Menu popover, the same as on the town screen.
// Day / Night switch, the reading pages, and the 18+ and not-affiliated note.
import { getTheme, setTheme } from "./common.js";
import * as I from "./icons.js";

export const MENU = [["Seasons", "/seasons"], ["Groups", "/seasons#groups"], ["Kit gallery", "/gallery"], ["Guide for AIs", "/agent"], ["Terms", "/terms"], ["Privacy", "/privacy"], ["Contact", "/contact"], ["Refunds", "/refunds"]];

export function renderMenu(pop) {
  const night = getTheme() === "dark";
  pop.innerHTML = `<div class="cm-seg" role="radiogroup" aria-label="Time of day" style="display:flex"><button type="button" class="${night ? "" : "is-on"}" style="flex:1" role="radio" aria-checked="${!night}" data-mode="light">Day</button><button type="button" class="${night ? "is-on" : ""}" style="flex:1" role="radio" aria-checked="${night}" data-mode="dark">Night</button></div>
    <div class="town-list">${MENU.map(([n, h]) => `<a class="cm-mi" href="${h}">${n}<small>${h}</small></a>`).join("")}</div>
    <p class="cm-note">For adults, 18+. Not affiliated with or endorsed by Anthropic, OpenAI or Google.</p>`;
}

/** Makes the Menu button and its popover. The caller puts `button` in the top bar and `pop` in the bar's container (the popover is positioned under it). */
export function createMenu() {
  const button = document.createElement("button");
  button.type = "button"; button.className = "cm-ib cm-glass"; button.id = "b-menu"; button.setAttribute("aria-label", "Menu"); button.setAttribute("aria-expanded", "false");
  button.innerHTML = I.ICON_CRATE;
  const pop = document.createElement("div");
  pop.className = "cm-pop cm-glass town-pop town-pop--menu"; pop.id = "pop-menu"; pop.hidden = true;
  const set = (open) => {
    if (open) renderMenu(pop);
    pop.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
  };
  button.addEventListener("click", (e) => { e.stopPropagation(); set(pop.hidden); });
  pop.addEventListener("click", (e) => {
    const t = e.target.closest("[data-mode]")?.dataset.mode;
    if (t) { setTheme(t); renderMenu(pop); }
  });
  document.addEventListener("click", (e) => { if (!pop.hidden && !pop.contains(e.target)) set(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !pop.hidden) { set(false); button.focus(); } });
  return { button, pop };
}
