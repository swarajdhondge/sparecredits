// Runs the real City object on a real SQLite (node:sqlite), with a fake Durable Object context and fake WebSockets.
import { DatabaseSync } from "node:sqlite";
import { City } from "../../src/city";

/** Same shape as the Durable Object SqlStorage: exec(query, ...bindings) -> cursor. */
export function sqlOver(db: DatabaseSync) {
  return {
    exec(query: string, ...bindings: unknown[]) {
      const st = db.prepare(query);
      let rows: Record<string, unknown>[] = [];
      let rowsWritten = 0;
      if (st.columns().length > 0) rows = st.all(...bindings);
      else rowsWritten = Number(st.run(...bindings).changes);
      return {
        rowsWritten,
        toArray: () => rows,
        one: () => {
          if (rows.length !== 1) throw new Error(`one(): expected 1 row, got ${rows.length}`);
          return rows[0];
        },
      };
    },
  };
}

/** Run `fn` in a transaction, like ctx.storage.transactionSync. */
export function txOver(db: DatabaseSync) {
  return (fn: () => void) => {
    db.exec("BEGIN");
    try { fn(); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  };
}

export class FakeSocket {
  sent: string[] = [];
  att: unknown = null;
  send(m: string) { this.sent.push(m); }
  serializeAttachment(a: unknown) { this.att = a; }
  deserializeAttachment() { return this.att; }
  messages() { return this.sent.map((s) => JSON.parse(s) as Record<string, unknown>); }
}

(globalThis as unknown as Record<string, unknown>).WebSocketRequestResponsePair = class {};

export function makeCity(db = new DatabaseSync(":memory:"), env: { ADMIN_KEY?: string; TURNSTILE_SECRET?: string } = {}) {
  const sockets: FakeSocket[] = [];
  const sql = sqlOver(db);
  const ctx = {
    storage: { sql, transactionSync: <T>(fn: () => T): T => { let r!: T; txOver(db)(() => { r = fn(); }); return r; } },
    blockConcurrencyWhile: (fn: () => unknown) => fn(),
    setWebSocketAutoResponse: () => {},
    getWebSockets: () => sockets,
  };
  const city = new City(ctx as never, { CITY: null, ASSETS: null, TURNSTILE_SITE_KEY: "x", ...env } as never);
  return { city, db, sql, sockets };
}
