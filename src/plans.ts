// Shared plans: pure helpers (no storage), tested in test/plans.test.ts.
import { inArea, type Area, type ParsedItem } from "../public/kit.js";
import { LIMITS } from "./limits";
import { CLOSED_MESSAGE, isFrozen, type Part } from "./engine";

export interface Target { x: number; y: number; style: string; h: number; pal: number; seed: number; parts: Part[] }
export interface PlanItemResult { cmd: string; ok: boolean; code?: string; message?: string; note?: string }

/**
 * Turn the B and E commands of a plan line into target cells. A later B on the same cell replaces the earlier one.
 * Cells outside the open area are skipped with "outside the city edge", cells in a closed area with "closed". Overlap with other plans or buildings is fine.
 */
export function planTargets(items: ParsedItem[], area: Area, frozen?: Area[]): { targets: Target[]; results: PlanItemResult[] } {
  const map = new Map<string, Target>();
  const results: PlanItemResult[] = [];
  for (const it of items) {
    if (!it.ok) { results.push({ cmd: it.raw, ok: false, code: it.code, message: it.message }); continue; }
    const c = it.cmd;
    if (c.v === "T" || c.v === "P") { results.push({ cmd: it.raw, ok: true, note: c.v === "P" ? "plan" : "team already set" }); continue; }
    if (c.v !== "B" && c.v !== "E") { results.push({ cmd: it.raw, ok: false, code: "plan_only_be", message: "a plan line takes only B and E commands" }); continue; }
    if (!inArea(area, c.x, c.y)) { results.push({ cmd: it.raw, ok: false, code: "outside_edge", message: "outside the city edge. Pick a cell inside the open area." }); continue; }
    if (isFrozen(frozen, c.x, c.y)) { results.push({ cmd: it.raw, ok: false, code: "closed", message: CLOSED_MESSAGE }); continue; }
    const k = `${c.x},${c.y}`;
    if (c.v === "B") {
      map.set(k, { x: c.x, y: c.y, style: c.style, h: c.h, pal: c.pal, seed: c.seed, parts: [] });
      results.push({ cmd: it.raw, ok: true });
      continue;
    }
    const t = map.get(k);
    if (!t) { results.push({ cmd: it.raw, ok: false, code: "no_target", message: "an E needs a B for the same cell earlier in the plan" }); continue; }
    const parts = t.parts.filter((p) => p.side !== c.side);
    if (parts.length >= LIMITS.maxParts) { results.push({ cmd: it.raw, ok: false, code: "too_many_parts", message: `a building holds at most ${LIMITS.maxParts} parts` }); continue; }
    parts.push({ part: c.part, side: c.side, h: c.h });
    t.parts = parts;
    results.push({ cmd: it.raw, ok: true });
  }
  return { targets: [...map.values()], results };
}

/** Progress: target cells whose current building has the same style (height, palette and seed may differ). */
export function planDone(targets: { x: number; y: number; style: string }[], styleAt: (x: number, y: number) => string | null): number {
  let n = 0;
  for (const t of targets) if (styleAt(t.x, t.y) === t.style) n++;
  return n;
}

/** "completed" is only on plans that ended that way before v9; a built plan now stays active. */
export type PlanStatus = "active" | "completed" | "expired";

/** A plan stays active, built or not, and ends after 7 days with no newly matching cell. */
export function planState(status: PlanStatus, lastProgress: number, now: number): PlanStatus {
  if (status !== "active") return status;
  return now - lastProgress >= LIMITS.planIdleMs ? "expired" : "active";
}

export function planCaps(ipPlansToday: number, activePlans: number): string | null {
  if (activePlans >= LIMITS.maxActivePlans) return `There are already ${LIMITS.maxActivePlans} active plans. Help one of them, or wait until one ends.`;
  if (ipPlansToday >= LIMITS.plansPerIpPerDay) return `Limit: ${LIMITS.plansPerIpPerDay} new plans per day from one network. Come back after 00:00 UTC.`;
  return null;
}

export const planWire = (t: Target) => ({
  x: t.x, y: t.y, b: `${t.style}.${t.h}.${t.pal}.${t.seed}`,
  ...(t.parts.length ? { e: t.parts.map((p) => `${p.part}.${p.side}.${p.h}`).join(",") } : {}),
});
