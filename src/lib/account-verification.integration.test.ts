import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { recipientHash, type TransactionalMessage } from "./transactional-email";

const sent = vi.hoisted(() => [] as TransactionalMessage[]);
vi.mock("./transactional-email", async importOriginal => ({
  ...await importOriginal<typeof import("./transactional-email")>(),
  transactionalProvider: () => ({ name: "mailpit", async send(message: TransactionalMessage) { sent.push(message); return { state: "accepted", messageId: `local:${message.jobId}` }; } }),
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
const verified = async (email: string) => (await pool.query('SELECT "emailVerified" AS v FROM "user" WHERE email = $1', [email])).rows[0]?.v;

it("sends one link in fixed words on sign-up, and the link confirms the address", async () => {
  const email = `${randomUUID()}@example.test`;
  expect((await post("/sign-up/email", { name: "GEWINN 500 EUR Ruf jetzt 0900 123456 an", email, password: "synthetic-verify-password" })).status).toBe(200);
  expect(sent).toHaveLength(1);
  const [mail] = sent;
  expect(mail.to).toBe(email);
  expect(mail.subject).toBe("Bestätige deine E-Mail-Adresse für Loynara");
  expect(`${mail.subject}${mail.body}${mail.fromName ?? ""}`).not.toMatch(/GEWINN|0900/);
  const link = /http:\/\/localhost:3000\/api\/auth\/verify-email\?\S+/.exec(mail.body)?.[0];
  expect(link).toBeDefined();
  expect(await verified(email)).toBe(false);
  const response = await GET(new Request(link!, { headers: { "cf-connecting-ip": "198.51.100.200" } }));
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/merchant");
  expect(await verified(email)).toBe(true);
});

it("sends at most three links an hour to one address, and limits the resend button per peer", async () => {
  const email = `${randomUUID()}@example.test`;
  await post("/sign-up/email", { name: "Synthetic owner", email, password: "synthetic-verify-password" });
  for (let i = 0; i < 4; i += 1) expect((await post("/send-verification-email", { email })).status).toBe(200);
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
  expect(sent).toHaveLength(5);
});

it("sends no link to an address that bounced or complained", async () => {
  const email = `${randomUUID()}@example.test`;
  await pool.query("INSERT INTO email_suppressions (recipient_hash, reason) VALUES ($1, 'complained')", [recipientHash(email)]);
  expect((await post("/sign-up/email", { name: "Synthetic owner", email, password: "synthetic-verify-password" })).status).toBe(200);
  expect((await post("/send-verification-email", { email })).status).toBe(200);
  expect(sent).toHaveLength(0);
});
