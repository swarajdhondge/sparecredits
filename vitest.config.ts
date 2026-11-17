import { defineConfig } from "vitest/config";
export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
  // City imports "cloudflare:workers"; tests use a small stand-in and a real SQLite (node:sqlite)
  resolve: { alias: { "cloudflare:workers": new URL("./test/support/cloudflare-workers.ts", import.meta.url).pathname } },
});
