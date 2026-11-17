// v8 hardening: one vote per network, compact A undo, plans per cell, IPv6 networks, capped bodies.
import { describe, it, expect } from "vitest";
import { makeCity } from "./support/harness";
import { ipKey } from "../src/city";

const NOW = Date.UTC(2026, 10, 14, 12, 0);
const KEY = "test-admin-key-0123456789-abcdef";
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type City = ReturnType<typeof makeCity>["city"];

function visit(city: City, team = "claude") {
  const id = `visit-${Math.random().toString(36).slice(2)}-xxxx`;
  const pub = `pub-${id.slice(6, 12)}`;
  city.sql.exec("INSERT INTO visits (id, pub, team, created, approved_at, status) VALUES (?, ?, ?, ?, ?, 'approved')", id, pub, team, NOW, NOW);
  return { id, pub };
}
const send = async (city: City, v: { id: string }, line: string, now = NOW) => (await city.runLine(city.visitRow(v.id)!, line, now).json()) as Json;
const shape = (n: number) => `b-0-0-0-1-1-1-${n.toString(16).padStart(3, "0")}`;

describe("votes", () => {
  it("count once per network and cell, whatever the device id; another network counts", async () => {
    const { city } = makeCity();
    await send(city, visit(city), "cm1;B.100.100.house.3.1.7");
    const rate = async (ip: string, device: string) => {
      const res = await city.vote(new Request("https://x.test/v1/rate", { method: "POST", body: JSON.stringify({ x: 100, y: 100, device, vote: -1 }), headers: { "cf-connecting-ip": ip } }), NOW, "rate");
      return { status: res.status, body: (await res.json()) as Json };
    };
    expect((await rate("1.1.1.1", "device-aaaa1111")).status).toBe(200);
    for (const d of ["device-bbbb2222", "device-cccc3333", "device-dddd4444"]) {
      const r = await rate("1.1.1.1", d);
      expect([r.status, r.body.code]).toEqual([409, "duplicate"]);
    }
    expect((await rate("2.2.2.2", "device-eeee5555")).status).toBe(200);
    expect(city.store.get(100, 100)!.downs).toBe(2);
  });
});

describe("undo of A", () => {
  it("stores a short prev for an A, not the whole cell", async () => {
    const { city } = makeCity();
    const a = visit(city);
    await send(city, a, `cm1;F.100.100.${shape(1)}_${shape(2)}`);
    expect((await send(city, a, `cm1;A.100.100.${shape(3)}_${shape(4)}`, NOW + 1000)).applied).toBe(1);
    expect(String(city.sql.exec("SELECT prev FROM events ORDER BY seq DESC LIMIT 1").one().prev)).toMatch(/^A:\d+:\d+:\d+$/);
  });

  it("admin undo of a visit that did F then A restores the exact shapes from before it", async () => {
    const { city } = makeCity(undefined, { ADMIN_KEY: KEY });
    const a = visit(city);
    await send(city, a, `cm1;F.100.100.${shape(1)}_${shape(2)}`);
    const first = city.store.get(100, 100)!;
    // the visit ends and a later one replaces the model, then adds to its own model: undo the later visit
    const b = visit(city, "gemini");
    await send(city, b, `cm1;F.100.100.${shape(5)}`, NOW + 11 * 60_000);
    const mid = city.store.get(100, 100)!;
    await send(city, b, `cm1;A.100.100.${shape(6)}_${shape(7)}`, NOW + 12 * 60_000);
    expect(city.store.get(100, 100)!.shape).toBe(`${mid.shape}_${shape(6)}_${shape(7)}`);
    // undo b: its F had prev = a's model (whole cell), then the A patch is applied on top
    const res = await city.route(new Request("https://x.test/v1/admin/undo-visit", { method: "POST", headers: { authorization: `Bearer ${KEY}` }, body: JSON.stringify({ pub: b.pub }) }), NOW + 13 * 60_000);
    expect(await res.json()).toMatchObject({ ok: true, restored: 1, hidden: 0 });
    expect(city.store.get(100, 100)!.shape).toBe(first.shape);
  });
});

describe("plans per cell", () => {
  it("refuses a 4th active plan on a cell with plan_cell_busy", async () => {
    const { city } = makeCity();
    for (let i = 0; i < 3; i++) expect((await send(city, visit(city), `cm1;P.plan${i};B.100.100.ship.3.1.1`)).ok).toBe(true);
    const r = await send(city, visit(city), "cm1;P.plan4;B.100.100.ship.3.1.1");
    expect(r).toMatchObject({ ok: false, code: "plan_cell_busy" });
    expect((await send(city, visit(city), "cm1;P.other;B.101.100.ship.3.1.1")).ok).toBe(true);
  });
});

describe("networks", () => {
  it("an IPv6 address counts by its /64 prefix, and :: expands correctly", () => {
    expect(ipKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe(ipKey("2001:0db8:0001:0002::1"));
    expect(ipKey("2001:db8:1:3::1")).not.toBe(ipKey("2001:db8:1:2::1"));
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(ipKey("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(ipKey("1.2.3.4")).toBe("1.2.3.4");
  });
});

describe("bodies", () => {
  it("a chunked body over the cap is refused while it is read", async () => {
    const { city } = makeCity();
    const big = new ReadableStream({ start(c) { for (let i = 0; i < 10; i++) c.enqueue(new TextEncoder().encode("x".repeat(1000))); c.close(); } });
    const req = new Request("https://x.test/v1/visits", { method: "POST", body: big, duplex: "half" } as RequestInit);
    expect(await city.readJson(req)).toBeNull();
  });
});
