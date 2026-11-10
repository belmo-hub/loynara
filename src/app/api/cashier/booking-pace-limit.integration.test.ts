import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, expect, it } from "vitest";
import { db, pool } from "@/db";
import { staffRoles } from "@/db/schema";
import { auth } from "@/lib/auth";
import { createMerchant, enroll } from "@/lib/product";
import { POST as award } from "@/app/api/cashier/award/route";
import { POST as redeem } from "@/app/api/cashier/redeem/route";
import { POST as reverse } from "@/app/api/transactions/reverse/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");
const origin = "http://localhost:3000", previous = process.env.PUBLIC_REGISTRATION_ENABLED;
beforeEach(async () => {
  await pool.query('TRUNCATE tenants, "user", rate_limits CASCADE');
  process.env.PUBLIC_REGISTRATION_ENABLED = "true";
});
afterAll(async () => { if (previous === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = previous; await pool.end(); });

async function identity() {
  const email = randomUUID() + "@example.test", password = "Synthetic-Pace-Limit-Only!";
  const account = await auth.api.signUpEmail({ body: { name: "Synthetic staff", email, password } });
  const signed = await auth.handler(new Request(origin + "/api/auth/sign-in/email", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) }));
  return { id: account.user.id, cookie: signed.headers.getSetCookie().map(value => value.split(";")[0]).join("; ") };
}
const post = (route: (request: Request) => Promise<Response>, path: string, cookie: string, body: object) =>
  route(new Request(origin + path, { method: "POST", headers: { origin, cookie, "content-type": "application/json" }, body: JSON.stringify(body) }));

async function shop() {
  const owner = await identity(), cashier = await identity();
  const merchant = await createMerchant({ userId: owner.id, businessName: "Synthetic Pace Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 3 });
  await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: cashier.id, role: "cashier", locationId: merchant.locationId });
  return { owner, cashier, merchant };
}
const stamp = (cookie: string, membershipId: string) => post(award, "/api/cashier/award", cookie, { membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });

it("books one card at most 20 times in 15 minutes, whoever stands at the counter", async () => {
  const { owner, cashier, merchant } = await shop();
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  for (let i = 0; i < 20; i++) expect((await stamp(cashier.cookie, card.id)).status).toBe(200);
  const refused = await stamp(cashier.cookie, card.id);
  expect(refused.status).toBe(429);
  expect(refused.headers.get("Retry-After")).toMatch(/^\d+$/);
  // Another staff account does not reopen the same card, and a redemption counts against it too.
  expect((await stamp(owner.cookie, card.id)).status).toBe(429);
  expect((await post(redeem, "/api/cashier/redeem", cashier.cookie, { membershipId: card.id, rewardVersionId: randomUUID(), idempotencyKey: randomUUID(), requestId: randomUUID() })).status).toBe(429);
  // Other cards are served as usual.
  const next = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  expect((await stamp(cashier.cookie, next.id)).status).toBe(200);
});

it("lets one account book at most 120 times in 15 minutes", async () => {
  const { cashier, merchant } = await shop();
  for (let c = 0; c < 6; c++) {
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    for (let i = 0; i < 20; i++) expect((await stamp(cashier.cookie, card.id)).status).toBe(200);
  }
  const fresh = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  expect((await stamp(cashier.cookie, fresh.id)).status).toBe(429);
});

it("lets one account correct at most 60 bookings in 15 minutes", async () => {
  const { owner, merchant } = await shop();
  const undo = () => post(reverse, "/api/transactions/reverse", owner.cookie, { locationId: merchant.locationId, entryId: randomUUID(), reason: "Synthetic correction reason", idempotencyKey: randomUUID() });
  for (let i = 0; i < 60; i++) expect((await undo()).status).toBe(404);
  expect((await undo()).status).toBe(429);
});
