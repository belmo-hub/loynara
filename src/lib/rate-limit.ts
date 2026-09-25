import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { pool } from "@/db";
import { DomainError } from "./loyalty";

type Limit = { scope: string; identity: string; max: number; windowSeconds: number };

export class RateLimitError extends DomainError {
  constructor(readonly retryAfterSeconds: number) {
    super("RATE_LIMIT", "Too many requests. Please try again later.");
  }
}

function rateKey(scope: string, identity: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? (process.env.NODE_ENV === "test" ? "synthetic-test-rate-key" : "");
  if (secret.length < 16) throw new Error("BETTER_AUTH_SECRET is required for shared rate limiting");
  return createHmac("sha256", secret).update(scope).update("\0").update(identity).digest("hex");
}

// Only enable proxy IP trust when an approved proxy overwrites this header.
// Direct client-provided X-Forwarded-For values are ignored by default.
export function peerIdentity(request: Request): string {
  if (process.env.TRUST_PROXY_CLIENT_IP !== "true") return "untrusted-peer";
  const candidate = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim();
  return candidate && isIP(candidate) ? candidate : "untrusted-peer";
}

export async function enforceRateLimit({ scope, identity, max, windowSeconds }: Limit): Promise<void> {
  if (!/^[a-z_]{3,64}$/.test(scope) || !identity || !Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error("Invalid rate limit configuration");
  }
  const keyHash = rateKey(scope, identity);
  const result = await pool.query<{ hits: number; reset_at: Date }>(`
    INSERT INTO rate_limits (key_hash, hits, reset_at, updated_at)
    VALUES ($1, 1, now() + $2::integer * interval '1 second', now())
    ON CONFLICT (key_hash) DO UPDATE SET
      hits = CASE WHEN rate_limits.reset_at <= now() THEN 1 ELSE rate_limits.hits + 1 END,
      reset_at = CASE WHEN rate_limits.reset_at <= now() THEN now() + $2::integer * interval '1 second' ELSE rate_limits.reset_at END,
      updated_at = now()
    RETURNING hits, reset_at
  `, [keyHash, windowSeconds]);
  const row = result.rows[0];
  if (!row) throw new Error("Rate limiter did not return a decision");
  if (row.hits > max) throw new RateLimitError(Math.max(1, Math.ceil((row.reset_at.getTime() - Date.now()) / 1000)));
}

export function enforcePeerLimit(request: Request, scope: string, max: number, windowSeconds: number) {
  return enforceRateLimit({ scope, identity: peerIdentity(request), max, windowSeconds });
}
