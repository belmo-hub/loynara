import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "@/lib/auth";
import { POST } from "@/app/api/auth/[...all]/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// The real auth route, reached the way a browser reaches it. Every attempt below comes from a different visitor
// address (Cloudflare tunnel mode), which is what a distributed password-guessing run looks like: the per-address
// limits never trip, so only a per-account limit can stop it.
const origin = "http://localhost:3000";
const password = "synthetic-account-limit-password";
const previous = { ingress: process.env.TRUSTED_INGRESS, production: process.env.PRODUCTION_ENVIRONMENT, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
let address = 0;
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
  delete process.env.PRODUCTION_ENVIRONMENT;
});
afterAll(async () => {
  for (const [key, value] of [["TRUSTED_INGRESS", previous.ingress], ["PRODUCTION_ENVIRONMENT", previous.production], ["PUBLIC_REGISTRATION_ENABLED", previous.registration]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

function signIn(email: string, attempt: string, init: { contentType?: string; body?: string } = {}) {
  address += 1;
  return POST(new Request(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { origin, "content-type": init.contentType ?? "application/json", "cf-connecting-ip": `198.51.${Math.floor(address / 250) % 250}.${address % 250 + 1}` },
    body: init.body ?? JSON.stringify({ email, password: attempt }),
  }));
}
async function account() {
  const email = `${randomUUID()}@example.test`;
  await auth.api.signUpEmail({ body: { name: "Synthetic account-limit identity", email, password } });
  return email;
}

it("stops password guessing against one account even when every guess comes from a new address", async () => {
  const email = await account();
  for (let i = 0; i < 10; i += 1) expect((await signIn(email, `wrong-guess-${i}-padding`)).status).toBe(401);
  const blocked = await signIn(email, "wrong-guess-final-padding");
  expect(blocked.status).toBe(429);
  expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  // While the account is locked even the right password is refused, so a guess cannot be confirmed by timing or status.
  expect((await signIn(email.toUpperCase(), password)).status).toBe(429);
  const stored = await pool.query<{ key_hash: string }>("select key_hash from rate_limits");
  expect(stored.rows.every(row => !row.key_hash.includes(email))).toBe(true);
});

it("counts only failed attempts, and one account's failures never lock another account", async () => {
  const email = await account(), other = await account();
  for (let i = 0; i < 12; i += 1) expect((await signIn(email, password)).status).toBe(200);
  for (let i = 0; i < 10; i += 1) await signIn(other, `wrong-guess-${i}-padding`);
  expect((await signIn(other, password)).status).toBe(429);
  expect((await signIn(email, password)).status).toBe(200);
});

it("cannot be bypassed by sending many guesses at once, before any failure is recorded", async () => {
  const email = await account();
  const statuses = (await Promise.all(Array.from({ length: 30 }, (_, i) => signIn(email, `parallel-guess-${i}-padding`)))).map(r => r.status);
  // Each guess reserves its attempt atomically before the password is checked, so at most ten are ever checked.
  expect(statuses.filter(status => status === 401).length).toBeLessThanOrEqual(10);
  expect(statuses.filter(status => status === 429).length).toBeGreaterThanOrEqual(20);
  expect((await signIn(email, password)).status).toBe(429);
});

it("refuses a sign-in body the account limit cannot read instead of letting it bypass the limit", async () => {
  const email = await account();
  expect((await signIn(email, password, { contentType: "application/x-www-form-urlencoded", body: `email=${encodeURIComponent(email)}&password=${password}` })).status).toBe(400);
  expect((await signIn(email, password, { body: JSON.stringify({ email: [email], password }) })).status).toBe(400);
  expect((await signIn(email, password)).status).toBe(200);
});
