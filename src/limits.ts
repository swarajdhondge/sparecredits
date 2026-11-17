// All limits in one place. Pure functions, tested in test/limits.test.ts.

export const LIMITS = {
  perNetPerWindow: 12, // commands per network per window, shared over all its visits
  netWindowMs: 10 * 60 * 1000,
  perVisitTotal: 60,
  visitTtlMs: 2 * 60 * 60 * 1000,
  ipVisitsPerDay: 60, // approved visits (each passed the human check) per network per day
  ipCreatesPerDay: 200, // unapproved visit starts per network per day (spam guard; pending visits expire in 1 h)
  globalVisitsPerDay: 5000,
  globalCommandsPerDay: 25000, // free-plan guard: keeps SQLite writes under the daily row limit
  fadeAfterMs: 7 * 24 * 60 * 60 * 1000,
  retainMs: 14 * 24 * 60 * 60 * 1000,
  hideNet: 5, // auto-hide when downvotes - likes >= this
  hideReports: 3, // or reports from distinct devices >= this
  freeHideReports: 2, // the same, for a free 3D model or a picture (style free or picture)
  votesPerIpPerDay: 40,
  maxParts: 4,
  activeWindowMs: 5 * 60 * 1000,
  pendingTtlMs: 60 * 60 * 1000,
  plansPerIpPerDay: 5,
  groupsPerIpPerDay: 5, // new groups per network per day
  maxActivePlans: 200,
  planIdleMs: 7 * 24 * 60 * 60 * 1000, // a plan with no progress for this long ends
};

export const FULL_MESSAGE = "The city is full today. Come back after 00:00 UTC.";

/** One network's fixed window: when it started and how many commands it used since. */
export interface NetWindow {
  start: number;
  n: number;
}

export interface QuotaResult {
  allowed: number; // how many of the wanted commands may run
  reason?: string;
  code: "rate_limit" | "wait";
  net: NetWindow; // the network window after these commands
}

/** Quota: 60 commands per visit, and 12 per network per 10 minutes (fixed window, shared by every visit of the network). */
export function commandQuota(cmdTotal: number, win: NetWindow | null, now: number, want: number): QuotaResult {
  const net = win && now - win.start < LIMITS.netWindowMs ? win : { start: now, n: 0 };
  const leftTotal = Math.max(0, LIMITS.perVisitTotal - cmdTotal);
  const leftNet = Math.max(0, LIMITS.perNetPerWindow - net.n);
  const allowed = Math.min(want, leftTotal, leftNet);
  let reason: string | undefined;
  let code: QuotaResult["code"] = "rate_limit";
  if (allowed < want) {
    if (leftTotal <= leftNet) reason = `This visit used its ${LIMITS.perVisitTotal} commands. Start a new visit.`;
    else {
      code = "wait";
      const secs = Math.max(1, Math.ceil((net.start + LIMITS.netWindowMs - now) / 1000));
      reason = `Wait: ${LIMITS.perNetPerWindow} commands per ${LIMITS.netWindowMs / 60_000} minutes per person. Try again in ${secs} seconds.`;
    }
  }
  return { allowed, reason, code, net: { start: net.start, n: net.n + allowed } };
}

export function dailyCaps(ipVisitsToday: number, globalVisitsToday: number, globalCommandsToday: number): string | null {
  if (globalVisitsToday >= LIMITS.globalVisitsPerDay || globalCommandsToday >= LIMITS.globalCommandsPerDay) return FULL_MESSAGE;
  if (ipVisitsToday >= LIMITS.ipVisitsPerDay) return `Limit: ${LIMITS.ipVisitsPerDay} visits per day from one network. Come back after 00:00 UTC.`;
  return null;
}

export function slotsLeft(globalVisitsToday: number, globalCommandsToday: number): number {
  return Math.max(0, Math.min(LIMITS.globalVisitsPerDay - globalVisitsToday, LIMITS.globalCommandsPerDay - globalCommandsToday));
}

export type Decay = "fresh" | "faded";

export function decayState(lastLike: number, now: number): Decay {
  const age = now - lastLike;
  if (age >= LIMITS.fadeAfterMs) return "faded";
  return "fresh";
}

export function shouldHide(likes: number, downs: number, reports: number, style?: string | null): boolean {
  const free = style === "free" || style === "picture";
  return downs - likes >= LIMITS.hideNet || reports >= (free ? LIMITS.freeHideReports : LIMITS.hideReports);
}

export const WEEK_MS = 7 * 86_400_000;

/** The latest Monday 00:00 UTC at or before `now`. */
export function weekStart(now: number): number {
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  const dow = new Date(day).getUTCDay(); // 0 = Sunday
  return day - ((dow + 6) % 7) * 86_400_000;
}

/** The first Monday 00:00 UTC after `now`. */
export function nextMonday(now: number): number {
  return weekStart(now) + WEEK_MS;
}

export function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** True only for a Cloudflare free-plan limit error. Narrow on purpose: any other error is a bug and must show as a 500, not as "full". */
export function isFreeLimitError(e: unknown): boolean {
  const m = String((e as Error)?.message ?? e).toLowerCase();
  return /free tier|exceeded allowed|quota|daily limit/.test(m);
}
