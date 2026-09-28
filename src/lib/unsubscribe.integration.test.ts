import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { membershipContacts } from "@/db/schema";
import { createMerchant, enroll, getCard } from "./product";
import { getMarketingPreference } from "./email";
import { createUnsubscribeToken, unsubscribeMarketing } from "./unsubscribe";
import { POST } from "@/app/api/unsubscribe/route";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Unsubscribe tests require looplocal_test");
beforeEach(async () => {
  process.env.BETTER_AUTH_SECRET = "synthetic-unsubscribe-secret-long-enough-for-tests";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET;
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN;
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, rate_limits CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic owner", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic", programType: "stamp", rulesText: "One stamp per purchase", rewardTitle: "Coffee", rewardCost: 8 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "holder@example.test", marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  return { merchant, card };
}

describe("public marketing unsubscribe", () => {
  it("withdraws only tenant-scoped marketing, is idempotent, and leaves the card and recovery email intact", async () => {
    const f = await fixture();
    const token = createUnsubscribeToken({ tenantId: f.merchant.tenantId, membershipId: f.card.id, email: "holder@example.test" });
    expect(token).not.toContain(f.card.cardToken);
    expect(token).not.toContain(f.card.id);
    expect(await unsubscribeMarketing(token)).toEqual({ status: "complete" });
    expect(await unsubscribeMarketing(token)).toEqual({ status: "complete" });
    expect(await getMarketingPreference(f.card.cardToken)).toEqual({ marketingEmail: false });
    expect((await getCard(f.card.cardToken)).scanCode).toBe(f.card.scanCode);
    const [contact] = await db.select().from(membershipContacts).where(eq(membershipContacts.membershipId, f.card.id));
    expect(contact.email).toBe("holder@example.test");
    expect(contact.emailVerified).toBe(true);
    await expect(unsubscribeMarketing(`${token}tampered`)).rejects.toMatchObject({ code: "INVALID_UNSUBSCRIBE" });
  });

  it("requires explicit POST and returns no membership details", async () => {
    const f = await fixture();
    const token = createUnsubscribeToken({ tenantId: f.merchant.tenantId, membershipId: f.card.id, email: "holder@example.test" });
    const request = new Request("http://localhost:3000/api/unsubscribe", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost:3000" }, body: JSON.stringify({ token }) });
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "complete" });
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("withdraws only the intended tenant membership when an address is shared", async () => {
    const first = await fixture();
    const second = await fixture();
    await unsubscribeMarketing(createUnsubscribeToken({ tenantId: first.merchant.tenantId, membershipId: first.card.id, email: "holder@example.test" }));
    expect(await getMarketingPreference(first.card.cardToken)).toEqual({ marketingEmail: false });
    expect(await getMarketingPreference(second.card.cardToken)).toEqual({ marketingEmail: true });
  });

  it("keeps an existing opt-out link valid across auth-secret rotation when a dedicated secret is configured", async () => {
    const f = await fixture();
    process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET = "synthetic-dedicated-unsubscribe-secret-long-enough";
    const token = createUnsubscribeToken({ tenantId: f.merchant.tenantId, membershipId: f.card.id, email: "holder@example.test" });
    process.env.BETTER_AUTH_SECRET = "another-synthetic-auth-secret-long-enough";
    expect(await unsubscribeMarketing(token)).toEqual({ status: "complete" });
    expect(await getMarketingPreference(f.card.cardToken)).toEqual({ marketingEmail: false });
    delete process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET;
  });

  it("accepts confirmation from the separately configured public unsubscribe origin", async () => {
    const f = await fixture();
    process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN = "https://unsubscribe.example.test";
    const token = createUnsubscribeToken({ tenantId: f.merchant.tenantId, membershipId: f.card.id, email: "holder@example.test" });
    const request = new Request("https://unsubscribe.example.test/api/unsubscribe", { method: "POST", headers: { "content-type": "application/json", origin: "https://unsubscribe.example.test" }, body: JSON.stringify({ token }) });
    expect((await POST(request)).status).toBe(200);
    expect(await getMarketingPreference(f.card.cardToken)).toEqual({ marketingEmail: false });
    delete process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN;
  });
});
