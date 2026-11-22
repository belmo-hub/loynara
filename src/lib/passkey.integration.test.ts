import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { pool } from "@/db";

const { GET, POST } = await import("@/app/api/auth/[...all]/route");

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// Review of #349: the passkey routes' per-network limit (P3, P4) and the 10-minute fresh sign-in to add one (CTO, 22 Nov).
const origin = "http://localhost:3000";
const password = "synthetic-passkey-password";
const previous = { ingress: process.env.TRUSTED_INGRESS, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
});
afterAll(async () => {
  for (const [key, value] of Object.entries({ TRUSTED_INGRESS: previous.ingress, PUBLIC_REGISTRATION_ENABLED: previous.registration })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

const headers = (from: string, cookie?: string) => ({ origin, "content-type": "application/json", "cf-connecting-ip": from, ...(cookie ? { cookie } : {}) });
const get = (path: string, from: string, cookie?: string) => GET(new Request(`${origin}/api/auth${path}`, { headers: headers(from, cookie) }));
const post = (path: string, body: unknown, from: string, cookie?: string) => POST(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: headers(from, cookie), body: JSON.stringify(body) }));

async function signedIn() {
  const email = `${randomUUID()}@example.test`;
  await post("/sign-up/email", { name: "Synthetic owner", email, password }, "198.51.100.10");
  const response = await post("/sign-in/email", { email, password }, "198.51.100.11");
  expect(response.status).toBe(200);
  await pool.query("DELETE FROM rate_limits");
  return { email, cookie: response.headers.getSetCookie().map(line => line.split(";")[0]).join("; ") };
}

describe("passkeys", () => {
  it("limits passkey sign-in challenges and verifications to 60 per network in 15 minutes (P3, P4)", async () => {
    const from = "198.51.100.20";
    for (let i = 0; i < 60; i += 1) expect((await get("/passkey/generate-authenticate-options", from)).status).toBe(200);
    expect((await get("/passkey/generate-authenticate-options", from)).status).toBe(429);
    expect((await post("/passkey/verify-authentication", { response: {} }, from)).status).toBe(429);
    // Another network is not affected.
    expect((await get("/passkey/generate-authenticate-options", "198.51.100.21")).status).toBe(200);
    const other = "198.51.100.22";
    for (let i = 0; i < 60; i += 1) expect((await post("/passkey/verify-authentication", { response: {} }, other)).status).not.toBe(429);
    expect((await post("/passkey/verify-authentication", { response: {} }, other)).status).toBe(429);
  });

  it("offers adding a passkey only within 10 minutes of signing in", async () => {
    const { email, cookie } = await signedIn();
    const age = (minutes: number) => pool.query(`UPDATE session SET "createdAt" = now() - make_interval(mins => $2) WHERE "userId" = (SELECT id FROM "user" WHERE email = $1)`, [email, minutes]);
    expect((await get("/passkey/generate-register-options", "198.51.100.30", cookie)).status).toBe(200);
    await age(9);
    expect((await get("/passkey/generate-register-options", "198.51.100.30", cookie)).status).toBe(200);
    await age(11);
    const stale = await get("/passkey/generate-register-options", "198.51.100.30", cookie);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "SESSION_NOT_FRESH" });
    // Signing in again makes it fresh; the password path itself never needed a fresh session.
    const again = await post("/sign-in/email", { email, password }, "198.51.100.31");
    const fresh = again.headers.getSetCookie().map(line => line.split(";")[0]).join("; ");
    expect((await get("/passkey/generate-register-options", "198.51.100.30", fresh)).status).toBe(200);
  });
});
