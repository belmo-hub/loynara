import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { recipientHash, type TransactionalMessage } from "./transactional-email";

const sent = vi.hoisted(() => [] as TransactionalMessage[]);
// How long the fake provider takes to accept a mail.
const provider = vi.hoisted(() => ({ delayMs: 0 }));
vi.mock("./transactional-email", async importOriginal => ({
  ...await importOriginal<typeof import("./transactional-email")>(),
  transactionalProvider: () => ({ name: "mailpit", async send(message: TransactionalMessage) {
    await new Promise(resolve => setTimeout(resolve, provider.delayMs));
    sent.push(message);
    return { state: "accepted", messageId: `local:${message.jobId}` };
  } }),
}));
const { GET, POST } = await import("@/app/api/auth/[...all]/route");

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// ENG-278: a new account's address gets one fixed-text link; nothing the signer typed reaches the mail, and nobody can
// make Loynara mail an address over and over.
const origin = "http://localhost:3000";
const previous = { ingress: process.env.TRUSTED_INGRESS, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
let peer = 0;
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits, email_suppressions CASCADE');
  sent.length = 0;
  provider.delayMs = 0;
  process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
});
afterAll(async () => {
  for (const [key, value] of Object.entries({ TRUSTED_INGRESS: previous.ingress, PUBLIC_REGISTRATION_ENABLED: previous.registration })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

function post(path: string, body: unknown, from = `198.51.100.${(peer += 1) % 250 + 1}`) {
  return POST(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": from }, body: JSON.stringify(body) }));
}
const settled = () => new Promise(resolve => setTimeout(resolve, 300));
const verified = async (email: string) => (await pool.query('SELECT "emailVerified" AS v FROM "user" WHERE email = $1', [email])).rows[0]?.v;

it("sends one link in fixed words on sign-up, and the link confirms the address", async () => {
  const email = `${randomUUID()}@example.test`;
  expect((await post("/sign-up/email", { name: "GEWINN 500 EUR Ruf jetzt 0900 123456 an", email, password: "synthetic-verify-password" })).status).toBe(200);
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  const [mail] = sent;
  expect(mail.to).toBe(email);
  expect(mail.subject).toBe("Bestätige deine E-Mail-Adresse für Loynara");
  expect(`${mail.subject}${mail.body}${mail.fromName ?? ""}`).not.toMatch(/GEWINN|0900/);
  const link = /http:\/\/localhost:3000\/api\/auth\/verify-email\?\S+/.exec(mail.body)?.[0];
  expect(link).toBeDefined();
  expect(await verified(email)).toBe(false);
  const response = await GET(new Request(link!, { headers: { "cf-connecting-ip": "198.51.100.200" } }));
  expect(response.status).toBe(302);
  // ENG-341: the owner lands on the sign-in page, which says the address is confirmed (and sends a signed-in owner on).
  expect(response.headers.get("location")).toBe("/login?verified=1");
  expect(await verified(email)).toBe(true);
  const broken = await GET(new Request(link!.replace(/token=[^&]+/, "token=broken"), { headers: { "cf-connecting-ip": "198.51.100.201" } }));
  expect(broken.headers.get("location")).toBe("/login?verified=1&error=INVALID_TOKEN");
});

it("sends at most three links an hour to one address, and limits the resend button per peer", async () => {
  const email = `${randomUUID()}@example.test`;
  await post("/sign-up/email", { name: "Synthetic owner", email, password: "synthetic-verify-password" });
  for (let i = 0; i < 4; i += 1) expect((await post("/send-verification-email", { email })).status).toBe(200);
  await settled();
  expect(sent).toHaveLength(3);
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await post("/send-verification-email", { email: `${randomUUID()}@example.test` }, "203.0.113.9")).status);
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
});

it("sends at most five links a day to one address, however the hours are spread", async () => {
  const email = `${randomUUID()}@example.test`;
  await post("/sign-up/email", { name: "Synthetic owner", email, password: "synthetic-verify-password" });
  for (let hour = 0; hour < 4; hour += 1) {
    // An hour passes: every window shorter than a day ends.
    await pool.query("UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE reset_at < now() + interval '2 hours'");
    for (let i = 0; i < 3; i += 1) expect((await post("/send-verification-email", { email })).status).toBe(200);
  }
  await settled();
  expect(sent).toHaveLength(5);
});

it("sends no link to an address that bounced or complained", async () => {
  const email = `${randomUUID()}@example.test`;
  await pool.query("INSERT INTO email_suppressions (recipient_hash, reason) VALUES ($1, 'complained')", [recipientHash(email)]);
  expect((await post("/sign-up/email", { name: "Synthetic owner", email, password: "synthetic-verify-password" })).status).toBe(200);
  expect((await post("/send-verification-email", { email })).status).toBe(200);
  await settled();
  expect(sent).toHaveLength(0);
});

it("tells a signed-in owner when a resend was not sent, and tells an anonymous caller nothing", async () => {
  const email = `${randomUUID()}@example.test`;
  await post("/sign-up/email", { name: "Synthetic owner", email, password: "synthetic-verify-password" });
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  const signIn = await post("/sign-in/email", { email, password: "synthetic-verify-password" });
  const cookie = signIn.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const own = (from: string) => POST(new Request(`${origin}/api/auth/send-verification-email`, { method: "POST", headers: { origin, cookie, "content-type": "application/json", "cf-connecting-ip": from }, body: JSON.stringify({ email }) }));
  // Sign-up used one of the hour's three links: two more go out, the third press is refused instead of claiming a mail.
  expect([(await own("198.51.100.201")).status, (await own("198.51.100.202")).status, (await own("198.51.100.203")).status]).toEqual([200, 200, 429]);
  expect(sent).toHaveLength(3);
  expect((await post("/send-verification-email", { email })).status).toBe(200);
  await pool.query("INSERT INTO email_suppressions (recipient_hash, reason) VALUES ($1, 'bounced')", [recipientHash(email)]);
  await pool.query("TRUNCATE rate_limits");
  expect((await own("198.51.100.204")).status).toBe(503);
  expect(sent).toHaveLength(3);
});

// ENG-283: sign-up must not tell whether an address has an account.
it("answers a new and an existing address alike, signs in neither, and mails and changes only the new one", async () => {
  const existing = `${randomUUID()}@example.test`, fresh = `${randomUUID()}@example.test`;
  await post("/sign-up/email", { name: "Synthetic owner", email: existing, password: "synthetic-verify-password" });
  await vi.waitFor(() => expect(sent).toHaveLength(1));
  const stored = () => pool.query('SELECT u.*, a.password FROM "user" u JOIN account a ON a."userId" = u.id WHERE u.email = $1', [existing]).then(result => result.rows);
  const before = await stored();
  sent.length = 0;
  const answers = [], times = [];
  for (const email of [fresh, existing, existing.toUpperCase()]) {
    const started = performance.now();
    const response = await post("/sign-up/email", { name: "Someone else", email, password: "synthetic-other-password" });
    times.push(performance.now() - started);
    answers.push([response.status, response.headers.getSetCookie(), await response.text()]);
  }
  expect(answers).toEqual(Array(3).fill([200, [], '{"status":true}']));
  // Only a new address gets an account written: every answer waits out the same floor, so its time tells nothing.
  for (const time of times) expect(time).toBeGreaterThanOrEqual(395);
  await settled();
  expect(sent.map(mail => mail.to)).toEqual([fresh]);
  expect(await stored()).toEqual(before);
  expect((await post("/sign-in/email", { email: existing, password: "synthetic-other-password" })).status).toBe(401);
});

it("answers a new address within the floor even when the provider is slow: the mail goes out after the answer", async () => {
  provider.delayMs = 600;
  const started = performance.now();
  expect((await post("/sign-up/email", { name: "Synthetic owner", email: `${randomUUID()}@example.test`, password: "synthetic-verify-password" })).status).toBe(200);
  const time = performance.now() - started;
  expect(time).toBeGreaterThanOrEqual(395);
  expect(time).toBeLessThan(550);
  expect(sent).toHaveLength(0);
  await vi.waitFor(() => expect(sent).toHaveLength(1), { timeout: 2000 });
});
