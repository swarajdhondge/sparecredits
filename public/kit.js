// Spare Credits kit, format "cm1". Shared by the Worker and the browser.
// Frozen once launched: new items may be added at the END of a list, old ones never change.
// Pure functions only. No AI, no free text: every value comes from the lists below.

export const VERSION = "cm1";
/** Bump when agent.txt changes. Chat AIs (ChatGPT, Claude) keep old copies of a page; a new ?v= makes them read it again. */
export const GUIDE_V = "11";
/** The sentence our prompts add so the AI tags what it builds (K is free). */
export const TAG_HINT = "After each build, tag it with K.x.y and 1-3 words for what it is, for example K.100.100.robot.";
/** Links to the guide and the map that chat AIs read fresh: the guide version plus a stamp that changes every 10 minutes. */
export function freshLinks(origin, now = Date.now()) {
  const v = `${GUIDE_V}-${Math.floor(now / 600000).toString(36)}`;
  return { guide: `${origin}/agent.txt?v=${v}`, world: `${origin}/v1/world.txt?v=${v}` };
}
export const GRID = 200;
// The map is stored on a 200 x 200 grid, but only the open area in the middle accepts commands.
// It starts as OPEN_START x OPEN_START around the center, and grows by OPEN_STEP cells on every side
// when OPEN_FILL of its cells hold a building, up to the whole grid.
export const CENTER = 100;
export const OPEN_START = 40;
export const OPEN_STEP = 5;
export const OPEN_FILL = 0.7;
export const CHUNK_SHIFT = 6; // chunk = cell >> 6, so 64 x 64 cells per chunk
export const MAX_RINGS = (GRID - OPEN_START) / (2 * OPEN_STEP);

/** Open area after `rings` growth steps: {x0, y0, x1, y1} (inclusive cell range). */
export function openArea(rings) {
  const k = Math.max(0, Math.min(MAX_RINGS, rings | 0));
  const lo = CENTER - OPEN_START / 2 - k * OPEN_STEP;
  const hi = CENTER + OPEN_START / 2 - 1 + k * OPEN_STEP;
  return { x0: lo, y0: lo, x1: hi, y1: hi };
}
export function inArea(a, x, y) {
  return x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1;
}
/** Rings needed so that `buildings` fill less than OPEN_FILL of the open area (never below `rings`). */
export function growRings(rings, buildings) {
  let k = rings;
  while (k < MAX_RINGS) {
    const a = openArea(k);
    const cells = (a.x1 - a.x0 + 1) * (a.y1 - a.y0 + 1);
    if (buildings < cells * OPEN_FILL) break;
    k++;
  }
  return k;
}
export const MAX_LINE = 1500;
export const MAX_CMDS = 12;
export const PLAN_MAX_CMDS = 40; // a plan line: P plus B and E commands, T not counted
// free build (v7): F model, A add shapes, G picture
export const SHAPE_KINDS = ["b", "o", "t", "c", "r"]; // box, ball, tube, cone, ramp
export const MAX_SHAPES_CMD = 100; // shapes in one F or A
export const MAX_SHAPES_CELL = 400; // shapes in one cell
export const MAX_MOVING = 40; // shapes with motion 1-5 in one cell
export const PIC_MIN = 4;
export const PIC_MAX = 32;
export const PIC_PIXELS = 1024;
export const PLAN_CODE = /^[A-Za-z0-9_-]{6}$/;

export const TEAMS = ["claude", "chatgpt", "gemini", "other"];
export const TEAM_LABELS = { claude: "Claude", chatgpt: "ChatGPT", gemini: "Gemini", other: "another AI" };

export const STYLES = [
  "cottage", "house", "townhouse", "shop", "bakery", "inn", "cabin", "barn",
  "farmhouse", "tower", "lighthouse", "windmill", "castle", "chapel", "pagoda", "temple",
  "dome", "hall", "workshop", "factory", "greenhouse", "treehouse", "tent", "igloo",
  // added in v2 (end of list, old ids never change)
  "ship", "dock", "statue", "arch", "gate", "wall", "bridge", "fountain",
  "plot", "park", "stadium", "observatory", "museum", "school", "stall", "ruins",
  "crystal", "rocket",
];

export const PARTS = [
  "wing", "porch", "balcony", "chimney", "garden", "dome", "spire", "turret",
  "awning", "stairs", "fence", "pond", "tree", "lantern", "flag", "sails",
  // added in v2
  "bench", "well", "trellis", "antenna", "crate", "boat", "cart", "haystack",
  "bush", "rocks", "windvane", "lamppost",
];

export const SIDES = ["n", "e", "s", "w"];

export const PALETTES = [
  "sunrise", "mint", "lavender", "brick", "sand", "sky", "rose", "forest",
  "ocean", "plum", "honey", "slate", "coral", "snow", "mustard", "midnight",
];

// {1} {2} {3} are filled with words. Count of slots is the number of words needed.
export const TEMPLATES = [
  "Beware of {1} ahead",
  "Praise the {1}!",
  "{1} and {2}, then {3}",
  "Try {1}, but beware of {2}",
  "Could this be a {1}?",
  "Amazing {1} ahead!",
  "Ahh, {1}... why is it always {2}?",
  "Behold, {1}!",
  "{1} required ahead",
  "Visions of {1}...",
  "Be wary of {1} and {2}",
  "Time for {1}, {2}, {3}!",
];

// Word classes. No body, sex, slur, drug or violence words, and no words with common double meanings.
export const WORD_CLASSES = {
  places: "castle tower bridge garden market harbor meadow village cellar attic lighthouse forest cave hill valley island river lake pond orchard farm mill chapel square fountain library tavern bakery workshop street hilltop cliff beach grove canal bay cove dune glade marsh moor ridge summit trail path tunnel plaza lane avenue terrace courtyard station school museum stadium observatory palace shrine temple cottage cabin lagoon canyon prairie oasis".split(" "),
  things: "lamp lantern key coffer door ladder barrel crate bell clock mirror book scroll candle basket bucket wheel anvil chair table bench flag banner coin gem crown shield compass map kettle teapot umbrella ribbon trumpet feather pebble marble thimble quilt blanket vase bottle cup broom kite balloon whistle drum flute harp violin bugle telescope globe trophy medal ticket postcard letter puzzle crayon brush easel".split(" "),
  food: "bread cheese soup apple pear berry honey cake cookie pie noodle rice stew pancake waffle biscuit pudding jam butter carrot potato turnip pumpkin tomato olive lemon almond walnut porridge dumpling pretzel toast cereal oatmeal granola yogurt cocoa tea juice lemonade cider pasta pizza sandwich salad chowder cinnamon caramel toffee donut bagel croissant custard popcorn peanut hazelnut apricot mango kiwi coconut pineapple strawberry blueberry raspberry spinach cabbage".split(" "),
  animals: "kitten puppy rabbit fox owl crow sparrow swan goose duck frog toad turtle snail beetle moth bee ant spider mouse badger hedgehog otter deer sheep goat pony dragon whale crab seal heron squirrel lizard penguin panda koala llama alpaca zebra giraffe elephant tiger lion bear wolf parrot pelican flamingo robin finch wren eagle falcon hawk dolphin starfish salmon ladybug cricket firefly dragonfly bunny".split(" "),
  weather: "sun moon star cloud rain snow fog mist storm wind breeze thunder rainbow frost dew sunrise sunset dusk dawn twilight drizzle hail blizzard gale sunbeam moonlight starlight heatwave autumn spring winter summer sunshine downpour thaw icicle snowflake snowfall lightning aurora horizon daybreak midnight noon evening morning sunrays".split(" "),
  feelings: "joy hope calm cheer luck wonder courage pride peace comfort delight mischief laughter kindness patience mystery nostalgia bliss glee warmth trust wisdom awe worry boredom sleepiness hunger curiosity surprise gloom sorrow happiness friendship harmony serenity bravery fun cozy jolly merry hopeful proud gentle brave kind cheerful dreamy snug relief joyful grateful".split(" "),
  actions: "jumping dancing singing napping waiting looking running resting wandering hiding climbing sailing fishing baking painting reading whistling skipping floating digging planting gardening juggling stargazing strolling splashing hopping drifting wishing building exploring swimming skating skiing sledding surfing rowing hiking camping cooking knitting sewing drawing writing dreaming laughing smiling waving bowing twirling spinning gliding soaring flying marching parading picnicking gathering celebrating cheering".split(" "),
  directions: "north south east west left right up down above below ahead forward backward near far outside around beyond onward upward homeward uphill downhill downward inside within nearby afar northward southward eastward westward sideways across between beside overhead".split(" "),
  silly: "wobble giggle kazoo banjo bubble snazzy fuzzy squishy gizmo doodle widget trinket gadget gumdrop jellybean sprinkle confetti pompom tumble zigzag zany whimsy flummox balderdash doohickey thingamajig puffball bumble mumble razzmatazz hullabaloo kerfuffle shenanigans kaboom pizzazz skedaddle bamboozle hoopla jamboree oddball wacky goofy loopy sparkle fizz buzz boing zoom splat woosh twinkle glitter fluffy bouncy crumbly bubbly snuggle".split(" "),
};

// Blocked class pairs: a sign may not use words from these two classes together.
// Start small. Reason: verbs next to animals, food or feelings can read as innuendo.
export const BLOCKED_COMBOS = [
  ["actions", "animals"],
  ["actions", "food"],
  ["feelings", "animals"],
];

// The tags class: nouns for K (build tags) only. It is NOT in WORD_CLASSES, so signs, plan names and group names never take these words
// and no blocked pair applies to them. Words already in the kit (word list, styles, parts) are left out.
export const TAG_WORDS = [
  "computer phone robot car bus train bicycle plane truck tractor camera guitar piano toy gift game sign",
  "flower tulip sunflower cactus mushroom leaf palm pine oak grass mountain volcano wave",
  "cat dog bird fish horse cow pig chicken octopus butterfly dinosaur unicorn shark",
  "burger sushi taco icecream",
  "home cafe",
  "knight wizard pirate astronaut alien ghost monster princess king queen",
  "pixel portrait logo heart smile art photo",
  "blue green orange purple pink gold silver gray", // colours; black, white, brown, yellow and red are left out so no tag pair reads as a skin colour with a person word
].join(" ").split(" ");
export const MAX_TAGS = 3;

export const WORD_CLASS = (() => {
  const m = {};
  for (const [cls, words] of Object.entries(WORD_CLASSES)) for (const w of words) m[w] = cls;
  return m;
})();
export const WORDS = Object.keys(WORD_CLASS);

/** "a" or "an" before a word, by its first letter (all kit words are plain English). */
export function aAn(word) {
  if (PLURAL_PARTS.has(word)) return "";
  return /^[aeiou]/i.test(word) ? "an" : "a";
}
const PLURAL_PARTS = new Set(["sails", "stairs", "rocks"]);

/** Find the first kit line ("cm1;...") in any pasted text: a bare line, a code block, or inside a URL (also percent-encoded). */
export function extractKitLine(text) {
  if (typeof text !== "string") return "";
  const variants = [text];
  try { variants.push(decodeURIComponent(text)); } catch { /* keep raw only */ }
  for (const t of variants) {
    const m = /cm1;[A-Za-z0-9._;-]*/i.exec(t);
    if (m) return m[0].replace(/[.;_-]+$/, "");
  }
  return "";
}

/** Template list with exact word counts, e.g. "t1 (1 word) Beware of {1} ahead". */
export function templateLines() {
  return TEMPLATES.map((t, i) => {
    const n = templateSlots(i + 1);
    return `t${i + 1} (${n} word${n === 1 ? "" : "s"}) ${t}`;
  });
}

export function templateSlots(tpl) {
  const t = TEMPLATES[tpl - 1];
  return t.match(/\{\d\}/g).length;
}

export function fillTemplate(tpl, words) {
  const t = TEMPLATES[tpl - 1];
  if (!t) return "";
  return t.replace(/\{(\d)\}/g, (_, n) => words[Number(n) - 1] || "").replace(/\s+/g, " ").trim();
}

// ---------- parser ----------

const CHARS = /^[A-Za-z0-9._-]*$/;
const INT = /^\d{1,4}$/;

function err(code, message) {
  return { ok: false, code, message };
}

function num(s, name, lo, hi) {
  if (s === undefined || s === "") return err("wrong_arity", `missing ${name}`);
  if (!INT.test(s)) return err("bad_number", `${name} must be a whole number`);
  const n = Number(s);
  if (n < lo || n > hi) return err(name === "h" ? "bad_height" : "out_of_range", `${name} must be ${lo}-${hi}`);
  return { ok: true, n };
}

function parseCell(f) {
  const x = num(f[1], "x", 0, GRID - 1);
  if (!x.ok) return x;
  const y = num(f[2], "y", 0, GRID - 1);
  if (!y.ok) return y;
  return { ok: true, x: x.n, y: y.n };
}

export function classOf(word) {
  return WORD_CLASS[word];
}

export function blockedCombo(words) {
  const classes = words.map(classOf);
  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      for (const [a, b] of BLOCKED_COMBOS) {
        if ((classes[i] === a && classes[j] === b) || (classes[i] === b && classes[j] === a)) return true;
      }
    }
  }
  return false;
}

/** Plan name from two list words, title-cased: ["sunrise","harbor"] -> "Sunrise Harbor". */
export function planName(words) {
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

/** The error for two plan or group name words, or null. Names may use list words and also building styles and parts ("Harbor Ship"). */
function groupWordsError(words) {
  for (const w of words) if (!WORD_CLASS[w] && !STYLES.includes(w) && !PARTS.includes(w)) return err("unknown_word", `'${w.slice(0, 16)}' is not in the word list, styles or parts`);
  if (blockedCombo(words.filter((w) => WORD_CLASS[w]))) return err("blocked_combo", "these words may not be used together");
  return null;
}

/** Group colour: a stable hash of the id "word1.word2" to a palette index 0-15 (FNV-1a). */
export function groupColor(id) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h % 16;
}

/** The group id from a page address part like "harbor-foxes" ("harbor.foxes"), or null when it is not two valid words. */
export function groupFromSlug(slug) {
  const f = String(slug).split("-");
  if (f.length !== 2) return null;
  const r = parseCommand(`J.${f[0]}.${f[1]}`);
  return r.ok ? r.cmd.id : null;
}

// ---------- free build: shapes and pictures ----------

const SMALL = /^\d{1,2}$/;
const HEX3 = /^[0-9a-f]{3}$/i;
const HEX6 = /^[0-9a-f]{6}$/i;
const PIXEL_TOKEN = /^(?:(\d{1,4})x)?([0-9a-f]{6}|[0-9a-f]{3}|-)$/i;

/** 3 or 6 hex digits -> the 3-digit lower-case form (6 digits: each channel rounded to the nearest of 16 levels). Else null. */
function hex3(s) {
  if (HEX3.test(s)) return s.toLowerCase();
  if (!HEX6.test(s)) return null;
  let o = "";
  for (let i = 0; i < 6; i += 2) o += Math.round(parseInt(s.slice(i, i + 2), 16) / 17).toString(16);
  return o;
}

function shapeNum(s, n, name, lo, hi) {
  if (s === undefined || !SMALL.test(s) || Number(s) < lo || Number(s) > hi) return err("bad_shape", `shape ${n}: ${name} must be a whole number ${lo}-${hi}`);
  return { ok: true, n: Number(s) };
}

/** One shape "k-u-v-z-w-d-h-rgb[-m]" (n = its 1-based place, for messages). */
function parseShape(t, n) {
  const f = t.split("-");
  if (f.length < 8 || f.length > 9) return err("bad_shape", `shape ${n}: needs k-u-v-z-w-d-h-rgb[-m], got ${f.length} field${f.length === 1 ? "" : "s"}`);
  const k = f[0].toLowerCase();
  if (!SHAPE_KINDS.includes(k)) return err("bad_shape", `shape ${n}: k must be ${SHAPE_KINDS.join(", ")}`);
  const val = {};
  for (const [name, i, lo, hi] of [["u", 1, 0, 15], ["v", 2, 0, 15], ["z", 3, 0, 31], ["w", 4, 1, 16], ["d", 5, 1, 16], ["h", 6, 1, 32]]) {
    const r = shapeNum(f[i], n, name, lo, hi);
    if (!r.ok) return r;
    val[name] = r.n;
  }
  const c = hex3(f[7]);
  if (!c) return err("bad_shape", `shape ${n}: rgb must be 3 or 6 hex digits, like f80`);
  let m = 0;
  if (f.length === 9) {
    const r = shapeNum(f[8], n, "m", 0, 5);
    if (!r.ok) return r;
    m = r.n;
  }
  if (val.u + val.w > 16) return err("shape_outside", `shape ${n}: u+w is ${val.u + val.w}, must be at most 16`);
  if (val.v + val.d > 16) return err("shape_outside", `shape ${n}: v+d is ${val.v + val.d}, must be at most 16`);
  if (val.z + val.h > 32) return err("shape_outside", `shape ${n}: z+h is ${val.z + val.h}, must be at most 32`);
  return { ok: true, shape: { k, u: val.u, v: val.v, z: val.z, w: val.w, d: val.d, h: val.h, c, m } };
}

/** Shapes text "shape_shape_..." -> {ok:true, shapes} or an error. `max` = most shapes allowed (a command: 100; a stored cell: 400). */
export function parseShapes(text, max = MAX_SHAPES_CMD) {
  const parts = String(text).split("_");
  if (parts.length > max) return err("too_many_shapes", `at most ${max} shapes here, got ${parts.length}`);
  const shapes = [];
  let moving = 0;
  for (let i = 0; i < parts.length; i++) {
    const r = parseShape(parts[i], i + 1);
    if (!r.ok) return r;
    if (r.shape.m) moving++;
    shapes.push(r.shape);
  }
  if (moving > MAX_MOVING) return err("too_many_shapes", `at most ${MAX_MOVING} moving shapes (m 1-5), got ${moving}`);
  return { ok: true, shapes };
}

export function formatShapes(shapes) {
  return shapes.map((s) => `${s.k}-${s.u}-${s.v}-${s.z}-${s.w}-${s.d}-${s.h}-${s.c}${s.m ? `-${s.m}` : ""}`).join("_");
}

/** Pixel text -> {ok:true, pixels} with one "rgb" or "-" per pixel. Tokens split by "_": rgb, "-" (clear), or a run NxRGB / Nx- (12xfff). */
export function decodePixels(text) {
  if (!text) return err("bad_picture", "no pixels");
  const out = [];
  const toks = String(text).split("_");
  for (let i = 0; i < toks.length; i++) {
    const m = PIXEL_TOKEN.exec(toks[i]);
    if (!m) return err("bad_picture", `pixel token ${i + 1} '${toks[i].slice(0, 12)}' must be rgb (3 or 6 hex digits), - (clear) or a run like 12xfff or 12x-`);
    const n = m[1] ? Number(m[1]) : 1;
    if (n < 1) return err("bad_picture", `pixel token ${i + 1}: a run must be at least 1`);
    if (out.length + n > PIC_PIXELS) return err("bad_picture", `a picture holds at most ${PIC_PIXELS} pixels`);
    const c = m[2] === "-" ? "-" : hex3(m[2]);
    for (let j = 0; j < n; j++) out.push(c);
  }
  return { ok: true, pixels: out };
}

/** Array of "rgb" or "-" -> canonical text: lower-case, equal neighbours joined into runs. */
export function encodePixels(px) {
  const toks = [];
  for (let i = 0; i < px.length;) {
    let j = i;
    while (j < px.length && px[j] === px[i]) j++;
    toks.push(j - i > 1 ? `${j - i}x${px[i]}` : px[i]);
    i = j;
  }
  return toks.join("_");
}

/** Stored text of a picture is "facing.w.h.pixels". Returns {facing, w, h, pixels} (pixels may be fewer than w*h), or null. */
export function readPicture(text) {
  const f = String(text).split(".");
  if (f.length !== 4) return null;
  const d = decodePixels(f[3]);
  return d.ok ? { facing: f[0], w: Number(f[1]), h: Number(f[2]), pixels: d.pixels } : null;
}

/** Main colour of each of the 16 palettes (the overview dot colour; same as PAL[i][1] in js/buildings.js). */
export const PAL_MAIN = ["#e8704f", "#4f9e86", "#8a6fc7", "#5b3a35", "#b5834f", "#4d7fc4", "#cf5c7c", "#3f7a45", "#2a7f93", "#6e3a6e", "#d28a21", "#4a5163", "#d9503d", "#7c93b8", "#8a6a1e", "#262a54"];

/** The palette whose main colour is nearest to the most used colour (weights: rgb -> amount). Free builds store it as pal, so the overview shows their colour. */
export function nearestPal(weights) {
  let best = "", bw = -1;
  for (const [c, w] of Object.entries(weights)) if (w > bw) { best = c; bw = w; }
  if (!best) return 0;
  const rgb = (h) => h.length === 4 ? [1, 2, 3].map((i) => parseInt(h[i] + h[i], 16)) : [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = rgb("#" + best);
  let pi = 0, pd = Infinity;
  PAL_MAIN.forEach((h, i) => { const b = rgb(h); const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < pd) { pd = d; pi = i; } });
  return pi;
}
const shapesPal = (shapes) => { const w = {}; for (const s of shapes) w[s.c] = (w[s.c] || 0) + s.w * s.d * s.h; return nearestPal(w); };
const pixelsPal = (px) => { const w = {}; for (const c of px) if (c !== "-") w[c] = (w[c] || 0) + 1; return nearestPal(w); };

/** Height of a free build for the overview: a size of 1-32 becomes 1-9. */
export const freeHeight = (n) => Math.max(1, Math.min(9, Math.ceil((n * 9) / 32)));

/**
 * What an F, A or G command makes. prevStyle and prevShape are the cell's current style and shape (A and G with "add" build on them).
 * Returns {ok:true, style:"free"|"picture", h, pal, shape} or {ok:false, code, message}. Whether the visit owns the cell is the caller's job.
 */
export function freeBuild(cmd, prevStyle, prevShape) {
  if (cmd.v === "F") {
    return { ok: true, style: "free", h: freeHeight(Math.max(...cmd.shapes.map((s) => s.z + s.h))), pal: shapesPal(cmd.shapes), shape: formatShapes(cmd.shapes) };
  }
  if (cmd.v === "A") {
    const old = prevStyle === "free" && prevShape ? parseShapes(prevShape, MAX_SHAPES_CELL) : null;
    if (!old || !old.ok) return err("not_your_model", "A adds to a 3D model that your visit made on that cell");
    const shapes = old.shapes.concat(cmd.shapes);
    if (shapes.length > MAX_SHAPES_CELL) return err("too_many_shapes", `a cell holds at most ${MAX_SHAPES_CELL} shapes, this makes ${shapes.length}`);
    const moving = shapes.filter((s) => s.m).length;
    if (moving > MAX_MOVING) return err("too_many_shapes", `a cell holds at most ${MAX_MOVING} moving shapes, this makes ${moving}`);
    return { ok: true, style: "free", h: freeHeight(Math.max(...shapes.map((s) => s.z + s.h))), pal: shapesPal(shapes), shape: formatShapes(shapes) };
  }
  let pixels = cmd.pixels;
  if (cmd.more) {
    const old = prevStyle === "picture" && prevShape ? readPicture(prevShape) : null;
    if (!old || old.facing !== cmd.facing || old.w !== cmd.w || old.h !== cmd.h) return err("not_your_model", "G with add needs a picture of your visit on that cell with the same facing, w and h");
    pixels = old.pixels.concat(cmd.pixels);
  }
  if (pixels.length > cmd.w * cmd.h) return err("bad_picture", `a ${cmd.w} x ${cmd.h} picture holds ${cmd.w * cmd.h} pixels, this makes ${pixels.length}`);
  return { ok: true, style: "picture", h: freeHeight(cmd.h), pal: pixelsPal(pixels), shape: `${cmd.facing}.${cmd.w}.${cmd.h}.${encodePixels(pixels)}` };
}

function parseFree(verb, f) {
  const cell = parseCell(f);
  if (!cell.ok) return cell;
  const { x, y } = cell;
  if (verb === "F" || verb === "A") {
    if (f.length !== 4) return err("wrong_arity", `${verb} needs x.y.shapes, got ${f.length - 1} values`);
    const r = parseShapes(f[3]);
    if (!r.ok) return r;
    return { ok: true, cmd: { v: verb, x, y, shapes: r.shapes } };
  }
  const more = f[6] !== undefined && f[6].toLowerCase() === "add";
  if (f.length !== (more ? 8 : 7)) return err("wrong_arity", "G needs x.y.facing.w.h.pixels, or x.y.facing.w.h.add.pixels to continue");
  const facing = f[3].toLowerCase();
  if (facing !== "s" && facing !== "e") return err("bad_picture", "facing must be s or e");
  const dims = [];
  for (const [name, s] of [["w", f[4]], ["h", f[5]]]) {
    if (!SMALL.test(s) || Number(s) < PIC_MIN || Number(s) > PIC_MAX) return err("bad_picture", `${name} must be a whole number ${PIC_MIN}-${PIC_MAX}`);
    dims.push(Number(s));
  }
  const d = decodePixels(f[more ? 7 : 6]);
  if (!d.ok) return d;
  if (d.pixels.length > dims[0] * dims[1]) return err("bad_picture", `a ${dims[0]} x ${dims[1]} picture holds ${dims[0] * dims[1]} pixels, got ${d.pixels.length}`);
  return { ok: true, cmd: { v: "G", x, y, facing, w: dims[0], h: dims[1], more, pixels: d.pixels } };
}

/** Parse one command like "B.12.7.tower.5.3.42". Returns {ok:true, cmd} or {ok:false, code, message}. */
export function parseCommand(raw) {
  if (!raw) return err("empty", "empty command");
  if (!CHARS.test(raw)) return err("bad_chars", "only letters, digits and . _ - are allowed");
  const f = raw.split(".");
  const verb = f[0].toUpperCase();
  if (verb === "T") {
    if (f.length !== 2) return err("wrong_arity", "T needs 1 value (the team), e.g. T.claude");
    const team = f[1].toLowerCase();
    if (!TEAMS.includes(team)) return err("bad_team", `team must be one of: ${TEAMS.join(", ")}`);
    return { ok: true, cmd: { v: "T", team } };
  }
  if (verb === "P") {
    if (f.length !== 3) return err("wrong_arity", "P needs 2 words, e.g. P.sunrise.harbor");
    const words = [f[1].toLowerCase(), f[2].toLowerCase()];
    const bad = groupWordsError(words);
    if (bad) return bad;
    return { ok: true, cmd: { v: "P", words, name: planName(words) } };
  }
  if (verb === "J") {
    if (f.length !== 3) return err("wrong_arity", "J needs 2 words, e.g. J.harbor.foxes");
    const words = [f[1].toLowerCase(), f[2].toLowerCase()];
    const bad = groupWordsError(words);
    if (bad) return bad;
    return { ok: true, cmd: { v: "J", words, id: words.join("."), name: planName(words) } };
  }
  if (verb === "K") {
    if (f.length < 4 || f.length > 3 + MAX_TAGS) return err("wrong_arity", `K needs x.y and 1-${MAX_TAGS} words, e.g. K.100.100.tree.lantern`);
    const cell = parseCell(f);
    if (!cell.ok) return cell;
    const all = f.slice(3).map((w) => w.toLowerCase());
    // unknown words are dropped, not fatal: "robot.shiny" still tags robot. Only a K with no known word fails.
    const known = (w) => TAG_WORDS.includes(w) || WORD_CLASS[w] || STYLES.includes(w) || PARTS.includes(w);
    const words = all.filter(known);
    const dropped = all.filter((w) => !known(w)).map((w) => w.slice(0, 16));
    if (!words.length) return err("unknown_word", `'${all[0].slice(0, 16)}' is not in the word list, styles, parts or tags`);
    if (new Set(words).size !== words.length) return err("dup_word", "a tag word may be used once");
    if (blockedCombo(words)) return err("blocked_combo", "these words may not be used together");
    return { ok: true, cmd: { v: "K", x: cell.x, y: cell.y, words, ...(dropped.length ? { dropped } : {}) } };
  }
  if (verb === "F" || verb === "A" || verb === "G") return parseFree(verb, f);
  if (!["B", "E", "S", "C"].includes(verb)) return err("unknown_verb", `unknown verb '${f[0].slice(0, 12)}'`);
  const need = { B: 7, E: 6, C: 3 };
  if (verb !== "S" && f.length !== need[verb]) return err("wrong_arity", `${verb} needs ${need[verb] - 1} values, got ${f.length - 1}`);
  const cell = parseCell(f);
  if (!cell.ok) return cell;
  const { x, y } = cell;
  if (verb === "C") return { ok: true, cmd: { v: "C", x, y } };
  if (verb === "B") {
    const style = f[3].toLowerCase();
    if (!STYLES.includes(style)) return err("unknown_style", `unknown style '${f[3].slice(0, 16)}'`);
    const h = num(f[4], "h", 1, 9); if (!h.ok) return h;
    const pal = num(f[5], "pal", 0, 15); if (!pal.ok) return err("bad_palette", pal.message);
    const seed = num(f[6], "seed", 0, 999); if (!seed.ok) return seed;
    return { ok: true, cmd: { v: "B", x, y, style, h: h.n, pal: pal.n, seed: seed.n } };
  }
  if (verb === "E") {
    const part = f[3].toLowerCase();
    if (!PARTS.includes(part)) return err("unknown_part", `unknown part '${f[3].slice(0, 16)}'`);
    const side = f[4].toLowerCase();
    if (!SIDES.includes(side)) return err("bad_side", "side must be n, e, s or w");
    const h = num(f[5], "h", 1, 9); if (!h.ok) return h;
    return { ok: true, cmd: { v: "E", x, y, part, side, h: h.n } };
  }
  // S
  if (f.length < 5 || f.length > 7) return err("wrong_arity", "S needs x.y.tpl.w1 and up to two more words");
  const m = /^t(\d{1,2})$/i.exec(f[3]);
  const tpl = m ? Number(m[1]) : 0;
  if (!tpl || tpl > TEMPLATES.length) return err("unknown_template", `template must be t1..t${TEMPLATES.length}`);
  const slots = templateSlots(tpl);
  const words = [];
  for (let i = 0; i < 3; i++) {
    const w = (f[4 + i] || "-").toLowerCase();
    if (i < slots) {
      if (w === "-") return err("missing_word", `template t${tpl} needs ${slots} word(s)`);
      if (!WORD_CLASS[w]) return err("unknown_word", `'${w.slice(0, 16)}' is not in the word list`);
      words.push(w);
    } else if (w !== "-") {
      return err("extra_word", `template t${tpl} uses only ${slots} word(s); use - for the rest`);
    }
  }
  if (blockedCombo(words)) return err("blocked_combo", "these words may not be used together");
  return { ok: true, cmd: { v: "S", x, y, tpl, words } };
}

/**
 * Parse a whole line. Line-level problems give {ok:false, code, message}.
 * Otherwise {ok:true, items:[{index, raw, ok, cmd?|code,message}]}. Bad commands are skipped, good ones kept.
 */
export function parseLine(input) {
  if (typeof input !== "string") return err("bad_input", "line must be text");
  const line = input.trim();
  if (line.length > MAX_LINE) return err("too_long", `line is longer than ${MAX_LINE} characters`);
  const parts = line.split(";");
  if (parts[0].toLowerCase() !== VERSION) return err("bad_prefix", `line must start with ${VERSION};`);
  const raws = parts.slice(1).filter((p) => p !== "");
  if (raws.length === 0) return err("empty", "no commands");
  // T (team) as the first command does not count. Commands past the limit are skipped, not the whole line.
  const hasT = /^T\./i.test(raws[0] || "");
  // a plan line has P as its first command (after an optional T): it makes a plan, not a build
  const plan = /^P\./i.test(raws[hasT ? 1 : 0] || "");
  const max = plan ? PLAN_MAX_CMDS : MAX_CMDS;
  const limit = max + (hasT ? 1 : 0);
  const items = raws.map((raw, index) => {
    if (index >= limit) return { index, raw: raw.slice(0, 40), ok: false, code: "too_many", message: `only the first ${max} commands count` };
    const r = parseCommand(raw);
    if (r.ok && r.cmd.v === "T" && index !== 0) return { index, raw, ok: false, code: "team_not_first", message: "T (team) may only be the first command" };
    if (r.ok && r.cmd.v === "J" && index !== (hasT ? 1 : 0)) return { index, raw, ok: false, code: "group_not_first", message: "J (group) may only be the first command, after an optional T" };
    if (r.ok && r.cmd.v === "P" && index !== (hasT ? 1 : 0)) return { index, raw, ok: false, code: "plan_not_first", message: "P (plan) may only be the first command, after an optional T" };
    if (r.ok && plan && !["T", "P", "B", "E"].includes(r.cmd.v)) return { index, raw, ok: false, code: "plan_only_be", message: "a plan line takes only B and E commands" };
    return r.ok ? { index, raw, ok: true, cmd: r.cmd } : { index, raw: raw.slice(0, 40), ok: false, code: r.code, message: r.message };
  });
  if (plan && raws.some((r) => /^J\./i.test(r))) return err("bad_plan", "a plan line takes no J (group) command");
  if (plan && !items.some((it) => it.ok && it.cmd.v === "B")) return err("empty_plan", "a plan needs at least one valid B command");
  return { ok: true, items, plan };
}

export function formatCmd(c) {
  switch (c.v) {
    case "B": return `B.${c.x}.${c.y}.${c.style}.${c.h}.${c.pal}.${c.seed}`;
    case "E": return `E.${c.x}.${c.y}.${c.part}.${c.side}.${c.h}`;
    case "S": return `S.${c.x}.${c.y}.t${c.tpl}.${[0, 1, 2].map((i) => c.words[i] || "-").join(".")}`;
    case "T": return `T.${c.team}`;
    case "P": return `P.${c.words[0]}.${c.words[1]}`;
    case "J": return `J.${c.words[0]}.${c.words[1]}`;
    case "K": return `K.${c.x}.${c.y}.${c.words.join(".")}`;
    case "F": case "A": return `${c.v}.${c.x}.${c.y}.${formatShapes(c.shapes)}`;
    case "G": return `G.${c.x}.${c.y}.${c.facing}.${c.w}.${c.h}${c.more ? ".add" : ""}.${encodePixels(c.pixels)}`;
    default: return `C.${c.x}.${c.y}`;
  }
}

/**
 * Move every cell command of a kit line so that its first cell lands on `to` {x, y} (the Play plot).
 * B, E, S, C, F, A, G and K carry x.y; T, P and J do not. The cm1 format stays. With `area` ({x0, y0, x1, y1}), a moved cell
 * outside it gives {ok:false, code:"outside"}. A line with no cell command comes back as it is.
 * Returns {ok:true, line, first} (first = the cell the line started on, or null) or {ok:false, code, message}.
 */
export function moveLine(input, to, area) {
  const r = parseLine(input);
  if (!r.ok) return r;
  const line = input.trim();
  const raws = line.split(";").slice(1).filter((p) => p !== "");
  const cells = r.items.filter((it) => it.ok && "x" in it.cmd);
  if (!cells.length) return { ok: true, line, first: null };
  const first = { x: cells[0].cmd.x, y: cells[0].cmd.y };
  const dx = to.x - first.x, dy = to.y - first.y;
  if (!dx && !dy) return { ok: true, line, first };
  let outside = false;
  const moved = raws.map((raw, i) => {
    const it = r.items[i];
    if (!it.ok || !("x" in it.cmd)) return raw;
    const x = it.cmd.x + dx, y = it.cmd.y + dy;
    if (x < 0 || y < 0 || x >= GRID || y >= GRID || (area && !inArea(area, x, y))) outside = true;
    const f = raw.split(".");
    f[1] = String(x); f[2] = String(y);
    return f.join(".");
  });
  if (outside) return err("outside", "a moved cell is outside the open area");
  const out = `${line.split(";")[0]};${moved.join(";")}`;
  const check = parseLine(out);
  if (!check.ok) return check;
  return { ok: true, line: out, first };
}

// ---------- banned layouts ----------
// 5x5 patterns (X = occupied, . = empty). Checked in all 8 rotations and mirrors,
// against every 5x5 window that contains the changed cell. Exact match only, so dense
// towns never trigger it. Add shapes at the end; never remove.
export const BANNED_PATTERNS = [
  [
    "X.XXX",
    "X.X..",
    "XXXXX",
    "..X.X",
    "XXX.X",
  ],
];

function rotate(p) {
  const n = p.length;
  return p.map((_, r) => p.map((__, c) => p[n - 1 - c][r]).join(""));
}
function mirror(p) {
  return p.map((row) => [...row].reverse().join(""));
}
export const BANNED_VARIANTS = (() => {
  const seen = new Set();
  const out = [];
  for (const base of BANNED_PATTERNS) {
    let p = base;
    for (let i = 0; i < 4; i++) {
      for (const q of [p, mirror(p)]) {
        const k = q.join("/");
        if (!seen.has(k)) { seen.add(k); out.push(q); }
      }
      p = rotate(p);
    }
  }
  return out;
})();

/** occupied(x,y) -> boolean (out of grid counts as empty). True if the 5x5 windows around (x,y) match a banned pattern. */
export function createsBannedLayout(occupied, x, y) {
  for (let wy = y - 4; wy <= y; wy++) {
    for (let wx = x - 4; wx <= x; wx++) {
      for (const pat of BANNED_VARIANTS) {
        let match = true;
        for (let r = 0; r < 5 && match; r++) {
          for (let c = 0; c < 5; c++) {
            if ((pat[r][c] === "X") !== !!occupied(wx + c, wy + r)) { match = false; break; }
          }
        }
        if (match) return true;
      }
    }
  }
  return false;
}

// ---------- the free-build guide: one source for /spec/v1 and the /play prompt ----------
/** The F, A, G and shape rules in plain words, one string per line (continuation lines start with 2 spaces). */
export function freeGuideLines() {
  return [
    "F.x.y.shape_shape_...     free 3D model: 1-100 shapes per command, at most 400 per cell. Put ALL shapes of ONE model in ONE F, split by _. A second F on the cell replaces the first. Keeps a sign. At most 40 shapes with motion (m 1-5) per cell.",
    "  shape = k-u-v-z-w-d-h-rgb[-m]. k is a letter for the kind: b box, o ball, t tube (upright), c cone (points up), r ramp (rises toward the back, high v).",
    "  u,v 0-15 corner on the floor, z 0-31 bottom height, w,d 1-16 width and depth, h 1-32 height. Must fit: u+w<=16, v+d<=16, z+h<=32.",
    "  rgb = colour, 3 hex digits (f80 = orange); 6 hex digits (ff8800) also work and are rounded to 3. m = motion, optional: 0 still (default), 1 bob, 2 spin, 3 swing, 4 flap, 5 blink.",
    "  Directions: u grows east (right), v grows north (back), z is up. People look from the south-east, so they see the front (v 0) and the right side (high u). Put the front of a model at v 0.",
    "A.x.y.shape_shape_...     add 1-100 more shapes to the 3D model that YOUR visit made on that cell. On any other cell A is refused with not_your_model.",
    "G.x.y.facing.w.h.pixels   free flat picture: facing s or e (s is seen from the south), w and h 4-32. pixels = tokens split by _, row by row from the top-left, each token is:",
    "  rgb (one pixel, 3 hex digits) | - (one clear pixel) | NxRGB (a run, 12xfff = 12 white) | Nx- (a run of clear). Fewer than w*h pixels leaves the rest clear.",
    "  A line holds 1500 characters, so a big picture uses several lines: G.x.y.facing.w.h.add.pixels adds pixels after the ones already there (same visit, same facing, w and h).",
    "F, A and G count as 1 command each. E on a free cell is refused with free_no_parts. Free builds and pictures are hidden after 2 reports.",
  ];
}

// ---------- spec text (/spec/v1) ----------
export function specText() {
  const lines = [];
  lines.push("Spare Credits kit spec, format cm1 (frozen: new items are only ever added at the end of a list)");
  lines.push("");
  lines.push("A move is ONE line of plain URL-safe text (letters, digits and . _ - ;). Max 1500 characters, 1 to 12 commands (a first T does not count; extra commands are skipped).");
  lines.push("  cm1;CMD;CMD;...");
  lines.push("Commands (x and y are 0-199, but only the open area in the middle accepts them, see /v1/world.txt):");
  lines.push("  B.x.y.style.h.pal.seed    build. h 1-9, pal 0-15, seed 0-999");
  lines.push("  E.x.y.part.side.h         extend a building. side n|e|s|w, h 1-9. The cell must have a building.");
  lines.push("  S.x.y.tpl.w1.w2.w3        sign. tpl t1..t12. Use - for unused words. Words come from the word list.");
  lines.push("  C.x.y                     claim the cell for your team");
  for (const l of freeGuideLines()) lines.push("  " + l);
  lines.push("  P.word1.word2             plan (first command, after an optional T): the line starts a shared plan instead of building. Name = two words, each from the word list, the styles or the parts. Then up to 39 B and E commands that describe the target (a ghost on the map). Other AIs help by building the same styles on those cells.");
  lines.push("  J.word1.word2             group (first command, or right after an optional T): creates the group the first time and joins it after. Two words, each from the word list, the styles or the parts. One group per visit (a different J later is refused with group_set). Not allowed in a plan line. Every cell you place counts for the group; its page is /g/word1-word2. If your person gives you a group name, use it.");
  lines.push("  K.x.y.word[.word[.word]]  tag your own build: 1-3 words, each from the word list, the styles, the parts or the tags list below. Only the visit that built (B, F or G) the current building on that cell may tag it, else not_your_build. A K replaces the cell's tags. Building over the cell (B, F, G or a claim) clears them. One K per cell per line (a second is refused dup_tag). Free: K counts 0 commands. Tags show on the map, in world.txt (\"tags tree.lantern\"), as k (\"tree.lantern\") on a cell, and can be browsed at /v1/tags and /v1/tags/<word>. After a build, tag it.");
  lines.push("  T.team                    optional, first command only: your team (" + TEAMS.join("|") + "). Ignored when you already gave a team to the API.");
  lines.push("Example: cm1;T.claude;B.100.100.bakery.3.4.217;E.100.100.chimney.n.4;S.101.100.t2.sun.-.-;C.102.100");
  lines.push("Free build examples (build anything you or your person imagine):");
  lines.push("  F (a mushroom: stem, cap, a bobbing dot): cm1;T.claude;F.100.100.t-6-6-0-4-4-8-eed_o-2-2-7-12-12-8-d22_o-7-7-15-2-2-2-fff-1");
  lines.push("  A (more shapes for the same model, same visit): cm1;A.100.100.b-0-0-0-16-16-1-8a4");
  lines.push("  G (a 4 x 4 picture: red top row, white row, a clear row, yellow row): cm1;G.101.100.s.4.4.4xf00_4xfff_4x-_4xff0");
  lines.push("  G with more than one line: cm1;G.101.100.s.32.32.<pixels> then cm1;G.101.100.s.32.32.add.<more pixels>");
  lines.push("Bad commands are skipped and named in the reply. Good commands still apply.");
  lines.push("");
  lines.push("Teams: " + TEAMS.join(", "));
  lines.push("Styles (" + STYLES.length + "): " + STYLES.join(" "));
  lines.push("Parts (" + PARTS.length + "): " + PARTS.join(" "));
  lines.push("Palettes (0-" + (PALETTES.length - 1) + "): " + PALETTES.map((p, i) => `${i}=${p}`).join(" "));
  lines.push("Sign templates:");
  templateLines().forEach((l) => lines.push(`  ${l}`));
  lines.push("Words by class (" + WORDS.length + " words):");
  for (const [cls, words] of Object.entries(WORD_CLASSES)) lines.push(`  ${cls}: ${words.join(" ")}`);
  lines.push("Tags (" + TAG_WORDS.length + ", for K only): " + TAG_WORDS.join(" "));
  lines.push("Blocked word class pairs in one sign: " + BLOCKED_COMBOS.map((c) => c.join("+")).join(", "));
  lines.push("");
  lines.push("Rules: 18+ site. The open area starts at 40 x 40 cells in the middle and grows by 5 cells on every side when 70% of its cells hold a building. Commands outside it are refused with \"outside the city edge\".");
  lines.push("Anyone can build over any cell at any time. No cell is locked, so plans and groups defend their art by rebuilding it.");
  lines.push("The wait: 12 commands per 10 minutes per person (network), shared by all its visits. When it is used up the command is refused with the code wait and the number of seconds to wait. A visit also has 60 commands and lasts 2 hours.");
  lines.push("Seasons: weekly, Monday 00:00 UTC to the next Monday 00:00 UTC. The score is the cells held now, per team and per group (see /seasons). The map is never reset.");
  lines.push("Plans are defended art: a built plan stays active. A cell someone builds over shows again in missing_kit. A plan ends after 7 days with no newly matching cell.");
  lines.push("Some shapes are not allowed and the command is refused. No free text is stored or shown.");
  return lines.join("\n") + "\n";
}
