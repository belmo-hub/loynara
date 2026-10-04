import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, redemptions, referrals, staffRoles } from "@/db/schema";
import { createAdditionalLocation } from "./locations";
import { award, redeem, reverseEntry } from "./loyalty";
import { getMerchantAnalytics } from "./merchant-analytics";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, lookupCard } from "./product";
import { configureReferrals, getCardReferralShare } from "./referrals";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const originalBaseUrl = process.env.PUBLIC_BASE_URL;
beforeEach(async () => { process.env.PUBLIC_BASE_URL = "http://localhost:3000"; await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => {
  if (originalBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = originalBaseUrl;
  await pool.end();
});

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, name = "Synthetic Correction Café") => createMerchant({ userId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 3 });
const key = () => randomUUID();
const give = (userId: string, locationId: string, membershipId: string, quantity: number) => award({ userId, locationId, membershipId, quantity, idempotencyKey: key(), requestId: randomUUID() });
const reverse = (userId: string, locationId: string, entryId: string, extra: { reason?: string; idempotencyKey?: string } = {}) =>
  reverseEntry({ userId, locationId, entryId, reason: extra.reason ?? "Versehentlich falsch gebucht", idempotencyKey: extra.idempotencyKey ?? key(), requestId: randomUUID() });
const ledgerSum = async (membershipId: string) => Number((await db.select({ total: sql<string>`coalesce(sum(${ledgerEntries.delta}), 0)` }).from(ledgerEntries).where(eq(ledgerEntries.membershipId, membershipId)))[0].total);
const balanceOf = async (membershipId: string) => (await db.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, membershipId)))[0].balance;

describe("correcting an award", () => {
  it("books a linked compensating entry and reconciles balance, history, analytics and member detail", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const good = await give(owner, merchant.locationId, card.id, 1);
    const wrong = await give(owner, merchant.locationId, card.id, 2);
    const originalRow = (await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, wrong.entryId)))[0];

    const done = await reverse(owner, merchant.locationId, wrong.entryId, { reason: "Doppelt gebucht, nur ein Kaffee" });
    expect(done).toMatchObject({ balance: 1, duplicate: false });
    const [compensation] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, done.entryId));
    expect(compensation).toMatchObject({ kind: "reversal", delta: -2, reversalOfId: wrong.entryId, source: "staff_correction", actorUserId: owner, reason: "Doppelt gebucht, nur ein Kaffee", membershipId: card.id });
    // The original stays exactly as booked, and history cannot be rewritten afterwards.
    expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, wrong.entryId)))[0]).toEqual(originalRow);
    await expect(pool.query("UPDATE ledger_entries SET delta = 0 WHERE id = $1", [wrong.entryId])).rejects.toThrow(/append-only/);
    await expect(pool.query("DELETE FROM ledger_entries WHERE id = $1", [wrong.entryId])).rejects.toThrow(/append-only/);

    expect(await balanceOf(card.id)).toBe(1);
    expect(await ledgerSum(card.id)).toBe(1);
    const detail = await getMerchantMember(owner, card.id);
    expect(detail.member).toMatchObject({ balance: 1, qualifyingCheckouts: 1 });
    expect(detail.timeline.map(entry => [entry.kind, entry.delta, entry.reversed, entry.reason])).toEqual([["reversal", -2, false, "Doppelt gebucht, nur ein Kaffee"], ["award", 2, true, null], ["award", 1, false, null]]);
    expect(await getMerchantAnalytics(owner, { windowDays: 30 })).toMatchObject({ qualifyingCheckouts: 1, issued: { stampUnits: 1, awardActions: 1 } });
    expect(good.balance).toBe(1);
  });

  it("is idempotent for the same key and refuses a second correction with another key", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const wrong = await give(owner, merchant.locationId, card.id, 2);
    const retryKey = key();
    const first = await reverse(owner, merchant.locationId, wrong.entryId, { idempotencyKey: retryKey });
    expect(await reverse(owner, merchant.locationId, wrong.entryId, { idempotencyKey: retryKey })).toMatchObject({ duplicate: true, entryId: first.entryId, balance: 0 });
    await expect(reverse(owner, merchant.locationId, wrong.entryId)).rejects.toMatchObject({ code: "ALREADY_REVERSED" });
    // A key cannot be recycled for a different entry, and a correction cannot itself be corrected.
    const other = await give(owner, merchant.locationId, card.id, 1);
    await expect(reverse(owner, merchant.locationId, other.entryId, { idempotencyKey: retryKey })).rejects.toMatchObject({ code: "KEY_REUSED" });
    await expect(reverse(owner, merchant.locationId, first.entryId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ledgerSum(card.id)).toBe(1);
    expect(await balanceOf(card.id)).toBe(1);
  });

  it("books exactly one correction when several are attempted at once", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const wrong = await give(owner, merchant.locationId, card.id, 2);
    await give(owner, merchant.locationId, card.id, 1);
    const outcomes = await Promise.allSettled(Array.from({ length: 6 }, () => reverse(owner, merchant.locationId, wrong.entryId)));
    expect(outcomes.filter(outcome => outcome.status === "fulfilled")).toHaveLength(1);
    for (const outcome of outcomes) if (outcome.status === "rejected") expect(outcome.reason).toMatchObject({ code: "ALREADY_REVERSED" });
    expect(await balanceOf(card.id)).toBe(1);
    expect(await ledgerSum(card.id)).toBe(1);
    expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.reversalOfId, wrong.entryId)))).toHaveLength(1);
  });

  it("requires a real reason and an authorised role at the right location and tenant", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const other = await shop(await user(), "Other Synthetic Café");
    const second = await createAdditionalLocation(owner, { name: "Second counter", city: "Bonn", country: "DE", timezone: "Europe/Berlin", programName: "Bonn card", programType: "stamp", rulesText: "Ein Stempel pro Kassenvorgang.", rewardTitle: "Testkaffee", rewardCost: 4 });
    const [cashier, manager, foreignManager, revoked] = [await user(), await user(), await user(), await user()];
    await db.insert(staffRoles).values([
      { tenantId: merchant.tenantId, userId: cashier, role: "cashier", locationId: merchant.locationId },
      { tenantId: merchant.tenantId, userId: manager, role: "manager", locationId: merchant.locationId },
      { tenantId: merchant.tenantId, userId: foreignManager, role: "manager", locationId: second.locationId },
      { tenantId: merchant.tenantId, userId: revoked, role: "manager", locationId: merchant.locationId, active: false },
    ]);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const wrong = await give(owner, merchant.locationId, card.id, 1);

    for (const reason of ["", "   ", "kurz", "x".repeat(241)]) await expect(reverse(owner, merchant.locationId, wrong.entryId, { reason }), reason).rejects.toMatchObject({ code: "INVALID_REASON" });
    await expect(reverse(cashier, merchant.locationId, wrong.entryId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reverse(revoked, merchant.locationId, wrong.entryId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reverse(foreignManager, merchant.locationId, wrong.entryId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reverse(owner, second.locationId, wrong.entryId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reverse(await user(), merchant.locationId, wrong.entryId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const strangerOwner = (await db.select().from(staffRoles).where(eq(staffRoles.tenantId, other.tenantId)))[0].userId;
    await expect(reverse(strangerOwner, merchant.locationId, wrong.entryId)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reverse(strangerOwner, other.locationId, wrong.entryId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await balanceOf(card.id)).toBe(1);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.reversalOfId, wrong.entryId))).toHaveLength(0);
    expect((await reverse(manager, merchant.locationId, wrong.entryId)).balance).toBe(0);
  });
});

describe("correcting a redemption", () => {
  it("restores the balance, withdraws the redemption from counts and keeps the original rows", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await give(owner, merchant.locationId, card.id, 3);
    // The offered reward for this card (version id) is needed to redeem.
    const open = await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: card.scanCode });
    const spent = await redeem({ userId: owner, locationId: merchant.locationId, membershipId: card.id, rewardVersionId: open.rewards[0].id, idempotencyKey: key(), requestId: randomUUID() });
    expect(spent.balance).toBe(0);
    expect(await getMerchantAnalytics(owner, { windowDays: 30 })).toMatchObject({ rewards: { redemptions: 1 } });

    const done = await reverse(owner, merchant.locationId, spent.entryId, { reason: "Prämie wurde nicht ausgegeben" });
    expect(done.balance).toBe(3);
    expect(await ledgerSum(card.id)).toBe(3);
    const [compensation] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.id, done.entryId));
    expect(compensation).toMatchObject({ kind: "reversal", delta: 3, reversalOfId: spent.entryId, source: "staff_correction", actorUserId: owner });
    expect(await db.select().from(redemptions).where(eq(redemptions.ledgerEntryId, spent.entryId))).toHaveLength(1); // the record of what happened stays
    expect((await getMerchantMember(owner, card.id)).member).toMatchObject({ redemptionCount: 0, balance: 3, qualifyingCheckouts: 1 });
    // A reward that was refunded counts neither as a visit nor as a purchase, and no longer as a redemption.
    expect(await getMerchantAnalytics(owner, { windowDays: 30 })).toMatchObject({ rewards: { redemptions: 0 }, qualifyingCheckouts: 1 });
  });
});

describe("correcting an award that qualified a referral", () => {
  it("takes the referral back and keeps every balance equal to its ledger", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const referrer = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await configureReferrals({ actorUserId: owner, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode: code });
    const qualifying = await give(owner, merchant.locationId, referred.id, 1);
    expect((await db.select().from(referrals).where(eq(referrals.referredMembershipId, referred.id)))[0].status).toBe("qualified");

    await reverse(owner, merchant.locationId, qualifying.entryId, { reason: "Probebuchung zurückgenommen" });
    expect((await db.select().from(referrals).where(eq(referrals.referredMembershipId, referred.id)))[0].status).toBe("reversed");
    for (const id of [referrer.id, referred.id]) expect(await balanceOf(id), id).toBe(await ledgerSum(id));
    expect(await balanceOf(referred.id) + await balanceOf(referrer.id)).toBe(0);
  });
});

