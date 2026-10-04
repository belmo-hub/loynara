import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { appleDevices, appleRegistrations, consentEvents, ledgerEntries, membershipContacts, memberships, outboxJobs, walletPasses } from "@/db/schema";
import { closeCard } from "./card-lifecycle";
import { getCustomerExport, getMerchantExport } from "./export";
import { award } from "./loyalty";
import { createMerchant, enroll, getCard, lookupCard } from "./product";
import { applePassToken } from "./wallet/apple";
import { listUpdatedApplePasses, registerAppleDevice } from "./wallet/apple-service";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices CASCADE'); });
afterAll(async () => { await pool.query("TRUNCATE TABLE apple_devices CASCADE"); await pool.end(); });

describe("bearer card closure", () => {
  it("retire both identifiers, erase contact, suppress queued data and retain a marked pseudonymous ledger", async () => {
    const userId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic owner", `${userId}@example.test`]);
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp per confirmed visit.", rewardTitle: "Synthetic reward", rewardCost: 5 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await db.insert(membershipContacts).values({ tenantId: merchant.tenantId, membershipId: card.id, email: "holder@example.test", recoveryTokenHash: "synthetic-hash" });
    await db.insert(consentEvents).values({ tenantId: merchant.tenantId, membershipId: card.id, channel: "email", purpose: "marketing", granted: true, noticeVersion: "synthetic", source: "test" });
    await award({ userId, locationId: merchant.locationId, membershipId: card.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await db.insert(outboxJobs).values({ tenantId: merchant.tenantId, kind: "email.marketing", payload: { membershipId: card.id, subject: "Synthetic private message", body: "Synthetic content", actorUserId: userId } });
    await db.insert(walletPasses).values({ tenantId: merchant.tenantId, membershipId: card.id, provider: "apple", providerObjectId: card.id, status: "downloaded" });

    const result = await closeCard(card.cardToken);
    expect(result).toEqual({ closed: true, retention: "pseudonymous-ledger-and-consent-pending-policy" });
    const [stored] = await db.select().from(memberships).where(eq(memberships.id, card.id));
    expect(stored.closedAt).toBeInstanceOf(Date);
    expect(stored.scanCode).toMatch(/^retired_sc_/);
    expect(stored.cardToken).toMatch(/^retired_card_/);
    expect(stored.scanCode).not.toBe(card.scanCode);
    expect(stored.cardToken).not.toBe(card.cardToken);
    expect(stored.balance).toBe(2);
    expect(await db.select().from(membershipContacts).where(eq(membershipContacts.membershipId, card.id))).toHaveLength(0);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id))).toHaveLength(1);
    const consent = await db.select().from(consentEvents).where(eq(consentEvents.membershipId, card.id));
    expect(consent).toHaveLength(2);
    expect(consent).toEqual(expect.arrayContaining([expect.objectContaining({ granted: false, source: "card_closure" })]));
    const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.tenantId, merchant.tenantId));
    expect(jobs.every(job => job.status === "suppressed")).toBe(true);
    expect(JSON.stringify(jobs)).not.toContain("Synthetic private message");
    expect(JSON.stringify(jobs)).not.toContain("Synthetic content");
    expect(await db.select().from(walletPasses).where(eq(walletPasses.membershipId, card.id))).toMatchObject([{ status: "revocation_pending" }]);

    await expect(getCard(card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCard(stored.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCard(card.scanCode)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getCustomerExport(card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupCard({ userId, locationId: merchant.locationId, scanCode: card.scanCode })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(award({ userId, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(closeCard(card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const merchantExport = await getMerchantExport(userId);
    expect(merchantExport.memberships).toMatchObject([{ id: card.id, closedAt: expect.any(Date) }]);
    expect(merchantExport.ledger).toHaveLength(1);
    expect(JSON.stringify(merchantExport)).not.toContain("holder@example.test");
    expect(JSON.stringify(merchantExport)).not.toContain(card.cardToken);
    expect(JSON.stringify(merchantExport)).not.toContain(card.scanCode);
  });

  it("removes closed-card Apple registrations and orphan push tokens while keeping a shared device's live card", async () => {
    const userId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic owner", `${userId}@example.test`]);
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp per confirmed visit.", rewardTitle: "Synthetic reward", rewardCost: 5 });
    const closedCard = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const liveCard = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await db.insert(walletPasses).values([
      { tenantId: merchant.tenantId, membershipId: closedCard.id, provider: "apple", providerObjectId: closedCard.id, status: "issued" },
      { tenantId: merchant.tenantId, membershipId: liveCard.id, provider: "apple", providerObjectId: liveCard.id, status: "issued" },
    ]);
    await db.insert(appleDevices).values([
      { deviceLibraryIdentifier: "closed-only-device", pushToken: "a".repeat(64) },
      { deviceLibraryIdentifier: "shared-device", pushToken: "b".repeat(64) },
    ]);
    await db.insert(appleRegistrations).values([
      { deviceLibraryIdentifier: "closed-only-device", tenantId: merchant.tenantId, membershipId: closedCard.id, passTypeIdentifier: "pass.local.loop", serialNumber: closedCard.id },
      { deviceLibraryIdentifier: "shared-device", tenantId: merchant.tenantId, membershipId: closedCard.id, passTypeIdentifier: "pass.local.loop", serialNumber: closedCard.id },
      { deviceLibraryIdentifier: "shared-device", tenantId: merchant.tenantId, membershipId: liveCard.id, passTypeIdentifier: "pass.local.loop", serialNumber: liveCard.id },
    ]);
    expect((await listUpdatedApplePasses("shared-device", "pass.local.loop"))?.serialNumbers.sort()).toEqual([closedCard.id, liveCard.id].sort());

    await closeCard(closedCard.cardToken);
    expect(await db.select().from(appleRegistrations).where(eq(appleRegistrations.membershipId, closedCard.id))).toHaveLength(0);
    expect(await db.select().from(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, "closed-only-device"))).toHaveLength(0);
    expect(await db.select().from(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, "shared-device"))).toMatchObject([{ pushToken: "b".repeat(64) }]);
    expect((await listUpdatedApplePasses("shared-device", "pass.local.loop"))?.serialNumbers).toEqual([liveCard.id]);
    const config = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "secret".repeat(8) };
    await expect(registerAppleDevice({ deviceId: "new-device", passTypeId: config.passTypeId, serial: closedCard.id, authorization: `ApplePass ${applePassToken(closedCard.id, closedCard.scanCode, config)}`, pushToken: "c".repeat(64) }, config)).rejects.toMatchObject({ code: "FORBIDDEN" }); // closing retires the scan code, so the pass token no longer authenticates
    expect(await db.select().from(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, "new-device"))).toHaveLength(0);
  });
});
