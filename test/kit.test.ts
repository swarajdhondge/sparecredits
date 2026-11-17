import { describe, it, expect } from "vitest";
import {
  parseCommand, parseLine, formatCmd, createsBannedLayout, BANNED_VARIANTS, BANNED_PATTERNS, WORD_CLASSES, WORDS,
  STYLES, PARTS, PALETTES, TEMPLATES, specText, aAn, extractKitLine, templateLines, TEAMS, freeGuideLines,
} from "../public/kit.js";

const valid: string[] = [];
for (let i = 0; i < 24; i++) valid.push(`B.${i * 8}.${199 - i}.${STYLES[i]}.${(i % 9) + 1}.${i % 16}.${i * 40}`);
for (let i = 0; i < 16; i++) valid.push(`E.${i}.${i + 1}.${PARTS[i]}.${"nesw"[i % 4]}.${(i % 9) + 1}`);
valid.push(
  "S.5.5.t1.castle.-.-", "S.5.5.t2.sun", "S.5.5.t3.bread.honey.cake", "S.0.199.t12.north.south.east", "S.1.1.t7.moon.rain",
  "C.0.0", "C.199.199", "C.99.99", "C.50.50", "c.1.2", "b.1.2.cottage.1.0.0",
  "B.001.002.tower.9.15.999",
);

const invalid: [string, string][] = [
  ["", "empty"], ["Z.1.1", "unknown_verb"], ["X", "unknown_verb"], ["move.1.1", "unknown_verb"],
  ["B.1.1.cottage.5.3", "wrong_arity"], ["B.1.1.cottage.5.3.4.5", "wrong_arity"], ["E.1.1.wing.n", "wrong_arity"], ["C.1", "wrong_arity"],
  ["C.1.1.1", "wrong_arity"], ["B", "wrong_arity"],
  ["B.200.1.cottage.5.3.4", "out_of_range"], ["B.1.200.cottage.5.3.4", "out_of_range"], ["C.200.0", "out_of_range"], ["C.0.200", "out_of_range"],
  ["B.-1.1.cottage.5.3.4", "bad_number"], ["B.a.1.cottage.5.3.4", "bad_number"], ["C.1.x", "bad_number"], ["C..1", "wrong_arity"],
  ["B.1.1.cottage.0.3.4", "bad_height"], ["B.1.1.cottage.10.3.4", "bad_height"], ["E.1.1.wing.n.0", "bad_height"], ["E.1.1.wing.n.10", "bad_height"],
  ["B.1.1.cottage.5.16.4", "bad_palette"], ["B.1.1.cottage.5.-1.4", "bad_palette"],
  ["B.1.1.cottage.5.3.1000", "out_of_range"], ["B.1.1.cottage.5.3.x", "bad_number"],
  ["B.1.1.skyscraper.5.3.4", "unknown_style"], ["B.1.1.<script>.5.3.4", "bad_chars"],
  ["E.1.1.rocket.n.3", "unknown_part"], ["E.1.1.wing.up.3", "bad_side"], ["E.1.1.wing.x.3", "bad_side"],
  ["S.1.1.t0.sun", "unknown_template"], ["S.1.1.t13.sun", "unknown_template"], ["S.1.1.tx.sun", "unknown_template"], ["S.1.1.2.sun", "unknown_template"],
  ["S.1.1.t2.nonsense", "unknown_word"], ["S.1.1.t2.-", "missing_word"], ["S.1.1.t3.sun.-.-", "missing_word"],
  ["S.1.1.t2.sun.moon.-", "extra_word"], ["S.1.1.t1.sun.-.rain", "extra_word"],
  ["S.1.1", "wrong_arity"], ["S.1.1.t2.sun.-.-.-", "wrong_arity"],
  ["S.1.1.t3.jumping.kitten.sun", "blocked_combo"], ["S.1.1.t3.baking.bread.cake", "blocked_combo"], ["S.1.1.t3.joy.owl.sun", "blocked_combo"],
  ["S.1.1.t2.fuck", "unknown_word"], ["S.1.1.t2.sex", "unknown_word"],
  ["B.1.1.cottage 5.3.4", "bad_chars"], ["B/1/1/cottage/5/3/4", "bad_chars"], ["B.1.1.cottége.5.3.4", "bad_chars"],
  ["B.1.1.cottage.5.3.4%20", "bad_chars"], ["C.1.1\n", "bad_chars"],
];

describe("kit parser", () => {
  it("has 50+ valid lines that parse", () => {
    expect(valid.length).toBeGreaterThanOrEqual(50);
    for (const v of valid) {
      const r = parseCommand(v);
      expect(r.ok, v).toBe(true);
    }
  });
  it("canonical format round trips", () => {
    for (const v of valid) {
      const r = parseCommand(v);
      if (!r.ok) throw new Error(v);
      const again = parseCommand(formatCmd(r.cmd));
      expect(again.ok && again.cmd).toEqual(r.cmd);
    }
  });
  it("rejects 50 invalid commands with the right reason", () => {
    expect(invalid.length).toBeGreaterThanOrEqual(50);
    for (const [raw, code] of invalid) {
      const r = parseCommand(raw);
      expect(r.ok, raw).toBe(false);
      if (!r.ok) expect(r.code, raw).toBe(code);
    }
  });
  it("covers every style, part, palette and template", () => {
    for (const s of STYLES) expect(parseCommand(`B.1.1.${s}.3.3.3`).ok).toBe(true);
    for (const p of PARTS) expect(parseCommand(`E.1.1.${p}.n.3`).ok).toBe(true);
    for (let i = 0; i < PALETTES.length; i++) expect(parseCommand(`B.1.1.cottage.3.${i}.3`).ok).toBe(true);
    expect(TEMPLATES.length).toBe(12);
    expect(STYLES.length).toBe(42);
    expect(PARTS.length).toBe(28);
    expect(PALETTES.length).toBe(16);
  });
});

describe("kit lines", () => {
  it("keeps good commands and names bad ones", () => {
    const r = parseLine("cm1;B.1.1.cottage.3.3.3;Q.1.1;C.2.2;B.1.1.nope.1.1.1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.items.map((i) => i.ok)).toEqual([true, false, true, false]);
    const q = r.items[1];
    expect(!q.ok && q.code).toBe("unknown_verb");
  });
  it("rejects bad line shapes", () => {
    const code = (l: string) => { const r = parseLine(l); return r.ok ? "ok" : r.code; };
    expect(code("B.1.1.cottage.3.3.3")).toBe("bad_prefix");
    expect(code("cc1;C.1.1")).toBe("bad_prefix");
    expect(code("cm1")).toBe("empty");
    expect(code("cm1;")).toBe("empty");
    const over = parseLine("cm1;" + Array(13).fill("C.1.1").join(";"));
    expect(over.ok && over.items.filter((i) => !i.ok).map((i) => i.code)).toEqual(["too_many"]);
    const withTeam = parseLine("cm1;T.gemini;" + Array(12).fill("C.1.1").join(";"));
    expect(withTeam.ok && withTeam.items.every((i) => i.ok)).toBe(true);
    expect(code("cm1;" + Array(12).fill("C.1.1").join(";"))).toBe("ok");
    expect(code("cm1;" + "C.1.1;".repeat(300))).toBe("too_long");
    expect(code(42 as unknown as string)).toBe("bad_input");
  });
  it("accepts a trailing semicolon and upper case prefix", () => {
    expect(parseLine("CM1;C.1.1;").ok).toBe(true);
  });
});

describe("word list", () => {
  const bad = ["fuck", "shit", "porn", "nazi", "rape", "slut", "whore", "dick", "cock", "nude", "naked", "pussy", "penis", "vagina", "sex", "kill", "murder", "drug", "cherry", "tart", "cat", "ass", "bonk", "bone", "chest"];
  it("is about 500 clean words, unique, lowercase letters only", () => {
    expect(WORDS.length).toBeGreaterThan(450);
    expect(WORDS.length).toBeLessThan(560);
    const total = Object.values(WORD_CLASSES).reduce((n, l) => n + l.length, 0);
    expect(total).toBe(WORDS.length); // no word sits in two classes
    for (const w of WORDS) {
      expect(w).toMatch(/^[a-z]{2,14}$/);
      expect(bad.includes(w), w).toBe(false);
    }
    for (const b of ["fuck", "shit", "porn", "nazi", "rape", "slut", "whore", "penis", "pussy", "nude"]) {
      expect(WORDS.some((w) => w.includes(b)), b).toBe(false);
    }
  });
  it("has the nine classes", () => {
    expect(Object.keys(WORD_CLASSES).sort()).toEqual(["actions", "animals", "directions", "feelings", "food", "places", "silly", "things", "weather"]);
  });
});

// ----- banned layouts -----
function toOcc(pat: string[], ox: number, oy: number) {
  const s = new Set<string>();
  pat.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "X") s.add(`${ox + c},${oy + r}`); }));
  return s;
}

describe("banned layouts", () => {
  it("covers all 8 rotations and mirrors (the shape is 4-fold symmetric, so 2 distinct)", () => {
    const keys = new Set(BANNED_VARIANTS.map((v) => v.join("/")));
    const rot = (p: string[]) => p.map((_, r) => p.map((__, c) => p[4 - c][r]).join(""));
    const mir = (p: string[]) => p.map((row) => [...row].reverse().join(""));
    let p = BANNED_PATTERNS[0];
    for (let i = 0; i < 4; i++) {
      expect(keys.has(p.join("/"))).toBe(true);
      expect(keys.has(mir(p).join("/"))).toBe(true);
      p = rot(p);
    }
    expect(BANNED_VARIANTS.length).toBe(2);
  });
  it("rejects every orientation, completed by any of its cells", () => {
    BANNED_VARIANTS.forEach((v, i) => {
      const occ = toOcc(v, 40, 40);
      for (const key of occ) {
        const [x, y] = key.split(",").map(Number);
        expect(createsBannedLayout((a, b) => occ.has(`${a},${b}`), x, y), `variant ${i} cell ${key}`).toBe(true);
      }
    });
  });
  it("is not fooled by a pattern at the map edge", () => {
    const occ = toOcc(BANNED_PATTERNS[0], 0, 0);
    expect(createsBannedLayout((a, b) => occ.has(`${a},${b}`), 2, 2)).toBe(true);
  });
  it("lets a dense town and the incomplete shape through", () => {
    const full = (a: number, b: number) => a >= 40 && a < 50 && b >= 40 && b < 50;
    expect(createsBannedLayout(full, 44, 44)).toBe(false);
    const occ = toOcc(BANNED_PATTERNS[0], 40, 40);
    occ.delete("40,40"); // one cell missing
    expect(createsBannedLayout((a, b) => occ.has(`${a},${b}`), 42, 42)).toBe(false);
  });
});

describe("spec text", () => {
  it("lists everything", () => {
    const s = specText();
    for (const w of ["cottage", "chimney", "midnight", "t12", "cm1", "silly:"]) expect(s).toContain(w);
  });
});

describe("T (team) verb", () => {
  it("accepts every team and nothing else", () => {
    for (const t of TEAMS) expect(parseCommand(`T.${t}`)).toEqual({ ok: true, cmd: { v: "T", team: t } });
    expect(parseCommand("T.bard")).toMatchObject({ ok: false, code: "bad_team" });
    expect(parseCommand("T")).toMatchObject({ ok: false, code: "wrong_arity" });
    expect(parseCommand("T.claude.x")).toMatchObject({ ok: false, code: "wrong_arity" });
  });
  it("is allowed only as the first command", () => {
    const first = parseLine("cm1;T.gemini;C.1.1");
    expect(first.ok && first.items.map((i) => i.ok)).toEqual([true, true]);
    const late = parseLine("cm1;C.1.1;T.gemini");
    expect(late.ok && late.items[1]).toMatchObject({ ok: false, code: "team_not_first" });
    const twice = parseLine("cm1;T.gemini;T.claude");
    expect(twice.ok && twice.items[1]).toMatchObject({ ok: false, code: "team_not_first" });
  });
  it("leaves old lines without T working", () => {
    const r = parseLine("cm1;C.1.1");
    expect(r.ok && r.items[0].ok).toBe(true);
  });
  it("round-trips and is in the spec", () => {
    expect(formatCmd({ v: "T", team: "claude" })).toBe("T.claude");
    expect(specText()).toContain("T.team");
  });
});

describe("extractKitLine", () => {
  const line = "cm1;T.claude;B.50.50.inn.3.4.217;C.52.50";
  it("finds a plain line, a code block, and a link", () => {
    expect(extractKitLine(line)).toBe(line);
    expect(extractKitLine("Here you go:\n```\n" + line + "\n```\nEnjoy!")).toBe(line);
    expect(extractKitLine(`Click https://x.dev/m#${line}. Nice town!`)).toBe(line);
  });
  it("finds a line inside a Google search URL, even percent-encoded", () => {
    expect(extractKitLine("https://www.google.com/search?q=https%3A%2F%2Fx.dev%2Fm%23" + encodeURIComponent(line))).toBe(line);
  });
  it("takes the first line and returns empty when none", () => {
    expect(extractKitLine(`a ${line} b cm1;C.1.1`)).toBe(line);
    expect(extractKitLine("no kit here")).toBe("");
  });
});

describe("text helpers", () => {
  it("a/an", () => {
    expect(aAn("inn")).toBe("an");
    expect(aAn("awning")).toBe("an");
    expect(aAn("igloo")).toBe("an");
    expect(aAn("bakery")).toBe("a");
    expect(aAn("tower")).toBe("a");
    const plural = new Set(["sails", "stairs", "rocks"]);
    for (const w of [...STYLES, ...PARTS]) expect(aAn(w)).toBe(plural.has(w) ? "" : "aeiou".includes(w[0]) ? "an" : "a");
  });
  it("lists templates with exact word counts", () => {
    const l = templateLines();
    expect(l[0]).toBe("t1 (1 word) Beware of {1} ahead");
    expect(l[2]).toBe("t3 (3 words) {1} and {2}, then {3}");
    expect(l.length).toBe(TEMPLATES.length);
  });
});

describe("kit v2 (bigger kit)", () => {
  it("keeps every old id in its old place; new ones only at the end", () => {
    expect(STYLES.slice(0, 24).join(" ")).toBe("cottage house townhouse shop bakery inn cabin barn farmhouse tower lighthouse windmill castle chapel pagoda temple dome hall workshop factory greenhouse treehouse tent igloo");
    expect(PARTS.slice(0, 16).join(" ")).toBe("wing porch balcony chimney garden dome spire turret awning stairs fence pond tree lantern flag sails");
    expect(WORD_CLASSES.places.slice(0, 5)).toEqual(["castle", "tower", "bridge", "garden", "market"]);
    expect(WORD_CLASSES.silly.slice(0, 3)).toEqual(["wobble", "giggle", "kazoo"]);
  });
  it("has about 40 styles, about 28 parts, and the styles the plan names", () => {
    expect(STYLES.length).toBe(42);
    expect(PARTS.length).toBe(28);
    for (const s of ["ship", "dock", "statue", "arch", "gate", "wall", "bridge", "fountain", "plot", "park", "stadium", "observatory", "museum", "school", "stall", "ruins", "crystal", "rocket"]) expect(STYLES).toContain(s);
    expect(new Set(STYLES).size).toBe(STYLES.length);
    expect(new Set(PARTS).size).toBe(PARTS.length);
  });
  it("accepts every new style and part", () => {
    for (const st of STYLES.slice(24)) expect(parseCommand(`B.100.100.${st}.3.1.1`).ok, st).toBe(true);
    for (const pt of PARTS.slice(16)) expect(parseCommand(`E.100.100.${pt}.n.3`).ok, pt).toBe(true);
  });
  it("new words work in signs, and blocked class pairs still block", () => {
    expect(parseCommand("S.100.100.t2.penguin").ok).toBe(true);
    expect(parseCommand("S.100.100.t3.skating.pizza.sunshine").ok).toBe(false); // actions + food
    expect(parseCommand("S.100.100.t3.skating.penguin.sunshine").ok).toBe(false); // actions + animals
    expect(parseCommand("S.100.100.t3.cozy.panda.sunshine").ok).toBe(false); // feelings + animals
    expect(parseCommand("S.100.100.t3.pizza.plaza.sunshine").ok).toBe(true);
  });
  it("has no unsafe words in the new lists", () => {
    const unsafe = /(fuck|shit|porn|nazi|rape|slut|whore|penis|pussy|nude|cock|dick|boob|damn|crap|sex|kill|drug|wank|piss|poof)/;
    expect(WORDS).not.toContain("pot");
    for (const w of WORDS) expect(unsafe.test(w), w).toBe(false);
  });
});

describe("guide for AIs", () => {
  it("stays under 6 KB once the site address is filled in, and covers asking, plans and helping", async () => {
    const { default: raw } = await import("../public/agent.txt?raw");
    const served = raw.replaceAll("{ORIGIN}", "https://sparecredits.com");
    expect(new TextEncoder().encode(served).length).toBeLessThan(6144);
    expect(raw).toMatch(/What do you want to build\?/);
    expect(raw).toMatch(/Describe it or send me a picture/);
    expect(raw).toMatch(/Build anything you or your person imagine/);
    expect(raw).toMatch(/\nF\.x\.y\./);
    expect(raw).toMatch(/\nG\.x\.y\./);
    expect(raw).toMatch(/P\.word1\.word2/);
    expect(raw).toMatch(/v1\/plans\/<code>/);
  });

  it("agent.txt carries the key free-build facts, and spec and /play share one guide", async () => {
    const { default: raw } = await import("../public/agent.txt?raw");
    for (const f of ["ONE F", "k is a letter", "v back", "Nx-", "add", "ramp (rises back)", "J.", "K.", "12 commands per 10 minutes"]) expect(raw, f).toContain(f);
    expect(raw).not.toContain("10 minutes old");
    expect(specText()).not.toContain("10 minutes old");
    const spec = specText();
    for (const l of freeGuideLines()) expect(spec).toContain(l);
    for (const f of ["not_your_model", "free_no_parts", "2 reports", "ONE F", "6 hex"]) expect(freeGuideLines().join("\n")).toContain(f);
    const { default: play } = await import("../public/js/playprompt.js?raw");
    expect(play).toContain("freeGuideLines()");
    expect(play).toMatch(/import \{[^}]*freeGuideLines[^}]*\} from "\.\.\/kit\.js"/);
  });
});
