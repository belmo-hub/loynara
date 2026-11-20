import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import type { TransactionalMessage } from "./transactional-email";

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
const { POST } = await import("@/app/api/auth/[...all]/route");

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// ENG-279: a self-service reset that answers every address alike and expires within the hour. ENG-286: it mails unconfirmed
// accounts too, its link confirms the address, and the token travels in the fragment, never in the query.
const origin = "http://localhost:3000";
const password = "synthetic-reset-old-password";
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

function post(path: string, body: unknown, from = `198.51.100.${(peer += 1) % 250 + 1}`) {
  return POST(new Request(`${origin}/api/auth${path}`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": from }, body: JSON.stringify(body) }));
}
async function account(confirmed: boolean) {
  const email = `${randomUUID()}@example.test`;
  await post("/sign-up/email", { name: "Synthetic owner", email, password });
  await pool.query('UPDATE "user" SET "emailVerified" = $2 WHERE email = $1', [email, confirmed]);
  sent.length = 0;
  provider.delayMs = 0;
  return email;
}
const settled = () => new Promise(resolve => setTimeout(resolve, 300));
const resetMails = () => sent.filter(mail => mail.subject === "Neues Passwort für Loynara");

it("mails a confirmed owner a one-hour link in fixed words; the link sets the password once and signs every device out", async () => {
  const email = await account(true);
  const response = await post("/request-password-reset", { email, redirectTo: "https://evil.example/steal" });
  expect(response.status).toBe(200);
  await vi.waitFor(() => expect(resetMails()).toHaveLength(1));
  const [mail] = resetMails();
  expect(mail.to).toBe(email);
  expect(mail.body).not.toMatch(/evil|Synthetic owner/);
  // In the fragment, out of server and proxy logs.
  expect(mail.body).not.toMatch(/[?&]token=/);
  const token = /http:\/\/localhost:3000\/reset-password#token=([\w-]+)\n/.exec(mail.body)?.[1];
  expect(token).toBeDefined();
  const [row] = (await pool.query(`SELECT "expiresAt" FROM verification WHERE identifier = $1`, [`reset-password:${token}`])).rows;
  expect(row.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(3600_000);
  expect((await pool.query('SELECT count(*)::int AS n FROM session s JOIN "user" u ON u.id = s."userId" WHERE u.email = $1', [email])).rows[0].n).toBe(1);
  expect((await post("/reset-password", { token, newPassword: "synthetic-reset-new-password" })).status).toBe(200);
  expect((await pool.query('SELECT count(*)::int AS n FROM session s JOIN "user" u ON u.id = s."userId" WHERE u.email = $1', [email])).rows[0].n).toBe(0);
  expect((await post("/reset-password", { token, newPassword: "synthetic-reset-third-password" })).status).toBe(400);
  expect((await post("/sign-in/email", { email, password: "synthetic-reset-new-password" })).status).toBe(200);
});

it("answers an unknown and an unconfirmed address exactly like a confirmed one, and mails both accounts", async () => {
  const confirmed = await account(true), unconfirmed = await account(false);
  const answers = [], times = [];
  for (const email of [confirmed, unconfirmed, `${randomUUID()}@example.test`]) {
    const started = performance.now();
    const response = await post("/request-password-reset", { email });
    times.push(performance.now() - started);
    answers.push([response.status, await response.text()]);
  }
  expect(new Set(answers.map(answer => JSON.stringify(answer))).size).toBe(1);
  // Only an existing account gets a token row written: every answer waits out the same floor, so its time tells nothing.
  for (const time of times) expect(time).toBeGreaterThanOrEqual(395);
  await settled();
  expect(resetMails().map(mail => mail.to)).toEqual([confirmed, unconfirmed]);
});

it("gives a squatted, never-confirmed address back to the inbox's owner: the link confirms it and signs the squatter out", async () => {
  const email = await account(false);
  expect((await post("/request-password-reset", { email })).status).toBe(200);
  await vi.waitFor(() => expect(resetMails()).toHaveLength(1));
  const token = /#token=([\w-]+)/.exec(resetMails()[0].body)![1];
  const verified = async () => (await pool.query('SELECT "emailVerified" AS v FROM "user" WHERE email = $1', [email])).rows[0].v;
  expect(await verified()).toBe(false);
  // A refused attempt confirms nothing.
  expect((await post("/reset-password", { token: "not-the-token", newPassword: "synthetic-reset-new-password" })).status).toBe(400);
  expect(await verified()).toBe(false);
  expect((await post("/reset-password", { token, newPassword: "synthetic-reset-new-password" })).status).toBe(200);
  expect(await verified()).toBe(true);
  expect((await pool.query('SELECT count(*)::int AS n FROM session s JOIN "user" u ON u.id = s."userId" WHERE u.email = $1', [email])).rows[0].n).toBe(0);
  expect((await post("/sign-in/email", { email, password })).status).toBe(401);
  expect((await post("/sign-in/email", { email, password: "synthetic-reset-new-password" })).status).toBe(200);
});

it("refuses an expired link", async () => {
  const email = await account(true);
  await post("/request-password-reset", { email });
  await vi.waitFor(() => expect(resetMails()).toHaveLength(1));
  const token = /token=([\w-]+)/.exec(resetMails()[0].body)![1];
  await pool.query(`UPDATE verification SET "expiresAt" = now() - interval '1 second' WHERE identifier = $1`, [`reset-password:${token}`]);
  expect((await post("/reset-password", { token, newPassword: "synthetic-reset-new-password" })).status).toBe(400);
});

it("sends an unconfirmed address at most three links an hour and five a day", async () => {
  const email = await account(false);
  for (let hour = 0; hour < 4; hour += 1) {
    // An hour passes: every window shorter than a day ends.
    await pool.query("UPDATE rate_limits SET reset_at = now() - interval '1 second' WHERE reset_at < now() + interval '2 hours'");
    for (let i = 0; i < 4; i += 1) expect((await post("/request-password-reset", { email })).status).toBe(200);
    await settled();
    expect(resetMails()).toHaveLength(Math.min(5, 3 * (hour + 1)));
  }
});

it("sends at most three links an hour to one address, and limits requests per peer", async () => {
  const email = await account(true);
  for (let i = 0; i < 4; i += 1) expect((await post("/request-password-reset", { email })).status).toBe(200);
  await settled();
  expect(resetMails()).toHaveLength(3);
  const statuses = [];
  for (let i = 0; i < 6; i += 1) statuses.push((await post("/request-password-reset", { email: `${randomUUID()}@example.test` }, "203.0.113.9")).status);
  expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
});

it("answers a confirmed address within the floor even when the provider is slow: the mail goes out after the answer", async () => {
  const email = await account(true);
  provider.delayMs = 600;
  const started = performance.now();
  expect((await post("/request-password-reset", { email })).status).toBe(200);
  const time = performance.now() - started;
  expect(time).toBeGreaterThanOrEqual(395);
  expect(time).toBeLessThan(550);
  expect(resetMails()).toHaveLength(0);
  await vi.waitFor(() => expect(resetMails()).toHaveLength(1), { timeout: 2000 });
});
