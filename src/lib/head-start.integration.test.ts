import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, outboxJobs, referrals } from "@/db/schema";
import { POST as enrollRoute } from "@/app/api/enroll/route";
import { sourceLabel } from "@/components/owner/card-actions";
import { upsertAutomationRule } from "./automations";
import { contactStatus } from "./contact-verification";
import { getMerchantCsv, ledgerVorgang } from "./export";
import { headStartCap, REVIEW_AFTER_VISITS } from "./card-extras";
import { award, RESERVED_KEY_PREFIXES, reverseEntry, winbackState } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, createReward, editReward, enroll, getCard, getMerchantContext, getMerchantRewards, getPublicProgram, lookupCard, updateProgram, updateProgramExtras } from "./product";
import { configureReferrals, getCardReferralShare } from "./referrals";
import { fillSender } from "./sender-test-support";
import { appleFixture, withEnv } from "./wallet/test-support";
import { JOIN_CONSENT_TEXT_VERSION } from "./wallet-message-rules";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

const base = "http://localhost:3000";
const settings = { PUBLIC_BASE_URL: base, HEAD_START_ENABLED: "true", SMTP_HOST: "localhost", EXTERNAL_EMAIL_ENABLED: "false", OPERATOR_NAME: "Synthetic Betreiber", OPERATOR_ADDRESS: "Teststraße 1, 34117 Kassel", BETTER_AUTH_SECRET: "synthetic-head-start-secret-at-least-32-characters" };
const before = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]]));
beforeEach(async () => {
  Object.assign(process.env, settings);
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, rate_limits CASCADE');
});
// Every setting goes back to what it was, so no later suite inherits the flag or this suite's mail settings.
afterEach(() => { for (const [key, value] of Object.entries(before)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
let apple: ReturnType<typeof appleFixture>;
beforeAll(() => { apple = appleFixture(); });
afterAll(async () => { apple.cleanup(); await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, programType: "stamp" | "points" = "stamp", rewardCost = 10) => createMerchant({ userId, businessName: `Synthetic Start Café ${randomUUID().slice(0, 6)}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType, rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost });
/** A shop whose owner gives the Startbonus at sign-up. */
async function headStartShop(amount = 2, programType: "stamp" | "points" = "stamp", rewardCost = 10) {
  const owner = await user();
  const merchant = await shop(owner, programType, rewardCost);
  await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: amount, welcomeBonusAt: "enrollment" });
  return { owner, ...merchant };
}
/** The stored setting as a later change could leave it (a cheaper reward, a flag switched back on): past the save's check. */
const force = (programId: string, amount: number) => pool.query("UPDATE programs SET welcome_bonus = $2, welcome_bonus_at = 'enrollment' WHERE id = $1", [programId, amount]);
const join = (slug: string) => enroll({ slug, acceptedTerms: true });
const give = (userId: string, locationId: string, membershipId: string, quantity = 1) => award({ userId, locationId, membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
const reverse = (userId: string, locationId: string, entryId: string) => reverseEntry({ userId, locationId, entryId, reason: "Startbonus zurückgenommen", idempotencyKey: randomUUID(), requestId: randomUUID() });
const balanceOf = async (membershipId: string) => (await db.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, membershipId)))[0].balance;
const rows = (membershipId: string, source?: string) => db.select().from(ledgerEntries).where(and(eq(ledgerEntries.membershipId, membershipId), source ? eq(ledgerEntries.source, source) : undefined));
const post = (slug: string, cookie = "", extra: object = {}) => enrollRoute(new Request(`${base}/api/enroll`, { method: "POST", headers: { origin: base, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ slug, acceptedTerms: true, ...extra }) }));
/** What a browser sends back after a response: its cookies, without the ones the response cleared. */
const cookiesOf = (response: Response) => response.headers.getSetCookie().filter(header => !/max-age=0/i.test(header)).map(header => header.split(";")[0]).join("; ");
const bookings = async (owner: string) => (await getMerchantCsv(owner, "buchungen")).body.trim().split("\r\n").slice(1);

describe("Startbonus at sign-up (ENG-207)", () => {
  it("books one labelled ledger entry with the new card, and the answers carry the amount", async () => {
    const s = await headStartShop(2);
    const card = await join(s.programSlug);
    expect(card.headStart).toBe(2);
    expect(await balanceOf(card.id)).toBe(2);
    const all = await rows(card.id);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ tenantId: s.tenantId, locationId: s.locationId, kind: "award", source: "head_start", delta: 2, reason: "Startbonus", actorUserId: null, idempotencyKey: `headstart:${card.id}` });
    // The card page names it like the Startbonus it is; the join page learns the amount before the card exists.
    expect((await getCard(card.cardToken)).activity).toMatchObject([{ delta: 2, kind: "award", isWelcomeBonus: true }]);
    expect(await getPublicProgram(s.programSlug)).toMatchObject({ headStart: 2 });
    expect(await updateProgramExtras({ actorUserId: s.owner, programId: s.programId })).toMatchObject({ welcomeBonus: 2, welcomeBonusAt: "enrollment" });
  });

  it("a repeated request books nothing more, and its key can be neither replayed nor taken by a client", async () => {
    const s = await headStartShop(2);
    const first = await post(s.programSlug);
    expect(first.status).toBe(201);
    expect(await first.json()).toMatchObject({ headStart: 2 });
    const again = await post(s.programSlug, cookiesOf(first));
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ code: "CARD_EXISTS" });
    const booked = await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, s.tenantId));
    expect(booked).toHaveLength(1);
    // The database refuses a second row under the card's key, whatever code path tried.
    const [entry] = booked;
    await expect(db.insert(ledgerEntries).values({ tenantId: entry.tenantId, locationId: entry.locationId, membershipId: entry.membershipId, delta: 2, kind: "award", source: "head_start", actorUserId: null, requestId: randomUUID(), idempotencyKey: entry.idempotencyKey })).rejects.toThrow();
    expect(RESERVED_KEY_PREFIXES).toEqual(expect.arrayContaining(["headstart:", "headstart-reversal:"]));
    for (const key of [`headstart:${entry.membershipId}`, `headstart-reversal:${entry.membershipId}`]) {
      await expect(award({ userId: s.owner, locationId: s.locationId, membershipId: entry.membershipId, quantity: 1, idempotencyKey: key, requestId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_KEY" });
    }
  });

  it("allows a row without an actor for the Startbonus at sign-up alone: every other source still needs its person, and a head start may not carry one", async () => {
    const s = await headStartShop(2);
    await join(s.programSlug);
    const [entry] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, s.tenantId));
    const row = (source: string, actorUserId: string | null) => ({ tenantId: entry.tenantId, locationId: entry.locationId, membershipId: entry.membershipId, delta: 1, kind: "award" as const, source, actorUserId, requestId: randomUUID(), idempotencyKey: randomUUID() });
    // The sources a person or the system books for a person: without an actor the database refuses each.
    for (const source of ["staff_online", "staff_offline", "staff_correction", "welcome_bonus", "referral_bonus", "happy_hour", "winback_bonus", "birthday_bonus", "challenge_bonus", "synthetic_seed", "legacy_unclassified"]) {
      await expect(db.insert(ledgerEntries).values(row(source, null)), source).rejects.toThrow();
    }
    await expect(db.insert(ledgerEntries).values(row("head_start", s.owner))).rejects.toThrow();
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, s.tenantId))).toHaveLength(1);
  });

  it("caps stamps at 2 and at a quarter of the cheapest reward, when saving and again when granting", async () => {
    expect([headStartCap("stamp", [8]), headStartCap("stamp", [6, 12]), headStartCap("stamp", [3]), headStartCap("stamp", [40]), headStartCap("stamp", [])]).toEqual([2, 1, 0, 2, 0]);
    const ten = await headStartShop(2, "stamp", 10);
    await expect(updateProgramExtras({ actorUserId: ten.owner, programId: ten.programId, welcomeBonus: 3 })).rejects.toMatchObject({ code: "INVALID_HEAD_START", message: "Bei der Anmeldung sind höchstens 2 Stempel möglich, ein Viertel deiner kleinsten Prämie." });
    await force(ten.programId, 3);
    expect(await join(ten.programSlug)).toMatchObject({ headStart: 2 });
    const six = await shop(await user(), "stamp", 6);
    await force(six.programId, 2);
    const capped = await join(six.programSlug);
    expect(capped.headStart).toBe(1);
    expect(await balanceOf(capped.id)).toBe(1);
    // Under 4 stamps a quarter is nothing: no entry, no field, an ordinary empty card.
    const owner = await user();
    const three = await shop(owner, "stamp", 3);
    await expect(updateProgramExtras({ actorUserId: owner, programId: three.programId, welcomeBonus: 1, welcomeBonusAt: "enrollment" })).rejects.toMatchObject({ code: "INVALID_HEAD_START", message: "Deine kleinste Prämie ist dafür zu klein." });
    await force(three.programId, 1);
    const none = await join(three.programSlug);
    expect(none).not.toHaveProperty("headStart");
    expect(await rows(none.id)).toEqual([]);
    expect(await getPublicProgram(three.programSlug)).not.toHaveProperty("headStart");
  });

  it("caps points at 50 and at a quarter of the cheapest reward", async () => {
    expect([headStartCap("points", [100]), headStartCap("points", [400]), headStartCap("points", [3])]).toEqual([25, 50, 0]);
    const owner = await user();
    const hundred = await shop(owner, "points", 100);
    await expect(updateProgramExtras({ actorUserId: owner, programId: hundred.programId, welcomeBonus: 50, welcomeBonusAt: "enrollment" })).rejects.toMatchObject({ code: "INVALID_HEAD_START", message: "Bei der Anmeldung sind höchstens 25 Punkte möglich, ein Viertel deiner kleinsten Prämie." });
    await updateProgramExtras({ actorUserId: owner, programId: hundred.programId, welcomeBonus: 25, welcomeBonusAt: "enrollment" });
    expect(await join(hundred.programSlug)).toMatchObject({ headStart: 25 });
    await force(hundred.programId, 50);
    const capped = await join(hundred.programSlug);
    expect(capped.headStart).toBe(25);
    expect(await rows(capped.id)).toMatchObject([{ source: "head_start", delta: 25 }]);
    const large = await headStartShop(50, "points", 400);
    expect(await join(large.programSlug)).toMatchObject({ headStart: 50 });
  });

  it("never gives both: a card with a head start gets no first-booking bonus; a card without one still gets it, whatever the setting", async () => {
    const owner = await user();
    const merchant = await shop(owner);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonus: 2 });
    const before = await join(merchant.programSlug); // a card from before the owner's switch: no booking yet
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonusAt: "enrollment" });
    const card = await join(merchant.programSlug);
    expect(await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: card.scanCode })).toMatchObject({ welcomeBonus: 0 });
    expect(await give(owner, merchant.locationId, card.id)).toMatchObject({ balance: 3, welcomeBonus: 0 });
    expect(await rows(card.id, "welcome_bonus")).toEqual([]);
    // The older card was promised its Startbonus with the first booking, and the switch does not take that away (Legal, 10 Nov).
    expect(await lookupCard({ userId: owner, locationId: merchant.locationId, scanCode: before.scanCode })).toMatchObject({ welcomeBonus: 2 });
    expect(await give(owner, merchant.locationId, before.id)).toMatchObject({ balance: 3, welcomeBonus: 2 });
    expect(await rows(before.id, "head_start")).toEqual([]);
    // Back to the first booking: a card that had its head start gets no second Startbonus, a new card gets it there.
    const started = await join(merchant.programSlug);
    await updateProgramExtras({ actorUserId: owner, programId: merchant.programId, welcomeBonusAt: "first_award" });
    const fresh = await join(merchant.programSlug);
    expect(fresh).not.toHaveProperty("headStart");
    expect(await give(owner, merchant.locationId, started.id)).toMatchObject({ balance: 3, welcomeBonus: 0 });
    expect(await rows(started.id, "welcome_bonus")).toEqual([]);
    expect(await give(owner, merchant.locationId, fresh.id)).toMatchObject({ balance: 3, welcomeBonus: 2 });
  });

  it("gives none to a further card on the same device („Weitere Karte erstellen“): that card follows the first-booking rule", async () => {
    const s = await headStartShop(2);
    const first = await post(s.programSlug);
    expect(await first.json()).toMatchObject({ headStart: 2 });
    const further = await post(s.programSlug, cookiesOf(first), { additionalCard: true });
    expect(further.status).toBe(201);
    const body = await further.json();
    expect(Object.keys(body)).toEqual(["cardToken", "cardLocator"]); // no headStart field without a Startbonus
    const [card] = await db.select().from(memberships).where(eq(memberships.cardToken, body.cardToken));
    expect(card.balance).toBe(0);
    expect(await rows(card.id)).toEqual([]);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.source, "head_start"))).toHaveLength(1);
    expect(await give(s.owner, s.locationId, card.id)).toMatchObject({ balance: 3, welcomeBonus: 2 });
  });

  it("does not depend on the message tick: the same Startbonus with it and without it", async () => {
    const s = await headStartShop(2);
    const without = await join(s.programSlug);
    const consents = async () => (await pool.query<{ membership_id: string }>("SELECT membership_id FROM wallet_message_consents")).rows.map(row => row.membership_id);
    expect(without.headStart).toBe(2);
    expect(await consents()).toEqual([]);
    const ticked = await withEnv(apple.env, () => enroll({ slug: s.programSlug, acceptedTerms: true, walletConsentVersion: JOIN_CONSENT_TEXT_VERSION }));
    expect(ticked.headStart).toBe(2);
    expect(await consents()).toEqual([ticked.id]);
    expect((await rows(ticked.id)).map(row => [row.source, row.delta])).toEqual((await rows(without.id)).map(row => [row.source, row.delta]));
  });

  it("refuses the join as stale when the page promised another Startbonus than the card would get", async () => {
    const s = await headStartShop(2);
    const promised = (headStart: number, options?: { additionalCard: boolean }) => enroll({ slug: s.programSlug, acceptedTerms: true, headStart }, options);
    expect(await promised(2)).toMatchObject({ headStart: 2 });
    await expect(promised(0)).rejects.toMatchObject({ code: "STALE_RULE" });
    await expect(promised(1)).rejects.toMatchObject({ code: "STALE_RULE" });
    // A further card gets none, so its page may only have promised none.
    await expect(promised(2, { additionalCard: true })).rejects.toMatchObject({ code: "STALE_RULE" });
    expect(await promised(0, { additionalCard: true })).not.toHaveProperty("headStart");
    await updateProgramExtras({ actorUserId: s.owner, programId: s.programId, welcomeBonusAt: "first_award" });
    await expect(promised(2)).rejects.toMatchObject({ code: "STALE_RULE" });
    expect(await promised(0)).not.toHaveProperty("headStart");
    // Nothing was created by a refused join.
    expect(await db.select().from(memberships).where(eq(memberships.tenantId, s.tenantId))).toHaveLength(3);
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, s.tenantId))).toHaveLength(1);
  });

  it("refuses a reward so cheap that the sign-up Startbonus would be over a quarter of it; with the flag off rewards save as today", async () => {
    const s = await headStartShop(2);
    const [reward] = await getMerchantRewards({ actorUserId: s.owner, programSlug: s.programSlug });
    const refusal = { code: "INVALID_HEAD_START", message: expect.stringContaining("Startbonus") };
    await expect(createReward({ actorUserId: s.owner, programSlug: s.programSlug, title: "Espresso", cost: 7 })).rejects.toMatchObject(refusal);
    await expect(editReward({ actorUserId: s.owner, programSlug: s.programSlug, rewardId: reward.rewardId, cost: 6 })).rejects.toMatchObject(refusal);
    await createReward({ actorUserId: s.owner, programSlug: s.programSlug, title: "Espresso", cost: 8 });
    await editReward({ actorUserId: s.owner, programSlug: s.programSlug, rewardId: reward.rewardId, cost: 9 });
    expect(await join(s.programSlug)).toMatchObject({ headStart: 2 });
    delete process.env.HEAD_START_ENABLED;
    await createReward({ actorUserId: s.owner, programSlug: s.programSlug, title: "Keks", cost: 2 });
  });

  it("with the flag off nothing is booked and the Startbonus comes with the first booking as today, whatever the column says", async () => {
    const s = await headStartShop(2);
    delete process.env.HEAD_START_ENABLED;
    const card = await join(s.programSlug);
    expect(card).toEqual({ id: card.id, programId: s.programId, cardToken: card.cardToken, cardLocator: card.cardLocator, scanCode: card.scanCode });
    expect(await balanceOf(card.id)).toBe(0);
    expect(await rows(card.id)).toEqual([]);
    const response = await post(s.programSlug);
    expect(Object.keys(await response.json())).toEqual(["cardToken", "cardLocator"]);
    expect(await getPublicProgram(s.programSlug)).not.toHaveProperty("headStart");
    expect(await getMerchantContext(s.owner)).not.toHaveProperty("welcomeBonusAt");
    expect(await updateProgramExtras({ actorUserId: s.owner, programId: s.programId, welcomeBonus: 3 })).not.toHaveProperty("welcomeBonusAt");
    await expect(updateProgramExtras({ actorUserId: s.owner, programId: s.programId, welcomeBonusAt: "first_award" })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await lookupCard({ userId: s.owner, locationId: s.locationId, scanCode: card.scanCode })).toMatchObject({ welcomeBonus: 3 });
    expect(await give(s.owner, s.locationId, card.id)).toMatchObject({ balance: 4, welcomeBonus: 3 });
    expect((await rows(card.id)).map(row => row.source).sort()).toEqual(["staff_online", "welcome_bonus"]);
  });

  it("is the owner's setting only, and a type change resets it to the first booking", async () => {
    const s = await headStartShop(2);
    const other = await user();
    await shop(other);
    await expect(updateProgramExtras({ actorUserId: other, programId: s.programId, welcomeBonusAt: "first_award" })).rejects.toMatchObject({ code: "NOT_FOUND" }); // another business's programme does not exist for them (ENG-197)
    expect(await getMerchantContext(s.owner)).toMatchObject({ welcomeBonusAt: "enrollment" });
    await updateProgram({ actorUserId: s.owner, programSlug: s.programSlug, name: "Kaffeekarte", rulesText: "Ein Stempel pro Kaffee.", programType: "points", earningMode: "manual" });
    expect(await updateProgramExtras({ actorUserId: s.owner, programId: s.programId })).toMatchObject({ welcomeBonus: 0, welcomeBonusAt: "first_award" });
  });

  it("stays inside its shop: another shop's owner can neither read nor correct it", async () => {
    const a = await headStartShop(2), b = await headStartShop(1);
    const cardA = await join(a.programSlug), cardB = await join(b.programSlug);
    const [entryA] = await rows(cardA.id), [entryB] = await rows(cardB.id);
    expect([entryA.tenantId, entryA.delta, entryB.tenantId, entryB.delta]).toEqual([a.tenantId, 2, b.tenantId, 1]);
    await expect(getMerchantMember(b.owner, cardA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reverse(b.owner, b.locationId, entryA.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(reverse(b.owner, a.locationId, entryA.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await getMerchantMember(b.owner, cardB.id)).timeline.map(row => row.id)).toEqual([entryB.id]);
    expect(await bookings(b.owner)).toHaveLength(1);
    expect(await balanceOf(cardA.id)).toBe(2);
  });

  it("is corrected by the owner like a booking, once, and a corrected head start does not come back as a first-booking bonus", async () => {
    const s = await headStartShop(2);
    const card = await join(s.programSlug);
    const [entry] = await rows(card.id);
    const key = randomUUID();
    const undo = { userId: s.owner, locationId: s.locationId, entryId: entry.id, reason: "Startbonus zurückgenommen", idempotencyKey: key, requestId: randomUUID() };
    expect(await reverseEntry(undo)).toMatchObject({ balance: 0, duplicate: false });
    expect(await reverseEntry(undo)).toMatchObject({ balance: 0, duplicate: true });
    await expect(reverse(s.owner, s.locationId, entry.id)).rejects.toMatchObject({ code: "ALREADY_REVERSED" });
    const [reversal] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.reversalOfId, entry.id));
    expect(reversal).toMatchObject({ kind: "reversal", source: "staff_correction", delta: -2, actorUserId: s.owner, idempotencyKey: key });
    expect(await balanceOf(card.id)).toBe(0);
    await updateProgramExtras({ actorUserId: s.owner, programId: s.programId, welcomeBonusAt: "first_award" });
    expect(await give(s.owner, s.locationId, card.id)).toMatchObject({ balance: 1, welcomeBonus: 0 });
  });

  describe("is not a visit", () => {
    it("Übersicht: no booking counted, no activity row, the shop still counts as without bookings", async () => {
      const s = await headStartShop(2);
      await join(s.programSlug);
      const me = await getMerchantContext(s.owner);
      expect(me?.stats).toMatchObject({ members: 1, awards: 0 });
      expect(me?.activity).toEqual([]);
    });

    it("Kunden: the card has no qualifying booking, and its history names the row Startbonus", async () => {
      const s = await headStartShop(2);
      const card = await join(s.programSlug);
      const detail = await getMerchantMember(s.owner, card.id);
      expect(detail.member).toMatchObject({ qualifyingCheckouts: 0, firstQualifyingAt: null, lastQualifyingAt: null });
      expect(detail.timeline).toMatchObject([{ kind: "award", source: "head_start", delta: 2 }]);
      expect(sourceLabel("head_start")).toBe("Startbonus");
    });

    it("export: listed under its own name, never as a stamp or points booking", async () => {
      expect([ledgerVorgang("award", "head_start", "stamp"), ledgerVorgang("award", "head_start", "points")]).toEqual(["Startbonus", "Startbonus"]);
      const s = await headStartShop(2);
      await join(s.programSlug);
      const [line, ...more] = await bookings(s.owner);
      expect(more).toEqual([]);
      expect(line.split(";")[4]).toBe("Startbonus"); // column „Vorgang“
    });

    it("referral: it does not qualify the referred card; the first confirmed booking does", async () => {
      const s = await headStartShop(2);
      await configureReferrals({ actorUserId: s.owner, programSlug: s.programSlug, enabled: true, referrerBonus: 1, referredBonus: 1 });
      const referrer = await join(s.programSlug);
      const code = new URL((await getCardReferralShare(referrer.cardToken)).shareUrl).searchParams.get("ref")!;
      const referred = await enroll({ slug: s.programSlug, acceptedTerms: true, referralCode: code });
      expect(await db.select().from(referrals)).toMatchObject([{ status: "pending", qualifyingEntryId: null }]);
      const first = await give(s.owner, s.locationId, referred.id);
      expect(first.balance).toBe(4); // 2 Startbonus + 1 stamp + 1 referred bonus
      expect(await db.select().from(referrals)).toMatchObject([{ status: "qualified", qualifyingEntryId: first.entryId }]);
    });

    it("Willkommen zurück: it does not start the clock", async () => {
      const s = await headStartShop(2);
      await pool.query("UPDATE programs SET winback_enabled = true, winback_days = 14 WHERE id = $1", [s.programId]);
      const card = await join(s.programSlug);
      // Day 20 after sign-up would be inside the window if the Startbonus were a stamp.
      expect(await winbackState(db, card.id, new Date(Date.now() + 20 * 86_400_000))).toBeNull();
    });

    it("first-booking automation: sign-up queues no event; the first confirmed booking does", async () => {
      const s = await headStartShop(2);
      await fillSender(s.owner, { locationId: s.locationId, street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactPhone: "0561 123456" });
      await upsertAutomationRule({ actorUserId: s.owner, programSlug: s.programSlug, triggerKind: "first_checkout", enabled: true, subject: "Willkommen", body: "Danke für deine erste Buchung.", cooldownDays: 7, dailyCap: 20 });
      const card = await join(s.programSlug);
      const events = () => db.select().from(outboxJobs).where(and(eq(outboxJobs.tenantId, s.tenantId), eq(outboxJobs.kind, "automation.event")));
      expect(await events()).toEqual([]);
      await give(s.owner, s.locationId, card.id);
      expect(await events()).toHaveLength(1);
    });

    it("review ask: it never counts towards the visits before the Google link shows (Legal, 10 Nov)", async () => {
      const s = await headStartShop(2);
      await updateProgramExtras({ actorUserId: s.owner, programId: s.programId, reviewUrl: "https://g.page/r/synthetic/review" });
      const card = await join(s.programSlug);
      for (let visit = 1; visit < REVIEW_AFTER_VISITS; visit++) await give(s.owner, s.locationId, card.id);
      // Startbonus plus one visit short: as many ledger awards as the threshold, still no ask.
      expect(await rows(card.id)).toHaveLength(REVIEW_AFTER_VISITS);
      expect((await getCard(card.cardToken)).reviewUrl).toBeUndefined();
      await give(s.owner, s.locationId, card.id);
      expect((await getCard(card.cardToken)).reviewUrl).toBe("https://g.page/r/synthetic/review");
    });

    it("e-mail offer under the card: it comes after the first confirmed stamp, not with the Startbonus", async () => {
      const s = await headStartShop(2);
      const card = await join(s.programSlug);
      expect((await contactStatus(card.cardToken)).offer).toBe(false);
      await give(s.owner, s.locationId, card.id);
      expect((await contactStatus(card.cardToken)).offer).toBe(true);
    });
  });
});
