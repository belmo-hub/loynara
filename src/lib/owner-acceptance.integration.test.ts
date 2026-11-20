import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import type { TransactionalMessage } from "./transactional-email";
import { OWNER_AVV, OWNER_TERMS, SIGNUP_ACCEPTANCE_HEADER, SIGNUP_ACCEPTANCE_TEXT_VERSION } from "./owner-contract";
import { OWNER_PRIVACY_NOTICE } from "./owner-privacy";

vi.mock("./transactional-email", async importOriginal => ({
  ...await importOriginal<typeof import("./transactional-email")>(),
  transactionalProvider: () => ({ name: "mailpit", async send(message: TransactionalMessage) { return { state: "accepted", messageId: `local:${message.jobId}` }; } }),
}));
const { POST } = await import("@/app/api/auth/[...all]/route");
const { createMerchant } = await import("./product");
const { POST: onboard } = await import("@/app/api/merchant/onboard/route");

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test") || !["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL).hostname)) throw new Error("Dedicated local synthetic database required");

// ENG-277: „Konto erstellen“ under Legal's sentence on /register makes the shop's contract; one row records it.
const origin = "http://localhost:3000";
const previous = { ingress: process.env.TRUSTED_INGRESS, registration: process.env.PUBLIC_REGISTRATION_ENABLED };
let peer = 0;
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits, owner_acceptances CASCADE');
  process.env.TRUSTED_INGRESS = "cloudflare_tunnel";
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
});
afterAll(async () => {
  for (const [key, value] of Object.entries({ TRUSTED_INGRESS: previous.ingress, PUBLIC_REGISTRATION_ENABLED: previous.registration })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  await pool.end();
});

function signUp(email: string, shown?: string) {
  const headers: Record<string, string> = { origin, "content-type": "application/json", "cf-connecting-ip": `198.51.100.${(peer += 1) % 250 + 1}` };
  if (shown) headers[SIGNUP_ACCEPTANCE_HEADER] = shown;
  return POST(new Request(`${origin}/api/auth/sign-up/email`, { method: "POST", headers, body: JSON.stringify({ name: "Synthetic owner", email, password: "synthetic-accept-password" }) }));
}
const rows = async () => (await pool.query("SELECT * FROM owner_acceptances")).rows;
const userId = async (email: string) => (await pool.query<{ id: string }>('SELECT id FROM "user" WHERE email = $1', [email])).rows[0].id;

it("stores one row with the account, the server's versions and server time, and no IP or browser", async () => {
  const email = `${randomUUID()}@example.test`;
  const before = Date.now();
  expect((await signUp(email, SIGNUP_ACCEPTANCE_TEXT_VERSION)).status).toBe(200);
  const stored = await rows();
  expect(stored).toHaveLength(1);
  const [{ id, accepted_at, ...row }] = stored;
  expect(id).toEqual(expect.any(String));
  expect(row).toEqual({ user_id: await userId(email), tenant_id: null, path: "register", terms_version: OWNER_TERMS.version, avv_version: OWNER_AVV.version, privacy_version: OWNER_PRIVACY_NOTICE.version, text_version: SIGNUP_ACCEPTANCE_TEXT_VERSION });
  expect((accepted_at as Date).getTime()).toBeGreaterThanOrEqual(before - 1000);
});

it("stores nothing for a sign-up to an address already taken, whose answer carries a made-up account (ENG-283)", async () => {
  const email = `${randomUUID()}@example.test`;
  expect((await signUp(email)).status).toBe(200);
  const again = await signUp(email, SIGNUP_ACCEPTANCE_TEXT_VERSION);
  expect(again.status).toBe(200);
  expect(await again.json()).toEqual({ status: true });
  expect(await rows()).toHaveLength(0);
});

it("stores nothing for a sign-up that showed no sentence (staff from an invitation), or while /register is closed", async () => {
  expect((await signUp(`${randomUUID()}@example.test`)).status).toBe(200);
  process.env.PUBLIC_REGISTRATION_ENABLED = "false";
  await signUp(`${randomUUID()}@example.test`, SIGNUP_ACCEPTANCE_TEXT_VERSION);
  expect(await rows()).toHaveLength(0);
});

it("refuses a sign-up from a page with an older sentence, so no row names a text that was not shown", async () => {
  const email = `${randomUUID()}@example.test`;
  expect((await signUp(email, "2026-01-01")).status).toBe(400);
  expect((await pool.query('SELECT 1 FROM "user" WHERE email = $1', [email])).rowCount).toBe(0);
  expect(await rows()).toHaveLength(0);
});

it("gets the business once the owner's shop exists, and is append-only after that", async () => {
  const email = `${randomUUID()}@example.test`, other = `${randomUUID()}@example.test`;
  await signUp(email, SIGNUP_ACCEPTANCE_TEXT_VERSION);
  await signUp(other, SIGNUP_ACCEPTANCE_TEXT_VERSION);
  const merchant = await createMerchant({ userId: await userId(email), businessName: "Synthetic Acceptance Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });
  // Reviewer N-1: only the owner's own row gets the business; another owner's pending row stays without one.
  const byUser = Object.fromEntries((await rows()).map(row => [row.user_id, row.tenant_id]));
  expect(byUser).toEqual({ [await userId(email)]: merchant.tenantId, [await userId(other)]: null });
  await expect(pool.query("UPDATE owner_acceptances SET tenant_id = gen_random_uuid() WHERE tenant_id IS NOT NULL")).rejects.toThrow(/append-only/);
  await expect(pool.query("UPDATE owner_acceptances SET terms_version = 'x'")).rejects.toThrow(/append-only/);
  // D3: the acceptance time cannot be moved afterwards either.
  await expect(pool.query("UPDATE owner_acceptances SET accepted_at = '2000-01-01T00:00:00Z'")).rejects.toThrow(/append-only/);
  await expect(pool.query("DELETE FROM owner_acceptances")).rejects.toThrow(/append-only/);
});

it("sets up a shop through the setup route only for an account that accepted at /register (CTO, 20 Nov)", async () => {
  const setup = { businessName: "Synthetic Gate Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 };
  const setUp = async (shown?: string) => {
    // Sign-up signs nobody in (ENG-283); the owner then signs in.
    const email = `${randomUUID()}@example.test`;
    expect((await signUp(email, shown)).status).toBe(200);
    const signIn = await POST(new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { origin, "content-type": "application/json", "cf-connecting-ip": `198.51.100.${(peer += 1) % 250 + 1}` }, body: JSON.stringify({ email, password: "synthetic-accept-password" }) }));
    const cookie = signIn.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
    return onboard(new Request(`${origin}/api/merchant/onboard`, { method: "POST", headers: { origin, cookie, "content-type": "application/json", "cf-connecting-ip": "198.51.100.251" }, body: JSON.stringify(setup) }));
  };
  // A direct call to the sign-up API, without the sentence, makes an account but no shop.
  const refused = await setUp();
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ error: expect.stringContaining("Vertragsbedingungen nicht angenommen") });
  expect((await pool.query("SELECT count(*)::int AS n FROM tenants")).rows[0].n).toBe(0);
  // The /register path.
  const created = await setUp(SIGNUP_ACCEPTANCE_TEXT_VERSION);
  expect(created.status).toBe(201);
  expect((await rows()).map(row => row.tenant_id)).toEqual([(await created.json()).tenantId]);
});

it("gives a staff-invite account without an acceptance no shop of its own (CTO, 20 Nov)", async () => {
  const { acceptStaffInvite, createStaffInvite } = await import("./staff");
  const ownerEmail = `${randomUUID()}@example.test`;
  await signUp(ownerEmail, SIGNUP_ACCEPTANCE_TEXT_VERSION);
  const owner = await userId(ownerEmail);
  const shop = await createMerchant({ userId: owner, businessName: "Synthetic Staff Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });
  for (const role of ["cashier", "manager"] as const) {
    const email = `${randomUUID()}@example.test`;
    const invite = await createStaffInvite({ actorUserId: owner, locationId: shop.locationId, email, role });
    await signUp(email);
    const staff = await userId(email);
    const setup = { userId: staff, businessName: `Synthetic ${role} shop`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 } as const;
    // Before accepting the invitation, and after: no row, so no shop.
    await expect(createMerchant(setup, { requireAcceptance: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await acceptStaffInvite({ userId: staff, token: invite.token });
    await expect(createMerchant(setup, { requireAcceptance: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  expect((await pool.query("SELECT count(*)::int AS n FROM tenants")).rows[0].n).toBe(1);
});

// Reviewer N-2 (D3): the acceptance time is the database's, whatever an insert sends.
it("stamps accepted_at with the server's time on insert, ignoring a time the caller sends", async () => {
  const { rows: [row] } = await pool.query("INSERT INTO owner_acceptances (user_id, terms_version, avv_version, privacy_version, text_version, accepted_at) VALUES ('synthetic', 'v', 'v', 'v', 'v', '2000-01-01T00:00:00Z') RETURNING accepted_at, now() AS server");
  expect(row.accepted_at).toEqual(row.server);
});
