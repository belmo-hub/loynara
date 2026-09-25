import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { billingInvoices, billingLocationPlans, billingWebhookEvents, staffRoles, subscriptions } from "@/db/schema";
import { createAdditionalLocation } from "./locations";
import { createMerchant, enroll } from "./product";
import { getMerchantExport } from "./export";
import { applyFixtureWebhook, cancelSubscriptionAtPeriodEnd, createFixtureHandoff, getBillingOverview, signFixtureWebhook } from "./billing";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Billing tests require looplocal_test");
const priorFixtureMode = process.env.BILLING_FIXTURE_MODE;
const priorFixtureSecret = process.env.BILLING_FIXTURE_SECRET;

beforeEach(async () => {
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
  process.env.BILLING_FIXTURE_MODE = "true";
  process.env.BILLING_FIXTURE_SECRET = "synthetic-local-billing-fixture-secret-32-bytes";
});
afterEach(() => {
  if (priorFixtureMode === undefined) delete process.env.BILLING_FIXTURE_MODE;
  else process.env.BILLING_FIXTURE_MODE = priorFixtureMode;
  if (priorFixtureSecret === undefined) delete process.env.BILLING_FIXTURE_SECRET;
  else process.env.BILLING_FIXTURE_SECRET = priorFixtureSecret;
});
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic billing tester", `${id}@example.test`]);
  return id;
}

async function merchant(ownerId: string) {
  return createMerchant({ userId: ownerId, businessName: "Synthetic Billing Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
}

const at = new Date("2026-09-25T12:00:00.000Z");

describe("local fixture billing lifecycle", () => {
  it("tracks one priced plan per location and current usage without creating a charge", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId);
    const second = await createAdditionalLocation(ownerId, { name: "Synthetic second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Tea", rewardCost: 5 });
    const overview = await getBillingOverview(ownerId, at);
    expect(overview).toMatchObject({ status: "manual_pending", currency: "EUR", monthlySubtotalMinor: 9800, locationCount: 2, liveBilling: false });
    expect(overview.locations.map(item => item.locationId)).toEqual(expect.arrayContaining([shop.locationId, second.locationId]));
    expect(overview.locations.every(item => item.planCode === "local_standard" && item.priceMinor === 4900 && item.memberLimit === 10000)).toBe(true);
    expect((await db.select().from(billingLocationPlans).where(eq(billingLocationPlans.tenantId, shop.tenantId)))).toHaveLength(2);
    expect((await db.select().from(billingInvoices).where(eq(billingInvoices.tenantId, shop.tenantId)))).toHaveLength(0);
  });

  it("enforces each location membership limit before a second card is created", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId);
    await db.update(billingLocationPlans).set({ memberLimit: 1 }).where(and(eq(billingLocationPlans.tenantId, shop.tenantId), eq(billingLocationPlans.locationId, shop.locationId)));
    await enroll({ slug: shop.programSlug, acceptedTerms: true });
    await expect(enroll({ slug: shop.programSlug, acceptedTerms: true })).rejects.toMatchObject({ code: "PLAN_MEMBER_LIMIT" });
  });

  it("requires an active owner and an explicit local fixture configuration for handoff", async () => {
    const ownerId = await user();
    const cashierId = await user();
    const shop = await merchant(ownerId);
    await db.insert(staffRoles).values({ tenantId: shop.tenantId, userId: cashierId, role: "cashier", locationId: shop.locationId });
    await expect(getBillingOverview(cashierId, at)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createFixtureHandoff(cashierId, at)).rejects.toMatchObject({ code: "FORBIDDEN" });
    process.env.BILLING_FIXTURE_MODE = "false";
    await expect(createFixtureHandoff(ownerId, at)).rejects.toMatchObject({ code: "BILLING_DISABLED" });
    process.env.BILLING_FIXTURE_MODE = "true";
    const handoff = await createFixtureHandoff(ownerId, at);
    expect(handoff).toMatchObject({ provider: "local_fixture", status: "pending", amountMinor: 4900 });
    expect(handoff.url).toMatch(/^http:\/\/localhost:3000\/merchant\/billing\/fixture\//);
    expect((await db.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)))[0].status).toBe("pending_checkout");
  });

  it("rejects a PostgreSQL URL query override in the local fixture", async () => {
    const ownerId = await user();
    await merchant(ownerId);
    const original = process.env.DATABASE_URL;
    process.env.DATABASE_URL = `${original}?host=db.example.com`;
    try { await expect(createFixtureHandoff(ownerId, at)).rejects.toMatchObject({ code: "BILLING_DISABLED" }); }
    finally { process.env.DATABASE_URL = original; }
  });

  it("reuses one pending handoff instead of creating several checkout attempts", async () => {
    const ownerId = await user();
    await merchant(ownerId);
    const first = await createFixtureHandoff(ownerId, at);
    const repeated = await createFixtureHandoff(ownerId, at);
    expect(repeated.id).toBe(first.id);
  });

  it("validates signatures and processes a completed fixture checkout only once", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId);
    const handoff = await createFixtureHandoff(ownerId, at);
    const event = { id: `evt_${randomUUID()}`, type: "checkout.completed", tenantId: shop.tenantId, handoffId: handoff.id, invoiceId: `inv_${randomUUID()}`, amountMinor: 4900, currency: "EUR", periodEnd: "2026-10-25T12:00:00.000Z", occurredAt: at.toISOString() };
    const raw = JSON.stringify(event);
    await expect(applyFixtureWebhook(raw, "sha256=bad", at)).rejects.toMatchObject({ code: "INVALID_SIGNATURE" });
    const signature = signFixtureWebhook(raw, at);
    expect(await applyFixtureWebhook(raw, signature, at)).toMatchObject({ status: "applied" });
    expect(await applyFixtureWebhook(raw, signature, at)).toMatchObject({ status: "duplicate" });
    expect((await db.select().from(billingWebhookEvents).where(eq(billingWebhookEvents.tenantId, shop.tenantId)))).toHaveLength(1);
    expect((await db.select().from(billingInvoices).where(eq(billingInvoices.tenantId, shop.tenantId)))).toMatchObject([{ status: "fixture_paid", amountMinor: 4900, currency: "EUR", taxMinor: null }]);
    expect(await getMerchantExport(ownerId)).toMatchObject({ billingLocationPlans: [expect.objectContaining({ locationId: shop.locationId, memberLimit: 10000 })], billingInvoices: [expect.objectContaining({ status: "fixture_paid", amountMinor: 4900 })] });
    expect((await db.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)))[0].status).toBe("active_fixture");
    const otherEvent = { ...event, id: `evt_${randomUUID()}`, amountMinor: 4800 };
    const otherRaw = JSON.stringify(otherEvent);
    await expect(applyFixtureWebhook(otherRaw, signFixtureWebhook(otherRaw, at), at)).rejects.toMatchObject({ code: "AMOUNT_MISMATCH" });
  });

  it("supports owner cancellation and bounded grace with controlled time", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId);
    const handoff = await createFixtureHandoff(ownerId, at);
    const complete = { id: `evt_${randomUUID()}`, type: "checkout.completed", tenantId: shop.tenantId, handoffId: handoff.id, invoiceId: `inv_${randomUUID()}`, amountMinor: 4900, currency: "EUR", periodEnd: "2026-10-25T12:00:00.000Z", occurredAt: at.toISOString() };
    const completedRaw = JSON.stringify(complete);
    await applyFixtureWebhook(completedRaw, signFixtureWebhook(completedRaw, at), at);
    expect(await cancelSubscriptionAtPeriodEnd(ownerId, at)).toMatchObject({ status: "active_fixture", cancelAtPeriodEnd: true });
    expect((await getBillingOverview(ownerId, new Date("2026-10-26T12:00:00.000Z"))).status).toBe("cancelled");
    const [stored] = await db.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId));
    expect(stored.status).toBe("cancelled");
  });

  it("records a payment failure as a seven-day fixture grace and then expires it", async () => {
    const ownerId = await user();
    const shop = await merchant(ownerId);
    const handoff = await createFixtureHandoff(ownerId, at);
    const completed = { id: `evt_${randomUUID()}`, type: "checkout.completed", tenantId: shop.tenantId, handoffId: handoff.id, invoiceId: `inv_${randomUUID()}`, amountMinor: 4900, currency: "EUR", periodEnd: "2026-10-25T12:00:00.000Z", occurredAt: at.toISOString() };
    const raw = JSON.stringify(completed);
    await applyFixtureWebhook(raw, signFixtureWebhook(raw, at), at);
    const failedAt = new Date("2026-10-25T12:00:00.000Z");
    const failure = { id: `evt_${randomUUID()}`, type: "payment.failed", tenantId: shop.tenantId, handoffId: handoff.id, occurredAt: failedAt.toISOString() };
    const failedRaw = JSON.stringify(failure);
    await applyFixtureWebhook(failedRaw, signFixtureWebhook(failedRaw, failedAt), failedAt);
    const repeatedAt = new Date("2026-10-26T12:00:00.000Z");
    const repeated = { ...failure, id: `evt_${randomUUID()}`, occurredAt: repeatedAt.toISOString() };
    const repeatedRaw = JSON.stringify(repeated);
    await applyFixtureWebhook(repeatedRaw, signFixtureWebhook(repeatedRaw, repeatedAt), repeatedAt);
    expect((await db.select().from(subscriptions).where(eq(subscriptions.tenantId, shop.tenantId)))[0].graceUntil?.toISOString()).toBe("2026-11-01T12:00:00.000Z");
    expect((await getBillingOverview(ownerId, new Date("2026-10-28T12:00:00.000Z"))).status).toBe("grace_fixture");
    expect((await getBillingOverview(ownerId, new Date("2026-11-02T12:00:01.000Z"))).status).toBe("suspended_fixture");
  });

  it("rejects a validly signed event for an unrelated handoff", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const shopA = await merchant(ownerA);
    const shopB = await merchant(ownerB);
    const handoff = await createFixtureHandoff(ownerA, at);
    const event = { id: `evt_${randomUUID()}`, type: "checkout.completed", tenantId: shopB.tenantId, handoffId: handoff.id, invoiceId: `inv_${randomUUID()}`, amountMinor: 4900, currency: "EUR", periodEnd: "2026-10-25T12:00:00.000Z", occurredAt: at.toISOString() };
    const raw = JSON.stringify(event);
    await expect(applyFixtureWebhook(raw, signFixtureWebhook(raw, at), at)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await db.select().from(billingWebhookEvents).where(and(eq(billingWebhookEvents.tenantId, shopA.tenantId), eq(billingWebhookEvents.eventId, event.id))))).toHaveLength(0);
  });

  it("serializes one provider event ID across simultaneous merchant handoffs", async () => {
    const ownerA = await user();
    const ownerB = await user();
    const shopA = await merchant(ownerA);
    const shopB = await merchant(ownerB);
    const handoffA = await createFixtureHandoff(ownerA, at);
    const handoffB = await createFixtureHandoff(ownerB, at);
    const id = `evt_${randomUUID()}`;
    const eventFor = (tenantId: string, handoffId: string) => JSON.stringify({ id, type: "checkout.completed", tenantId, handoffId, invoiceId: `inv_${randomUUID()}`, amountMinor: 4900, currency: "EUR", periodEnd: "2026-10-25T12:00:00.000Z", occurredAt: at.toISOString() });
    const rawA = eventFor(shopA.tenantId, handoffA.id);
    const rawB = eventFor(shopB.tenantId, handoffB.id);
    const outcomes = await Promise.allSettled([applyFixtureWebhook(rawA, signFixtureWebhook(rawA, at), at), applyFixtureWebhook(rawB, signFixtureWebhook(rawB, at), at)]);
    expect(outcomes.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(result => result.status === "rejected")).toMatchObject([{ reason: { code: "KEY_REUSED" } }]);
    expect(await db.select().from(billingInvoices)).toHaveLength(1);
  });
});
