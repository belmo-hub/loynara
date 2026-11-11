import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { createMerchant, enroll, getCard, getMerchantContext, updateProgramExtras } from "./product";
import { configureReferrals, getCardReferralShare } from "./referrals";
import { GET } from "@/app/api/card/[token]/route";

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
    await expect(updateProgramExtras({ actorUserId: otherOwner, programId: merchant.programId, cardNews: "Fremde Nachricht" })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    await expect(updateProgramExtras({ actorUserId: otherOwner, programId: merchant.programId, reviewUrl: REVIEW })).rejects.toMatchObject({ code: "NOT_FOUND" });
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
    expect(await getCard(card.cardToken)).toMatchObject({ stampMoment: { referralDue: true, referralNew: true } });
    // On, the one count of team-confirmed bookings is the only read added.
    expect(queries.mock.calls.length).toBe(off + 1);
  });

  it("on: the referral block is due from the second team-confirmed booking and new only with it; the Startbonus and an undone booking do not count", async () => {
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "true");
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 3 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: false, referralNew: false });
    await visit(owner, merchant.locationId, card.id);
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: false, referralNew: false });
    const second = await visit(owner, merchant.locationId, card.id);
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: true, referralNew: true });
    await reverseEntry({ userId: owner, locationId: merchant.locationId, entryId: second.entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: false, referralNew: false });
    await visit(owner, merchant.locationId, card.id);
    await visit(owner, merchant.locationId, card.id);
    // The third booking: still due, no longer new, so the card page shows the block without opening it.
    expect((await getCard(card.cardToken)).stampMoment).toEqual({ referralDue: true, referralNew: false });
  });

  // The card page's read itself (the route), so the block needs no request of its own.
  const read = async (token: string) => { const response = await GET(new Request(`http://localhost/api/card/${token}`), { params: Promise.resolve({ token }) }); expect(response.status).toBe(200); return response.json(); };

  it("the read carries no share and runs no query for one while the flag is off, and on before the second booking", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await configureReferrals({ actorUserId: owner, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const early = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const due = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await visit(owner, merchant.locationId, early.id);
    for (let i = 0; i < 3; i++) await visit(owner, merchant.locationId, due.id);
    const queries = vi.spyOn(pg.Client.prototype, "query");
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "false");
    expect(await read(due.cardToken)).not.toHaveProperty("stampMoment");
    const off = queries.mock.calls.length;
    queries.mockClear();
    expect(await read(early.cardToken)).not.toHaveProperty("stampMoment");
    expect(queries.mock.calls.length).toBe(off);
    queries.mockClear();
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "true");
    expect((await read(early.cardToken)).stampMoment).toEqual({ referralDue: false, referralNew: false });
    // On and not due, the count of team-confirmed bookings stays the only read added.
    expect(queries.mock.calls.length).toBe(off + 1);
  });

  it("on, from the second booking the read carries the share the referral route answers", async () => {
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "true");
    const owner = await user();
    const merchant = await shop(owner);
    await configureReferrals({ actorUserId: owner, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await visit(owner, merchant.locationId, card.id);
    await visit(owner, merchant.locationId, card.id);
    const second = (await read(card.cardToken)).stampMoment;
    expect(second).toEqual({ referralDue: true, referralNew: true, referral: await getCardReferralShare(card.cardToken) });
    expect(second.referral).toMatchObject({ shareUrl: expect.stringMatching(new RegExp(`^http://localhost:3000/join/${merchant.programSlug}\\?ref=ref_[A-Za-z0-9_-]{24}$`)), referrerBonus: 2, referredBonus: 1, programType: "stamp" });
    await visit(owner, merchant.locationId, card.id);
    expect((await read(card.cardToken)).stampMoment).toEqual({ ...second, referralNew: false });
  });

  it("on, the open card's timed re-reads carry no share and run no query for one (ENG-218)", async () => {
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "true");
    const owner = await user();
    const merchant = await shop(owner);
    await configureReferrals({ actorUserId: owner, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
    const early = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    const due = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await visit(owner, merchant.locationId, early.id);
    for (let i = 0; i < 3; i++) await visit(owner, merchant.locationId, due.id);
    const timed = async (token: string) => { const response = await GET(new Request(`http://localhost/api/card/${token}`, { headers: { "x-loynara-card-read": "poll" } }), { params: Promise.resolve({ token }) }); expect(response.status).toBe(200); return response.json(); };
    // A timed re-read of a due card costs what a read of a card that is not due costs: no second transaction.
    const queries = vi.spyOn(pg.Client.prototype, "query");
    expect((await timed(early.cardToken)).stampMoment).toEqual({ referralDue: false, referralNew: false });
    const notDue = queries.mock.calls.length;
    queries.mockClear();
    expect((await timed(due.cardToken)).stampMoment).toEqual({ referralDue: true, referralNew: false });
    expect(queries.mock.calls.length).toBe(notDue);
    queries.mockClear();
    // The read the guest causes still brings it.
    expect((await read(due.cardToken)).stampMoment.referral).toMatchObject({ referrerBonus: 2, referredBonus: 1 });
    expect(queries.mock.calls.length).toBeGreaterThan(notDue);
  });

  it("on, a shop with referrals off gets the read without a share", async () => {
    vi.stubEnv("STAMP_ANIMATION_ENABLED", "true");
    const owner = await user();
    const merchant = await shop(owner);
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    await visit(owner, merchant.locationId, card.id);
    await visit(owner, merchant.locationId, card.id);
    expect(await read(card.cardToken)).toMatchObject({ balance: 2, stampMoment: { referralDue: true, referralNew: true } });
    expect((await read(card.cardToken)).stampMoment).not.toHaveProperty("referral");
  });
});
