// v9b: tags on builds (K), T1 to T5.
import { describe, it, expect } from "vitest";
import { parseCommand, formatCmd, type Cmd, TAG_WORDS, WORD_CLASS, STYLES, PARTS, PALETTES, TEAMS } from "../public/kit.js";
import { makeCity } from "./support/harness";

const NOW = Date.UTC(2026, 10, 14, 12, 0);
type City = ReturnType<typeof makeCity>["city"];
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function visit(city: City) {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, 'claude', ?, ?, 'approved')", id, `pub-${id.slice(6, 12)}`, NOW, NOW);
  return id;
}
async function send(city: City, id: string, line: string, ip = "net1") {
  const res = city.runLine(city.visitRow(id)!, line, NOW, ip);
  return { ...((await res.json()) as Json), status: res.status } as Json;
}

describe("tags (K)", () => {
  it("keeps the kit words of a K and drops unknown ones; colours are tag words", () => {
    const r = parseCommand("K.100.100.robot.shiny.blue");
    expect(r.ok && r.cmd).toMatchObject({ v: "K", words: ["robot", "blue"], dropped: ["shiny"] });
    if (r.ok) expect(formatCmd(r.cmd)).toBe("K.100.100.robot.blue");
    expect(parseCommand("K.100.100.shiny").ok).toBe(false);
  });
  it("the tags class is lowercase a-z only and shares no word with another class", () => {
    expect(TAG_WORDS.length).toBeGreaterThan(50);
    expect(new Set(TAG_WORDS).size).toBe(TAG_WORDS.length);
    const others = new Set([...Object.keys(WORD_CLASS), ...STYLES, ...PARTS, ...PALETTES, ...TEAMS]);
    for (const w of TAG_WORDS) {
      expect(w, w).toMatch(/^[a-z]+$/);
      expect(others.has(w), w).toBe(false);
    }
    // the tags class is for K only: signs, plan names and group names refuse it
    expect(parseCommand("S.1.1.t1.robot.-.-")).toMatchObject({ ok: false, code: "unknown_word" });
    expect(parseCommand("P.robot.castle")).toMatchObject({ ok: false, code: "unknown_word" });
  });

  it("parses K with 1 to 3 words from any class, formats it back, and applies blocked pairs", () => {
    const r = parseCommand("K.100.100.tree.lantern.robot");
    expect(r).toMatchObject({ ok: true, cmd: { v: "K", x: 100, y: 100, words: ["tree", "lantern", "robot"] } });
    expect(formatCmd((r as { ok: true; cmd: Cmd }).cmd)).toBe("K.100.100.tree.lantern.robot");
    expect(parseCommand("K.100.100.robot")).toMatchObject({ ok: true });
    expect(parseCommand("K.100.100")).toMatchObject({ ok: false, code: "wrong_arity" });
    expect(parseCommand("K.100.100.a.b.c.d")).toMatchObject({ ok: false, code: "wrong_arity" });
    expect(parseCommand("K.100.100.zzzz")).toMatchObject({ ok: false, code: "unknown_word" });
    expect(parseCommand("K.100.100.robot.robot")).toMatchObject({ ok: false, code: "dup_word" });
    expect(parseCommand("K.100.100.jumping.kitten")).toMatchObject({ ok: false, code: "blocked_combo" });
  });

  it("a visit tags its own build for 0 commands; /v1/tags and /v1/tags/<word> list it", async () => {
    const { city } = makeCity();
    const a = visit(city);
    await send(city, a, "cm1;T.claude;J.harbor.garden;B.90.90.tower.3.1.1");
    const r = await send(city, a, "cm1;K.90.90.tree.robot");
    expect(r).toMatchObject({ ok: true, applied: 1, commands_left: 59 }); // only the B cost a command
    expect(city.store.get(90, 90)!.tags).toBe("tree.robot");
    const top = city.tagTop(50) as Json;
    expect(top.tags).toEqual([{ tag: "robot", n: 1 }, { tag: "tree", n: 1 }]);
    const list = city.tagCells("robot") as Json;
    expect(list.cells).toEqual([{ x: 90, y: 90, team: "claude", group: "harbor.garden", style: "tower" }]);
    expect((city.tagCells("zzzz") as Json).cells).toEqual([]);
    const w = await city.fetch(new Request("https://x/v1/tags/robot")).then((x) => x.json()) as Json;
    expect(w.cells).toHaveLength(1);
    // a K replaces the tags
    await send(city, a, "cm1;K.90.90.cat");
    expect(city.store.get(90, 90)!.tags).toBe("cat");
    expect((city.tagCells("robot") as Json).cells).toEqual([]);
  });

  it("another visit's K is refused with not_your_build; a second K on a cell in one line is refused with dup_tag", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city);
    await send(city, a, "cm1;B.90.90.tower.3.1.1");
    const r = await send(city, b, "cm1;K.90.90.robot;C.91.90", "net2");
    expect(r.results[0]).toMatchObject({ ok: false, code: "not_your_build" });
    expect(r.applied).toBe(1); // the C still applied
    expect(city.store.get(90, 90)!.tags).toBeNull();
    const d = await send(city, a, "cm1;K.90.90.robot;K.90.90.cat");
    expect(d.results[1]).toMatchObject({ ok: false, code: "dup_tag" });
    expect(city.store.get(90, 90)!.tags).toBe("robot");
    // a cell with no building is not tagged either
    expect((await send(city, a, "cm1;K.95.95.robot")).results[0]).toMatchObject({ code: "not_your_build" });
  });

  it("building over the cell clears its tags; E and S keep them", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city);
    await send(city, a, "cm1;B.90.90.tower.3.1.1;K.90.90.robot");
    await send(city, b, "cm1;E.90.90.flag.n.2;S.90.90.t2.sun.-.-", "net2");
    expect(city.store.get(90, 90)!.tags).toBe("robot");
    await send(city, a, "cm1;B.90.90.house.3.1.1");
    expect(city.store.get(90, 90)!.tags).toBeNull();
    await send(city, a, "cm1;K.90.90.cat");
    await send(city, b, "cm1;C.90.90", "net2");
    expect(city.store.get(90, 90)!.tags).toBeNull();
    expect((city.tagTop(50) as Json).tags).toEqual([]);
  });

  it("world.txt building lines end with the tags", async () => {
    const { city } = makeCity();
    const a = visit(city);
    await send(city, a, "cm1;T.claude;B.90.90.tower.3.1.1;K.90.90.tree.lantern");
    const text = await city.fetch(new Request("https://x/v1/world.txt?near=90,90")).then((x) => x.text());
    expect(text).toMatch(/B\.90\.90\.tower\.3\.1\.1 by claude.* tags tree\.lantern\n/);
  });
});
