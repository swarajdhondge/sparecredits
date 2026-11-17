// v9 card S: the wait per network (D3) and weekly seasons (D6).
import { describe, it, expect } from "vitest";
import { makeCity } from "./support/harness";

const NOW = Date.UTC(2026, 10, 14, 12, 0); // a Saturday
const MON = Date.UTC(2026, 10, 16);
type City = ReturnType<typeof makeCity>["city"];
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function visit(city: City) {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, 'claude', ?, ?, 'approved')", id, `pub-${id.slice(6, 12)}`, NOW, NOW);
  return id;
}
async function send(city: City, id: string, line: string, ip: string, now = NOW) {
  return (await city.runLine(city.visitRow(id)!, line, now, ip).json()) as Json;
}
const claims = (from: number, n: number) => "cm1;" + Array.from({ length: n }, (_, i) => `C.${85 + from + i}.100`).join(";");

describe("the wait per network", () => {
  it("12 commands per 10 minutes are shared by all visits of one network; another network is free", async () => {
    const { city } = makeCity();
    const a = visit(city), b = visit(city), c = visit(city);
    expect((await send(city, a, claims(0, 12), "net1")).applied).toBe(12);
    const r = await send(city, b, claims(20, 1), "net1", NOW + 4 * 60_000); // a second visit, same network, 13th command
    expect(r.applied).toBe(0);
    expect(r.results[0]).toMatchObject({ ok: false, code: "wait" });
    expect(r.results[0].message).toBe("Wait: 12 commands per 10 minutes per person. Try again in 360 seconds.");
    expect((await send(city, c, claims(30, 1), "net2", NOW + 4 * 60_000)).applied).toBe(1);
    expect((await send(city, b, claims(20, 1), "net1", NOW + 10 * 60_000)).applied).toBe(1); // the window is over
  });
});

describe("seasons", () => {
  it("the first season runs to the next Monday; past it the scores are stored and season 2 starts; no cell is removed", async () => {
    const { city } = makeCity();
    city.rollSeason(NOW);
    expect(city.seasonsList().current).toMatchObject({ num: 1, starts: NOW, ends: MON });
    const a = visit(city);
    await send(city, a, claims(0, 3), "net1", NOW + 1000);
    city.rollSeason(MON - 1);
    expect(city.seasonsList().past).toEqual([]);

    city.rollSeason(MON + 5000); // any request after the end does this
    await send(city, a, claims(10, 1), "net2", MON + 6000);
    const s = city.seasonsList();
    expect(s.current).toMatchObject({ num: 2, starts: MON, ends: MON + 7 * 86_400_000 });
    expect(s.past).toHaveLength(1);
    expect(s.past[0]).toMatchObject({ num: 1, ends: MON, end_seq: 3, scores: { teams: { claude: 3, chatgpt: 0, gemini: 0, other: 0 }, groups: [] } });
    expect(Number(city.sql.exec("SELECT COUNT(*) AS n FROM cells").one().n)).toBe(4);

    // the time-lapse stops at the season's end_seq
    const tl = (await city.timelapse(new URL("https://cm.example/v1/timelapse?until=3"), MON + 7000).json()) as Json;
    expect(tl.events.map((e: Json) => e.seq)).toEqual([1, 2, 3]);
  });
});
