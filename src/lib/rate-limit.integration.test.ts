import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { enforceRateLimit, peerIdentity, RateLimitError } from "./rate-limit";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Rate limit tests require looplocal_test");

afterAll(async () => { await pool.end(); });

describe("shared PostgreSQL rate limits", () => {
  it("allows only five of twenty simultaneous requests for the same identity", async () => {
    const identity = randomUUID();
    const calls = Array.from({ length: 20 }, () => enforceRateLimit({ scope: "test_atomic", identity, max: 5, windowSeconds: 1 }));
    const results = await Promise.allSettled(calls);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(5);
    expect(results.filter((item) => item.status === "rejected" && item.reason instanceof RateLimitError)).toHaveLength(15);

    const stored = await pool.query<{ key_hash: string; hits: number }>("select key_hash, hits from rate_limits where hits = 20 order by updated_at desc limit 1");
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].key_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored.rows)).not.toContain(identity);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    await expect(enforceRateLimit({ scope: "test_atomic", identity, max: 5, windowSeconds: 1 })).resolves.toBeUndefined();
  });

  it("ignores attacker-supplied forwarded addresses when proxy trust is disabled", () => {
    const previous = process.env.TRUST_PROXY_CLIENT_IP;
    process.env.TRUST_PROXY_CLIENT_IP = "false";
    try {
      const first = new Request("http://localhost:3000/api/enroll", { headers: { "x-forwarded-for": "192.0.2.1" } });
      const second = new Request("http://localhost:3000/api/enroll", { headers: { "x-forwarded-for": "192.0.2.2" } });
      expect(peerIdentity(first)).toBe(peerIdentity(second));
    } finally {
      if (previous === undefined) delete process.env.TRUST_PROXY_CLIENT_IP; else process.env.TRUST_PROXY_CLIENT_IP = previous;
    }
  });
});
