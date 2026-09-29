import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { pool } from "@/db";
import { POST as requestDemo } from "./demo-request/route";
import { POST as enroll } from "./enroll/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Public route tests require looplocal_test");

const base = "http://localhost:3000";

function post(path: string, payload: object, clientIp?: string) {
  return new Request(`${base}${path}`, {
    method: "POST",
    headers: {
      origin: base,
      "content-type": "application/json",
      ...(clientIp ? { "cf-connecting-ip": clientIp } : {}),
    },
    body: JSON.stringify(payload),
  });
}

afterAll(async () => { await pool.end(); });

describe("public route abuse controls", () => {
  it("throttles demo requests from one trusted proxy client across distinct addresses", async () => {
    const previousBase = process.env.PUBLIC_BASE_URL;
    const previousProxy = process.env.TRUSTED_INGRESS;
    process.env.PUBLIC_BASE_URL = base;
    process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
    const runId = randomUUID();
    const clientIp = `2001:db8:${runId.slice(0, 4)}:${runId.slice(9, 13)}::1`;
    const addresses: string[] = [];
    try {
      for (let index = 0; index < 10; index += 1) {
        const email = `rate-${runId}-${index}@example.test`;
        addresses.push(email);
        const response = await requestDemo(post("/api/demo-request", { name: "Synthetic owner", business: "Synthetic Cafe", city: "Kassel", email }, clientIp));
        expect(response.status).toBe(201);
      }
      const blockedEmail = `rate-${runId}-blocked@example.test`;
      addresses.push(blockedEmail);
      const blocked = await requestDemo(post("/api/demo-request", { name: "Synthetic owner", business: "Synthetic Cafe", city: "Kassel", email: blockedEmail }, clientIp));
      expect(blocked.status).toBe(429);
      expect(await blocked.json()).toMatchObject({ code: "RATE_LIMIT" });
      const stored = await pool.query<{ count: string }>("select count(*) from demo_requests where email = any($1::text[])", [addresses]);
      expect(Number(stored.rows[0].count)).toBe(10);
    } finally {
      await pool.query("delete from demo_requests where email = any($1::text[])", [addresses]);
      if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previousBase;
      if (previousProxy === undefined) delete process.env.TRUSTED_INGRESS; else process.env.TRUSTED_INGRESS = previousProxy;
    }
  });

  it("rejects public enrollment contact collection before looking up a programme", async () => {
    const previousBase = process.env.PUBLIC_BASE_URL;
    process.env.PUBLIC_BASE_URL = base;
    try {
      const response = await enroll(post("/api/enroll", { slug: "nonexistent", acceptedTerms: true, email: "synthetic@example.test", marketingOptIn: true }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ code: "CONTACT_DISABLED" });
    } finally {
      if (previousBase === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previousBase;
    }
  });
});
