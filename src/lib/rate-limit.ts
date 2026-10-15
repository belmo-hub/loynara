import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { pool } from "@/db";
import type { Pool } from "pg";
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

// One fixed event per minute per process, independent of peer/header values.
// Monotonic time avoids clock adjustments; no request-keyed map or DB dependency.
const ingressSignalKey = Symbol.for("loynara.invalid-ingress.next-signal-at");
const ingressSignalState = globalThis as typeof globalThis & { [ingressSignalKey]?: number };
export class InvalidIngressError extends DomainError {
  constructor() {
    super("INVALID_INGRESS", "Invalid ingress metadata");
    const now = performance.now();
    if (now >= (ingressSignalState[ingressSignalKey] ?? 0)) {
      ingressSignalState[ingressSignalKey] = now + 60_000;
      console.warn('{"event":"invalid_ingress"}');
    }
  }
}

// This setting asserts a DEPLOYMENT boundary, not header authentication. The
// Railway origin must be private and Cloudflare Tunnel its sole public ingress.
// Local/compiled synthetic previews deliberately retain their conservative bucket.
export function peerIdentity(request: Request): string {
  const mode = process.env.TRUSTED_INGRESS;
  const legacy = process.env.TRUST_PROXY_CLIENT_IP;
  if (legacy !== undefined && legacy !== "false") throw new InvalidIngressError();
  if (mode === undefined || mode === "local") {
    if (process.env.PRODUCTION_ENVIRONMENT === "loynara-production") throw new InvalidIngressError();
    return "untrusted-peer";
  }
  if (mode !== "cloudflare_tunnel") throw new InvalidIngressError();
  const address = request.headers.get("cf-connecting-ip");
  // isIP rejects ports, lists, brackets and non-canonical IPv4 forms. Reject
  // scoped IPv6 explicitly: a public visitor address cannot have a zone suffix.
  if (!address || address.length > 45 || address.includes("%") || !isIP(address)) throw new InvalidIngressError();
  let canonical = address;
  if (isIP(address) === 6) {
    // WHATWG URL serialization canonicalizes valid IPv6 case/compression and
    // embedded IPv4; validation above prevents URL parser leniency for inputs.
    canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
    if (mapped) {
      const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
      canonical = [high >>> 8, high & 255, low >>> 8, low & 255].join(".");
    } else {
      // Native IPv6 uses /64, matching Better Auth's default subnet granularity.
      // Expand only a strictly validated canonical address, then discard host bits.
      const [left, right] = canonical.split("::");
      const head = left ? left.split(":") : [];
      const tail = right ? right.split(":") : [];
      const words = right === undefined ? head : [...head, ...Array<string>(8 - head.length - tail.length).fill("0"), ...tail];
      canonical = `${words.slice(0, 4).join(":")}::/64`;
    }
  }
  // Raw addresses never become persisted rate-limit keys or ordinary log data.
  return `peer:${rateKey("trusted_peer_identity", canonical)}`;
}

export async function enforceRateLimit({ scope, identity, max, windowSeconds }: Limit, queries: Pick<Pool, "query"> = pool): Promise<void> {
  if (!/^[a-z_]{3,64}$/.test(scope) || !identity || !Number.isSafeInteger(max) || max < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error("Invalid rate limit configuration");
  }
  const keyHash = rateKey(scope, identity);
  const result = await queries.query<{ hits: number; reset_at: Date }>(`
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

/** Gives back one hit counted by enforceRateLimit in the current window, for an attempt that turned out not to count. */
export async function refundRateLimit({ scope, identity }: Pick<Limit, "scope" | "identity">, queries: Pick<Pool, "query"> = pool): Promise<void> {
  // Rows require hits > 0, so the last hit is given back by removing the row. One statement, so a concurrent hit
  // either lands before (and the row is decremented) or after (and starts a fresh row).
  await queries.query(`
    WITH emptied AS (DELETE FROM rate_limits WHERE key_hash = $1 AND reset_at > now() AND hits = 1 RETURNING 1)
    UPDATE rate_limits SET hits = hits - 1, updated_at = now()
    WHERE key_hash = $1 AND reset_at > now() AND hits > 1 AND NOT EXISTS (SELECT 1 FROM emptied)
  `, [rateKey(scope, identity)]);
}

export function enforcePeerLimit(request: Request, scope: string, max: number, windowSeconds: number, queries: Pick<Pool, "query"> = pool) {
  return enforceRateLimit({ scope, identity: peerIdentity(request), max, windowSeconds }, queries);
}
