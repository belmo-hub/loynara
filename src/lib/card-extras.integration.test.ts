import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { createMerchant, enroll, getCard, getMerchantContext, updateProgramExtras } from "./product";

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
const shop = (userId: string, businessName = "Synthetic News Café") => createMerchant({ userId, businessName, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });

describe("news on the card", () => {
  it("is hidden while empty and shown as saved, trimmed", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    expect((await getCard(card.cardToken)).news).toBeUndefined();
    expect(await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "  Neu: Kürbissuppe <heiß> & lecker  " })).toMatchObject({ cardNews: "Neu: Kürbissuppe <heiß> & lecker" });
    expect((await getCard(card.cardToken)).news).toBe("Neu: Kürbissuppe <heiß> & lecker");
    expect((await getMerchantContext(owner))?.cardNews).toBe("Neu: Kürbissuppe <heiß> & lecker");
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "" });
    expect((await getCard(card.cardToken)).news).toBeUndefined();
  });

  it("refuses more than 140 characters and links", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "a".repeat(141) })).rejects.toMatchObject({ code: "INVALID_CARD_NEWS" });
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "Mehr unter https://example.test" })).rejects.toMatchObject({ code: "INVALID_CARD_NEWS" });
    expect(await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "a".repeat(140) })).toMatchObject({ cardNews: "a".repeat(140) });
  });

  it("is written only by the shop's own owner and shown only on its own cards", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const otherOwner = await user();
    const other = await shop(otherOwner, "Synthetic Other Café");
    const otherCard = await enroll({ slug: other.programSlug, acceptedTerms: true });
    await expect(updateProgramExtras({ actorUserId: otherOwner, programId: merchant.programId, cardNews: "Fremde Nachricht" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const manager = await user();
    await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'manager', $3)", [merchant.tenantId, manager, merchant.locationId]);
    await expect(updateProgramExtras({ actorUserId: manager, programId: merchant.programId, cardNews: "Vom Team" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, cardNews: "Nur bei uns" });
    expect((await getCard(otherCard.cardToken)).news).toBeUndefined();
  });
});

describe("review link on the card", () => {
  const REVIEW = "https://g.page/r/Synthetic123/review";
  const visit = (userId: string, locationId: string, membershipId: string) => award({ userId, locationId, membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const ledgerCount = async (membershipId: string) => (await db.select({ id: ledgerEntries.id }).from(ledgerEntries).where(eq(ledgerEntries.membershipId, membershipId))).length;

  it("is stored only as an https Google link, and empty clears it", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, reviewUrl: "https://evil.test/review" })).rejects.toMatchObject({ code: "INVALID_REVIEW_URL" });
    await expect(updateProgramExtras({ actorUserId: owner, programId: merchant.programId, reviewUrl: "http://g.page/r/x/review" })).rejects.toMatchObject({ code: "INVALID_REVIEW_URL" });
    expect(await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, reviewUrl: ` ${REVIEW} ` })).toMatchObject({ reviewUrl: REVIEW });
    expect((await getMerchantContext(owner))?.reviewUrl).toBe(REVIEW);
    const otherOwner = await user();
    await shop(otherOwner, "Synthetic Other Café");
    await expect(updateProgramExtras({ actorUserId: otherOwner, programId: merchant.programId, reviewUrl: REVIEW })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, reviewUrl: "" })).toMatchObject({ reviewUrl: null });
  });

  it("appears from the third staff-confirmed visit; corrected visits and the welcome bonus do not count", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, reviewUrl: REVIEW, welcomeBonus: 3 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await visit(owner, merchant.locationId, card.id);
    const second = await visit(owner, merchant.locationId, card.id);
    expect((await getCard(card.cardToken)).reviewUrl).toBeUndefined();
    await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: second.entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await visit(owner, merchant.locationId, card.id);
    expect((await getCard(card.cardToken)).reviewUrl).toBeUndefined();
    await visit(owner, merchant.locationId, card.id);
    expect((await getCard(card.cardToken)).reviewUrl).toBe(REVIEW);
  });

  it("never books anything: showing the link leaves balance and ledger unchanged", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, reviewUrl: REVIEW });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    for (let i = 0; i < 3; i++) await visit(owner, merchant.locationId, card.id);
    const before = await ledgerCount(card.id);
    const view = await getCard(card.cardToken);
    expect(view).toMatchObject({ reviewUrl: REVIEW, balance: 3 });
    expect(await ledgerCount(card.id)).toBe(before);
  });
});

describe("the stamp moment's field on the card (ENG-206)", () => {
  const visit = (userId: string, locationId: string, membershipId: string) => award({ userId, locationId, membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("STAMP_ANIMATION_ENABLED off: the card read carries no field and runs no query for it", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await visit(owner, merchant.locationId, card.id);
    await visit(owner, merchant.locationId, card.id);
    const queries = vi.spyOn(pg.Client.prototype, "query");
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "false");
    expect(await getCard(card.cardToken)).not.toHaveProperty("stampMoment");
    const off = queries.mock.calls.length;
    queries.mockClear();
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "true");
    expect(await getCard(card.cardToken)).toMatchObject({ stampMoment: { referralDue: true } });
    // On, the one count of team-confirmed bookings is the only read added.
    expect(queries.mock.calls.length).toBe(off + 1);
  });

  it("on: the referral block is due from the second team-confirmed booking; the Startbonus and an undone booking do not count", async () => {
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "true");
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 3 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: false });
    await visit(owner, merchant.locationId, card.id);
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: false });
    const second = await visit(owner, merchant.locationId, card.id);
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: true });
    await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: second.entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: false });
  });
});
