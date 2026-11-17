// Every style and part in the kit, drawn once, so a person can check that each one looks different.
// Styles: ?h=5 sets the height. Dark: ?theme=dark.
import { isDark, onTheme } from "./common.js";
import { readingPage } from "./pagekit.js";
import { STYLES, PARTS } from "../kit.js";
import { drawBuilding } from "./buildings.js";

const wrap = readingPage();
wrap.innerHTML = `<h1>Kit gallery</h1><p class="muted">All ${STYLES.length} styles and ${PARTS.length} parts, drawn by the same code as the city. Each tile shows one style.</p>
  <h2>Styles</h2><div><canvas id="styles"></canvas></div>
  <h2>Parts (on a house, one per tile)</h2><div><canvas id="parts"></canvas></div>`;

const q = new URLSearchParams(location.search);
const h = Math.max(1, Math.min(9, +q.get("h") || 5));
let dark = isDark();

function sheet(canvas, items, draw) {
  const COLS = Math.max(2, Math.min(8, Math.floor((canvas.parentElement.clientWidth || 360) / 150)));
  canvas.style.maxWidth = "100%";
  const W = 150, H = 170, rows = Math.ceil(items.length / COLS);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = COLS * W * dpr; canvas.height = rows * H * dpr;
  canvas.style.width = "100%"; canvas.style.height = "auto"; canvas.style.display = "block";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = dark ? "#222a50" : "#bfe3a0"; ctx.fillRect(0, 0, COLS * W, rows * H);
  items.forEach((it, i) => {
    const cx = (i % COLS) * W + W / 2, cy = Math.floor(i / COLS) * H + 120;
    ctx.save(); ctx.translate(cx, cy);
    draw(ctx, it, i);
    ctx.restore();
    ctx.fillStyle = dark ? "#f3ecdc" : "#3a2a1a"; ctx.font = "700 12px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(it, cx, cy + 40);
  });
}

function paint() {
  sheet(document.getElementById("styles"), STYLES, (ctx, style, i) => {
    drawBuilding(ctx, { style, h, pal: (i * 5) % 16, seed: 100 + i * 37, parts: [] }, { dark });
  });
  sheet(document.getElementById("parts"), PARTS, (ctx, part, i) => {
    drawBuilding(ctx, { style: "house", h: 4, pal: (i * 3) % 16, seed: 7, parts: [{ part, side: "s", h: 5 }] }, { dark });
  });
}
paint();
onTheme((d) => { dark = d; paint(); }); // the Menu switches Day and Night: draw the tiles again
