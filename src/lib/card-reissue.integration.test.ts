import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { appleDevices, appleRegistrations, cardSecurityEvents, ledgerEntries, memberships, outboxJobs, referrals, staffRoles, walletPasses } from "@/db/schema";
import { closeCard } from "./card-lifecycle";
import { reissueCardByStaff, VERIFICATION_METHODS } from "./card-reissue";
import { getCustomerExport, getMerchantExport } from "./export";
import { createAdditionalLocation } from "./locations";
import { award } from "./loyalty";
import { getMerchantAnalytics } from "./merchant-analytics";
import { createMerchant, enroll, getCard, lookupCard } from "./product";
import { configureReferrals, getCardReferralShare } from "./referrals";
import { bindTapCard } from "./secure-tap";
import { applePassToken } from "./wallet/apple";
import { authenticatedApplePass, listUpdatedApplePasses, registerAppleDevice } from "./wallet/apple-service";
import { issueWalletPass } from "./wallet/issue";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const appleConfig = { passTypeId: "pass.local.loop", teamId: "ABCDE12345", webServiceUrl: "https://wallet.example.test/api/apple", authSecret: "secret".repeat(8) };
const originalBaseUrl = process.env.PUBLIC_BASE_URL;
beforeEach(async () => { process.env.PUBLIC_BASE_URL = "http://localhost:3000"; await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, apple_devices CASCADE'); });
afterAll(async () => {
  if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = originalBaseUrl;
  await pool.query("TRUNCATE TABLE apple_devices CASCADE"); await pool.end();
});

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, businessName = "Synthetic Reissue Café") => createMerchant({ userId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 3 });
const key = () => randomUUID();
const request = (actorUserId: string, locationId: string, membershipId: string, extra: Partial<Parameters<typeof reissueCardByStaff>[0]> = {}) => ({
  actorUserId, locationId, membershipId, reason: "Neues Handy, alten Kartenlink gezeigt", verificationMethod: "card_link" as const, entitlementConfirmed: true as const, idempotencyKey: key(), ...extra,
});
const credentials = async (id: string) => (await db.select({ cardToken: memberships.cardToken, scanCode: memberships.scanCode, cardLocator: memberships.cardLocator, balance: memberships.balance }).from(memberships).where(eq(memberships.id, id)))[0];
const events = (membershipId: string) => db.select().from(cardSecurityEvents).where(and(eq(cardSecurityEvents.membershipId, membershipId), eq(cardSecurityEvents.action, "card_reissued_by_staff")));

describe("staff-assisted card reissue", () => {
  it("rotates bearer access on the same card and changes nothing about value, history or analytics", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 2, idempotencyKey: key(), requestId: randomUUID() });
    const before = await credentials(card.id);
    const ledgerBefore = await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id));
    const analyticsBefore = await getMerchantAnalytics(owner, { windowDays: 30 });
    const memberCountBefore = (await db.select().from(memberships).where(eq(memberships.tenantId, merchant.tenantId))).length;

    const result = await reissueCardByStaff(request(owner, merchant.locationId, card.id, { reason: "Neues Handy, Kartennummer genannt", verificationMethod: "stored_contact" }));
    expect(result).toMatchObject({ membershipId: card.id, duplicate: false });

    // Old link and QR are dead everywhere; the new ones work.
    await expect(getCard(card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: card.scanCode })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const fresh = await getCard(result.cardToken);
    expect(fresh.scanCode).not.toBe(card.scanCode);
    expect((await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: fresh.scanCode })).membershipId).toBe(card.id);

    // Same membership, same locator, same balance, no new spendable balance, no ledger rewrite.
    const after = await credentials(card.id);
    expect(after).toMatchObject({ cardLocator: before.cardLocator, balance: 2 });
    expect(after.cardToken).not.toBe(before.cardToken);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id))).toEqual(ledgerBefore);
    expect((await db.select().from(memberships).where(eq(memberships.tenantId, merchant.tenantId))).length).toBe(memberCountBefore);
    // It is not a visit and not a purchase.
    expect(await getMerchantAnalytics(owner, { windowDays: 30, asOf: new Date(analyticsBefore.asOf) })).toMatchObject({ qualifyingCheckouts: 1, participatingCards: 1, repeatCards: 0, newCards: 1, issued: analyticsBefore.issued });

    const [event] = await events(card.id);
    expect(event).toMatchObject({ actorUserId: owner, reason: "Neues Handy, Kartennummer genannt", verificationMethod: "stored_contact", tenantId: merchant.tenantId });
    expect(event.createdAt).toBeInstanceOf(Date);
    expect(event.idempotencyKey).toHaveLength(36);
  });

  it("requires owner or manager of the card's location, a reason, the entitlement confirmation and a known method", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const other = await shop(await user(), "Other Synthetic Café");
    const second = await createAdditionalLocation(owner, { name: "Second counter", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Bonn card", programType: "stamp", rulesText: "Ein Stempel pro Kassenvorgang.", rewardTitle: "Testkaffee", rewardCost: 4 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const [cashier, manager, foreignManager, revoked] = [await user(), await user(), await user(), await user()];
    await db.insert(staffRoles).values([
      { tenantId: merchant.tenantId, userId: cashier, role: "cashier", locationId: merchant.locationId },
      { tenantId: merchant.tenantId, userId: manager, role: "manager", locationId: merchant.locationId },
      { tenantId: merchant.tenantId, userId: foreignManager, role: "manager", locationId: second.locationId },
      { tenantId: merchant.tenantId, userId: revoked, role: "manager", locationId: merchant.locationId, active: false },
    ]);
    const before = await credentials(card.id);

    await expect(reissueCardByStaff(request(cashier, merchant.locationId, card.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reissueCardByStaff(request(foreignManager, merchant.locationId, card.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reissueCardByStaff(request(revoked, merchant.locationId, card.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reissueCardByStaff(request(await user(), merchant.locationId, card.id))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reissueCardByStaff(request(owner, second.locationId, card.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reissueCardByStaff(request(owner, other.locationId, card.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Missing or false confirmation, bad method, short reason and a bad key are refused before anything changes.
    const base = request(manager, merchant.locationId, card.id);
    await expect(reissueCardByStaff({ ...base, entitlementConfirmed: false as unknown as true })).rejects.toThrow();
    await expect(reissueCardByStaff({ ...base, entitlementConfirmed: undefined as unknown as true })).rejects.toThrow();
    await expect(reissueCardByStaff({ ...base, verificationMethod: "passport" as unknown as "card_link" })).rejects.toThrow();
    await expect(reissueCardByStaff({ ...base, verificationMethod: undefined as unknown as "card_link" })).rejects.toThrow();
    await expect(reissueCardByStaff({ ...base, reason: "kurz" })).rejects.toThrow();
    await expect(reissueCardByStaff({ ...base, idempotencyKey: "x" })).rejects.toThrow();
    expect(await credentials(card.id)).toEqual(before);
    expect(await events(card.id)).toHaveLength(0);

    for (const method of VERIFICATION_METHODS) expect((await reissueCardByStaff(request(manager, merchant.locationId, card.id, { verificationMethod: method }))).membershipId).toBe(card.id);
    expect((await events(card.id)).map(event => event.verificationMethod).sort()).toEqual([...VERIFICATION_METHODS].sort());

    const closed = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await closeCard(closed.cardToken);
    await expect(reissueCardByStaff(request(owner, merchant.locationId, closed.id))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("applies a retried request once and returns the same link", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const input = request(owner, merchant.locationId, card.id);
    const first = await reissueCardByStaff(input);
    const retry = await reissueCardByStaff(input);
    expect(retry).toEqual({ membershipId: card.id, cardToken: first.cardToken, duplicate: true });
    expect(await events(card.id)).toHaveLength(1);
    expect((await getCard(first.cardToken)).cardLocator).toMatch(/^K-/);
  });

  it("rotates exactly once for simultaneous retries with one key, and leaves one valid link for different keys", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const same = request(owner, merchant.locationId, card.id);
    const results = await Promise.all(Array.from({ length: 6 }, () => reissueCardByStaff(same)));
    expect(new Set(results.map(result => result.cardToken)).size).toBe(1);
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    expect(await events(card.id)).toHaveLength(1);

    // Different keys are different decisions: every one is recorded, the last one wins, all earlier links are dead.
    const racing = await Promise.all(Array.from({ length: 4 }, () => reissueCardByStaff(request(owner, merchant.locationId, card.id))));
    expect(await events(card.id)).toHaveLength(5);
    const current = (await credentials(card.id)).cardToken;
    expect(racing.map(result => result.cardToken)).toContain(current);
    for (const token of [card.cardToken, results[0].cardToken, ...racing.map(result => result.cardToken)].filter(token => token !== current)) await expect(getCard(token)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getCard(current)).cardLocator).toMatch(/^K-/);
  });

  it("does not let a key be replayed by someone else, on another card, or after a later reissue", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const manager = await user();
    await db.insert(staffRoles).values({ tenantId: merchant.tenantId, userId: manager, role: "manager", locationId: merchant.locationId });
    const a = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const b = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const input = request(owner, merchant.locationId, a.id);
    await reissueCardByStaff(input);
    await expect(reissueCardByStaff({ ...input, actorUserId: manager })).rejects.toMatchObject({ code: "KEY_REUSED" });
    await expect(reissueCardByStaff({ ...input, membershipId: b.id })).rejects.toMatchObject({ code: "KEY_REUSED" });
    await reissueCardByStaff(request(owner, merchant.locationId, a.id));
    await expect(reissueCardByStaff(input)).rejects.toMatchObject({ code: "KEY_REUSED" });
    expect(await events(a.id)).toHaveLength(2);
    expect(await events(b.id)).toHaveLength(0);
  });

  it("does not qualify a referral, count as a visit, or touch the ledger", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const referrer = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await configureReferrals({ actorUserId: owner, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode: code });
    const ledgerBefore = await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, merchant.tenantId));

    await reissueCardByStaff(request(owner, merchant.locationId, referred.id));
    await reissueCardByStaff(request(owner, merchant.locationId, referrer.id));

    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, merchant.tenantId))).toEqual(ledgerBefore);
    expect((await db.select().from(referrals).where(eq(referrals.referredMembershipId, referred.id)))[0].status).toBe("pending");
    expect((await credentials(referred.id)).balance + (await credentials(referrer.id)).balance).toBe(0);
    // The referral still qualifies normally, once, on the first real checkout after the reissue.
    await award({ userId: owner, locationId: merchant.locationId, membershipId: referred.id, quantity: 1, idempotencyKey: key(), requestId: randomUUID() });
    expect((await db.select().from(referrals).where(eq(referrals.referredMembershipId, referred.id)))[0].status).toBe("qualified");
  });

  it("revokes obsolete bindings: the tap cookie token and every saved Wallet pass, without touching other cards", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const keep = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const oldPass = await issueWalletPass(card.cardToken, "apple", id => id);
    const keepPass = await issueWalletPass(keep.cardToken, "apple", id => id);
    const auth = (serial: string) => `ApplePass ${applePassToken(serial, appleConfig)}`;
    const device = (serial: string, deviceId: string) => ({ deviceId, passTypeId: appleConfig.passTypeId, serial, authorization: auth(serial), pushToken: "a".repeat(64) });
    await registerAppleDevice(device(oldPass.id, "lost-phone"), appleConfig);
    await registerAppleDevice(device(keepPass.id, "shared-tablet"), appleConfig);
    expect(await bindTapCard(card.cardToken)).toBe(await bindTapCard(keep.cardToken));
    const tag = await listUpdatedApplePasses("lost-phone", appleConfig.passTypeId);

    const { cardToken } = await reissueCardByStaff(request(owner, merchant.locationId, card.id));
    const fresh = (await credentials(card.id)).scanCode;

    await expect(bindTapCard(card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" }); // an NFC cookie holding the old token stops resolving
    expect(await bindTapCard(cardToken)).toBeTruthy();
    // The old pass is revoked, not updated: the lost phone is told it changed and can only fetch a voided pass.
    expect((await db.select().from(walletPasses).where(eq(walletPasses.id, oldPass.id)))[0]).toMatchObject({ revokeReason: "reissued", status: "revocation_pending" });
    expect((await listUpdatedApplePasses("lost-phone", appleConfig.passTypeId, tag?.lastUpdated))?.serialNumbers).toEqual([oldPass.id]);
    const stale = await authenticatedApplePass({ passTypeId: appleConfig.passTypeId, serial: oldPass.id, authorization: auth(oldPass.id) }, appleConfig);
    expect(stale).toMatchObject({ kind: "void", pass: { reason: "reissued" } });
    expect(JSON.stringify(stale)).not.toContain(fresh);
    expect(JSON.stringify(stale)).not.toContain(card.scanCode);
    await expect(registerAppleDevice(device(oldPass.id, "another-phone"), appleConfig)).rejects.toMatchObject({ code: "FORBIDDEN" });
    // The old card link cannot mint a new pass; the new link mints a NEW serial that carries the new QR code.
    await expect(issueWalletPass(card.cardToken, "apple", id => id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const newPass = await issueWalletPass(cardToken, "apple", id => id);
    expect(newPass.id).not.toBe(oldPass.id);
    const current = await authenticatedApplePass({ passTypeId: appleConfig.passTypeId, serial: newPass.id, authorization: auth(newPass.id) }, appleConfig);
    expect(current).toMatchObject({ kind: "active", pass: { scanCode: fresh, balance: 0 } });
    expect(await registerAppleDevice(device(newPass.id, "new-phone"), appleConfig)).toBe(201);
    // Another card's pass on a shared device is untouched.
    expect(await authenticatedApplePass({ passTypeId: appleConfig.passTypeId, serial: keepPass.id, authorization: auth(keepPass.id) }, appleConfig)).toMatchObject({ kind: "active", pass: { membershipId: keep.id } });
    expect(await db.select().from(appleRegistrations).where(eq(appleRegistrations.membershipId, keep.id))).toHaveLength(1);
    expect(await db.select().from(appleDevices).where(eq(appleDevices.deviceLibraryIdentifier, "shared-tablet"))).toHaveLength(1);
    // Exactly one provider job for the card: the revocation.
    expect(await db.select().from(outboxJobs).where(and(eq(outboxJobs.kind, "wallet.refresh"), eq(outboxJobs.status, "pending")))).toMatchObject([{ payload: { membershipId: card.id } }]);
  });

  it("keeps an append-only audit trail with actor, time, reason and method, and exports it without credentials", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const { cardToken } = await reissueCardByStaff(request(owner, merchant.locationId, card.id, { reason: "Handywechsel, Kontakt stimmt überein", verificationMethod: "other_check" }));
    const [event] = await events(card.id);
    await expect(pool.query("UPDATE card_security_events SET reason = 'umgeschrieben' WHERE id = $1", [event.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("UPDATE card_security_events SET actor_user_id = 'someone-else' WHERE id = $1", [event.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM card_security_events WHERE id = $1", [event.id])).rejects.toThrow(/append-only/);
    await expect(pool.query("INSERT INTO card_security_events (tenant_id, membership_id, action, verification_method) VALUES ($1, $2, 'card_reissued_by_staff', 'passport')", [merchant.tenantId, card.id])).rejects.toThrow(/card_security_verification_valid/);

    const merchantExport = await getMerchantExport(owner);
    expect(merchantExport.cardSecurityEvents).toEqual([expect.objectContaining({ membershipId: card.id, actorUserId: owner, reason: "Handywechsel, Kontakt stimmt überein", verificationMethod: "other_check" })]);
    expect(merchantExport.memberships).toEqual([expect.objectContaining({ id: card.id, cardLocator: expect.stringMatching(/^K-[A-Z2-9]{6}$/), balance: 0 })]);
    const serialized = JSON.stringify(merchantExport);
    for (const secret of [card.cardToken, cardToken, card.scanCode, (await credentials(card.id)).scanCode]) expect(serialized).not.toContain(secret);
    expect((await getCustomerExport(cardToken)).membership).toMatchObject({ id: card.id, cardLocator: merchantExport.memberships[0].cardLocator });
  });
});
