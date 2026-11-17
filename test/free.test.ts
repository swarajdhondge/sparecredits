// Free build (v7 F1): the F, A and G commands in the kit and in the live city.
import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { makeCity } from "./support/harness";
import { parseCommand, parseLine, formatCmd, specText, MAX_LINE } from "../public/kit.js";
import { LIMITS, shouldHide } from "../src/limits";

const NOW = Date.UTC(2026, 10, 13, 12, 0);
const MIN = 60_000;
const KEY = "test-admin-key-0123456789-abcdef";
type City = ReturnType<typeof makeCity>["city"];
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MUSHROOM = "t-6-6-0-4-4-8-eed_o-2-2-7-12-12-8-d22_o-5-4-13-2-2-1-fff";
const code = (raw: string) => { const r = parseCommand(raw); return r.ok ? "ok" : r.code; };
const shape = (n: number, m = 0) => `b-0-0-0-1-1-1-${(n % 4096).toString(16).padStart(3, "0")}${m ? `-${m}` : ""}`;

function visit(city: City, team = "claude") {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  const pub = `pub-${id.slice(6, 12)}`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, ?, ?, ?, 'approved')", id, pub, team, NOW, NOW);
  return { id, pub };
}
async function send(city: City, v: { id: string }, line: string, now = NOW) {
  const res = city.runLine(city.visitRow(v.id)!, line, now);
  return (await res.json()) as Json;
}
const first = (r: Json) => (r.results[0].ok ? "ok" : r.results[0].code);
const cell = (city: City, x: number, y: number) => city.sql.exec("SELECT * FROM cells WHERE x = ? AND y = ?", x, y).one();

describe("kit: F, A and G", () => {
  it("parses the example and gives the canonical text back", () => {
    const r = parseCommand(`F.100.100.${MUSHROOM.toUpperCase()}`);
    expect(r.ok && r.cmd.v).toBe("F");
    if (r.ok) expect(formatCmd(r.cmd)).toBe(`F.100.100.${MUSHROOM}`); // lower-case hex
    const m = parseCommand("F.1.2.b-0-0-0-4-4-4-F80-0_b-0-0-4-4-4-4-f80-3");
    if (m.ok) expect(formatCmd(m.cmd)).toBe("F.1.2.b-0-0-0-4-4-4-f80_b-0-0-4-4-4-4-f80-3"); // m omitted when 0
    const a = parseCommand("A.5.5.b-0-0-0-1-1-1-fff");
    expect(a.ok && formatCmd(a.cmd)).toBe("A.5.5.b-0-0-0-1-1-1-fff");
  });

  it("accepts 6 hex digits and keeps only the 3-digit form", () => {
    const f = parseCommand("F.1.1.b-0-0-0-4-4-4-E8E8E8");
    expect(f.ok && formatCmd(f.cmd)).toBe("F.1.1.b-0-0-0-4-4-4-eee");
    const g = parseCommand("G.1.1.s.4.4.ff8800_3xff8800_-");
    expect(g.ok && formatCmd(g.cmd)).toBe("G.1.1.s.4.4.4xf80_-");
    expect(code("F.1.1.b-0-0-0-4-4-4-e8e8")).toBe("bad_shape");
  });

  it("names the shape number and field of a bad shape, and every other error code", () => {
    const bad = parseCommand("F.1.1.b-0-0-0-1-1-1-fff_x-0-0-0-1-1-1-fff");
    expect(bad).toMatchObject({ ok: false, code: "bad_shape" });
    expect(!bad.ok && bad.message).toMatch(/shape 2: k must be/);
    const gh = parseCommand("F.1.1.b-0-0-0-1-1-1-ggg");
    expect(!gh.ok && gh.message).toMatch(/shape 1: rgb/);
    const w0 = parseCommand("F.1.1.b-0-0-0-0-1-1-fff");
    expect(!w0.ok && w0.message).toMatch(/shape 1: w must be a whole number 1-16/);
    expect(code("F.1.1.b-0-0-0-1-1-1")).toBe("bad_shape");
    expect(code("F.1.1.b-0-0-0-1-1-1-fff-9")).toBe("bad_shape");
    expect(code("F.1.1.b-0-0-0-1-1-1-fff_")).toBe("bad_shape");
    const out = parseCommand("F.1.1.b-0-0-0-1-1-1-fff_b-9-0-0-8-1-1-fff");
    expect(out).toMatchObject({ ok: false, code: "shape_outside" });
    expect(!out.ok && out.message).toMatch(/shape 2: u\+w/);
    expect(code("F.1.1.b-0-0-31-1-1-2-fff")).toBe("shape_outside");
    expect(code("F.1.1.b-0-9-0-1-8-1-fff")).toBe("shape_outside");
    expect(code(`F.1.1.${Array(101).fill(shape(1)).join("_")}`)).toBe("too_many_shapes");
    expect(code(`F.1.1.${Array(100).fill(shape(1)).join("_")}`)).toBe("ok");
    expect(code(`F.1.1.${Array(41).fill(shape(1, 2)).join("_")}`)).toBe("too_many_shapes"); // 41 moving
    expect(code(`F.1.1.${Array(40).fill(shape(1, 2)).join("_")}`)).toBe("ok");
    expect(code("F.1.1")).toBe("wrong_arity");
    expect(code("G.1.1.n.8.8.fff")).toBe("bad_picture"); // facing
    expect(code("G.1.1.s.3.8.fff")).toBe("bad_picture"); // w
    expect(code("G.1.1.s.8.33.fff")).toBe("bad_picture"); // h
    expect(code("G.1.1.s.8.8.zzz")).toBe("bad_picture"); // token
    expect(code("G.1.1.s.4.4.17xfff")).toBe("bad_picture"); // 17 pixels in 4 x 4
    expect(code("G.1.1.s.4.4.16xfff")).toBe("ok");
  });

  it("reads the pixel tokens without doubt: rgb, -, NxRGB, Nx-", () => {
    const g = parseCommand("G.9.9.E.4.4.FFF_-_3x-_2xF00_2xf00_0a0_16x-"); // 1+1+3+2+2+1 = 10, then 16 more: too many
    expect(g).toMatchObject({ ok: false, code: "bad_picture" });
    const ok = parseCommand("G.9.9.e.4.4.fff_-_3x-_2xF00_2xf00_0A0_5x-");
    if (!ok.ok) throw new Error(ok.message);
    // 15 pixels, equal neighbours join: - and 3x- make 4x-, 2xF00 and 2xf00 make 4xf00
    expect(formatCmd(ok.cmd)).toBe("G.9.9.e.4.4.fff_4x-_4xf00_0a0_5x-");
    expect(parseCommand("G.9.9.e.4.4.add.2xfff")).toMatchObject({ ok: true, cmd: { v: "G", more: true } });
    expect(formatCmd((parseCommand("G.9.9.e.4.4.add.2xfff") as any).cmd)).toBe("G.9.9.e.4.4.add.2xfff"); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it("one F, A or G is one command; a plan line still takes only B and E; the spec lists them", () => {
    const l = parseLine(`cm1;F.1.1.${MUSHROOM};A.1.1.${shape(1)};G.2.2.s.4.4.fff`);
    expect(l.ok && l.items.length).toBe(3);
    const p = parseLine(`cm1;P.sunrise.harbor;B.1.1.house.3.1.7;F.2.2.${MUSHROOM}`);
    expect(p.ok && p.items.map((i) => (i.ok ? "ok" : i.code))).toEqual(["ok", "ok", "plan_only_be"]);
    expect(MAX_LINE).toBe(1500);
    const spec = specText();
    for (const w of ["F.x.y", "A.x.y", "G.x.y", "NxRGB", "not_your_model"]) expect(spec).toContain(w);
  });
});

describe("the live city", () => {
  it("stores an F, sends it as b + f, lists it in world.txt, keeps the replay text, counts 1 command", async () => {
    const { city } = makeCity();
    const v = visit(city);
    const r = await send(city, v, `cm1;F.100.100.${MUSHROOM.toUpperCase()}`);
    expect(r.applied).toBe(1);
    expect(r.commands_left).toBe(LIMITS.perVisitTotal - 1);
    const row = cell(city, 100, 100);
    expect(row).toMatchObject({ style: "free", h: 5, shape: MUSHROOM }); // top 15 of 32 -> 5
    const chunk = JSON.parse(city.chunkMessages(1, 1)[0]);
    const w = chunk.cells.find((c: Json) => c.x === 100);
    expect(w.b).toBe("free.5.12.0");
    expect(w.f).toBe(MUSHROOM);
    const world = city.worldText(new URL("https://x.test/v1/world.txt?near=100,100"), NOW);
    expect(world).toContain("F.100.100 free 3D model, 3 shapes");
    expect(world.length).toBeLessThan(4096);
    expect(city.sql.exec("SELECT cmd FROM events").one().cmd).toBe(`F.100.100.${MUSHROOM}`);
    expect(city.overview()).not.toMatch(/^\.*$/); // the block has a character
  });

  it("a 100-shape F is not cut and costs 1 command", async () => {
    const { city } = makeCity();
    const v = visit(city);
    const shapes = Array.from({ length: 60 }, (_, i) => shape(i)).join("_");
    const r = await send(city, v, `cm1;F.100.100.${shapes}`);
    expect(r.applied).toBe(1);
    expect(String(cell(city, 100, 100).shape).split("_").length).toBe(60);
  });

  it("F follows B: it replaces a fresh build at once and keeps the sign", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city, "gemini");
    await send(city, a, "cm1;B.100.100.house.3.1.7;S.100.100.t2.sun.-.-");
    const r = await send(city, b, `cm1;F.100.100.${MUSHROOM}`, NOW + MIN);
    expect(r.applied).toBe(1);
    expect(cell(city, 100, 100)).toMatchObject({ style: "free", shape: MUSHROOM, team: "gemini" });
    expect(cell(city, 100, 100).sign).toBe("t2.sun.-.-");
    // a free build is replaced by B the same way; the shape is gone
    await send(city, a, "cm1;B.100.100.house.3.1.7", NOW + 2 * MIN);
    expect(cell(city, 100, 100)).toMatchObject({ style: "house", shape: null });
    // outside the edge and in a closed area, like B
    expect(first(await send(city, a, `cm1;F.5.5.${MUSHROOM}`))).toBe("outside_edge");
  });

  it("E on a free build or picture is refused with free_no_parts", async () => {
    const { city } = makeCity();
    const v = visit(city);
    await send(city, v, `cm1;F.100.100.${MUSHROOM};G.101.100.s.4.4.fff`);
    expect(first(await send(city, v, "cm1;E.100.100.flag.n.2"))).toBe("free_no_parts");
    expect(first(await send(city, v, "cm1;E.101.100.flag.n.2"))).toBe("free_no_parts");
  });

  it("A adds only to a model of the same visit; the cell limits hold", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city, "gemini");
    await send(city, a, `cm1;F.100.100.${MUSHROOM};B.101.100.house.3.1.7;G.102.100.s.4.4.fff`);
    expect(first(await send(city, b, `cm1;A.100.100.${shape(1)}`))).toBe("not_your_model");
    expect(first(await send(city, a, `cm1;A.101.100.${shape(1)}`))).toBe("not_your_model"); // a house
    expect(first(await send(city, a, `cm1;A.102.100.${shape(1)}`))).toBe("not_your_model"); // a picture
    expect(first(await send(city, a, `cm1;A.103.100.${shape(1)}`))).toBe("not_your_model"); // empty
    const r = await send(city, a, `cm1;A.100.100.${shape(7)}`);
    expect(r.applied).toBe(1);
    expect(String(cell(city, 100, 100).shape)).toBe(`${MUSHROOM}_${shape(7)}`);
    // up to 400 shapes: 3 + 1 + 5 x 79 + 1 = 400, one more is too many (a line holds about 80 shapes, so the sends spread over 10-minute network windows)
    for (let i = 0; i < 5; i++) await send(city, a, `cm1;A.100.100.${Array.from({ length: 79 }, (_, j) => shape(i * 79 + j)).join("_")}`, NOW + (i + 1) * 10 * MIN);
    await send(city, a, `cm1;A.100.100.${shape(9)}`, NOW + 70 * MIN);
    expect(String(cell(city, 100, 100).shape).split("_").length).toBe(400);
    expect(first(await send(city, a, `cm1;A.100.100.${shape(1)}`, NOW + 80 * MIN))).toBe("too_many_shapes");
  });

  it("moving shapes: at most 40 per cell over F and A", async () => {
    const { city } = makeCity();
    const a = visit(city);
    await send(city, a, `cm1;F.100.100.${Array(30).fill(shape(1, 4)).join("_")}`);
    expect((await send(city, a, `cm1;A.100.100.${Array(10).fill(shape(2, 1)).join("_")}`)).applied).toBe(1);
    expect(first(await send(city, a, `cm1;A.100.100.${shape(3, 5)}`))).toBe("too_many_shapes");
    expect((await send(city, a, `cm1;A.100.100.${shape(3)}`)).applied).toBe(1);
  });

  it("a 32 x 32 picture over 3 lines reads back whole; G add checks owner, size and total", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city, "gemini");
    // 1024 pixels, no equal neighbours, so no run shortens the text: 342 + 341 + 341
    const px = Array.from({ length: 1024 }, (_, i) => ((i * 37 + 5) % 4095 + 1).toString(16).padStart(3, "0"));
    for (let i = 1; i < px.length; i++) if (px[i] === px[i - 1]) px[i] = "000";
    const part = (from: number, to: number) => px.slice(from, to).join("_");
    const l1 = `cm1;G.100.100.s.32.32.${part(0, 342)}`;
    const l2 = `cm1;G.100.100.s.32.32.add.${part(342, 683)}`;
    const l3 = `cm1;G.100.100.s.32.32.add.${part(683, 1024)}`;
    for (const l of [l1, l2, l3]) expect(l.length).toBeLessThanOrEqual(MAX_LINE);
    expect((await send(city, a, l1)).applied).toBe(1);
    expect(first(await send(city, b, l2))).toBe("not_your_model");
    expect(first(await send(city, a, "cm1;G.100.100.s.16.16.add.fff"))).toBe("not_your_model"); // other size
    expect(first(await send(city, a, "cm1;G.100.100.e.32.32.add.fff"))).toBe("not_your_model"); // other facing
    expect((await send(city, a, l2)).applied).toBe(1);
    expect((await send(city, a, l3)).applied).toBe(1);
    const row = cell(city, 100, 100);
    expect(row.style).toBe("picture");
    const [facing, w, h, pixels] = String(row.shape).split(".");
    expect([facing, w, h]).toEqual(["s", "32", "32"]);
    expect(pixels.split("_").length).toBe(1024);
    expect(pixels).toBe(px.join("_"));
    expect(first(await send(city, a, "cm1;G.100.100.s.32.32.add.fff"))).toBe("bad_picture"); // full
    const wire = JSON.parse(city.chunkMessages(1, 1)[0]).cells.find((c: Json) => c.x === 100);
    expect(wire.b).toBe("picture.9.15.0");
    expect(wire.f).toBe(String(row.shape));
    expect(city.worldText(new URL("https://x.test/v1/world.txt?near=100,100"), NOW)).toContain("G.100.100 free picture, 32x32 facing s");
    // fewer pixels than w*h is fine; the rest stays clear
    expect((await send(city, a, "cm1;G.101.100.e.8.8.4xfff")).applied).toBe(1);
  });

  it("hides a free build or picture after 2 reports, a house still needs 3", async () => {
    expect(LIMITS.freeHideReports).toBe(2);
    expect(shouldHide(0, 0, 2, "free")).toBe(true);
    expect(shouldHide(0, 0, 2, "picture")).toBe(true);
    expect(shouldHide(0, 0, 2, "house")).toBe(false);
    expect(shouldHide(0, 0, 3, "house")).toBe(true);
    const { city } = makeCity();
    const v = visit(city);
    await send(city, v, `cm1;F.100.100.${MUSHROOM};B.101.100.house.3.1.7`);
    const report = async (x: number, n: number) => {
      const res = await city.route(new Request("https://x.test/v1/report", {
        method: "POST", headers: { "cf-connecting-ip": `10.0.0.${n}` }, body: JSON.stringify({ x, y: 100, device: `device-${n}-aaaaaa` }),
      }), NOW);
      return (await res.json()) as Json;
    };
    expect((await report(100, 1)).hidden).toBe(false);
    expect((await report(100, 2)).hidden).toBe(true);
    expect((await report(101, 1)).hidden).toBe(false);
    expect((await report(101, 2)).hidden).toBe(false);
    expect((await report(101, 3)).hidden).toBe(true);
  });

  it("admin undo brings back the shape the cell had before", async () => {
    const { city } = makeCity(undefined, { ADMIN_KEY: KEY });
    const a = visit(city), b = visit(city, "gemini");
    await send(city, a, `cm1;F.100.100.${MUSHROOM}`);
    await send(city, b, `cm1;G.100.100.s.4.4.fff`, NOW + 11 * MIN);
    expect(cell(city, 100, 100).style).toBe("picture");
    const res = await city.route(new Request("https://x.test/v1/admin/undo-visit", {
      method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ pub: b.pub }),
    }), NOW + 12 * MIN);
    expect(((await res.json()) as Json).restored).toBe(1);
    expect(cell(city, 100, 100)).toMatchObject({ style: "free", shape: MUSHROOM });
  });
});

describe("migration v5 -> v6", () => {
  it("adds cells.shape, keeps every row, edits none", async () => {
    const db = new DatabaseSync(":memory:");
    const { city } = makeCity(db);
    const v = visit(city);
    await send(city, v, "cm1;B.100.100.house.3.1.7;B.101.100.cottage.2.2.2;C.102.100;S.103.100.t2.sun.-.-");
    const dump = () => JSON.stringify(db.prepare("SELECT x,y,style,h,pal,seed,parts,sign,claim,team,built_at,last_like,visit FROM cells ORDER BY x").all());
    const before = dump();
    const n = (t: string) => Number(db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).all()[0].n);
    const counts = [n("cells"), n("events"), n("visits"), n("blocks")];
    db.exec("ALTER TABLE cells DROP COLUMN shape");
    db.prepare("UPDATE meta SET v = '5' WHERE k = 'schema'").run();
    const { sql } = makeCity(db);
    expect(sql.exec("PRAGMA table_info(cells)").toArray().some((c) => c.name === "shape")).toBe(true);
    expect(sql.exec("SELECT v FROM meta WHERE k = 'schema'").one().v).toBe("10");
    expect([n("cells"), n("events"), n("visits"), n("blocks")]).toEqual(counts);
    expect(dump()).toBe(before);
    expect(sql.exec("SELECT COUNT(*) AS n FROM cells WHERE shape IS NOT NULL").one().n).toBe(0);
  });
});

describe("free build overview colour", () => {
  it("stores the palette nearest to the most used colour, so the zoomed-out map shows it", async () => {
    const { freeBuild, parseCommand } = await import("../public/kit.js");
    const red = parseCommand("F.100.100.b-0-0-0-16-16-8-e00_b-0-0-8-2-2-2-00f");
    const blue = parseCommand("G.100.100.s.4.4.16x24c");
    if (!red.ok || !blue.ok) throw new Error("parse");
    expect((freeBuild(red.cmd as never, null, null) as { pal: number }).pal).toBe(12); // coral
    expect((freeBuild(blue.cmd as never, null, null) as { pal: number }).pal).toBe(5); // sky
  });
});
