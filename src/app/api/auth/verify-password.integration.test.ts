import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "@/lib/auth";
import { POST } from "@/app/api/auth/[...all]/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// ENG-380: Better Auth serves /verify-password over HTTP although it is meant for server code. With any session it would
// confirm a guessed password outside every account budget, and nothing in the app calls it, so auth.ts switches it off.
const origin = "http://localhost:3000";
const password = "synthetic-verify-old-password";
const previous = { ingress: process.env.TRUSTED_INGRESS, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
let peer = 0;
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
function post(path: string, body: unknown, cookie?: string) {
  peer += 1;
  return POST(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `198.51.100.${peer % 250 + 1}`, ...cookie ? { cookie } : {} }, body: JSON.stringify(body) }));
}
const cookieOf = (response: Response) => response.headers.getSetCookie().find(c => c.startsWith("better-auth.session_token=") && !c.startsWith("better-auth.session_token=;"))?.split(";")[0];
async function account() {
  const email = `${randomUUID()}@example.test`;
  await auth.api.signUpEmail({ body: { name: "Synthetic owner", email, password } });
  return { here: cookieOf(await post("/sign-in/email", { email, password }))! };
}

it("V1 /verify-password (another password check) is not reachable over HTTP, so it is no way around the budget", async () => {
  const { here } = await account();
  for (const attempt of ["wrong-guess-padding-1", password]) {
    const response = await post("/verify-password", { password: attempt }, here);
    expect(response.status).toBe(404);
  }
});
