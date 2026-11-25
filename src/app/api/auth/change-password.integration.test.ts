import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { pool } from "@/db";
import { auth } from "@/lib/auth";
import { POST } from "@/app/api/auth/[...all]/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// ENG-379: a signed-in person changes the password under Mehr → Konto, through Better Auth's own /change-password.
const origin = "http://localhost:3000";
const password = "synthetic-change-old-password";
const next = "synthetic-change-new-password";
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

function post(path: string, body: unknown, cookie?: string, from = `198.51.100.${(peer += 1) % 250 + 1}`) {
  return POST(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": from, ...cookie ? { cookie } : {} }, body: JSON.stringify(body) }));
}
const cookieOf = (response: Response) => response.headers.getSetCookie().map(c => c.split(";")[0]).find(c => c.startsWith("better-auth.session_token=") && !c.endsWith("="));
async function signIn(email: string, attempt = password) {
  const response = await post("/sign-in/email", { email, password: attempt });
  return { status: response.status, cookie: cookieOf(response) };
}
const signedIn = async (cookie: string | undefined) => Boolean(await auth.api.getSession({ headers: new Headers({ cookie: cookie ?? "" }) }));
async function account() {
  const email = `${randomUUID()}@example.test`;
  await auth.api.signUpEmail({ body: { name: "Synthetic owner", email, password } });
  const here = await signIn(email), elsewhere = await signIn(email);
  return { email, here: here.cookie!, elsewhere: elsewhere.cookie! };
}
const change = (cookie: string, body: object, from?: string) => post("/change-password", { currentPassword: password, newPassword: next, ...body }, cookie, from);
const codeOf = async (response: Response) => (await response.json() as { code?: string }).code;

it("changes the password, keeps this device signed in and signs the other devices out", async () => {
  const { email, here, elsewhere } = await account();
  const response = await change(here, { revokeOtherSessions: true });
  expect(response.status).toBe(200);
  // Better Auth ends every session and starts a fresh one for this device, so the page stays signed in on its new cookie.
  const fresh = cookieOf(response);
  expect(await signedIn(fresh)).toBe(true);
  expect(await signedIn(here)).toBe(false);
  expect(await signedIn(elsewhere)).toBe(false);
  expect((await signIn(email)).status).toBe(401);
  expect((await signIn(email, next)).status).toBe(200);
});

it("leaves the other devices signed in when that choice is off", async () => {
  const { here, elsewhere } = await account();
  expect((await change(here, { revokeOtherSessions: false })).status).toBe(200);
  expect(await signedIn(here)).toBe(true);
  expect(await signedIn(elsewhere)).toBe(true);
});

it("refuses a wrong current password and changes nothing", async () => {
  const { email, here, elsewhere } = await account();
  const response = await change(here, { currentPassword: "not-the-current-password", revokeOtherSessions: true });
  expect(response.status).toBe(400);
  expect(await codeOf(response)).toBe("INVALID_PASSWORD");
  expect(await signedIn(elsewhere)).toBe(true);
  expect((await signIn(email)).status).toBe(200);
});

it("refuses a new password under the sign-up minimum", async () => {
  const { email, here } = await account();
  const response = await change(here, { newPassword: "short-11ch", revokeOtherSessions: true });
  expect(response.status).toBe(400);
  expect(await codeOf(response)).toBe("PASSWORD_TOO_SHORT");
  expect((await signIn(email)).status).toBe(200);
});

it("needs a signed-in session", async () => {
  expect((await post("/change-password", { currentPassword: password, newPassword: next })).status).toBe(401);
});

// A stolen session cookie must not turn this form into a password oracle: wrong guesses count against the same
// per-account budget as sign-in (10 per 15 minutes), and a locked account refuses even the right password here.
it("counts wrong current passwords against the account's sign-in failure budget", async () => {
  const { email, here } = await account();
  for (let i = 0; i < 10; i += 1) expect((await change(here, { currentPassword: `wrong-guess-${i}-padding` })).status).toBe(400);
  expect((await change(here, {})).status).toBe(429);
  expect((await signIn(email)).status).toBe(429);
});

it("does not use up the budget with right passwords or refused new ones", async () => {
  const { here } = await account();
  for (let i = 0; i < 11; i += 1) expect((await change(here, { newPassword: "short" })).status).toBe(400);
  expect((await change(here, {})).status).toBe(200);
});

it("allows 30 attempts per address in 15 minutes, whoever's session they carry", async () => {
  const first = await account(), second = await account();
  // Refused new passwords: they use no account budget, so only the address limit can stop the 31st.
  for (let i = 0; i < 30; i += 1) expect((await change(i % 2 ? first.here : second.here, { newPassword: "short" }, "192.0.2.7")).status).toBe(400);
  expect((await change(first.here, {}, "192.0.2.7")).status).toBe(429);
  expect((await change(first.here, {}, "192.0.2.8")).status).toBe(200);
});

it("answers an account without a password with Better Auth's code, which the form turns into a sentence", async () => {
  const { here } = await account();
  await pool.query(`UPDATE account SET password = NULL WHERE "providerId" = 'credential'`);
  const response = await change(here, {});
  expect(response.status).toBe(400);
  expect(await codeOf(response)).toBe("CREDENTIAL_ACCOUNT_NOT_FOUND");
});
