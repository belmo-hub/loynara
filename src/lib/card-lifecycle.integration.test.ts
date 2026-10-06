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
import { authenticatedApplePass, listUpdatedApplePasses, registerAppleDevice } from "./wallet/apple-service";
import { issueWalletPass } from "./wallet/issue";
import { pruneRevokedAppleRegistrations } from "./wallet/refresh";

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
    // Everything queued before the closure is suppressed; the one new job withdraws the saved Wallet pass.
    expect(jobs.filter(job => job.status !== "suppressed")).toMatchObject([{ kind: "wallet.refresh", status: "pending", payload: { membershipId: card.id } }]);
    expect(JSON.stringify(jobs)).not.toContain("Synthetic private message");
    expect(JSON.stringify(jobs)).not.toContain("Synthetic content");
    expect(await db.select().from(walletPasses).where(eq(walletPasses.membershipId, card.id))).toMatchObject([{ status: "revocation_pending", revokeReason: "closed", revokedAt: expect.any(Date) }]);

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

  it("keeps closed-card Apple registrations only to deliver the voided pass, then prunes them without touching a shared device's live card", async () => {
    const userId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic owner", `${userId}@example.test`]);
    const merchant = await createMerchant({ userId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp per confirmed visit.", rewardTitle: "Synthetic reward", rewardCost: 5 });
    const closedCard = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const liveCard = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const config = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "secret".repeat(8) };
    const closedPass = await issueWalletPass(closedCard.cardToken, "apple", id => id);
    const livePass = await issueWalletPass(liveCard.cardToken, "apple", id => id);
    const register = (serial: string, deviceId: string, pushToken: string) => registerAppleDevice({ deviceId, passTypeId: config.passTypeId, serial, authorization: `ApplePass ${applePassToken(serial, config)}`, pushToken }, config);
    await register(closedPass.id, "closed-only-device", "a".repeat(64));
    await register(closedPass.id, "shared-device", "b".repeat(64));
    await register(livePass.id, "shared-device", "b".repeat(64));
    const before = await listUpdatedApplePasses("shared-device", config.passTypeId);
    expect(before?.serialNumbers.sort()).toEqual([closedPass.id, livePass.id].sort());

    await closeCard(closedCard.cardToken);
    // The device learns that the closed pass changed and fetches it: voided, without QR code or balance.
    const after = await listUpdatedApplePasses("shared-device", config.passTypeId, before?.lastUpdated);
    expect(after?.serialNumbers).toEqual([closedPass.id]);
    const view = await authenticatedApplePass({ passTypeId: config.passTypeId, serial: closedPass.id, authorization: `ApplePass ${applePassToken(closedPass.id, config)}` }, config);
    expect(view).toMatchObject({ kind: "void", pass: { reason: "closed", merchantName: "Synthetic Café" } });
    expect(JSON.stringify(view)).not.toContain(closedCard.scanCode);
    // No new device can subscribe to a closed card's pass.
    await expect(register(closedPass.id, "new-device", "c".repeat(64))).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await db.select().from(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, "new-device"))).toHaveLength(0);

    await pruneRevokedAppleRegistrations(pool, 0);
    expect(await db.select().from(appleRegistrations).where(eq(appleRegistrations.membershipId, closedCard.id))).toHaveLength(0);
    expect(await db.select().from(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, "closed-only-device"))).toHaveLength(0);
    expect(await db.select().from(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, "shared-device"))).toMatchObject([{ pushToken: "b".repeat(64) }]);
    expect((await listUpdatedApplePasses("shared-device", config.passTypeId))?.serialNumbers).toEqual([livePass.id]);
    // The pass history row itself is kept.
    expect(await db.select().from(walletPasses).where(eq(walletPasses.id, closedPass.id))).toMatchObject([{ revokeReason: "closed" }]);
  });
});
