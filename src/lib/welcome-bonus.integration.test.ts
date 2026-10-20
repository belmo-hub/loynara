import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, referrals } from "@/db/schema";
import { award, awardTapInTransaction, redeem, RESERVED_KEY_PREFIXES, reverseEntry } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, getCard, updateProgram, updateProgramExtras } from "./product";
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
const shop = (userId: string, programType: "stamp" | "points" = "stamp") => createMerchant({ userId, businessName: "Synthetic Bonus Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType, rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });
const give = (userId: string, locationId: string, membershipId: string, quantity = 1) => award({ userId, locationId, membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
const balanceOf = async (membershipId: string) => (await db.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, membershipId)))[0].balance;
const bonusRows = (membershipId: string) => db.select().from(ledgerEntries).where(and(eq(ledgerEntries.membershipId, membershipId), eq(ledgerEntries.source, "welcome_bonus")));

describe("welcome bonus (Startbonus)", () => {
  it("is off by default: the first award books only itself", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    expect(await give(owner, merchant.locationId, card.id)).toMatchObject({ balance: 1 });
    expect(await bonusRows(card.id)).toEqual([]);
  });

  it("books a labelled entry exactly once per card, with the first staff-confirmed award only", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 2 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    // Opening the join link is not an award.
    expect(await balanceOf(card.id)).toBe(0);
    const first = await give(owner, merchant.locationId, card.id);
    expect(first).toMatchObject({ balance: 3, creditedQuantity: 1 });
    const [bonus] = await bonusRows(card.id);
    expect(bonus).toMatchObject({ kind: "award", delta: 2, reason: "Startbonus", actorUserId: owner, idempotencyKey: `welcome:${first.entryId}` });
    expect(await give(owner, merchant.locationId, card.id)).toMatchObject({ balance: 4 });
    expect(await bonusRows(card.id)).toHaveLength(1);
    // The card page names the bonus line.
    const view = await getCard(card.cardToken);
    expect(view.activity.filter(entry => entry.isWelcomeBonus).map(entry => entry.delta)).toEqual([2]);
  });

  it("never comes with an unconfirmed tap", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 3 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await db.transaction(tx => awardTapInTransaction(tx, { locationId: merchant.locationId, membershipId: card.id, tagId: randomUUID(), counter: 1 }));
    expect(await balanceOf(card.id)).toBe(1);
    expect(await bonusRows(card.id)).toEqual([]);
  });

  it("is reversed together with the first award and cannot be corrected on its own", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 3 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const first = await give(owner, merchant.locationId, card.id);
    const [bonus] = await bonusRows(card.id);
    await expect(reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: bonus.id, reason: "Nur den Bonus zurücknehmen", idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "WELCOME_BONUS_WITH_AWARD" });
    expect(await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: first.entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() })).toMatchObject({ balance: 0 });
    const reversals = await db.select().from(ledgerEntries).where(and(eq(ledgerEntries.membershipId, card.id), eq(ledgerEntries.kind, "reversal")));
    expect(reversals.map(row => [row.reversalOfId, row.delta]).sort()).toEqual([[bonus.id, -3], [first.entryId, -1]].sort());
    // Once per card: a later award after the correction does not book a second bonus.
    expect(await give(owner, merchant.locationId, card.id)).toMatchObject({ balance: 1 });
    expect(await bonusRows(card.id)).toHaveLength(1);
  });

  it("refuses every server key namespace from client keys, while normal keys and the server bookings still work", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 2 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const first = await give(owner, merchant.locationId, card.id);
    const [bonus] = await bonusRows(card.id);
    const [reward] = (await getCard(card.cardToken)).rewards;
    for (const key of RESERVED_KEY_PREFIXES.map(prefix => `${prefix}${first.entryId}`)) {
      await expect(award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: key, requestId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_KEY" });
      await expect(redeem({ userId: owner, locationId: merchant.locationId, membershipId: card.id, rewardVersionId: reward.id, idempotencyKey: key, requestId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_KEY" });
      await expect(reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: first.entryId, reason: "Versehentlich gebucht", idempotencyKey: key, requestId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_KEY" });
    }
    expect(RESERVED_KEY_PREFIXES).toEqual(["tap:", "offline:", "referral:", "welcome:", "welcome-reversal:"]);
    // A normal client key still works; the bonus and its correction still book under their own keys.
    expect(await award({ userId: owner, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: "cashier-key-0001", requestId: randomUUID() })).toMatchObject({ duplicate: false, balance: 4 });
    expect(await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: first.entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() })).toMatchObject({ balance: 1 });
    const [bonusReversal] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.reversalOfId, bonus.id));
    expect(bonusReversal).toMatchObject({ delta: -2, idempotencyKey: `welcome-reversal:${first.entryId}` });
  });

  it("works for points and enforces the per-type limit on the server", async () => {
    const owner = await user();
    const merchant = await shop(owner, "points");
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 51 })).rejects.toThrow();
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 50 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    expect(await give(owner, merchant.locationId, card.id, 5)).toMatchObject({ balance: 55 });
  });

  it("refuses more than 3 stamps, other tenants' owners, and switches off on a type change", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 4 })).rejects.toMatchObject({ code: "INVALID_WELCOME_BONUS" });
    const otherOwner = await user();
    await shop(otherOwner);
    await expect(updateProgramExtras({ actorUserId: otherOwner, programId: merchant.programId, welcomeBonus: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 3 });
    await updateProgram({ actorUserId: owner, programSlug: merchant.programSlug, name: "Kaffeekarte", rulesText: "Ein Stempel pro Kaffee.", programType: "points", earningMode: "manual" });
    expect(await updateProgramExtras({ actorUserId: owner, programId: merchant.programId })).toEqual({ welcomeBonus: 0 });
  });

  it("does not count as a qualifying purchase for referrals", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 2 });
    await configureReferrals({ actorUserId: owner, programSlug: merchant.programSlug, enabled: true, referrerBonus: 1, referredBonus: 1 });
    const referrer = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
    const referred = await enroll({ slug: merchant.programSlug, acceptedTerms: true, referralCode: code });
    const first = await give(owner, merchant.locationId, referred.id);
    // 1 stamp + 2 welcome bonus + 1 referred bonus.
    expect(first.balance).toBe(4);
    const [referral] = await db.select().from(referrals);
    expect(referral).toMatchObject({ status: "qualified", qualifyingEntryId: first.entryId });
    expect((await getMerchantMember(owner, referred.id)).member).toMatchObject({ qualifyingCheckouts: 1 });
    // Correcting the first award takes back the award, the welcome bonus and the referral bonuses.
    expect(await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: first.entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() })).toMatchObject({ balance: 0 });
    expect((await getMerchantMember(owner, referred.id)).member).toMatchObject({ qualifyingCheckouts: 0 });
  });
});
