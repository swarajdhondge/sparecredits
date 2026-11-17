// Seeded procedural building generator. Same recipe (style, h, pal, seed, parts) always draws the same building.
// Origin (0,0) is the centre of the tile on the ground. u,v are cell units (-0.5..0.5), z is pixels up.
import { fillTemplate, parseShapes, readPicture, MAX_SHAPES_CELL } from "../kit.js";

export const PAL = [
  ["#ffd9a8", "#e8704f", "#fff4e0", "#c2452d"], // sunrise
  ["#cdeedc", "#4f9e86", "#f4fff9", "#2f6f5c"], // mint
  ["#e0d4f5", "#8a6fc7", "#faf6ff", "#5a3f9e"], // lavender
  ["#c8694f", "#5b3a35", "#f1d9c6", "#3b2420"], // brick
  ["#f0deb4", "#b5834f", "#fff8e6", "#7a5230"], // sand
  ["#cfe6fb", "#4d7fc4", "#f6fbff", "#2d4f8f"], // sky
  ["#f9cfd8", "#cf5c7c", "#fff2f5", "#8f2f4c"], // rose
  ["#b9d6a4", "#3f7a45", "#f3fbea", "#28532d"], // forest
  ["#a9dde0", "#2a7f93", "#effcfd", "#17546a"], // ocean
  ["#c9a0c7", "#6e3a6e", "#f7e9f6", "#43203f"], // plum
  ["#fbe08a", "#d28a21", "#fff9dc", "#8f5a10"], // honey
  ["#b6bcc9", "#4a5163", "#eef0f5", "#2c3240"], // slate
  ["#ffb3a1", "#d9503d", "#fff0ec", "#962d20"], // coral
  ["#f5f7fa", "#7c93b8", "#ffffff", "#4a5d80"], // snow
  ["#e6c553", "#8a6a1e", "#fff6cc", "#5a4410"], // mustard
  ["#5a5f96", "#262a54", "#c9ccf0", "#f2c14e"], // midnight
];

export const TEAM_COLORS = { claude: "#d9774a", chatgpt: "#3aa07a", gemini: "#4b7bdc", other: "#8a6fc7" };

// kind: how the body is built. hm: height multiplier. w,d: footprint in cell units.
const STYLE = {
  cottage:    { kind: "box", w: 0.5, d: 0.46, hm: 0.75, roof: "gable", rh: 0.6, chimney: 1, door: 1, flowers: 1 },
  house:      { kind: "box", w: 0.56, d: 0.5, hm: 0.9, roof: "gable", rh: 0.55, chimney: 0.6, door: 1 },
  townhouse:  { kind: "box", w: 0.4, d: 0.5, hm: 1.15, roof: "gable", rh: 0.7, chimney: 0.5, door: 1, cols: 2 },
  shop:       { kind: "box", w: 0.62, d: 0.5, hm: 0.8, roof: "flat", awning: 1, door: 1, shopfront: 1 },
  bakery:     { kind: "box", w: 0.52, d: 0.5, hm: 0.85, roof: "gable", rh: 0.5, awning: 1, chimney: 1, smoke: 1, door: 1 },
  inn:        { kind: "box", w: 0.66, d: 0.52, hm: 1.0, roof: "hip", rh: 0.5, chimney: 1, hangSign: 1, door: 1, cols: 3 },
  cabin:      { kind: "box", w: 0.5, d: 0.44, hm: 0.7, roof: "gable", rh: 0.45, chimney: 1, logs: 1, door: 1, stoneChimney: 1 },
  barn:       { kind: "box", w: 0.64, d: 0.52, hm: 0.85, roof: "gable", rh: 0.7, barnDoor: 1, wallOverride: "#c0533f", trimOverride: "#fbeee0" },
  farmhouse:  { kind: "box", w: 0.54, d: 0.46, hm: 0.85, roof: "gable", rh: 0.55, chimney: 1, door: 1, silo: 1 },
  tower:      { kind: "round", r: 0.2, hm: 1.55, roof: "cone", rh: 0.9, slits: 1, door: 1 },
  lighthouse: { kind: "round", r: 0.19, hm: 1.8, roof: "dome", rh: 0.3, stripes: 1, lamp: 1, door: 1 },
  windmill:   { kind: "round", r: 0.2, hm: 1.2, taper: 0.6, roof: "cone", rh: 0.45, sails: 1, door: 1 },
  castle:     { kind: "box", w: 0.7, d: 0.7, hm: 1.1, roof: "crenel", turrets: 1, gate: 1, cols: 3 },
  chapel:     { kind: "box", w: 0.4, d: 0.62, hm: 1.0, roof: "gable", axis: "v", rh: 0.65, belfry: 1, door: 1, arched: 1 },
  pagoda:     { kind: "pagoda", w: 0.46, hm: 1.0 },
  temple:     { kind: "box", w: 0.68, d: 0.56, hm: 0.8, roof: "gable", axis: "u", rh: 0.35, columns: 1, steps: 1 },
  dome:       { kind: "round", r: 0.3, hm: 0.7, roof: "dome", rh: 0.55, door: 1, bandWindows: 1 },
  hall:       { kind: "box", w: 0.76, d: 0.52, hm: 0.9, roof: "hip", rh: 0.35, cols: 4, door: 1, centerGable: 1 },
  workshop:   { kind: "box", w: 0.62, d: 0.5, hm: 0.8, roof: "saw", chimney: 1, smoke: 1, door: 1, cols: 2 },
  factory:    { kind: "box", w: 0.72, d: 0.52, hm: 1.0, roof: "saw", stacks: 1, smoke: 1, door: 1, cols: 3, wallDeep: 1 },
  greenhouse: { kind: "box", w: 0.62, d: 0.48, hm: 0.55, roof: "glass", glass: 1 },
  treehouse:  { kind: "tree" },
  tent:       { kind: "tent", r: 0.3 },
  igloo:      { kind: "igloo", r: 0.3 },
  // v2: drawn by their own functions (see SPECIAL). plinth:false = no stone slab under it.
  ship: { kind: "special", plinth: false }, dock: { kind: "special", plinth: false }, statue: { kind: "special" }, arch: { kind: "special" },
  gate: { kind: "special" }, wall: { kind: "special" }, bridge: { kind: "special", plinth: false }, fountain: { kind: "special" },
  plot: { kind: "special", plinth: false }, park: { kind: "special", plinth: false }, stadium: { kind: "special" }, observatory: { kind: "special" },
  museum: { kind: "special" }, school: { kind: "special" }, stall: { kind: "special" }, ruins: { kind: "special", plinth: false },
  crystal: { kind: "special" }, rocket: { kind: "special", plinth: false },
};

let c, dark, rng;
let lineW = 1; // world px of the ink line: about 1 screen px at any zoom
let outline = null; // the ink colour of kit shapes (free builds), from the --outline token; null = the old thin line of B buildings
let nightLight = "#ffd66e"; // the --night-light token: lit windows

function mulberry(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const cl = (v) => Math.max(0, Math.min(255, v | 0));
function shade(h, f) {
  let [r, g, b] = hex(h);
  if (dark) { r *= 0.62; g *= 0.66; b *= 0.86; }
  return `rgb(${cl(r * f)},${cl(g * f)},${cl(b * f)})`;
}
const faces = (h) => ({ top: shade(h, 1.1), left: shade(h, 1), right: shade(h, 0.78) });
const OW = () => (outline ? lineW : 0.8); // line width of the ink
const OUT = () => outline || (dark ? "rgba(0,0,0,0.45)" : "rgba(60,40,30,0.28)");

const P = (u, v, z) => [(u - v) * 32, (u + v) * 16 - z];

function poly(pts, fill, line = true) {
  c.beginPath();
  pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
  c.fillStyle = fill;
  c.fill();
  if (line) { c.strokeStyle = OUT(); c.lineWidth = OW(); c.lineJoin = "round"; c.stroke(); }
}

function box(u0, v0, u1, v1, z0, z1, col) {
  poly([P(u0, v1, z0), P(u1, v1, z0), P(u1, v1, z1), P(u0, v1, z1)], col.left);
  poly([P(u1, v1, z0), P(u1, v0, z0), P(u1, v0, z1), P(u1, v1, z1)], col.right);
  poly([P(u0, v0, z1), P(u1, v0, z1), P(u1, v1, z1), P(u0, v1, z1)], col.top);
}

// quads on the two visible faces of box b. L = face at v1, R = face at u1.
const Lq = (b, k0, k1, z0, z1) => { const a = b.u0 + (b.u1 - b.u0) * k0, e = b.u0 + (b.u1 - b.u0) * k1; return [P(a, b.v1, z0), P(e, b.v1, z0), P(e, b.v1, z1), P(a, b.v1, z1)]; };
const Rq = (b, k0, k1, z0, z1) => { const a = b.v1 - (b.v1 - b.v0) * k0, e = b.v1 - (b.v1 - b.v0) * k1; return [P(b.u1, a, z0), P(b.u1, e, z0), P(b.u1, e, z1), P(b.u1, a, z1)]; };
const faceQ = (face, b, k0, k1, z0, z1) => (face === "L" ? Lq(b, k0, k1, z0, z1) : Rq(b, k0, k1, z0, z1));

function glassColor(lit) {
  if (dark) return lit ? nightLight : "#3a4666";
  return lit ? "#fff0b8" : "#a9d6f0";
}

function windowQ(q, trim, lit, round) {
  if (round) {
    const cx = (q[0][0] + q[1][0]) / 2, cy = (q[0][1] + q[2][1]) / 2;
    c.beginPath(); c.ellipse(cx, cy, 3, 3.6, 0, 0, 7); c.fillStyle = glassColor(lit); c.fill();
    c.strokeStyle = shade(trim, 1); c.lineWidth = 1; c.stroke();
    return;
  }
  poly(q, glassColor(lit), false);
  c.strokeStyle = shade(trim, 1); c.lineWidth = 1.1;
  c.beginPath(); q.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke();
  c.lineWidth = 0.6;
  c.beginPath();
  c.moveTo((q[0][0] + q[1][0]) / 2, (q[0][1] + q[1][1]) / 2);
  c.lineTo((q[3][0] + q[2][0]) / 2, (q[3][1] + q[2][1]) / 2);
  c.stroke();
}

function windows(b, H, o) {
  const rows = o.rows, trim = o.trim;
  for (const face of ["L", "R"]) {
    const cols = face === "L" ? o.colsL : o.colsR;
    for (let f = 0; f < rows; f++) {
      const fh = (H - 6) / rows;
      const zc = 6 + fh * (f + 0.5);
      const wh = Math.min(10, fh * 0.55);
      for (let k = 0; k < cols; k++) {
        const kc = (k + 0.5) / cols;
        if (f === 0 && face === o.doorFace && o.door && Math.abs(kc - 0.5) < 0.5 / cols + 0.02) continue;
        if (o.shopfront && f === 0) continue;
        const kw = Math.min(0.2, 0.55 / cols / 1.6);
        const lit = rng() < (dark ? 0.7 : 0.25);
        const q = faceQ(face, b, kc - kw, kc + kw, zc - wh / 2, zc + wh / 2);
        if (o.slits) { windowQ(faceQ(face, b, kc - 0.04, kc + 0.04, zc - wh / 2, zc + wh / 2), trim, lit, false); continue; }
        windowQ(q, trim, lit, o.round);
        if (o.shutters) {
          poly(faceQ(face, b, kc - kw - 0.07, kc - kw - 0.01, zc - wh / 2, zc + wh / 2), shade(o.accent, 1), false);
          poly(faceQ(face, b, kc + kw + 0.01, kc + kw + 0.07, zc - wh / 2, zc + wh / 2), shade(o.accent, 1), false);
        }
      }
    }
  }
}

function door(b, face, accent, trim, H, arched, big) {
  const dh = Math.min(big ? 20 : 14, H * 0.55);
  const w = big ? 0.2 : 0.13;
  const q = faceQ(face, b, 0.5 - w, 0.5 + w, 0, dh);
  poly(q, shade(accent, 1));
  const q2 = faceQ(face, b, 0.5 - w - 0.03, 0.5 + w + 0.03, dh, dh + 1.8);
  poly(q2, shade(trim, 1), false);
  const kx = (q[1][0] * 0.65 + q[0][0] * 0.35), ky = (q[0][1] + q[3][1]) / 2;
  c.fillStyle = shade("#f6d56a", 1); c.beginPath(); c.arc(kx, ky + 0.5, 0.9, 0, 7); c.fill();
}

function awning(b, face, z, accent, trim, depth = 0.1) {
  // striped awning sticking out of a face
  const n = 6;
  for (let i = 0; i < n; i++) {
    const k0 = 0.1 + (0.8 * i) / n, k1 = 0.1 + (0.8 * (i + 1)) / n;
    const col = i % 2 ? trim : accent;
    const a = faceQ(face, b, k0, k1, z - 1, z + 3);
    const o = face === "L" ? [0.0, depth] : [depth, 0.0];
    const q = [a[0], a[1], [a[1][0] + (o[0] - o[1]) * 32, a[1][1] + (o[0] + o[1]) * 16 + 4], [a[0][0] + (o[0] - o[1]) * 32, a[0][1] + (o[0] + o[1]) * 16 + 4]];
    poly([a[3], a[2], q[2], q[3]].reverse(), shade(col, i % 2 ? 1.05 : 0.95), false);
  }
}

function smoke(x, y, n = 3) {
  for (let i = 0; i < n; i++) {
    c.beginPath();
    c.arc(x + i * 2 - 1, y - 6 - i * 7, 2.6 + i * 1.3, 0, 7);
    c.fillStyle = dark ? `rgba(200,205,225,${0.35 - i * 0.08})` : `rgba(255,255,255,${0.85 - i * 0.2})`;
    c.fill();
  }
}

function chimney(u, v, z, h, col, withSmoke) {
  const s = 0.07;
  box(u - s, v - s, u + s, v + s, z, z + h, faces(col));
  box(u - s - 0.012, v - s - 0.012, u + s + 0.012, v + s + 0.012, z + h, z + h + 1.6, faces("#6f625c"));
  if (withSmoke) { const [x, y] = P(u, v, z + h + 2); smoke(x, y); }
}

function roofGable(b, z, rh, axis, col, ov, gableCol) {
  const um = (b.u0 + b.u1) / 2, vm = (b.v0 + b.v1) / 2;
  const top = z + rh;
  if (axis === "u") {
    // ridge runs along u at v = vm. Visible: front slope (toward +v) and the end gable at u1.
    poly([P(b.u1, b.v1, z), P(b.u1, b.v0, z), P(b.u1, vm, top)], gableCol);
    poly([P(b.u0 - ov, b.v1 + ov, z - 1), P(b.u1 + ov, b.v1 + ov, z - 1), P(b.u1 + ov, vm, top), P(b.u0 - ov, vm, top)], shade(col, 1.05));
    poly([P(b.u1 + ov, b.v1 + ov, z - 1), P(b.u1 + ov, b.v0 - ov, z - 1), P(b.u1 + ov, vm, top)].concat([]), shade(col, 0.75), false);
    c.strokeStyle = shade(col, 0.6); c.lineWidth = 1; c.beginPath(); const r0 = P(b.u0 - ov, vm, top), r1 = P(b.u1 + ov, vm, top); c.moveTo(...r0); c.lineTo(...r1); c.stroke();
  } else {
    poly([P(b.u0, b.v1, z), P(b.u1, b.v1, z), P(um, b.v1, top)], gableCol);
    poly([P(b.u1 + ov, b.v0 - ov, z - 1), P(b.u1 + ov, b.v1 + ov, z - 1), P(um, b.v1 + ov, top), P(um, b.v0 - ov, top)], shade(col, 0.8));
    poly([P(b.u0 - ov, b.v1 + ov, z - 1), P(b.u1 + ov, b.v1 + ov, z - 1), P(um, b.v1 + ov, top)], shade(col, 1.05), false);
    c.strokeStyle = shade(col, 0.6); c.lineWidth = 1; c.beginPath(); c.moveTo(...P(um, b.v0 - ov, top)); c.lineTo(...P(um, b.v1 + ov, top)); c.stroke();
  }
}

function roofPyr(b, z, rh, col, ov) {
  const um = (b.u0 + b.u1) / 2, vm = (b.v0 + b.v1) / 2;
  const apex = P(um, vm, z + rh);
  poly([P(b.u1 + ov, b.v0 - ov, z - 1), P(b.u1 + ov, b.v1 + ov, z - 1), apex], shade(col, 0.78));
  poly([P(b.u0 - ov, b.v1 + ov, z - 1), P(b.u1 + ov, b.v1 + ov, z - 1), apex], shade(col, 1.05));
}

function roofHip(b, z, rh, col, ov) {
  const um = (b.u0 + b.u1) / 2, vm = (b.v0 + b.v1) / 2;
  const lu = Math.max(0, (b.u1 - b.u0) / 2 - (b.v1 - b.v0) / 2);
  const a = P(um - lu, vm, z + rh), e = P(um + lu, vm, z + rh);
  poly([P(b.u1 + ov, b.v0 - ov, z - 1), P(b.u1 + ov, b.v1 + ov, z - 1), e], shade(col, 0.78));
  poly([P(b.u0 - ov, b.v1 + ov, z - 1), P(b.u1 + ov, b.v1 + ov, z - 1), e, a], shade(col, 1.05));
  poly([P(b.u1 + ov, b.v1 + ov, z - 1), P(b.u1 + ov, b.v0 - ov, z - 1), e], shade(col, 0.82), false);
}

function crenel(b, z, col) {
  const n = 5;
  for (let i = 0; i < n; i++) {
    const k = i / n, k2 = k + 0.5 / n;
    const u0 = b.u0 + (b.u1 - b.u0) * k, u1 = b.u0 + (b.u1 - b.u0) * k2;
    box(u0, b.v1 - 0.045, u1, b.v1, z, z + 5, faces(col));
  }
  for (let i = 0; i < n; i++) {
    const k = i / n, k2 = k + 0.5 / n;
    const v0 = b.v0 + (b.v1 - b.v0) * k, v1 = b.v0 + (b.v1 - b.v0) * k2;
    box(b.u1 - 0.045, v0, b.u1, v1, z, z + 5, faces(col));
  }
}

// ----- round things -----
function ell(x, y, rx, ry, fill, line = true) {
  c.beginPath(); c.ellipse(x, y, rx, ry, 0, 0, 7); c.fillStyle = fill; c.fill();
  if (line) { c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke(); }
}
function grad(x0, x1, base, f0 = 1.12, f1 = 0.72) {
  const g = c.createLinearGradient(x0, 0, x1, 0);
  g.addColorStop(0, shade(base, f0)); g.addColorStop(0.55, shade(base, 0.98)); g.addColorStop(1, shade(base, f1));
  return g;
}
function cyl(u, v, r, z0, z1, base, r1 = r) {
  const [x, y0] = P(u, v, z0), [, y1] = P(u, v, z1);
  const rx0 = r * 45.25, ry0 = r * 22.6, rx1 = r1 * 45.25, ry1 = r1 * 22.6;
  c.beginPath();
  c.moveTo(x - rx1, y1);
  c.lineTo(x - rx0, y0);
  c.ellipse(x, y0, rx0, ry0, 0, Math.PI, 0, true);
  c.lineTo(x + rx1, y1);
  c.ellipse(x, y1, rx1, ry1, 0, 0, Math.PI, false);
  c.closePath();
  c.fillStyle = grad(x - rx0, x + rx0, base); c.fill();
  c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
  ell(x, y1, rx1, ry1, shade(base, 1.12));
}
function cone(u, v, r, z, rh, base, ov = 0.03) {
  const [x, y] = P(u, v, z);
  const rx = (r + ov) * 45.25, ry = (r + ov) * 22.6;
  c.beginPath();
  c.moveTo(x - rx, y); c.lineTo(x, y - rh); c.lineTo(x + rx, y);
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI, false);
  c.closePath();
  c.fillStyle = grad(x - rx, x + rx, base, 1.15, 0.7); c.fill();
  c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
}
function domeShape(u, v, r, z, rh, base) {
  const [x, y] = P(u, v, z);
  const rx = r * 45.25, ry = r * 22.6;
  c.beginPath();
  c.ellipse(x, y, rx, rh, 0, Math.PI, 2 * Math.PI, false);
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI, false);
  c.closePath();
  c.fillStyle = grad(x - rx, x + rx, base, 1.18, 0.7); c.fill();
  c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
}
function roundWindows(u, v, r, H, rows, trim, slits, rngf) {
  const [x, y0] = P(u, v, 0);
  const rx = r * 45.25, ry = r * 22.6;
  for (let f = 0; f < rows; f++) {
    const z = 8 + ((H - 10) / rows) * (f + 0.5);
    for (const a of [Math.PI * 0.38, Math.PI * 0.72]) {
      if (f === 0 && a < 2) continue;
      const wx = x + Math.cos(a) * rx * 0.95, wy = y0 - z + Math.sin(a) * ry * 0.95;
      const lit = rngf() < (dark ? 0.7 : 0.25);
      c.fillStyle = glassColor(lit);
      c.strokeStyle = shade(trim, 1); c.lineWidth = 0.9;
      c.beginPath();
      if (slits) c.rect(wx - 1.2, wy - 4, 2.4, 8); else c.ellipse(wx, wy, 2.6, 3.4, 0, 0, 7);
      c.fill(); c.stroke();
    }
  }
}

function flag(x, y, h, col) {
  c.strokeStyle = shade("#5a4a40", 1); c.lineWidth = 1.2;
  c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - h); c.stroke();
  poly([[x, y - h], [x + 9, y - h + 3.2], [x, y - h + 6.4]], shade(col, 1));
}

function treeAt(u, v, s, kind, col2) {
  const [x, y] = P(u, v, 0);
  c.fillStyle = shade("#7a5a3a", 1); c.fillRect(x - 1.6 * s, y - 9 * s, 3.2 * s, 9 * s);
  const g = shade(col2 || "#5fae62", 1);
  if (kind === 1) {
    for (let i = 0; i < 3; i++) poly([[x - (11 - i * 2.5) * s, y - (7 + i * 7) * s], [x + (11 - i * 2.5) * s, y - (7 + i * 7) * s], [x, y - (20 + i * 7) * s]], shade(col2 || "#3f8f58", 1 - i * 0.07));
  } else {
    ell(x - 4 * s, y - 14 * s, 7.5 * s, 7 * s, shade(col2 || "#4f9e5a", 0.9));
    ell(x + 4 * s, y - 14 * s, 7.5 * s, 7 * s, shade(col2 || "#4f9e5a", 0.82));
    ell(x, y - 19 * s, 8.5 * s, 8 * s, g);
  }
}

// ----- styles -----
function bodyHeight(st, h) { return (10 + h * 5.5) * st.hm; }

function drawBoxBuilding(st, spec, o) {
  const { h, rr, wall, roofC, trim, accent } = o;
  const w = st.w + (rr() - 0.5) * 0.06, d = st.d + (rr() - 0.5) * 0.06;
  const b = { u0: -w / 2, u1: w / 2, v0: -d / 2, v1: d / 2 };
  const H = bodyHeight(st, h);
  const wallC = st.wallOverride || wall;
  const trimC = st.trimOverride || trim;
  const wf = faces(wallC);
  const axis = st.axis || (rr() < 0.5 ? "u" : "v");
  box(b.u0, b.v0, b.u1, b.v1, 0, H, wf);
  // wall decoration
  if (st.logs) {
    for (let z = 4; z < H; z += 5) { for (const q of [Lq(b, 0, 1, z, z + 0.8), Rq(b, 0, 1, z, z + 0.8)]) poly(q, shade("#5a3b22", 0.9), false); }
  }
  if (st.wallDeep || st.brick) { for (let z = 6; z < H; z += 9) for (const q of [Lq(b, 0, 1, z, z + 0.6), Rq(b, 0, 1, z, z + 0.6)]) poly(q, shade(wallC, 0.7), false); }
  if (rr() < 0.55 && !st.logs && H > 28) { // trim band between floors
    const zb = H * 0.5;
    for (const q of [Lq(b, 0, 1, zb, zb + 2), Rq(b, 0, 1, zb, zb + 2)]) poly(q, shade(trimC, 1), false);
  }
  // corner posts
  c.strokeStyle = shade(trimC, 1); c.lineWidth = 1.3; c.beginPath(); c.moveTo(...P(b.u1, b.v1, 0)); c.lineTo(...P(b.u1, b.v1, H)); c.stroke();
  const rows = Math.max(1, Math.round(H / 24));
  const cols = (st.cols || 1 + Math.round(rr() * 1)) ;
  const doorFace = rr() < 0.5 ? "L" : "R";
  windows(b, H, { rows, colsL: Math.max(1, Math.round(cols * (w / 0.55))), colsR: Math.max(1, Math.round(cols * (d / 0.55))), trim: trimC, accent, door: st.door || st.gate || st.barnDoor, doorFace, shopfront: st.shopfront, shutters: !st.shopfront && rr() < 0.5, round: st.arched });
  if (st.shopfront) {
    for (const f of ["L", "R"]) poly(faceQ(f, b, 0.12, 0.88, 3, Math.min(16, H * 0.5)), glassColor(dark), true);
  }
  if (st.door) door(b, doorFace, accent, trimC, H, st.arched);
  if (st.gate) door(b, doorFace, "#4a3b33", trimC, H, true, true);
  if (st.barnDoor) {
    const q = faceQ(doorFace, b, 0.3, 0.7, 0, Math.min(24, H * 0.7));
    poly(q, shade("#fbeee0", 1)); c.strokeStyle = shade("#c0533f", 1); c.lineWidth = 1;
    c.beginPath(); c.moveTo(...q[0]); c.lineTo(...q[2]); c.moveTo(...q[1]); c.lineTo(...q[3]); c.stroke();
  }
  if (st.flowers && rr() < 0.8) {
    const [x, y] = P(b.u0 + 0.12, b.v1 + 0.03, 4);
    for (let i = 0; i < 4; i++) { c.fillStyle = shade(["#ff7a8a", "#ffd166", "#ff9ecb", "#fff"][i % 4], 1); c.beginPath(); c.arc(x + i * 3.6, y + i * 1.8, 1.5, 0, 7); c.fill(); }
  }
  if (st.awning) awning(b, doorFace, Math.min(18, H * 0.55), accent, "#ffffff", 0.1);
  if (st.columns) {
    for (let i = 0; i < 5; i++) { const k = 0.1 + i * 0.2; const [x, y0] = P(b.u0 + (b.u1 - b.u0) * k, b.v1 + 0.03, 0); c.fillStyle = shade("#fff6e8", 1); c.fillRect(x - 1.7, y0 - H + 2, 3.4, H - 2); c.fillStyle = shade("#e8d9c0", 1); c.fillRect(x - 2.5, y0 - H, 5, 2.4); }
    box(b.u0 - 0.02, b.v1, b.u1, b.v1 + 0.05, 0, 3, faces("#e8d9c0"));
  }
  if (st.steps) { for (let i = 0; i < 3; i++) box(b.u0 + 0.1 + i * 0.03, b.v1 + 0.05 + i * 0.03, b.u1 - 0.1 - i * 0.03, b.v1 + 0.1 + i * 0.03, 0, 3 - i, faces("#efe3cf")); }
  if (st.hangSign) {
    const [x, y] = P(b.u1 + 0.02, b.v1 - 0.12, H * 0.62);
    c.strokeStyle = shade("#4a3b33", 1); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + 8, y - 2); c.stroke();
    c.fillStyle = shade("#b27a45", 1); c.fillRect(x + 3, y - 2, 9, 7); c.strokeStyle = shade("#6b4524", 1); c.strokeRect(x + 3, y - 2, 9, 7);
  }
  // roof
  const ov = 0.035;
  let top = H;
  const rh = (st.rh || 0.5) * (18 + h * 1.1);
  if (st.roof === "gable") { roofGable(b, H, rh, axis, roofC, ov, shade(wallC, axis === "u" ? 0.8 : 1)); top = H + rh; }
  else if (st.roof === "hip") { roofHip(b, H, rh, roofC, ov); top = H + rh; }
  else if (st.roof === "flat") {
    box(b.u0 - 0.02, b.v0 - 0.02, b.u1 + 0.02, b.v1 + 0.02, H, H + 3, faces(roofC));
  } else if (st.roof === "crenel") {
    box(b.u0 - 0.015, b.v0 - 0.015, b.u1 + 0.015, b.v1 + 0.015, H, H + 3, faces(roofC));
    crenel({ u0: b.u0, u1: b.u1, v0: b.v0, v1: b.v1 }, H + 3, wallC);
    top = H + 8;
  } else if (st.roof === "saw") {
    box(b.u0 - 0.015, b.v0 - 0.015, b.u1 + 0.015, b.v1 + 0.015, H, H + 2, faces(roofC));
    const n = 3;
    for (let i = 0; i < n; i++) {
      const u0 = b.u0 + ((b.u1 - b.u0) * i) / n, u1 = b.u0 + ((b.u1 - b.u0) * (i + 1)) / n;
      const zz = H + 2;
      poly([P(u1, b.v1, zz), P(u1, b.v0, zz), P(u1, b.v0, zz + 10)].concat([]), shade(roofC, 0.75), false);
      poly([P(u0, b.v1, zz), P(u1, b.v1, zz), P(u1, b.v1, zz + 10)], shade(roofC, 1.12));
      poly([P(u1, b.v1, zz + 10), P(u1, b.v0, zz + 10), P(u1, b.v0, zz), P(u1, b.v1, zz)], shade("#bfe2f5", 1), false);
    }
    top = H + 12;
  } else if (st.roof === "glass") {
    const hg = 12;
    poly([P(b.u1, b.v1, H), P(b.u1, b.v0, H), P(b.u1, (b.v0 + b.v1) / 2, H + hg)], dark ? "rgba(120,170,190,0.5)" : "rgba(190,232,244,0.75)");
    poly([P(b.u0, b.v1, H), P(b.u1, b.v1, H), P(b.u1, (b.v0 + b.v1) / 2, H + hg), P(b.u0, (b.v0 + b.v1) / 2, H + hg)], dark ? "rgba(140,190,210,0.55)" : "rgba(210,242,252,0.8)");
    top = H + hg;
  }
  // chimney
  if (st.chimney && rr() < (st.chimney === 1 ? 0.9 : st.chimney)) {
    const cu = b.u0 + (b.u1 - b.u0) * (0.2 + rr() * 0.2), cv = b.v0 + (b.v1 - b.v0) * (0.25 + rr() * 0.3);
    const zc = st.roof === "gable" ? H + (axis === "u" ? rh * 0.55 : rh * 0.45) : H + 1;
    chimney(cu, cv, zc, 11 + rr() * 5, st.stoneChimney ? "#8c8680" : trimC === wall ? "#b8654b" : "#b8654b", st.smoke || rr() < 0.4);
  }
  if (st.stacks) {
    chimney(b.u0 + 0.14, b.v0 + 0.13, H + 2, 26, "#9b6b5a", true);
    chimney(b.u0 + 0.3, b.v0 + 0.1, H + 2, 20, "#9b6b5a", true);
  } else if (st.smoke && !st.chimney) { /* none */ }
  if (st.turrets) {
    for (const [u, v] of [[b.u0 + 0.02, b.v0 + 0.02], [b.u1 - 0.02, b.v0 + 0.02], [b.u1 - 0.02, b.v1 - 0.02], [b.u0 + 0.02, b.v1 - 0.02]]) {
      cyl(u, v, 0.1, 0, H + 12, shade(wallC, 1) && wallC);
      cone(u, v, 0.1, H + 12, 14, roofC);
    }
    flag(...P((b.u0 + b.u1) / 2, (b.v0 + b.v1) / 2, H + 3), 18, accent);
    top = H + 24;
  }
  if (st.belfry) {
    const u = (b.u0 + b.u1) / 2, v = b.v0 + 0.14;
    box(u - 0.07, v - 0.07, u + 0.07, v + 0.07, H + 4, H + 20, faces(wallC));
    roofPyr({ u0: u - 0.07, u1: u + 0.07, v0: v - 0.07, v1: v + 0.07 }, H + 20, 16, roofC, 0.02);
    const [x, y] = P(u, v, H + 38); c.strokeStyle = shade(trimC, 1); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 6); c.moveTo(x - 2, y - 4); c.lineTo(x + 2, y - 4); c.stroke();
    top = H + 44;
  }
  if (st.silo) {
    cyl(b.u1 + 0.04 > 0.4 ? 0.36 : b.u1 + 0.1, b.v0 - 0.02 < -0.4 ? -0.34 : b.v0 + 0.1, 0.1, 0, H + 14, "#d8d8dc");
    domeShape(b.u1 + 0.04 > 0.4 ? 0.36 : b.u1 + 0.1, b.v0 - 0.02 < -0.4 ? -0.34 : b.v0 + 0.1, 0.1, H + 14, 8, "#c0533f");
  }
  if (st.centerGable) {
    const um = (b.u0 + b.u1) / 2;
    const bb = { u0: um - 0.12, u1: um + 0.12, v0: b.v1 - 0.01, v1: b.v1 + 0.04 };
    box(bb.u0, bb.v0, bb.u1, bb.v1, 0, H + 8, faces(trimC));
    roofPyr({ u0: bb.u0, u1: bb.u1, v0: bb.v0, v1: bb.v1 }, H + 8, 12, roofC, 0.015);
  }
  return { b, H, top };
}

function drawRoundBuilding(st, spec, o) {
  const { h, rr, wall, roofC, trim, accent } = o;
  const r = st.r + (rr() - 0.5) * 0.03;
  const H = bodyHeight(st, h);
  const rTop = r * (st.taper || 1);
  // base ring
  if (st.stripes) {
    const n = Math.max(3, Math.round(H / 12));
    for (let i = 0; i < n; i++) {
      const z0 = (H * i) / n, z1 = (H * (i + 1)) / n;
      const k0 = 1 - (1 - 0.8) * (i / n), k1 = 1 - (1 - 0.8) * ((i + 1) / n);
      cyl(0, 0, r * k0, z0, z1 + 0.5, i % 2 ? accent : "#ffffff", r * k1);
    }
  } else {
    cyl(0, 0, r, 0, H, wall, rTop);
  }
  if (st.bandWindows) {
    const [x, y] = P(0, 0, H * 0.5);
    for (let i = 0; i < 5; i++) { const a = Math.PI * (0.12 + 0.19 * i); c.fillStyle = glassColor(!dark ? false : rr() < 0.8); c.fillRect(x + Math.cos(a) * r * 45 * 0.95 - 2, y + Math.sin(a) * r * 22 * 0.95 - 4, 4, 8); }
    box(-0.02, r - 0.02, 0.02, r + 0.07, 0, 8, faces(trim));
  }
  if (!st.stripes && !st.bandWindows) roundWindows(0, 0, r, H, Math.max(1, Math.round(H / 26)), trim, st.slits, rr);
  if (st.stripes) roundWindows(0, 0, r * 0.9, H, 2, trim, true, rr);
  if (st.door) { const [x, y] = P(0.0, 0.0, 0); c.fillStyle = shade(accent, 1); c.beginPath(); c.moveTo(x - 4, y + r * 22.6 - 0.5); c.lineTo(x - 4, y + r * 22.6 - 10); c.arc(x, y + r * 22.6 - 10, 4, Math.PI, 0); c.lineTo(x + 4, y + r * 22.6 - 0.5); c.fill(); }
  if (st.lamp) {
    cyl(0, 0, r * 0.62, H, H + 12, "#ffffff", r * 0.62);
    const [x, y] = P(0, 0, H + 6);
    c.fillStyle = dark ? "#ffe27a" : "#fff2b0"; c.beginPath(); c.ellipse(x, y, r * 24, 4.5, 0, 0, 7); c.fill();
    if (dark) { const g = c.createRadialGradient(x, y, 2, x, y, 55); g.addColorStop(0, "rgba(255,230,120,0.5)"); g.addColorStop(1, "rgba(255,230,120,0)"); c.fillStyle = g; c.fillRect(x - 55, y - 55, 110, 110); }
    domeShape(0, 0, r * 0.7, H + 12, 9, roofC);
    return { H, top: H + 28, r };
  }
  if (st.roof === "cone") { cone(0, 0, rTop, H, st.rh * 40, roofC, 0.05); }
  else if (st.roof === "dome") { domeShape(0, 0, rTop, H, st.rh * 60, roofC); }
  if (st.sails) {
    const [x, y] = P(0, 0, H * 0.82);
    const base = (rr() * Math.PI) / 2;
    c.save(); c.translate(x, y + 4);
    for (let i = 0; i < 4; i++) {
      c.save(); c.rotate(base + (i * Math.PI) / 2);
      c.fillStyle = shade("#fff6e8", 1); c.strokeStyle = shade("#8a6a4a", 1); c.lineWidth = 1;
      c.beginPath(); c.rect(2, -3, 26, 6); c.fill(); c.stroke();
      c.beginPath(); c.moveTo(2, 0); c.lineTo(28, 0); c.stroke();
      c.restore();
    }
    ell(0, 0, 2.5, 2.5, shade("#8a6a4a", 1));
    c.restore();
  }
  return { H, top: H + (st.rh || 0.3) * 40, r };
}

function drawPagoda(st, spec, o) {
  const { h, wall, roofC, trim, accent } = o;
  const tiers = Math.max(2, Math.min(5, 2 + Math.floor(h / 3)));
  let z = 0;
  const step = (14 + h * 3) * 0.5 + 6;
  for (let i = 0; i < tiers; i++) {
    const s = (st.w - i * 0.06);
    const b = { u0: -s / 2, u1: s / 2, v0: -s / 2, v1: s / 2 };
    const bh = step;
    box(b.u0, b.v0, b.u1, b.v1, z, z + bh, faces(wall));
    for (const f of ["L", "R"]) { windowQ(faceQ(f, b, 0.38, 0.62, z + bh * 0.3, z + bh * 0.75), trim, dark, false); }
    // flared eave
    const e = s / 2 + 0.07;
    const zz = z + bh;
    poly([P(e, -e, zz), P(e, e, zz), P(0, 0, zz + 9), P(e - 0.02, -e + 0.02, zz + 2.5)].slice(0, 3), shade(roofC, 0.75));
    poly([P(-e, e, zz), P(e, e, zz), P(0, 0, zz + 9)], shade(roofC, 1.05));
    c.strokeStyle = shade(roofC, 0.6); c.lineWidth = 0.9; c.beginPath(); c.moveTo(...P(-e, e, zz)); c.lineTo(...P(e, e, zz)); c.lineTo(...P(e, -e, zz)); c.stroke();
    z = zz + 6;
  }
  const [x, y] = P(0, 0, z + 2);
  c.strokeStyle = shade(accent, 1); c.lineWidth = 1.6; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 14); c.stroke();
  ell(x, y - 8, 2.6, 1.4, shade("#f2c14e", 1), false);
  return { H: z, top: z + 14 };
}

function drawTreehouse(st, spec, o) {
  const { h, rr, wall, roofC, trim, accent } = o;
  const th = 18 + h * 7;
  cyl(0, 0, 0.07, 0, th, "#8a5f3a");
  // lower canopy
  for (const [dx, dy, r] of [[-14, th * 0.1, 15], [14, th * 0.05, 15], [0, th * 0.18, 17]]) ell(dx, -th * 0.7 + dy, r, r * 0.8, shade("#4f9e5a", 0.85));
  const b = { u0: -0.14, u1: 0.14, v0: -0.12, v1: 0.12 };
  const z0 = th;
  box(b.u0 - 0.05, b.v0 - 0.05, b.u1 + 0.05, b.v1 + 0.05, z0 - 3, z0, faces("#a8794a"));
  box(b.u0, b.v0, b.u1, b.v1, z0, z0 + 16, faces(wall));
  windowQ(faceQ("L", b, 0.3, 0.7, z0 + 5, z0 + 12), trim, dark, false);
  poly(faceQ("R", b, 0.3, 0.7, z0, z0 + 11), shade(accent, 1));
  roofPyr(b, z0 + 16, 12, roofC, 0.03);
  ell(-16, -z0 - 6, 11, 9, shade("#5fae62", 1));
  ell(16, -z0 - 4, 11, 9, shade("#4f9e5a", 0.9));
  return { H: z0 + 16, top: z0 + 32 };
}

function drawTent(st, spec, o) {
  const { h, accent, wall, roofC } = o;
  const H = 12 + h * 3, r = st.r;
  const n = 8;
  cyl(0, 0, r, 0, H, wall);
  // stripes on wall
  const [x, y0] = P(0, 0, 0);
  const rx = r * 45.25, ry = r * 22.6;
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a0 = (Math.PI * i) / n, a1 = (Math.PI * (i + 1)) / n;
    c.beginPath();
    c.ellipse(x, y0, rx, ry, 0, a0, a1, false);
    c.lineTo(x + Math.cos(a1) * rx, y0 - H + Math.sin(a1) * ry); c.ellipse(x, y0 - H, rx, ry, 0, a1, a0, true); c.closePath();
    c.fillStyle = shade(accent, 1); c.fill();
  }
  const [, ytop] = P(0, 0, H);
  const rh = 22 + h * 3;
  c.beginPath();
  c.moveTo(x - rx - 3, ytop); c.lineTo(x, ytop - rh); c.lineTo(x + rx + 3, ytop); c.ellipse(x, ytop, rx + 3, ry + 1.5, 0, 0, Math.PI, false); c.closePath();
  c.fillStyle = grad(x - rx, x + rx, roofC, 1.1, 0.75); c.fill(); c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
  for (let i = 0; i < n; i++) {
    if (i % 2) continue;
    const a0 = (Math.PI * i) / n, a1 = (Math.PI * (i + 1)) / n;
    c.beginPath(); c.moveTo(x, ytop - rh);
    c.lineTo(x + Math.cos(a0) * (rx + 3), ytop + Math.sin(a0) * (ry + 1.5));
    c.lineTo(x + Math.cos(a1) * (rx + 3), ytop + Math.sin(a1) * (ry + 1.5)); c.closePath();
    c.fillStyle = shade(accent, 1); c.fill();
  }
  poly([[x - 5, y0 - 0.5], [x + 5, y0 - 0.5 + 0], [x, y0 - 13]].slice(0, 0), "#0000", false);
  flag(x, ytop - rh, 13, accent);
  return { H: H, top: H + rh + 14, r };
}

function drawIgloo(st, spec, o) {
  const { h, wall, trim } = o;
  const r = st.r, rh = 20 + h * 3.5;
  domeShape(0, 0, r, 0, rh, "#eef6fb");
  const [x, y] = P(0, 0, 0);
  const rx = r * 45.25;
  c.strokeStyle = dark ? "rgba(120,150,190,0.7)" : "rgba(130,170,205,0.7)"; c.lineWidth = 0.8;
  for (let i = 1; i < 4; i++) { c.beginPath(); c.ellipse(x, y - rh * (i / 4) * 0.55, rx * Math.sqrt(1 - (i / 4) ** 2 * 0.9), (r * 22.6) * (1 - i / 5) , 0, 0.1, Math.PI - 0.1); c.stroke(); }
  // tunnel entrance
  box(0.02, r * 0.45, 0.22, r * 0.8 + 0.1, 0, 10, faces("#dcebf5"));
  poly(Lq({ u0: 0.02, u1: 0.22, v0: r * 0.45, v1: r * 0.8 + 0.1 }, 0.25, 0.75, 0, 7), shade("#3a4a63", 1));
  return { H: rh, top: rh + 4, r };
}

// ----- v2 styles: each has its own look, drawn by one small function -----
// tint() gives a hex colour (what box/faces/cyl expect). shade() gives the final rgb fill, with the dark-mode dimming.
const tint = (hx, f) => `#${hex(hx).map((v) => cl(v * f).toString(16).padStart(2, "0")).join("")}`;
const stoneOf = (o, f = 1) => tint("#cfcac0", f);
const waterC = () => (dark ? "#35557e" : "#7cc5ec");
const waterHi = () => (dark ? "#6fa0d0" : "#d2efff");
const woodC = (f = 1) => tint("#a8794a", f);

function waterPatch(rx, ry) {
  ell(0, 6, rx, ry, shade("#e6d8b4", 0.95), false);
  ell(0, 6, rx - 3, ry - 1.6, waterC(), false);
  ell(-rx * 0.35, 4, rx * 0.2, ry * 0.12, waterHi(), false);
}

function drawShip(st, spec, o) {
  const { h, wall, roofC, trim, accent } = o;
  waterPatch(33, 16);
  const hullC = tint(wall, 0.62);
  box(-0.34, -0.13, 0.3, 0.13, 3, 11, faces(hullC));
  poly([P(0.3, -0.13, 11), P(0.3, 0.13, 11), P(0.47, 0, 11)], shade(hullC, 1.15)); // bow deck
  poly([P(0.3, 0.13, 3), P(0.3, 0.13, 11), P(0.47, 0, 11), P(0.4, 0, 3)], shade(hullC, 0.8)); // bow side
  poly([P(-0.34, -0.13, 11), P(0.3, -0.13, 11), P(0.3, 0.13, 11), P(-0.34, 0.13, 11)], shade(woodC(1.1), 1), false); // deck
  box(-0.3, -0.07, -0.1, 0.07, 11, 19, faces(trim)); // cabin
  windowQ(faceQ("L", { u0: -0.3, u1: -0.1, v0: -0.07, v1: 0.07 }, 0.25, 0.75, 13, 17), accent, dark, false);
  const mastH = 24 + h * 3.6;
  c.strokeStyle = shade("#5a4a40", 1); c.lineWidth = 1.8; c.beginPath(); c.moveTo(...P(0.08, 0, 11)); c.lineTo(...P(0.08, 0, 11 + mastH)); c.stroke();
  poly([P(0.1, 0, 14), P(0.1, 0, 11 + mastH - 2), P(0.42, 0, 14)], shade("#fffaf0", 1)); // big sail
  poly([P(0.06, 0, 16), P(0.06, 0, 11 + mastH - 6), P(-0.22, 0, 16)], shade(roofC, 1)); // second sail
  const [fx, fy] = P(0.08, 0, 11 + mastH);
  flag(fx, fy, 8, accent);
  return { H: 19, top: 11 + mastH + 8, r: 0.3 };
}

function drawDock(st, spec, o) {
  const { h, wall, accent } = o;
  waterPatch(34, 17);
  const wood = woodC(1);
  box(-0.46, -0.2, 0.46, 0.2, 4, 7, faces(wood));
  for (let i = 0; i < 7; i++) { const u = -0.4 + i * 0.133; poly([P(u, -0.2, 7), P(u, 0.2, 7), P(u + 0.01, 0.2, 7), P(u + 0.01, -0.2, 7)], shade(woodC(0.7), 1), false); }
  for (const [pu, pv] of [[-0.42, 0.17], [0.42, 0.17], [0, 0.19], [0.42, -0.17], [-0.42, -0.17]]) cyl(pu, pv, 0.03, 0, 12, woodC(0.8));
  box(-0.3, -0.1, -0.12, 0.08, 7, 7 + 6 + h, faces("#c8a06c")); // crates
  box(0.05, -0.02, 0.2, 0.12, 7, 7 + 5, faces(accent));
  const [lx, ly] = P(0.4, 0.17, 12);
  c.fillStyle = dark ? "#ffe27a" : "#ffd36a"; c.beginPath(); c.arc(lx, ly - 4, 2.4, 0, 7); c.fill();
  return { H: 12, top: 20 + h, r: 0.35 };
}

function drawStatue(st, spec, o) {
  const { h, wall, accent, roofC } = o;
  box(-0.22, -0.22, 0.22, 0.22, 2, 12, faces(stoneOf(o)));
  box(-0.17, -0.17, 0.17, 0.17, 12, 15, faces(stoneOf(o, 1.08)));
  const bodyC = tint(roofC, 0.95), z0 = 15, bh = 14 + h * 3.4;
  cyl(0, 0, 0.1, z0, z0 + bh, bodyC, 0.07);
  // raised arm holding a torch
  const [sx, sy] = P(0, 0, z0 + bh * 0.8);
  c.strokeStyle = shade(bodyC, 1); c.lineWidth = 3.4; c.lineCap = "round"; c.beginPath(); c.moveTo(sx + 3, sy); c.lineTo(sx + 11, sy - 12); c.stroke(); c.lineCap = "butt";
  ell(sx + 12, sy - 15, 2.8, 3.6, shade("#ffb347", 1), false);
  const [hx, hy] = P(0, 0, z0 + bh + 4);
  ell(hx, hy, 4.6, 4.6, shade(bodyC, 1.12));
  return { H: z0 + bh, top: z0 + bh + 12, r: 0.25 };
}

function drawArch(st, spec, o) {
  const { h, wall, trim, accent } = o;
  const H = 26 + h * 3.6, col = stoneOf(o);
  const pil = (u0, u1) => box(u0, -0.1, u1, 0.1, 0, H, faces(col));
  pil(-0.34, -0.2); pil(0.2, 0.34);
  // the curved top: a half ring seen from the front
  const [cx, cy] = P(0, 0.1, H), rx = 0.27 * 45.25 * 0.74;
  c.beginPath(); c.ellipse(cx, cy, rx + 6, 13, 0, Math.PI, 0, false); c.ellipse(cx, cy, rx - 3, 9, 0, 0, Math.PI, true); c.closePath();
  c.fillStyle = shade(stoneOf(o, 1.05), 1); c.fill(); c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
  box(-0.34, -0.1, 0.34, 0.1, H - 3, H, faces(col)); // base of the curve
  ell(cx, cy - 13, 3.2, 3, shade(accent, 1)); // keystone gem
  const [gx, gy] = P(0, 0.05, 0);
  poly([[gx - 22, gy + 4], [gx + 22, gy + 4], [gx + 24, gy + 8], [gx - 24, gy + 8]], shade("#d9c9a0", 1), false);
  return { H: H + 12, top: H + 24, b: { u0: -0.34, u1: 0.34, v0: -0.1, v1: 0.1 } };
}

function drawGate(st, spec, o) {
  const { h, trim, accent, roofC } = o;
  const H = 20 + h * 2.2, col = stoneOf(o, 0.95);
  for (const u of [-0.32, 0.24]) {
    box(u, -0.09, u + 0.1, 0.09, 0, H, faces(col));
    box(u - 0.02, -0.11, u + 0.12, 0.11, H, H + 3, faces(stoneOf(o, 1.1)));
    cone(u + 0.05, 0, 0.07, H + 3, 8, roofC, 0);
  }
  // iron bars and a cross rail
  c.strokeStyle = shade("#2f3340", 1); c.lineWidth = 1.5;
  for (let i = 0; i < 7; i++) { const u = -0.2 + i * 0.07; c.beginPath(); c.moveTo(...P(u, 0.04, 2)); c.lineTo(...P(u, 0.04, H - 4)); c.stroke(); }
  for (const z of [6, H - 7]) { c.beginPath(); c.moveTo(...P(-0.22, 0.04, z)); c.lineTo(...P(0.24, 0.04, z)); c.stroke(); }
  const [lx, ly] = P(0.02, 0.04, H - 2); ell(lx, ly, 3, 3, shade(accent, 1));
  return { H: H + 10, top: H + 14, b: { u0: -0.32, u1: 0.34, v0: -0.09, v1: 0.09 } };
}

function drawWall(st, spec, o) {
  const { h, rr, trim } = o;
  const H = 12 + h * 2.6, col = stoneOf(o);
  const b = { u0: -0.48, u1: 0.48, v0: -0.1, v1: 0.1 };
  box(b.u0, b.v0, b.u1, b.v1, 0, H, faces(col));
  for (let z = 4; z < H; z += 5) for (const q of [Lq(b, 0, 1, z, z + 0.7)]) poly(q, shade(col, 0.72), false);
  for (let k = 0; k < 5; k++) { const x0 = 0.1 + k * 0.18 }
  crenel(b, H, col);
  const tw = { u0: 0.3, u1: 0.5, v0: -0.12, v1: 0.12 }; // a corner turret
  box(tw.u0, tw.v0, tw.u1, tw.v1, 0, H + 8, faces(stoneOf(o, 1.06)));
  roofPyr(tw, H + 8, 9, o.roofC, 0.02);
  windowQ(faceQ("L", tw, 0.3, 0.7, H * 0.4, H * 0.8), trim, dark, false);
  return { H: H + 8, top: H + 22, b };
}

function drawBridge(st, spec, o) {
  const { h, accent } = o;
  waterPatch(34, 16);
  const H = 12 + h * 1.6, col = stoneOf(o);
  const b = { u0: -0.46, u1: 0.46, v0: -0.13, v1: 0.13 };
  box(b.u0, b.v0, b.u1, b.v1, 4, H, faces(col));
  // arch openings on the front
  for (const k of [0.3, 0.7]) {
    const [x, y] = P(b.u0 + (b.u1 - b.u0) * k, b.v1, 4);
    c.beginPath(); c.ellipse(x, y, 8.5, 7, 0, Math.PI, 0, false); c.lineTo(x + 8.5, y + 3); c.lineTo(x - 8.5, y + 3); c.closePath(); c.fillStyle = waterC(); c.fill();
    c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
  }
  // rails and lamps
  c.strokeStyle = shade(accent, 1); c.lineWidth = 1.2;
  for (const v of [b.v1 - 0.01]) { c.beginPath(); c.moveTo(...P(b.u0, v, H + 5)); c.lineTo(...P(b.u1, v, H + 5)); c.stroke(); }
  for (let i = 0; i <= 5; i++) { const u = b.u0 + ((b.u1 - b.u0) * i) / 5; c.beginPath(); c.moveTo(...P(u, b.v1 - 0.01, H)); c.lineTo(...P(u, b.v1 - 0.01, H + 5)); c.stroke(); }
  for (const u of [-0.42, 0.42]) { const [lx, ly] = P(u, b.v1 - 0.01, H + 8); c.fillStyle = dark ? "#ffe27a" : "#ffd36a"; c.beginPath(); c.arc(lx, ly, 2.2, 0, 7); c.fill(); }
  return { H: H + 6, top: H + 14, b };
}

function drawFountain(st, spec, o) {
  const { h, accent } = o;
  cyl(0, 0, 0.36, 2, 9, stoneOf(o, 1.05));
  const [x, y] = P(0, 0, 9);
  ell(x, y, 0.3 * 45.25, 0.3 * 22.6, waterC(), false);
  cyl(0, 0, 0.07, 9, 20 + h * 1.4, stoneOf(o, 1.1));
  cyl(0, 0, 0.16, 20 + h * 1.4, 23 + h * 1.4, stoneOf(o, 1.05));
  const [tx, ty] = P(0, 0, 23 + h * 1.4);
  c.strokeStyle = waterHi(); c.lineWidth = 1.4; c.lineCap = "round";
  for (let i = -3; i <= 3; i++) { c.beginPath(); c.moveTo(tx, ty); c.quadraticCurveTo(tx + i * 6, ty - 14 - (3 - Math.abs(i)) * 3, tx + i * 9, ty + 6); c.stroke(); }
  c.lineCap = "butt";
  for (let i = 0; i < 6; i++) ell(x + Math.cos(i * 1.05) * 14, y + Math.sin(i * 1.05) * 6, 1.6, 0.9, waterHi(), false);
  ell(tx, ty - 1, 2.4, 2.4, shade(accent, 1), false);
  return { H: 23 + h * 1.4, top: 36 + h * 1.4, r: 0.36 };
}

function drawPlot(st, spec, o) {
  const { h, rr, accent, roofC } = o;
  const soil = shade("#8a6444", 1);
  poly([P(-0.44, -0.44, 1), P(0.44, -0.44, 1), P(0.44, 0.44, 1), P(-0.44, 0.44, 1)], soil, false);
  const crops = [accent, "#5fae62", "#ffd166", roofC];
  for (let r = 0; r < 4; r++) {
    const v = -0.3 + r * 0.2, col = crops[(r + Math.floor(rr() * 4)) % 4];
    c.strokeStyle = shade("#6e4c30", 1); c.lineWidth = 2; c.beginPath(); c.moveTo(...P(-0.4, v, 1.5)); c.lineTo(...P(0.4, v, 1.5)); c.stroke();
    for (let i = 0; i < 6; i++) {
      const [x, y] = P(-0.34 + i * 0.136, v, 1.5), s = 3 + h * 0.35;
      c.fillStyle = shade("#3f8f58", 1); c.beginPath(); c.ellipse(x, y - s * 0.6, s * 0.7, s, 0, 0, 7); c.fill();
      c.fillStyle = shade(col, 1); c.beginPath(); c.arc(x, y - s * 1.4, 1.7, 0, 7); c.fill();
    }
  }
  // scarecrow
  const [sx, sy] = P(0.3, -0.34, 0);
  c.strokeStyle = shade("#6e4c30", 1); c.lineWidth = 1.5; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx, sy - 20); c.moveTo(sx - 7, sy - 14); c.lineTo(sx + 7, sy - 14); c.stroke();
  ell(sx, sy - 22, 3, 3, shade("#f0d9a8", 1)); poly([[sx - 5, sy - 24], [sx + 5, sy - 24], [sx, sy - 31]], shade("#8a5a2a", 1));
  return { H: 10, top: 34, b: { u0: -0.44, u1: 0.44, v0: -0.44, v1: 0.44 } };
}

function drawPark(st, spec, o) {
  const { h, rr } = o;
  poly([P(-0.46, -0.46, 1), P(0.46, -0.46, 1), P(0.46, 0.46, 1), P(-0.46, 0.46, 1)], shade("#8fd07a", 1), false);
  poly([P(-0.05, -0.46, 1.4), P(0.05, -0.46, 1.4), P(0.05, 0.46, 1.4), P(-0.05, 0.46, 1.4)], shade("#eadfc4", 1), false); // paths
  poly([P(-0.46, -0.05, 1.4), P(0.46, -0.05, 1.4), P(0.46, 0.05, 1.4), P(-0.46, 0.05, 1.4)], shade("#eadfc4", 1), false);
  ell(...P(0, 0, 1.6), 9, 4.5, waterC(), false);
  for (const [u, v, k] of [[-0.3, -0.3, 1], [0.3, -0.28, 0], [-0.28, 0.3, 0], [0.32, 0.3, 1]]) treeAt(u, v, 0.8 + h * 0.06 + rr() * 0.2, k, k ? undefined : "#e28fa3");
  box(0.12, 0.2, 0.3, 0.27, 0, 4, faces("#a8794a")); // bench
  box(0.12, 0.2, 0.3, 0.215, 4, 8, faces("#8a5f3a"));
  const [lx, ly] = P(-0.12, 0.12, 0); c.strokeStyle = shade("#3b3b46", 1); c.lineWidth = 1.4; c.beginPath(); c.moveTo(lx, ly); c.lineTo(lx, ly - 18); c.stroke();
  c.fillStyle = dark ? "#ffe27a" : "#ffd36a"; c.beginPath(); c.arc(lx, ly - 20, 2.6, 0, 7); c.fill();
  return { H: 20, top: 40, b: { u0: -0.46, u1: 0.46, v0: -0.46, v1: 0.46 } };
}

function drawStadium(st, spec, o) {
  const { h, wall, accent, roofC } = o;
  const H = 12 + h * 1.8;
  cyl(0, 0, 0.44, 0, H, wall);
  const [x, y] = P(0, 0, H);
  ell(x, y, 0.44 * 45.25, 0.44 * 22.6, shade(accent, 0.9), false);
  ell(x, y + 1, 0.34 * 45.25, 0.34 * 22.6, shade("#5fae62", 1), false); // pitch
  c.strokeStyle = "rgba(255,255,255,0.8)"; c.lineWidth = 1; c.beginPath(); c.ellipse(x, y + 1, 0.2 * 45.25, 0.2 * 22.6, 0, 0, 7); c.moveTo(x, y + 1 - 0.34 * 22.6); c.lineTo(x, y + 1 + 0.34 * 22.6); c.stroke();
  // seat stripes on the outside
  const [x0, y0] = P(0, 0, 0), rx = 0.44 * 45.25, ry = 0.44 * 22.6;
  for (let i = 1; i < 6; i++) { const a = (Math.PI * i) / 6; c.strokeStyle = shade(roofC, 1); c.lineWidth = 1.2; c.beginPath(); c.moveTo(x0 + Math.cos(a) * rx, y0 + Math.sin(a) * ry); c.lineTo(x0 + Math.cos(a) * rx, y0 - H + Math.sin(a) * ry); c.stroke(); }
  for (const [u, v] of [[0.38, 0.1], [-0.1, 0.4]]) { // floodlights
    const [px, py] = P(u, v, 0); c.strokeStyle = shade("#4a4f60", 1); c.lineWidth = 2; c.beginPath(); c.moveTo(px, py); c.lineTo(px, py - H - 16); c.stroke();
    c.fillStyle = dark ? "#fff1b0" : "#fff8d0"; c.fillRect(px - 5, py - H - 22, 10, 6);
  }
  return { H, top: H + 28, r: 0.44 };
}

function drawObservatory(st, spec, o) {
  const { h, wall, roofC, accent, trim } = o;
  const H = 26 + h * 4.2;
  cyl(0, 0, 0.24, 0, H, wall);
  roundWindows(0, 0, 0.24, H, 2, trim, false, o.rr);
  domeShape(0, 0, 0.27, H, 20, roofC);
  const [x, y] = P(0, 0, H);
  poly([[x + 1, y - 2], [x + 6, y - 2], [x + 6, y - 19], [x + 1, y - 18]], shade("#1c2238", 1), false); // slit
  c.strokeStyle = shade("#c8ccd8", 1); c.lineWidth = 5; c.lineCap = "round"; c.beginPath(); c.moveTo(x + 3, y - 12); c.lineTo(x + 20, y - 30); c.stroke(); c.lineCap = "butt"; // telescope
  c.strokeStyle = shade(accent, 1); c.lineWidth = 2; c.beginPath(); c.moveTo(x + 17, y - 27); c.lineTo(x + 20, y - 30); c.stroke();
  const [sx, sy] = P(0, 0, H + 20); c.strokeStyle = shade("#8a6a4a", 1); c.lineWidth = 1.2; c.beginPath(); c.moveTo(sx, sy); c.lineTo(sx, sy - 8); c.stroke();
  return { H: H + 8, top: H + 36, r: 0.26 };
}

function drawMuseum(st, spec, o) {
  const { h, wall, roofC, trim, accent } = o;
  const H = 18 + h * 2.8, b = { u0: -0.42, u1: 0.42, v0: -0.28, v1: 0.28 };
  box(-0.46, -0.32, 0.46, 0.32, 0, 4, faces(stoneOf(o, 1.05))); // steps
  box(b.u0, b.v0, b.u1, b.v1, 4, 4 + H, faces(wall));
  for (let i = 0; i < 6; i++) { // columns on the front
    const u = b.u0 + 0.06 + i * 0.148;
    cyl(u, b.v1 + 0.04, 0.032, 4, 4 + H - 2, trim);
  }
  box(b.u0 - 0.03, b.v0 - 0.03, b.u1 + 0.03, b.v1 + 0.08, 2 + H, 4 + H, faces(stoneOf(o, 1.08)));
  roofGable(b, 4 + H, 11, "v", roofC, 0.04, shade(stoneOf(o, 1.1), 1)); // pediment
  windowQ(faceQ("R", b, 0.25, 0.5, 8, H - 2), trim, dark, false);
  const q = faceQ("L", b, 0.4, 0.6, 4, 4 + H * 0.6); poly(q, shade("#4a3b33", 1));
  const [fx, fy] = P(0, 0, 4 + H + 11); flag(fx, fy, 12, accent);
  return { H: H + 15, top: H + 34, b };
}

function drawSchool(st, spec, o) {
  const { h, wall, roofC, trim, accent } = o;
  const H = 14 + h * 2.2, b = { u0: -0.46, u1: 0.4, v0: -0.26, v1: 0.26 };
  box(b.u0, b.v0, b.u1, b.v1, 0, H, faces(wall));
  windows(b, H, { rows: 1, colsL: 5, colsR: 2, trim, accent, door: false, doorFace: "L", shutters: false });
  roofGable(b, H, 8, "u", roofC, 0.03, shade(wall, 1.05));
  door(b, "L", accent, trim, H, true);
  const bt = { u0: -0.05, u1: 0.13, v0: -0.09, v1: 0.09 }; // bell tower on the roof
  box(bt.u0, bt.v0, bt.u1, bt.v1, H + 3, H + 18, faces(trim));
  poly(faceQ("L", bt, 0.25, 0.75, H + 8, H + 15), shade("#3a2a1a", 1), false);
  ell(...P(0.04, 0.09, H + 11), 2.2, 2.6, shade("#f2c14e", 1), false);
  roofPyr(bt, H + 18, 9, roofC, 0.02);
  const [fx, fy] = P(0.04, 0, H + 27); flag(fx, fy, 9, accent);
  // playground swing
  const [sx, sy] = P(0.3, 0.42, 0); c.strokeStyle = shade("#8a6a4a", 1); c.lineWidth = 1.4;
  c.beginPath(); c.moveTo(sx - 7, sy); c.lineTo(sx - 5, sy - 12); c.lineTo(sx + 5, sy - 12); c.lineTo(sx + 7, sy); c.moveTo(sx - 2, sy - 12); c.lineTo(sx - 2, sy - 4); c.moveTo(sx + 2, sy - 12); c.lineTo(sx + 2, sy - 4); c.stroke();
  return { H: H + 10, top: H + 36, b };
}

function drawStall(st, spec, o) {
  const { h, rr, accent, trim } = o;
  box(-0.3, -0.12, 0.3, 0.2, 0, 11, faces(woodC(1)));
  box(-0.33, -0.15, 0.33, 0.23, 11, 13, faces(woodC(1.15)));
  const gcols = [accent, "#ffd166", "#ff7a8a", "#7bd88f", "#c58bff"];
  for (let i = 0; i < 6; i++) { // produce on the counter
    const [x, y] = P(-0.24 + i * 0.096, 0.04, 13);
    c.fillStyle = shade(gcols[Math.floor(rr() * gcols.length)], 1); c.beginPath(); c.arc(x, y - 2.2, 2.6, 0, 7); c.fill();
  }
  for (const [u, v] of [[-0.32, 0.22], [0.32, 0.22], [0.32, -0.14], [-0.32, -0.14]]) { const [x, y] = P(u, v, 0); c.fillStyle = shade("#6e4c30", 1); c.fillRect(x - 1.2, y - 30 - h, 2.4, 30 + h); }
  const b = { u0: -0.38, u1: 0.38, v0: -0.2, v1: 0.28 };
  awning(b, "L", 28 + h, accent, trim, 0.08);
  poly([P(-0.38, -0.2, 30 + h), P(0.38, -0.2, 30 + h), P(0.38, 0.28, 30 + h), P(-0.38, 0.28, 30 + h)], shade(accent, 1.08), false); // canopy top
  for (let i = 0; i < 5; i++) { const u0 = -0.38 + i * 0.152; poly([P(u0, -0.2, 30 + h), P(u0 + 0.076, -0.2, 30 + h), P(u0 + 0.076, 0.28, 30 + h), P(u0, 0.28, 30 + h)], shade("#fffaf0", 1), false); }
  return { H: 30 + h, top: 38 + h, b };
}

function drawRuins(st, spec, o) {
  const { h, rr } = o;
  const col = stoneOf(o, 0.95);
  poly([P(-0.46, -0.46, 1), P(0.46, -0.46, 1), P(0.46, 0.46, 1), P(-0.46, 0.46, 1)], shade("#a9b98a", 1), false);
  const b = { u0: -0.42, u1: 0.1, v0: -0.4, v1: -0.28 }; // a broken wall with a jagged top
  box(b.u0, b.v0, b.u1, b.v1, 0, 22 + h, faces(col));
  for (let i = 0; i < 4; i++) { const u = b.u0 + i * 0.13; box(u, b.v0, u + 0.07, b.v1, 22 + h, 22 + h + 4 + ((i * 7 + h) % 6), faces(col)); }
  const heights = [26 + h * 2, 12 + h, 30 + h * 2.5, 8];
  [[-0.3, 0.1], [-0.05, 0.3], [0.25, 0.05], [0.3, 0.34]].forEach(([u, v], i) => {
    cyl(u, v, 0.06, 0, heights[i], col);
    if (i === 1 || i === 3) { const [x, y] = P(u, v, heights[i]); poly([[x - 5, y], [x + 1, y - 3], [x + 5, y + 1], [x + 2, y + 3]], shade(col, 1.1), false); }
  });
  for (const [u, v, s] of [[0.1, 0.2, 5], [-0.2, 0.34, 4], [0.38, -0.2, 5]]) { box(u - 0.06, v - 0.05, u + 0.06, v + 0.05, 0, s, faces(col)); }
  for (let i = 0; i < 7; i++) { const [x, y] = P(-0.4 + rr() * 0.8, -0.1 + rr() * 0.5, 0); ell(x, y - 1, 3 + rr() * 2, 1.8, shade("#6aa86a", 0.95), false); } // moss
  return { H: 30 + h * 2.5, top: 44 + h * 2.5, b: { u0: -0.4, u1: 0.4, v0: -0.4, v1: 0.4 } };
}

function drawCrystal(st, spec, o) {
  const { h, roofC, accent, wall } = o;
  for (const [u, v, k] of [[-0.18, 0.1, 0.55], [0.2, 0.12, 0.7], [0.05, -0.12, 1]]) { // base rocks
    const [x, y] = P(u, v, 0); poly([[x - 9, y], [x - 5, y - 6], [x + 5, y - 7], [x + 10, y]], shade("#7d7a86", k), false); }
  const [bx, by] = P(0, 0, 4);
  if (dark) { const g = c.createRadialGradient(bx, by - 28, 3, bx, by - 28, 48); g.addColorStop(0, "rgba(160,220,255,0.55)"); g.addColorStop(1, "rgba(160,220,255,0)"); c.fillStyle = g; c.fillRect(bx - 50, by - 80, 100, 100); }
  const spikes = [[-14, 0.55, -0.12], [0, 1, 0], [13, 0.7, 0.1], [-6, 0.4, 0.2], [7, 0.45, -0.2]];
  const base = [roofC, accent, wall];
  spikes.forEach(([dx, hk, lean], i) => {
    const Hh = (22 + h * 4.6) * hk, wd = 6 + hk * 3, col = base[i % 3];
    const x = bx + dx, y = by + (i % 2) * 3;
    poly([[x - wd, y], [x - wd * 0.6, y - Hh * 0.72], [x + Hh * lean, y - Hh], [x + wd * 0.6, y - Hh * 0.72], [x + wd, y], [x, y + 3]], shade(col, 1.0));
    poly([[x, y + 3], [x + wd, y], [x + wd * 0.6, y - Hh * 0.72], [x + Hh * lean, y - Hh], [x, y - Hh * 0.45]], shade(col, 0.72));
    poly([[x - wd * 0.6, y - Hh * 0.72], [x + Hh * lean, y - Hh], [x - wd * 0.1, y - Hh * 0.7]], shade("#ffffff", 1), false);
  });
  return { H: 24 + h * 4.6, top: 34 + h * 4.6, r: 0.25 };
}

function drawRocket(st, spec, o) {
  const { h, wall, roofC, accent, trim } = o;
  box(-0.42, -0.42, 0.42, 0.42, 2, 5, faces(stoneOf(o, 0.9))); // pad
  const H = 36 + h * 5;
  // launch tower
  const tw = { u0: 0.22, u1: 0.3, v0: -0.28, v1: -0.2 };
  box(tw.u0, tw.v0, tw.u1, tw.v1, 5, H * 0.85, faces("#c0463a"));
  for (let z = 14; z < H * 0.8; z += 12) { c.strokeStyle = shade("#c0463a", 0.9); c.lineWidth = 1.4; c.beginPath(); c.moveTo(...P(0.22, -0.24, z)); c.lineTo(...P(0.05, -0.1, z)); c.stroke(); }
  // fins behind and in front
  const [x, y] = P(0, 0, 5);
  for (const s of [-1, 1]) poly([[x + s * 6, y - 10], [x + s * 19, y + 3], [x + s * 6, y - 3 + 0]], shade(roofC, 0.85));
  cyl(0, 0, 0.13, 5, 5 + H, wall);
  const [, yt] = P(0, 0, 5 + H), rx = 0.13 * 45.25;
  c.beginPath(); c.moveTo(x - rx, yt); c.quadraticCurveTo(x - rx * 0.6, yt - 22, x, yt - 30); c.quadraticCurveTo(x + rx * 0.6, yt - 22, x + rx, yt); c.ellipse(x, yt, rx, 0.13 * 22.6, 0, 0, Math.PI, false); c.closePath();
  c.fillStyle = grad(x - rx, x + rx, roofC, 1.15, 0.7); c.fill(); c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
  const [, ym] = P(0, 0, 5 + H * 0.62);
  ell(x, ym + 2, 4.4, 4.4, shade(trim, 1)); ell(x, ym + 2, 3, 3, glassColor(dark));
  const [, yb] = P(0, 0, 5 + H * 0.2);
  c.fillStyle = shade(accent, 1); c.fillRect(x - rx, yb - 3, rx * 2, 5);
  ell(x, y + 4, 9, 3.5, "rgba(255,200,90,0.6)", false); // little glow of the engines
  smoke(x + 11, y + 4, 2);
  return { H: H + 10, top: H + 40, r: 0.15 };
}

const SPECIAL = {
  ship: drawShip, dock: drawDock, statue: drawStatue, arch: drawArch, gate: drawGate, wall: drawWall, bridge: drawBridge,
  fountain: drawFountain, plot: drawPlot, park: drawPark, stadium: drawStadium, observatory: drawObservatory, museum: drawMuseum,
  school: drawSchool, stall: drawStall, ruins: drawRuins, crystal: drawCrystal, rocket: drawRocket,
};

// ----- parts -----
const DIR = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };

function partPos(side, ext, ps) {
  const [du, dv] = DIR[side];
  const e = Math.min(ext + ps * 0.55, 0.5 - ps * 0.5);
  return [du * e, dv * e];
}

const ROOF_PARTS = new Set(["chimney", "dome", "spire", "flag", "sails", "antenna", "windvane"]);

function drawPartGround(p, info, o, rr) {
  const ps = 0.15 + p.h * 0.012;
  const ext = info.r ? info.r : (p.side === "e" || p.side === "w" ? info.b.u1 : info.b.v1);
  const [u, v] = partPos(p.side, ext, ps * 1.6);
  const { wall, roofC, trim, accent } = o;
  const k = p.h / 9;
  switch (p.part) {
    case "wing": {
      const hw = 0.13 + k * 0.05;
      const b = { u0: u - hw, u1: u + hw, v0: v - hw, v1: v + hw };
      const H = info.H * (0.4 + k * 0.35);
      box(b.u0, b.v0, b.u1, b.v1, 0, H, faces(wall));
      windowQ(faceQ("L", b, 0.3, 0.7, H * 0.35, H * 0.75), trim, dark, false);
      windowQ(faceQ("R", b, 0.3, 0.7, H * 0.35, H * 0.75), trim, dark, false);
      roofPyr(b, H, 10 + k * 8, roofC, 0.03);
      break;
    }
    case "porch": {
      const hw = 0.12;
      const b = { u0: u - hw, u1: u + hw, v0: v - hw, v1: v + hw };
      const H = 13 + k * 5;
      box(b.u0, b.v0, b.u1, b.v1, 0, 2, faces("#d9c3a0"));
      for (const [pu, pv] of [[b.u0 + 0.02, b.v1 - 0.02], [b.u1 - 0.02, b.v1 - 0.02], [b.u1 - 0.02, b.v0 + 0.02]]) {
        const [x, y] = P(pu, pv, 0); c.fillStyle = shade(trim, 1); c.fillRect(x - 1.2, y - H, 2.4, H);
      }
      box(b.u0 - 0.02, b.v0 - 0.02, b.u1 + 0.02, b.v1 + 0.02, H, H + 2.5, faces(roofC));
      break;
    }
    case "balcony": {
      const hw = 0.11;
      const b = { u0: u - hw, u1: u + hw, v0: v - hw, v1: v + hw };
      const z = info.H * (0.45 + k * 0.2);
      box(b.u0, b.v0, b.u1, b.v1, z, z + 2, faces(trim));
      for (let i = 0; i < 4; i++) { const t = i / 3; const [x, y] = P(b.u0 + (b.u1 - b.u0) * t, b.v1, z + 2); c.strokeStyle = shade(accent, 1); c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 6); c.stroke(); }
      const [xa, ya] = P(b.u0, b.v1, z + 8), [xb, yb] = P(b.u1, b.v1, z + 8); c.beginPath(); c.moveTo(xa, ya); c.lineTo(xb, yb); c.stroke();
      break;
    }
    case "garden": {
      poly([P(u - 0.2, v - 0.2, 0.3), P(u + 0.2, v - 0.2, 0.3), P(u + 0.2, v + 0.2, 0.3), P(u - 0.2, v + 0.2, 0.3)], shade("#7bbf6a", 1), false);
      const gr = mulberry(p.h * 77 + u * 100);
      for (let i = 0; i < 6 + p.h; i++) {
        const [x, y] = P(u + (gr() - 0.5) * 0.34, v + (gr() - 0.5) * 0.34, 0);
        c.fillStyle = shade(["#ff7a8a", "#ffd166", "#ff9ecb", "#ffffff", "#c58bff"][i % 5], 1);
        c.beginPath(); c.arc(x, y - 1, 1.7, 0, 7); c.fill();
        c.fillStyle = shade("#3f8f58", 1); c.fillRect(x - 0.4, y - 0.2, 0.8, 2.4);
      }
      break;
    }
    case "turret": {
      cyl(u, v, 0.09, 0, info.H * (0.7 + k * 0.4) + 6, wall);
      cone(u, v, 0.09, info.H * (0.7 + k * 0.4) + 6, 14 + k * 8, roofC);
      break;
    }
    case "awning": {
      const [x, y] = P(u, v, 0);
      c.fillStyle = shade("#8a6a4a", 1); c.fillRect(x - 9, y - 12, 1.6, 12); c.fillRect(x + 8, y - 12, 1.6, 12);
      for (let i = 0; i < 6; i++) { poly([[x - 11 + i * 3.7, y - 15], [x - 7.3 + i * 3.7, y - 15], [x - 6 + i * 3.7, y - 10], [x - 10 + i * 3.7, y - 10]], shade(i % 2 ? "#ffffff" : accent, 1), false); }
      ell(x, y - 3, 6, 2.4, shade("#d9a066", 1), false);
      break;
    }
    case "stairs": {
      for (let i = 0; i < 4; i++) {
        const a = 0.05 * i;
        const [du, dv] = DIR[p.side];
        const cu = u - du * a, cv = v - dv * a, hw = du ? 0.07 : 0.12, hv = dv ? 0.07 : 0.12;
        box(cu - hw, cv - hv, cu + hw, cv + hv, 0, 2 + i * 2.2, faces("#d9d3c7"));
      }
      break;
    }
    case "fence": {
      const [du, dv] = DIR[p.side];
      for (let i = 0; i < 6; i++) {
        const t = -0.38 + i * 0.152;
        const pu = du === 0 ? t : (du > 0 ? 0.46 : -0.46), pv = dv === 0 ? t : (dv > 0 ? 0.46 : -0.46);
        const [x, y] = P(pu, pv, 0);
        c.fillStyle = shade("#f3e7d0", 1); c.fillRect(x - 1, y - 7, 2, 7);
        c.beginPath(); c.moveTo(x - 1, y - 7); c.lineTo(x, y - 9); c.lineTo(x + 1, y - 7); c.fill();
      }
      const [x0, y0] = P(du === 0 ? -0.38 : (du > 0 ? 0.46 : -0.46), dv === 0 ? -0.38 : (dv > 0 ? 0.46 : -0.46), 0);
      const [x1, y1] = P(du === 0 ? 0.38 : (du > 0 ? 0.46 : -0.46), dv === 0 ? 0.38 : (dv > 0 ? 0.46 : -0.46), 0);
      c.strokeStyle = shade("#e0cfae", 1); c.lineWidth = 1; c.beginPath(); c.moveTo(x0, y0 - 5); c.lineTo(x1, y1 - 5); c.stroke();
      break;
    }
    case "pond": {
      const [x, y] = P(u, v, 0);
      ell(x, y, 17 + k * 5, 8 + k * 2.5, shade("#e6d8b4", 1), false);
      ell(x, y, 15 + k * 5, 6.6 + k * 2.5, dark ? "#35557e" : "#7cc5ec", false);
      ell(x - 4, y - 1, 3, 1.4, dark ? "#6fa0d0" : "#d2efff", false);
      ell(x + 6, y + 1.5, 2.6, 1.2, shade("#5fae62", 1), false);
      break;
    }
    case "tree": {
      treeAt(u, v, 0.8 + k * 0.7, p.h % 2, p.h % 3 === 0 ? "#e28fa3" : undefined);
      break;
    }
    case "lantern": {
      const [x, y] = P(u, v, 0);
      c.strokeStyle = shade("#3b3b46", 1); c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - 18 - k * 6); c.stroke();
      const ly = y - 20 - k * 6;
      if (dark) { const g = c.createRadialGradient(x, ly, 1, x, ly, 40); g.addColorStop(0, "rgba(255,220,120,0.7)"); g.addColorStop(1, "rgba(255,220,120,0)"); c.fillStyle = g; c.fillRect(x - 40, ly - 40, 80, 80); }
      c.fillStyle = dark ? "#ffe27a" : "#ffd36a"; c.beginPath(); c.arc(x, ly, 2.8, 0, 7); c.fill(); c.strokeStyle = shade("#3b3b46", 1); c.lineWidth = 1; c.stroke();
      break;
    }
    case "bench": {
      const [du] = DIR[p.side];
      const a = du ? 0.07 : 0.16, e = du ? 0.16 : 0.07;
      box(u - a, v - e, u + a, v + e, 5, 7, faces("#b9874f"));
      for (const [pu, pv] of [[-a, -e], [a, -e], [-a, e], [a, e]]) box(u + pu * 0.9 - 0.012, v + pv * 0.9 - 0.012, u + pu * 0.9 + 0.012, v + pv * 0.9 + 0.012, 0, 5, faces("#5a4a40"));
      box(u - a, v - e, du ? u - a + 0.02 : u + a, du ? v + e : v - e + 0.02, 7, 12 + k * 2, faces("#9a6e3c"));
      break;
    }
    case "well": {
      cyl(u, v, 0.1, 0, 10, "#cfcac0");
      const [x, y] = P(u, v, 10);
      ell(x, y, 0.085 * 45.25, 0.085 * 22.6, dark ? "#26374f" : "#4f8fb8", false);
      for (const s of [-1, 1]) { c.fillStyle = shade("#6e4c30", 1); c.fillRect(x + s * 8 - 1, y - 20, 2, 20); }
      poly([[x - 12, y - 19], [x, y - 28 - k * 3], [x + 12, y - 19]], shade(roofC, 1));
      c.strokeStyle = shade("#3a2a1a", 1); c.lineWidth = 0.9; c.beginPath(); c.moveTo(x, y - 19); c.lineTo(x, y - 8); c.stroke();
      ell(x, y - 6, 2.4, 2, shade("#8a6a4a", 1), false);
      break;
    }
    case "trellis": {
      const [x, y] = P(u, v, 0);
      const hh = 20 + k * 6;
      c.strokeStyle = shade("#e9dcc0", 1); c.lineWidth = 2;
      c.beginPath(); c.moveTo(x - 11, y); c.lineTo(x - 11, y - hh + 6); c.moveTo(x + 11, y); c.lineTo(x + 11, y - hh + 6); c.stroke();
      c.beginPath(); c.ellipse(x, y - hh + 6, 11, 7, 0, Math.PI, 0, false); c.stroke();
      const gr = mulberry(p.h * 31 + 5);
      for (let i = 0; i < 9; i++) {
        const a = Math.PI + (Math.PI * i) / 8, fx = x + Math.cos(a) * 11, fy = y - hh + 6 + Math.sin(a) * 7;
        c.fillStyle = shade(["#ff7a8a", "#ffd166", "#ff9ecb", "#c58bff"][Math.floor(gr() * 4)], 1); c.beginPath(); c.arc(fx, fy, 2, 0, 7); c.fill();
      }
      for (const s of [-11, 11]) for (let i = 0; i < 3; i++) { c.fillStyle = shade("#4fa35f", 1); c.beginPath(); c.arc(x + s, y - 4 - i * 5, 2, 0, 7); c.fill(); }
      break;
    }
    case "crate": {
      box(u - 0.1, v - 0.1, u + 0.1, v + 0.1, 0, 9, faces("#c8a06c"));
      box(u - 0.07, v - 0.07, u + 0.07, v + 0.07, 9, 9 + 5 + k * 3, faces("#b98a52"));
      poly([P(u - 0.1, v + 0.1, 4), P(u + 0.1, v + 0.1, 4), P(u + 0.1, v + 0.1, 5), P(u - 0.1, v + 0.1, 5)], shade("#7a5230", 1), false);
      break;
    }
    case "boat": {
      const [x, y] = P(u, v, 0);
      ell(x, y + 1, 17, 8, dark ? "#35557e" : "#7cc5ec", false);
      c.beginPath(); c.moveTo(x - 13, y - 4); c.quadraticCurveTo(x, y + 9, x + 13, y - 4); c.lineTo(x + 8, y - 2); c.quadraticCurveTo(x, y + 4, x - 8, y - 2); c.closePath();
      c.fillStyle = shade(accent, 1); c.fill(); c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
      c.strokeStyle = shade("#6e4c30", 1); c.lineWidth = 1.2; c.beginPath(); c.moveTo(x - 6, y - 5); c.lineTo(x + 7, y + 3); c.stroke();
      break;
    }
    case "cart": {
      const [du] = DIR[p.side];
      const a = du ? 0.1 : 0.17, e = du ? 0.17 : 0.1;
      box(u - a, v - e, u + a, v + e, 6, 12, faces("#a8794a"));
      box(u - a + 0.02, v - e + 0.02, u + a - 0.02, v + e - 0.02, 12, 13, faces("#d8b46a"));
      for (const s of [-1, 1]) { const [x, y] = P(du ? u + s * 0.02 : u + s * (a + 0.01), du ? v + s * (e + 0.01) : v + s * 0.02, 6); c.strokeStyle = shade("#5a3b22", 1); c.lineWidth = 1.4; c.beginPath(); c.arc(x, y, 5, 0, 7); c.moveTo(x - 5, y); c.lineTo(x + 5, y); c.moveTo(x, y - 5); c.lineTo(x, y + 5); c.stroke(); }
      const [hx, hy] = P(u + (du ? du * a : 0), v + (du ? 0 : DIR[p.side][1] * e), 9); c.strokeStyle = shade("#6e4c30", 1); c.lineWidth = 1.6; c.beginPath(); c.moveTo(hx, hy); c.lineTo(hx + 10, hy - 4); c.stroke();
      break;
    }
    case "haystack": {
      const [x, y] = P(u, v, 0);
      const r = 0.12 + k * 0.03;
      domeShape(u, v, r, 0, 14 + k * 6, "#e3be5c");
      c.strokeStyle = "rgba(120,80,20,0.5)"; c.lineWidth = 0.8;
      for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(x + i * 3, y - 3); c.lineTo(x + i * 2, y - 12 - k * 4); c.stroke(); }
      break;
    }
    case "bush": {
      const [x, y] = P(u, v, 0), s = 0.85 + k * 0.5;
      for (const [dx, dy, r, f] of [[-6, -5, 7, 0.85], [6, -5, 7, 0.8], [0, -9, 8, 1]]) ell(x + dx * s, y + dy * s, r * s, r * 0.85 * s, shade("#4f9e5a", f));
      c.fillStyle = shade(p.h % 2 ? "#e8506a" : "#ffd166", 1); for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(x + (i - 2) * 4 * s, y - (6 + (i % 3) * 3) * s, 1.5, 0, 7); c.fill(); }
      break;
    }
    case "rocks": {
      const [x, y] = P(u, v, 0), s = 0.8 + k * 0.7;
      for (const [dx, dy, r, f] of [[-7, 0, 6, 0.85], [5, 1, 8, 1], [-1, -6, 5, 1.1]]) {
        c.beginPath(); c.moveTo(x + (dx - r) * s, y + dy * s); c.lineTo(x + (dx - r * 0.5) * s, y + (dy - r * 0.9) * s); c.lineTo(x + (dx + r * 0.4) * s, y + (dy - r) * s); c.lineTo(x + (dx + r) * s, y + dy * s); c.closePath();
        c.fillStyle = shade(dark ? "#8d8a86" : "#bdb8ae", f); c.fill(); c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
      }
      break;
    }
    case "lamppost": {
      const [x, y] = P(u, v, 0), hh = 28 + k * 8;
      c.strokeStyle = shade("#2f3340", 1); c.lineWidth = 2; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hh); c.quadraticCurveTo(x, y - hh - 6, x + 7, y - hh - 4); c.stroke();
      c.fillStyle = shade("#2f3340", 1); c.fillRect(x - 3, y - 4, 6, 4);
      const lx = x + 7, ly = y - hh - 1;
      if (dark) { const g = c.createRadialGradient(lx, ly, 1, lx, ly, 46); g.addColorStop(0, "rgba(255,220,120,0.75)"); g.addColorStop(1, "rgba(255,220,120,0)"); c.fillStyle = g; c.fillRect(lx - 46, ly - 46, 92, 92); }
      c.fillStyle = dark ? "#ffe27a" : "#fff0b0"; c.beginPath(); c.arc(lx, ly, 3.4, 0, 7); c.fill(); c.strokeStyle = shade("#2f3340", 1); c.lineWidth = 1; c.stroke();
      break;
    }
  }
}

function drawPartRoof(p, info, o, rr) {
  const { b, H, top } = info;
  const k = p.h / 9;
  const [du, dv] = DIR[p.side];
  const cu = info.r ? du * info.r * 0.4 : (b.u0 + b.u1) / 2 + du * (b.u1 - b.u0) * 0.28;
  const cv = info.r ? dv * info.r * 0.4 : (b.v0 + b.v1) / 2 + dv * (b.v1 - b.v0) * 0.28;
  const z = Math.max(H, top - 8);
  switch (p.part) {
    case "chimney": chimney(cu, cv, Math.max(H, top * 0.8), 8 + p.h * 2.2, "#b8654b", true); break;
    case "dome": domeShape(cu, cv, 0.11 + k * 0.05, top - 4, 9 + p.h * 1.6, o.accent); break;
    case "spire": { cone(cu, cv, 0.05, top - 4, 12 + p.h * 3.4, o.roofC, 0.0); break; }
    case "flag": { const [x, y] = P(cu, cv, top - 2); flag(x, y, 12 + p.h * 1.5, o.accent); break; }
    case "sails": {
      const [x, y] = P(cu, cv, top + 6 + p.h);
      c.save(); c.translate(x, y); const base = p.h * 0.5;
      for (let i = 0; i < 4; i++) { c.save(); c.rotate(base + (i * Math.PI) / 2); c.fillStyle = shade("#fff6e8", 1); c.strokeStyle = shade("#8a6a4a", 1); c.lineWidth = 0.9; c.beginPath(); c.rect(1.5, -2.2, 14 + k * 6, 4.4); c.fill(); c.stroke(); c.restore(); }
      ell(0, 0, 2, 2, shade("#8a6a4a", 1)); c.restore();
      break;
    }
    case "antenna": {
      const [x, y] = P(cu, cv, z);
      const hh = 16 + p.h * 2.4;
      c.strokeStyle = shade("#4a4f60", 1); c.lineWidth = 1.5; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hh);
      for (let i = 1; i <= 3; i++) { const yy = y - hh * (i / 3.4), w = 8 - i * 1.6; c.moveTo(x - w, yy); c.lineTo(x + w, yy); }
      c.stroke();
      c.fillStyle = "#ff5a4a"; c.beginPath(); c.arc(x, y - hh - 1, 1.8, 0, 7); c.fill();
      break;
    }
    case "windvane": {
      const [x, y] = P(cu, cv, z);
      const hh = 12 + p.h * 1.6;
      c.strokeStyle = shade("#3b3b46", 1); c.lineWidth = 1.3; c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - hh); c.moveTo(x - 6, y - hh + 3); c.lineTo(x + 6, y - hh + 3); c.stroke();
      poly([[x - 8, y - hh - 1], [x + 7, y - hh - 1], [x + 12, y - hh - 4], [x + 7, y - hh - 7], [x - 8, y - hh - 4], [x - 11, y - hh - 4]].slice(0, 6), shade(o.accent, 1));
      break;
    }
  }
}

/**
 * Draw one building. spec = {style,h,pal,seed,parts:[{part,side,h}]}. opts = {dark}.
 * The caller translates to the centre of the tile first.
 */
export function drawBuilding(ctx, spec, opts = {}) {
  c = ctx;
  dark = !!opts.dark;
  outline = opts.outline || null; lineW = opts.lw || 1;
  if (opts.light) nightLight = opts.light;
  const st = STYLE[spec.style] || STYLE.house;
  rng = mulberry(spec.seed * 7919 + hashStr(spec.style));
  const rr = mulberry(spec.seed * 104729 + 17);
  const pal = PAL[spec.pal % 16];
  // small per-seed colour wobble so two houses with the same palette still differ
  const wob = (hx, f) => { const [r, g, b] = hex(hx); const m = 1 + (rr() - 0.5) * f; return `#${[r, g, b].map((v) => cl(v * m).toString(16).padStart(2, "0")).join("")}`; };
  const o = { h: spec.h, rr, wall: wob(pal[0], 0.1), roofC: wob(pal[1], 0.14), trim: pal[2], accent: pal[3] };
  const parts = spec.parts || [];

  // plinth
  if (st.plinth !== false) box(-0.47, -0.47, 0.47, 0.47, 0, 2, faces(dark ? "#9a9078" : "#e9dfc9"));

  // body first to know the size, but parts on the back sides must be drawn before it.
  // So measure with a dry run on a throwaway path: bodies are cheap, so draw back parts after a size estimate.
  const est = estimate(st, o);
  const back = parts.filter((p) => (p.side === "n" || p.side === "w") && !ROOF_PARTS.has(p.part));
  const front = parts.filter((p) => (p.side === "e" || p.side === "s") && !ROOF_PARTS.has(p.part));
  const roofs = parts.filter((p) => ROOF_PARTS.has(p.part));
  for (const p of back) drawPartGround(p, est, o, rr);

  let info;
  if (st.kind === "box") info = drawBoxBuilding(st, spec, o);
  else if (st.kind === "round") info = drawRoundBuilding(st, spec, o);
  else if (st.kind === "pagoda") info = drawPagoda(st, spec, o);
  else if (st.kind === "tree") info = drawTreehouse(st, spec, o);
  else if (st.kind === "special") info = SPECIAL[spec.style](st, spec, o);
  else if (st.kind === "tent") info = drawTent(st, spec, o);
  else info = drawIgloo(st, spec, o);
  if (!info.b) info.b = { u0: -(info.r || 0.25), u1: info.r || 0.25, v0: -(info.r || 0.25), v1: info.r || 0.25 };

  for (const p of front) drawPartGround(p, { ...info, b: info.b }, o, rr);
  for (const p of roofs) drawPartRoof(p, info, o, rr);
  return info;
}

function estimate(st, o) {
  if (st.kind === "special") return { r: 0.35, b: { u0: -0.3, u1: 0.3, v0: -0.3, v1: 0.3 }, H: 20 + o.h * 2, top: 40 };
  const H = st.kind === "box" || st.kind === "round" ? bodyHeight(st, o.h) : 40;
  if (st.kind === "box") return { b: { u0: -st.w / 2, u1: st.w / 2, v0: -st.d / 2, v1: st.d / 2 }, H, top: H + 20 };
  const r = st.r || st.w / 2 || 0.2;
  return { r, b: { u0: -r, u1: r, v0: -r, v1: r }, H, top: H + 20 };
}

/** Wooden sign board drawn upright at (0,0)=base of its post. Words come from the kit only. */
export function drawSign(ctx, sign, opts = {}) {
  const dk = !!opts.dark;
  const textStr = fillTemplate(sign.tpl, sign.words);
  const detail = opts.detail !== false;
  ctx.save();
  ctx.fillStyle = dk ? "#4a3a2c" : "#7a5a3a";
  ctx.fillRect(-1, -12, 2, 12);
  const W = detail ? 40 : 18, Hh = detail ? 18 : 8;
  const x = -W / 2, y = -12 - Hh;
  ctx.fillStyle = dk ? "#8a6a48" : "#d9a066";
  ctx.strokeStyle = opts.outline || (dk ? "#2e2218" : "#6b4524");
  ctx.lineWidth = opts.outline ? (opts.lw || 1) : 1.2;
  ctx.beginPath(); ctx.roundRect(x, y, W, Hh, 2.5); ctx.fill(); ctx.stroke();
  if (detail) {
    ctx.strokeStyle = "rgba(90,60,30,0.25)"; ctx.lineWidth = 0.6;
    for (const yy of [y + Hh * 0.33, y + Hh * 0.66]) { ctx.beginPath(); ctx.moveTo(x + 2, yy); ctx.lineTo(x + W - 2, yy); ctx.stroke(); }
    ctx.fillStyle = dk ? "#f4e6c8" : "#3a2410";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    let size = 5.6;
    ctx.font = `700 ${size}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`;
    // wrap into up to 3 lines
    const words = textStr.split(" ");
    let lines = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (ctx.measureText(t).width > W - 5 && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    lines.push(cur);
    while (lines.length > 3 || lines.some((l) => ctx.measureText(l).width > W - 4)) { size -= 0.4; ctx.font = `700 ${size}px ui-rounded, "Trebuchet MS", system-ui, sans-serif`; if (size < 4) break; }
    const lh = size * 1.12;
    lines.forEach((l, i) => ctx.fillText(l, 0, y + Hh / 2 + (i - (lines.length - 1) / 2) * lh));
  }
  ctx.restore();
}

// ===== Free builds: 3D models (F, A) and pictures (G) =====
// Floor units: 16 per cell edge (a = east, b = south). Heights are units too (32 = 70 px). A model fills the whole cell, so shapes of
// next cells meet at the cell edge. The town can turn: a model is drawn from view phase phi (45 degrees = the classic view) and its shapes
// turn truly. Painter order is worked out once per model and per quarter of the turn (the side of each floor axis the viewer stands on);
// still shapes are baked to an offscreen canvas for each 90 degree snap.
const ZU = 2.2; // screen px per height unit (about the same as a floor unit along an edge)
const KU = 2 * Math.SQRT2; // screen px of one floor unit along a turned floor axis
let vcs = Math.SQRT1_2, vsn = Math.SQRT1_2; // cosine and sine of the view phase; set by drawFree
let winSeed = null, lightFill = "rgba(255,214,110,0.92)"; // night: the seed of the cell (lit windows on box faces), and the window colour
let bakeQ = 0; // the quarter of the view being baked
const PU = (a, b, z) => { const da = a - 8, db = b - 8; return [(da * vcs - db * vsn) * KU, (da * vsn + db * vcs) * KU / 2 - z * ZU]; }; // floor units -> screen px from the cell centre
const VZ = Math.SQRT2 / ZU; // the height part of the direction to the viewer (a point moves along it without moving on screen)
/** -1 to 1: how far a face with floor normal (nx, ny) looks to the left on screen (the left faces are the lighter ones). */
const sideLit = (nx, ny) => { const x = nx * vcs - ny * vsn, y = nx * vsn + ny * vcs; return -x / (Math.hypot(x, y) || 1); };
const hx3 = (s) => "#" + s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
const BOX_W = 68, BOX_H = 108, BOX_X = 34, BOX_Y = 90; // the region of a cell a free build can paint (px at zoom 1)
const MAX_BAKED = 64e6; // bytes of baked canvases kept

/** Prepare a stored free build ("free" style: the shapes text; "picture" style: "facing.w.h.pixels"). null when the text is bad. */
export function prepFree(style, text) {
  if (!text) return null;
  if (style === "picture") return prepPicture(readPicture(text));
  const r = parseShapes(text, MAX_SHAPES_CELL);
  return r.ok ? prepModel(r.shapes) : null;
}

function prepPicture(p) {
  if (!p || !(p.w > 0) || !(p.h > 0)) return null;
  const s = Math.min(15 / p.w, 25 / p.h), LEG = 6, M = 0.5;
  const bw = p.w * s, bh = p.h * s, cnt = new Map();
  for (const px of p.pixels) if (px !== "-") cnt.set(px, (cnt.get(px) || 0) + 1);
  let main = "#c9b48a", best = 0;
  for (const [k, n] of cnt) if (n > best) { best = n; main = hx3(k); }
  return { kind: "picture", pic: p, s, bw, bh, leg: LEG, m: M, items: Math.max(1, Math.ceil(p.pixels.length / p.w)), top: (LEG + bh + 2 * M) * ZU + 4, main, moving: false, baked: null };
}

function prepModel(shapes) {
  const n = shapes.length;
  // v grows to the back (north): v 0 is the front, on the south side that people see. Every AI we tested put the front at low v.
  const S = shapes.map((s, i) => ({ ...s, i, col: hx3(s.c), a0: s.u, a1: s.u + s.w, b0: 16 - s.v - s.d, b1: 16 - s.v, z0: s.z, z1: s.z + s.h }));
  const moving = S.some((s) => s.m);
  const groups = [];
  const group = (m, ids, extra) => { // shapes that move together; the box round them is the pivot
    const g = { m, ids, a0: 99, a1: -1, b0: 99, b1: -1, z0: 99, z1: -1, ...extra };
    for (const i of ids) {
      g.a0 = Math.min(g.a0, S[i].a0); g.a1 = Math.max(g.a1, S[i].a1); g.b0 = Math.min(g.b0, S[i].b0); g.b1 = Math.max(g.b1, S[i].b1); g.z0 = Math.min(g.z0, S[i].z0); g.z1 = Math.max(g.z1, S[i].z1);
      S[i].g = g;
    }
    groups.push(g);
    return g;
  };
  for (let m = 1; m <= 5; m++) {
    const ids = [...S.keys()].filter((i) => S[i].m === m);
    if (!ids.length) continue;
    if (m !== 4) { group(m, ids); continue; }
    // flap: wings on the two sides of the cell centre each fold on their own inner edge
    const lo = (k) => Math.min(...ids.map((i) => S[i][k])), hi = (k) => Math.max(...ids.map((i) => S[i][k]));
    const ax = hi("a1") - lo("a0") >= hi("b1") - lo("b0") ? "a" : "b";
    for (const sg of [-1, 1]) {
      const side = ids.filter((i) => ((S[i][ax + "0"] + S[i][ax + "1"]) / 2 < 8 ? -1 : 1) === sg);
      if (!side.length) continue;
      const g = group(4, side, { ax, sg });
      g.h = sg < 0 ? g[ax + "1"] : g[ax + "0"]; // the hinge: the edge nearest the cell centre
    }
  }
  const vol = new Map();
  for (const s of S) vol.set(s.col, (vol.get(s.col) || 0) + s.w * s.d * s.h);
  let main = "#888888", best = 0;
  for (const [k, v] of vol) if (v > best) { best = v; main = k; }
  return { kind: "model", S, groups, items: n, top: Math.max(...S.map((s) => s.z1)) * ZU + 4, main, moving, blink: S.some((s) => s.m === 5), baked: null, views: [null, null, null, null] };
}

/** The painter order of a model for one quarter of the turn: q 0 is the classic view (the viewer is on the high side of both floor axes). */
function viewOf(fr, q) {
  if (fr.views[q]) return fr.views[q];
  const { S } = fr, n = S.length, sa = q === 0 || q === 1 ? 1 : -1, sb = q === 0 || q === 3 ? 1 : -1;
  const key = S.map((s) => sa * (s.a0 + s.a1) / 2 + sb * (s.b0 + s.b1) / 2 + (s.z0 + s.z1) / 2);
  const behind = (A, B) => (sa > 0 ? A.a1 <= B.a0 : A.a0 >= B.a1) || (sb > 0 ? A.b1 <= B.b0 : A.b0 >= B.b1) || A.z1 <= B.z0; // A is on the far side of B on some axis
  const pred = S.map(() => []);
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const ij = behind(S[i], S[j]), ji = behind(S[j], S[i]);
      if (ij && !ji) pred[j].push(i); else if (ji && !ij) pred[i].push(j); // both ways: neither can hide the other
    }
  }
  const seen = new Uint8Array(n), order = [];
  const visit = (i) => { if (seen[i]) return; seen[i] = 1; for (const j of pred[i]) visit(j); order.push(i); };
  for (const i of [...S.keys()].sort((p, r) => key[p] - key[r] || p - r)) visit(i);
  const succ = S.map(() => []);
  pred.forEach((l, i) => l.forEach((j) => succ[j].push(i)));
  const need = new Uint8Array(n); // a still shape that a moving shape must be drawn over
  if (fr.moving) for (let p = n - 1; p >= 0; p--) { const i = order[p]; for (const j of succ[i]) if (S[j].m || need[j]) { need[i] = 1; break; } }
  const pre = order.filter((i) => !S[i].m && (!fr.moving || need[i])), post = fr.moving ? order.filter((i) => !S[i].m && !need[i]) : [];
  const pos = new Map(order.map((i, p) => [i, p]));
  const groups = fr.groups.map((g) => ({ ...g, ids: order.filter((i) => S[i].g === g) })).sort((x, y) => pos.get(x.ids[0]) - pos.get(y.ids[0]));
  return (fr.views[q] = { order, pre, post, groups });
}

// ----- shapes -----
const BOX_FACES = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [3, 2, 6, 7], [0, 3, 7, 4], [1, 2, 6, 5]];
const RAMP_FACES = [[0, 1, 2, 3], [3, 2, 5, 4], [0, 1, 5, 4], [0, 3, 4], [1, 2, 5]];

/** Night: two lit windows on a box face (q = the four corners: bottom start, bottom end, top end, top start). Which ones depends on n only. */
function litWindows(q, n) {
  const a = q[0], b = q[1], t = q[3];
  const P2 = (s, u) => [a[0] + (b[0] - a[0]) * s + (t[0] - a[0]) * u, a[1] + (b[1] - a[1]) * s + (t[1] - a[1]) * u];
  for (let i = 0; i < 2; i++) {
    if ((n + i) % 3 === 0) continue;
    const s0 = 0.22 + i * 0.34, s1 = s0 + 0.2;
    poly([P2(s0, 0.3), P2(s1, 0.3), P2(s1, 0.62), P2(s0, 0.62)], lightFill, false);
  }
}

/** A solid made of flat faces (box, ramp). T moves a point (moving groups), or null. Only the faces that look at the viewer are painted. */
function solid(s, T) {
  const { a0, a1, b0, b1, z0, z1 } = s;
  if (!T && s.k === "b") { // still box: the three faces that show
    const na = vsn >= 0 ? 1 : -1, nb = vcs >= 0 ? 1 : -1, ia = na > 0 ? a1 : a0, ib = nb > 0 ? b1 : b0;
    const fb = [PU(a0, ib, z0), PU(a1, ib, z0), PU(a1, ib, z1), PU(a0, ib, z1)], fa = [PU(ia, b0, z0), PU(ia, b1, z0), PU(ia, b1, z1), PU(ia, b0, z1)];
    poly(fb, shade(s.col, 0.89 + 0.11 * sideLit(0, nb)));
    poly(fa, shade(s.col, 0.89 + 0.11 * sideLit(na, 0)));
    poly([PU(a0, b0, z1), PU(a1, b0, z1), PU(a1, b1, z1), PU(a0, b1, z1)], shade(s.col, 1.1));
    if (winSeed != null && z1 - z0 > 7) {
      const w = (s.i || 0) * 5 + winSeed;
      if (a1 - a0 > 4.8) litWindows(fb, w);
      if (b1 - b0 > 4.8) litWindows(fa, w + 1);
    }
    return;
  }
  const V = s.k === "r"
    ? [[a0, b0, z0], [a1, b0, z0], [a1, b1, z0], [a0, b1, z0], [a0, b0, z1], [a1, b0, z1]]
    : [[a0, b0, z0], [a1, b0, z0], [a1, b1, z0], [a0, b1, z0], [a0, b0, z1], [a1, b0, z1], [a1, b1, z1], [a0, b1, z1]];
  const W = T ? V.map((p) => T(p[0], p[1], p[2])) : V;
  const cen = [0, 0, 0];
  for (const p of W) { cen[0] += p[0] / W.length; cen[1] += p[1] / W.length; cen[2] += p[2] / W.length; }
  for (const f of s.k === "r" ? RAMP_FACES : BOX_FACES) {
    const p0 = W[f[0]], p1 = W[f[1]], p2 = W[f[2]];
    let nx = (p1[1] - p0[1]) * (p2[2] - p0[2]) - (p1[2] - p0[2]) * (p2[1] - p0[1]);
    let ny = (p1[2] - p0[2]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[2] - p0[2]);
    let nz = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-6) continue;
    nx /= len; ny /= len; nz /= len;
    if (nx * (p0[0] - cen[0]) + ny * (p0[1] - cen[1]) + nz * (p0[2] - cen[2]) < 0) { nx = -nx; ny = -ny; nz = -nz; } // point away from the solid
    if (nx * vsn + ny * vcs + nz * VZ <= 1e-6) continue;
    const up = Math.max(0, nz), side = sideLit(nx, ny); // light: top lightest, left side, right side darkest
    poly(f.map((i) => PU(W[i][0], W[i][1], W[i][2])), shade(s.col, (0.89 + 0.11 * side) * (1 - up) + 1.1 * up));
  }
}

/** Screen ellipse of a flat disc or an ellipsoid with half sizes rw, rd (floor) and rh (height, 0 = disc). X, off: the side tangent points. */
function ellipseOf(rw, rd, rh) {
  const k2 = KU * KU, cc = vcs * vcs, ss = vsn * vsn;
  const xx = k2 * (cc * rw * rw + ss * rd * rd), yy = (k2 / 4) * (ss * rw * rw + cc * rd * rd) + ZU * ZU * rh * rh, xy = (k2 / 2) * vcs * vsn * (rw * rw - rd * rd);
  const mean = (xx + yy) / 2, rr = Math.hypot((xx - yy) / 2, xy);
  return { rx: Math.sqrt(mean + rr), ry: Math.sqrt(Math.max(0.01, mean - rr)), rot: 0.5 * Math.atan2(2 * xy, xx - yy), X: Math.sqrt(xx), off: xy / Math.sqrt(xx) };
}

function ball(s, T) {
  const ca = (s.a0 + s.a1) / 2, cb = (s.b0 + s.b1) / 2, cz = (s.z0 + s.z1) / 2;
  const [x, y] = PU(...(T ? T(ca, cb, cz) : [ca, cb, cz]));
  const e = ellipseOf(s.w / 2, s.d / 2, s.h / 2), R = Math.max(e.rx, e.ry);
  const g = c.createRadialGradient(x - e.rx * 0.3, y - e.ry * 0.45, 1, x, y, R);
  g.addColorStop(0, shade(s.col, 1.22)); g.addColorStop(0.55, shade(s.col, 0.98)); g.addColorStop(1, shade(s.col, 0.7));
  c.beginPath(); c.ellipse(x, y, e.rx, e.ry, e.rot, 0, 7); c.fillStyle = g; c.fill();
  c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
}

/** Upright tube (k "t": a flat top) or cone (k "c": a point). */
function roundSolid(s, T) {
  const ca = (s.a0 + s.a1) / 2, cb = (s.b0 + s.b1) / 2;
  const B = PU(...(T ? T(ca, cb, s.z0) : [ca, cb, s.z0])), Tp = PU(...(T ? T(ca, cb, s.z1) : [ca, cb, s.z1]));
  const e = ellipseOf(s.w / 2, s.d / 2, 0), t0 = Math.atan2(-e.ry * Math.sin(e.rot), e.rx * Math.cos(e.rot)); // t0: the right-most point of the base
  c.beginPath();
  if (s.k === "t") {
    c.moveTo(Tp[0] - e.X, Tp[1] - e.off); c.lineTo(B[0] - e.X, B[1] - e.off);
    c.ellipse(B[0], B[1], e.rx, e.ry, e.rot, t0 + Math.PI, t0, true);
    c.lineTo(Tp[0] + e.X, Tp[1] + e.off);
  } else {
    c.moveTo(B[0] - e.X, B[1] - e.off); c.lineTo(Tp[0], Tp[1]); c.lineTo(B[0] + e.X, B[1] + e.off);
    c.ellipse(B[0], B[1], e.rx, e.ry, e.rot, t0, t0 + Math.PI, false);
  }
  c.closePath();
  c.fillStyle = s.k === "t" ? grad(B[0] - e.X, B[0] + e.X, s.col) : grad(B[0] - e.X, B[0] + e.X, s.col, 1.15, 0.7); c.fill();
  c.strokeStyle = OUT(); c.lineWidth = OW(); c.stroke();
  if (s.k === "t") { c.beginPath(); c.ellipse(Tp[0], Tp[1], e.rx, e.ry, e.rot, 0, 7); c.fillStyle = shade(s.col, 1.12); c.fill(); c.stroke(); }
}

function paintShape(s, T) {
  if (s.k === "o") ball(s, T);
  else if (s.k === "t" || s.k === "c") roundSolid(s, T);
  else solid(s, T);
}

// ----- motion -----
/** The point mover of a moving group at t seconds, or null when the group has no movement of points (still, blink). */
function mover(g, t) {
  const pa = (g.a0 + g.a1) / 2, pb = (g.b0 + g.b1) / 2;
  if (g.m === 1) { const dz = 2 * Math.sin(Math.PI * t); return (a, b, z) => [a, b, z + dz]; } // bob: up and down 2 units, 2 s
  if (g.m === 2) { // spin around the group centre, 6 s
    const th = (2 * Math.PI * t) / 6, cs = Math.cos(th), sn = Math.sin(th);
    return (a, b, z) => [pa + (a - pa) * cs - (b - pb) * sn, pb + (a - pa) * sn + (b - pb) * cs, z];
  }
  if (g.m === 3) { // swing: tilts 15 degrees left and right on screen, 3 s, around the foot of the group
    const th = (15 * Math.PI / 180) * Math.sin((2 * Math.PI * t) / 3), cs = Math.cos(th), sn = Math.sin(th);
    return (a, b, z) => {
      const da = a - pa, db = b - pb, dz = z - g.z0, x = da * vcs - db * vsn, d = da * vsn + db * vcs, x2 = x * cs - dz * sn; // x: screen right, d: towards the viewer
      return [pa + d * vsn + x2 * vcs, pb + d * vcs - x2 * vsn, g.z0 + x * sn + dz * cs];
    };
  }
  if (g.m === 4) { // flap: folds up and down 20 degrees on the inner edge (g.h), 0.8 s
    const th = (20 * Math.PI / 180) * Math.sin((2 * Math.PI * t) / 0.8), cs = Math.cos(th), sn = Math.sin(th), { sg, h } = g;
    if (g.ax === "a") return (a, b, z) => { const o = (a - h) * sg, dz = z - g.z0; return [h + sg * (o * cs - dz * sn), b, g.z0 + dz * cs + o * sn]; };
    return (a, b, z) => { const o = (b - h) * sg, dz = z - g.z0; return [a, h + sg * (o * cs - dz * sn), g.z0 + dz * cs + o * sn]; };
  }
  return null;
}
const groupShown = (g, t) => g.m !== 5 || t % 1.2 < 0.6; // blink: on and off, 1.2 s

// ----- baked layers -----
const bakedSet = new Set();
let bakedBytes = 0;
let frameBytes = 0; // bytes of baked layers used so far in this frame
/** Call at the start of each frame. */
export function startBakeFrame() { frameBytes = 0; }
function dropBaked(fr) {
  if (fr.baked) { bakedBytes -= fr.baked.bytes; fr.baked = null; }
  bakedSet.delete(fr);
}
/** Paint one layer of a free build to an offscreen canvas once (per zoom scale, theme and 90 degree snap), then copy it. */
function bake(fr, name, scale, paint) {
  const key = scale + (dark ? "d" : "l") + bakeQ;
  if (!fr.baked || fr.baked.key !== key) { dropBaked(fr); fr.baked = { key, bytes: 0, l: {} }; }
  let oc = fr.baked.l[name];
  if (oc) frameBytes += oc.width * oc.height * 4;
  else {
    const need = Math.ceil(BOX_W * scale) * Math.ceil(BOX_H * scale) * 4;
    if (frameBytes + need > MAX_BAKED) { paint(); return; } // this frame alone is over budget: draw unbaked, do not evict and re-bake every frame
    frameBytes += need;
    oc = document.createElement("canvas");
    oc.width = Math.ceil(BOX_W * scale); oc.height = Math.ceil(BOX_H * scale);
    const x = oc.getContext("2d"), prev = c;
    x.setTransform(scale, 0, 0, scale, BOX_X * scale, BOX_Y * scale);
    c = x; paint(); c = prev;
    const bytes = oc.width * oc.height * 4;
    fr.baked.l[name] = oc; fr.baked.bytes += bytes; bakedBytes += bytes;
    bakedSet.add(fr);
    for (const old of bakedSet) { if (bakedBytes <= MAX_BAKED) break; if (old !== fr) dropBaked(old); }
  }
  bakedSet.delete(fr); bakedSet.add(fr); // most recently used last
  c.drawImage(oc, -BOX_X, -BOX_Y, oc.width / scale, oc.height / scale);
}

// ----- pictures -----
function drawPicture(fr, o) {
  const { pic, s, bw, bh, leg, m } = fr, W = pic.w, east = pic.facing === "e";
  const frame = "#e6d3ad", wood = "#8a6a48";
  const f0 = 8 - bw / 2 - m, f1 = 8 + bw / 2 + m, zt = leg + bh; // the board spans f0..f1 along its edge
  const bx = (a0, a1, b0, b1, z0, z1, col) => solid({ k: "b", a0, a1, b0, b1, z0, z1, col }, null);
  const stand = (k) => { const p = f0 + (f1 - f0) * k; if (east) bx(7.5, 8.5, p - 0.5, p + 0.5, 0, leg, wood); else bx(p - 0.5, p + 0.5, 7.5, 8.5, 0, leg, wood); };
  const far = (east ? vcs >= 0 : vsn >= 0) ? 0.15 : 0.85; // the leg on the far side first, the board, the near leg
  stand(far);
  if (east) bx(7.5, 8.5, f0, f1, leg, zt + 2 * m, frame); else bx(f0, f1, 7.5, 8.5, leg, zt + 2 * m, frame);
  stand(1 - far);
  if (east ? vsn <= 0 : vcs <= 0) return; // the picture side looks away from the viewer: only the plain back shows
  const rows = o.upTo == null ? fr.items : Math.min(fr.items, o.upTo), dim = dark ? 0.85 : 1;
  const [ox, oy] = east ? PU(8.5, 8 + bw / 2, zt + m) : PU(8 - bw / 2, 8.5, zt + m);
  c.save();
  // pixel column and row steps on the board's face: columns run along -b (east face) or +a (south face), rows run down
  c.transform(s * (east ? vsn : vcs) * KU, s * (east ? -vcs : vsn) * KU / 2, 0, ZU * s, ox, oy);
  for (let r = 0; r < rows; r++) {
    const lift = o.pop != null && r === rows - 1 ? (1 - o.pop) * 1.4 : 0;
    for (let i = 0; i < W;) {
      const px = pic.pixels[r * W + i];
      if (px === undefined) break;
      let j = i + 1;
      while (j < W && pic.pixels[r * W + j] === px) j++;
      if (px !== "-") {
        c.fillStyle = `rgb(${cl(parseInt(px[0], 16) * 17 * dim)},${cl(parseInt(px[1], 16) * 17 * dim)},${cl(parseInt(px[2], 16) * 17 * dim)})`;
        c.fillRect(i - 0.01, r - lift - 0.01, j - i + 0.02, 1.02);
      }
      i = j;
    }
  }
  c.restore();
}

/**
 * Draw a prepared free build with the cell centre at the origin. o = {dark, now (ms), motion, scale (baked canvas scale; none = no baking,
 * only for a view on a 90 degree snap), phi (view phase, default 45 degrees = the classic view), outline (the --outline colour), light (the
 * --night-light colour), seed (a number for the lit windows at night), upTo (while the bot builds: how many shapes or picture rows show),
 * pop (0-1, how far the newest piece has settled)}.
 */
export function drawFree(ctx, fr, o) {
  c = ctx; dark = !!o.dark;
  outline = o.outline || (dark ? "rgba(5,8,22,0.75)" : "rgba(58,42,26,0.6)"); lineW = o.lw || 1;
  const phi = o.phi ?? Math.PI / 4;
  vcs = Math.cos(phi); vsn = Math.sin(phi);
  bakeQ = ((Math.floor(phi / (Math.PI / 2)) % 4) + 4) % 4;
  if (o.light && o.light !== nightLight) { nightLight = o.light; const [r, g, b] = hex(nightLight); lightFill = `rgba(${r},${g},${b},0.92)`; }
  winSeed = dark && o.seed != null ? o.seed : null;
  const t = o.now / 1000;
  if (fr.kind === "picture") {
    winSeed = null;
    if (o.upTo != null || !o.scale) drawPicture(fr, o);
    else bake(fr, "p", o.scale, () => drawPicture(fr, o));
    return;
  }
  const S = fr.S, V = viewOf(fr, bakeQ);
  const live = (g, gi) => { // a moving group, drawn each frame
    if (!groupShown(g, t)) return;
    if (o.scale && (!o.motion || g.m === 1 || g.m === 5)) { // at rest, bob and blink do not change the drawing: a baked copy, moved for bob
      c.save(); c.translate(0, o.motion && g.m === 1 ? -2 * Math.sin(Math.PI * t) * ZU : 0);
      bake(fr, "g" + gi, o.scale, () => { for (const i of g.ids) paintShape(S[i], null); });
      c.restore();
      return;
    }
    const T = o.motion ? mover(g, t) : null;
    for (const i of g.ids) paintShape(S[i], T);
  };
  if (o.upTo != null) { // the bot is building: shapes show in the AI's order, painted back to front
    for (const i of V.order) {
      if (i >= o.upTo) continue;
      const s = S[i], g = s.g;
      if (g && !groupShown(g, t)) continue;
      let T = g && o.motion ? mover(g, t) : null;
      if (i === o.upTo - 1 && o.pop != null) { const T0 = T, dz = (1 - o.pop) * 5; T = (a, b, z) => { const p = T0 ? T0(a, b, z) : [a, b, z]; return [p[0], p[1], p[2] + dz]; }; }
      paintShape(s, T);
    }
    return;
  }
  const layer = (ids) => () => { for (const i of ids) paintShape(S[i], null); };
  if (!o.scale) { layer(V.pre)(); V.groups.forEach(live); layer(V.post)(); return; }
  if (V.pre.length) bake(fr, "pre", o.scale, layer(V.pre));
  V.groups.forEach(live);
  if (V.post.length) bake(fr, "post", o.scale, layer(V.post));
}

/** Night: the lit spots of a model at view phase phi, in px from the cell centre: one per blinking shape that is on now, with a beam
 * (two end points) when the shape is high up. null when the model has no blinking part. seed varies the beam angle between cells. */
export function glowOf(fr, now, phi, seed = 0) {
  if (fr.kind !== "model" || !fr.blink) return null;
  vcs = Math.cos(phi); vsn = Math.sin(phi);
  const t = now / 1000, out = [];
  for (const s of fr.S) {
    if (s.m !== 5 || !groupShown(s.g, t)) continue;
    const ca = (s.a0 + s.a1) / 2, cb = (s.b0 + s.b1) / 2, cz = (s.z0 + s.z1) / 2, [x, y] = PU(ca, cb, cz), g = { x, y, beam: null };
    if (s.z0 > 14) {
      const ang = now / 1300 + seed * 0.7, L = 51, sp = 0.16;
      const p1 = PU(ca + Math.cos(ang - sp) * L, cb + Math.sin(ang - sp) * L, cz), p2 = PU(ca + Math.cos(ang + sp) * L, cb + Math.sin(ang + sp) * L, cz);
      g.beam = [p1[0], p1[1], p2[0], p2[1]];
    }
    out.push(g);
  }
  return out;
}
