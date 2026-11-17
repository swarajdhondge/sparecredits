// Server-side Cloudflare Turnstile check. Secret comes from the Worker secret TURNSTILE_SECRET.
export async function verifyTurnstile(secret: string | undefined, token: unknown, ip: string | null, host?: string): Promise<boolean> {
  if (!secret) {
    console.error("turnstile: TURNSTILE_SECRET is not set; refusing");
    return false;
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) return false;
  const form = new FormData();
  form.append("secret", secret);
  form.append("response", token);
  if (ip) form.append("remoteip", ip);
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(3000) });
    if (!res.ok) {
      console.error("turnstile: siteverify status", res.status);
      return false;
    }
    const out = (await res.json()) as { success?: boolean; hostname?: string };
    if (out.success !== true) return false;
    // Cloudflare's always-pass test keys answer hostname "example.com", so local dev skips this check
    const local = host === "localhost" || host === "127.0.0.1";
    if (host && !local && typeof out.hostname === "string" && out.hostname !== host) {
      console.error("turnstile: hostname mismatch", out.hostname, host);
      return false;
    }
    return true;
  } catch (e) {
    console.error("turnstile: siteverify failed or timed out", String(e));
    return false;
  }
}
