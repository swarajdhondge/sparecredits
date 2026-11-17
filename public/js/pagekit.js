// Pieces shared by the pages that are not the town screen: the small top bar (back button and Menu), reading pages,
// town pages (the town fills the screen), the dock-style card at the bottom, and a camera fit that keeps the bars clear.
import { createMenu } from "./menu.js";
import * as I from "./icons.js";

/** The small top bar: a back button (history back, or / when there is no history) and the Menu button. */
export function topBar() {
  const head = document.createElement("div");
  head.className = "town-head pg-head";
  head.innerHTML = `<div class="cm-top"><a class="cm-ib cm-glass" href="/" aria-label="Back">${I.ICON_BACK}</a><span style="flex:1"></span></div>`;
  head.querySelector("a").addEventListener("click", (e) => { if (history.length > 1) { e.preventDefault(); history.back(); } });
  const { button, pop } = createMenu();
  head.firstChild.append(button);
  head.append(pop);
  return head;
}

/** A reading page: style E ground, the top bar, and the content in a `cm-glass` column. `main` is an existing element or made here. */
export function readingPage(main) {
  document.body.classList.add("pg", "cm", "cm-ground");
  main ||= document.createElement("main");
  main.classList.add("pg-col", "cm-glass");
  document.body.prepend(topBar());
  if (!main.isConnected) document.body.append(main);
  return main;
}

/** A town page: the town fills the screen, the top bar floats over it. Returns the canvas. */
export function townPage() {
  document.body.classList.add("app", "pg-town", "cm");
  const stage = document.createElement("main");
  stage.className = "stage cm"; stage.id = "stage";
  stage.innerHTML = `<canvas aria-label="The shared town. Drag to move, pinch to zoom, twist to turn."></canvas>`;
  stage.append(topBar());
  document.body.append(stage);
  return stage.querySelector("canvas");
}

/** The small `cm-glass` card at the bottom of a town page (the PlayDock look). */
export function dockCard(html) {
  const d = document.createElement("section");
  d.className = "cm-dock cm-glass pg-dock";
  d.innerHTML = html;
  document.body.append(d);
  return d;
}

/** Glide to show the cell box [x0, y0, x1, y1] in the free part of the screen: under the top bar, above the card (`bottom` px). */
export function flyBoxClear(view, box, { top = 58, bottom = 0, maxZ = 1.2, ms = 700 } = {}) {
  const { l, r, t, b } = view.cellsExtent(...box);
  const h = Math.max(80, view.H - top - bottom);
  const z = Math.max(view.minZoom, Math.min(maxZ, view.W / ((r - l) * 1.15), h / ((b - t) * 1.15)));
  const cy = (t + b) / 2 + (bottom - top) / 2 / z; // moves the box up to the middle of the free part
  const o = view.aim((l + r) / 2, cy, z);
  if (ms > 0) { view.moved = true; view.glide(o, ms); } else { Object.assign(view.cam, o); view.dirty = true; }
}

/** How much room a card takes at the bottom: its height plus its margin and a little air. */
export const cardRoom = (card) => Math.ceil(card.getBoundingClientRect().height) + 24;

export const teamDot = (t) => `<span class="cm-dot" style="background:var(--team-${["claude", "chatgpt", "gemini"].includes(t) ? t : "other"})"></span>`;
