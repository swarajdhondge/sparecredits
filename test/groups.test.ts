// v9 card G: word-named groups (J), D7 to D9.
import { describe, it, expect } from "vitest";
import { parseLine } from "../public/kit.js";
import { makeCity } from "./support/harness";

const NOW = Date.UTC(2026, 10, 14, 12, 0);
const MON = Date.UTC(2026, 10, 16);
type City = ReturnType<typeof makeCity>["city"];
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function visit(city: City) {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, 'claude', ?, ?, 'approved')", id, `pub-${id.slice(6, 12)}`, NOW, NOW);
  return id;
}
async function send(city: City, id: string, line: string, ip = "net1", now = NOW) {
  const res = city.runLine(city.visitRow(id)!, line, now, ip);
  return { ...((await res.json()) as Json), status: res.status } as Json;
}
const detail = async (city: City, slug: string) => (await city.groupDetail(slug).json()) as Json;

describe("groups (J)", () => {
  it("the first J creates the group, a second visit joins it, both cells count", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city);
    expect((await send(city, a, "cm1;T.claude;J.harbor.garden;C.90.90")).applied).toBe(1);
    expect((await send(city, b, "cm1;J.harbor.garden;C.91.90", "net2")).applied).toBe(1);
    const g = await detail(city, "harbor-garden");
    expect(g).toMatchObject({ id: "harbor.garden", name: "Harbor Garden", cells: 2, visits: 2, created: NOW });
    expect(g.color).toBeGreaterThanOrEqual(0);
    expect(g.color).toBeLessThan(16);
    expect(city.store.get(90, 90)!.grp).toBe("harbor.garden");
    expect(((await city.groupList().json()) as Json).groups[0]).toMatchObject({ id: "harbor.garden", cells: 2 });
    expect(city.groupDetail("castle-tower").status).toBe(404);
  });

  it("J alone builds nothing and costs no command; a cell overwritten without a group leaves the group", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city);
    const r = await send(city, a, "cm1;J.harbor.garden");
    expect(r).toMatchObject({ ok: true, applied: 0, commands_left: 60 });
    await send(city, a, "cm1;C.90.90");
    expect((await detail(city, "harbor-garden")).cells).toBe(1);
    await send(city, b, "cm1;B.90.90.house.3.1.1", "net2"); // no group: builds over the claim
    expect(city.store.get(90, 90)!.grp).toBeNull();
    expect((await detail(city, "harbor-garden")).cells).toBe(0);
  });

  it("a different name on the same visit is refused with group_set; the same name again is fine", async () => {
    const { city } = makeCity();
    const a = visit(city);
    await send(city, a, "cm1;J.harbor.garden;C.90.90");
    const bad = await send(city, a, "cm1;J.castle.tower;C.91.90");
    expect(bad).toMatchObject({ ok: false, code: "group_set", status: 400 });
    expect(city.store.get(91, 90)).toBeNull();
    expect((await send(city, a, "cm1;J.harbor.garden;C.92.90")).applied).toBe(1);
  });

  it("J is refused in a plan line and must be first (after T)", async () => {
    expect(parseLine("cm1;P.moon.garden;J.harbor.garden;B.100.100.house.3.1.1")).toMatchObject({ ok: false, code: "bad_plan" });
    const l = parseLine("cm1;C.90.90;J.harbor.garden");
    expect(l.ok && l.items[1]).toMatchObject({ ok: false, code: "group_not_first" });
    const { city } = makeCity();
    const a = visit(city);
    expect(await send(city, a, "cm1;P.moon.garden;J.harbor.garden;B.100.100.house.3.1.1")).toMatchObject({ ok: false, code: "bad_plan" });
  });

  it("a network may start 5 new groups a day; joining an old one is free", async () => {
    const { city } = makeCity();
    const names = ["harbor.garden", "castle.tower", "bridge.market", "meadow.village", "forest.river", "island.lake"];
    for (const n of names.slice(0, 5)) {
      expect((await send(city, visit(city), `cm1;J.${n}`)).ok).toBe(true);
    }
    const v6 = visit(city);
    expect(await send(city, v6, `cm1;J.${names[5]}`)).toMatchObject({ ok: false, code: "limit" });
    expect((await send(city, v6, `cm1;J.${names[0]}`)).ok).toBe(true);
    expect((await send(city, visit(city), `cm1;J.${names[5]}`, "net2")).ok).toBe(true); // another network
  });

  it("the season snapshot stores the top groups; world.txt says for <group> and lists the top groups", async () => {
    const { city } = makeCity();
    city.rollSeason(NOW);
    const a = visit(city), b = visit(city);
    await send(city, a, "cm1;J.harbor.garden;B.90.90.house.3.1.1;C.91.90");
    await send(city, b, "cm1;J.castle.tower;C.92.90", "net2");
    await send(city, visit(city), "cm1;C.93.90", "net3", NOW + 1000); // a visit without a group
    const w = city.worldText(new URL("https://cm.example/v1/world.txt?near=90,90"), NOW);
    expect(w).toContain("B.90.90.house.3.1.1 by claude for harbor.garden");
    expect(w).toContain("C.92.90 by claude for castle.tower");
    expect(w).toContain("Top groups: harbor.garden 2, castle.tower 1");
    expect(w).toMatch(/C\.93\.90 by claude\n/);
    city.rollSeason(MON + 5000);
    expect(city.seasonsList().past[0].scores.groups).toEqual([{ id: "harbor.garden", cells: 2 }, { id: "castle.tower", cells: 1 }]);
  });
});
