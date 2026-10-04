import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { cardSecurityEvents, ledgerEntries, memberships, staffRoles } from "@/db/schema";
import { closeCard } from "./card-lifecycle";
import { getCustomerExport, getMerchantExport } from "./export";
import { reissueCardByStaff } from "./card-reissue";
import { createAdditionalLocation } from "./locations";
import { award, redeem, reverseEntry } from "./loyalty";
import { getMerchantAnalytics } from "./merchant-analytics";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, getCard, lookupCard } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user" CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, businessName = "Synthetic Reissue Café") => createMerchant({ userId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 3 });
const key = () => randomUUID();

describe("staff-assisted card reissue", () => {
  it("rotates both bearer credentials on the same card without touching value or history", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 2, idempotencyKey: key(), requestId: randomUUID() });
    const ledgerBefore = await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id));

    const result = await reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: card.id, reason: "Neues Handy, Kartennummer genannt" });
    expect(result.membershipId).toBe(card.id);
    expect(result.cardToken).not.toBe(card.cardToken);

    await expect(getCard(card.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: card.scanCode })).rejects.toMatchObject({ code: "NOT_FOUND" });
    const fresh = await getCard(result.cardToken);
    expect(fresh).toMatchObject({ balance: 2, cardNumber: "K-0001" });
    expect(fresh.scanCode).not.toBe(card.scanCode);
    expect((await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: fresh.scanCode })).membershipId).toBe(card.id);

    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id))).toEqual(ledgerBefore);
    expect(await db.select().from(memberships).where(eq(memberships.tenantId, merchant.tenantId))).toHaveLength(1);
    const [event] = await db.select().from(cardSecurityEvents).where(eq(cardSecurityEvents.membershipId, card.id));
    expect(event).toMatchObject({ action: "card_reissued_by_staff", actorUserId: owner, reason: "Neues Handy, Kartennummer genannt" });

    // Exports carry the same number and the audited reissue, and still reconcile with the ledger.
    const merchantExport = await getMerchantExport(owner);
    expect(merchantExport.memberships).toEqual([expect.objectContaining({ id: card.id, cardNumber: "K-0001", balance: 2 })]);
    expect(merchantExport.cardSecurityEvents).toEqual([expect.objectContaining({ membershipId: card.id, action: "card_reissued_by_staff", actorUserId: owner })]);
    expect(merchantExport.ledger.filter(entry => entry.membershipId === card.id).reduce((sum, entry) => sum + entry.delta, 0)).toBe(2);
    expect((await getCustomerExport(result.cardToken)).membership).toMatchObject({ id: card.id, cardNumber: "K-0001", balance: 2 });
    expect(JSON.stringify(merchantExport)).not.toContain(result.cardToken);
  });

  it("is limited to owners and managers of the card's location and refuses closed cards", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const other = await shop(await user(), "Other Synthetic Café");
    const second = await createAdditionalLocation(owner, { name: "Second counter", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Bonn card", programType: "stamp", rulesText: "Ein Stempel pro Kassenvorgang.", rewardTitle: "Testkaffee", rewardCost: 4 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const [cashier, manager, foreignManager] = [await user(), await user(), await user()];
    await db.insert(staffRoles).values([
      { tenantId: merchant.tenantId, userId: cashier, role: "cashier", locationId: merchant.locationId },
      { tenantId: merchant.tenantId, userId: manager, role: "manager", locationId: merchant.locationId },
      { tenantId: merchant.tenantId, userId: foreignManager, role: "manager", locationId: second.locationId },
    ]);
    const reason = "Kartenlink verloren, geprüft";
    await expect(reissueCardByStaff({ actorUserId: cashier, locationId: merchant.locationId, membershipId: card.id, reason })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reissueCardByStaff({ actorUserId: foreignManager, locationId: merchant.locationId, membershipId: card.id, reason })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reissueCardByStaff({ actorUserId: owner, locationId: second.locationId, membershipId: card.id, reason })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reissueCardByStaff({ actorUserId: owner, locationId: other.locationId, membershipId: card.id, reason })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reissueCardByStaff({ actorUserId: manager, locationId: merchant.locationId, membershipId: card.id, reason: "kurz" })).rejects.toThrow();
    expect((await reissueCardByStaff({ actorUserId: manager, locationId: merchant.locationId, membershipId: card.id, reason })).membershipId).toBe(card.id);

    const closed = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await closeCard(closed.cardToken);
    await expect(reissueCardByStaff({ actorUserId: owner, locationId: merchant.locationId, membershipId: closed.id, reason })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("counter mistake to correction", () => {
  it("reconciles balance, card history and analytics after a compensating entry", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const right = await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: key(), requestId: randomUUID() });
    const wrong = await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 2, idempotencyKey: key(), requestId: randomUUID() });
    expect(wrong.balance).toBe(3);

    const correctionKey = key();
    const corrected = await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: wrong.entryId, reason: "Doppelt gebucht, nur ein Kaffee", idempotencyKey: correctionKey, requestId: randomUUID() });
    expect(corrected.balance).toBe(1);
    // The same key is a safe retry, not a second correction.
    expect(await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: wrong.entryId, reason: "Doppelt gebucht, nur ein Kaffee", idempotencyKey: correctionKey, requestId: randomUUID() })).toMatchObject({ duplicate: true, entryId: corrected.entryId });

    const detail = await getMerchantMember(owner, card.id);
    expect(detail.member).toMatchObject({ balance: 1, qualifyingCheckouts: 1 });
    expect(detail.timeline.map(entry => [entry.kind, entry.delta, entry.reversed, entry.reason])).toEqual([
      ["reversal", -2, false, "Doppelt gebucht, nur ein Kaffee"],
      ["award", 2, true, null],
      ["award", 1, false, null],
    ]);
    const analytics = await getMerchantAnalytics(owner, { windowDays: 30 });
    expect(analytics).toMatchObject({ qualifyingCheckouts: 1, repeatCards: 0, issued: { stampUnits: 1, awardActions: 1 } });

    // A reward that spent the corrected stamps blocks the correction instead of creating a negative balance.
    await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 2, idempotencyKey: key(), requestId: randomUUID() });
    const rewardVersionId = (await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: "1" })).rewards[0].id;
    await redeem({ userId: owner, locationId: merchant.locationId, membershipId: card.id, rewardVersionId, idempotencyKey: key(), requestId: randomUUID() });
    await expect(reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: right.entryId, reason: "Später bemerkter Fehler", idempotencyKey: key(), requestId: randomUUID() })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE" });
  });
});
