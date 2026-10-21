import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, getCard, updateProgramExtras } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
async function staff(s: Shop, role: "cashier" | "manager") {
  const id = await user();
  await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, $3, $4)", [s.tenantId, id, role, s.locationId]);
  return id;
}
/**
 * A shop whose location timezone has at least one earlier day in the current month, so a visit "on day 1" is a different
 * day of the same month whatever date the suite runs on.
 */
async function shop(programType: "points" | "stamp" = "stamp", name = "Synthetic Döner") {
  const owner = await user();
  const merchant = await createMerchant({ userId: owner, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType, rulesText: "Ein Stempel pro bestätigtem Besuch.", rewardTitle: "Döner gratis", rewardCost: 10 });
  const { rows: [{ now }] } = await pool.query<{ now: Date }>("SELECT now()");
  const timezone = ["Europe/Berlin", "Pacific/Kiritimati", "Pacific/Pago_Pago"].find(zone => Number(new Intl.DateTimeFormat("en", { day: "numeric", timeZone: zone }).format(now)) >= 2)!;
  await pool.query("UPDATE locations SET timezone = $1 WHERE id = $2", [timezone, merchant.locationId]);
  return { owner, timezone, ...merchant };
}
type Shop = Awaited<ReturnType<typeof shop>>;
const give = (s: Shop, membershipId: string, userId = s.owner, quantity = 1) => award({ userId, locationId: s.locationId, membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
/** A ledger row on day 1, 12:00, of the current month in the shop's timezone. */
async function earlierVisit(s: Shop, membershipId: string, source = "staff_online") {
  await pool.query(`INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, created_at)
    VALUES ($1, $2, $3, 1, 'award', $4, $5, gen_random_uuid(), $6, (date_trunc('month', now() AT TIME ZONE $7) + interval '12 hours') AT TIME ZONE $7)`,
    [s.tenantId, s.locationId, membershipId, source, source === "nfc_tap" ? null : s.owner, `synthetic-${randomUUID()}`, s.timezone]);
  await pool.query("UPDATE memberships SET balance = balance + 1 WHERE id = $1", [membershipId]);
}
const bonusRows = (membershipId: string) => db.select().from(ledgerEntries).where(and(eq(ledgerEntries.membershipId, membershipId), eq(ledgerEntries.source, "challenge_bonus")));
const balanceOf = async (membershipId: string) => (await db.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, membershipId)))[0].balance;
const challenge = (s: Shop, challengeVisits: number | null, challengeBonus?: number, actorUserId = s.owner) => updateProgramExtras({ actorUserId, programId: s.programId, challengeVisits, challengeBonus });

describe("challenge setting", () => {
  it("is off by default: no bonus and nothing on the card", async () => {
    const s = await shop();
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await earlierVisit(s, card.id);
    await give(s, card.id);
    expect(await bonusRows(card.id)).toEqual([]);
    expect((await getCard(card.cardToken)).challenge).toBeUndefined();
  });

  it("is the owner's alone, with a count of 2 to 10, stamps +1 to +3 and points up to a quarter of the cheapest reward", async () => {
    const s = await shop();
    const other = await shop("stamp", "Other Synthetic Shop");
    await expect(challenge(s, 3, 1, await staff(s, "cashier"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(challenge(s, 3, 1, await staff(s, "manager"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(challenge(s, 3, 1, other.owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(challenge(s, 1, 1)).rejects.toThrow();
    await expect(challenge(s, 11, 1)).rejects.toThrow();
    await expect(challenge(s, 3, 4)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    expect(await challenge(s, 3, 3)).toMatchObject({ challengeVisits: 3, challengeBonus: 3 });
    // The shop's only reward costs 10 points: the bonus may be 1 or 2.
    const points = await shop("points", "Synthetic Pizzeria");
    await expect(challenge(points, 3, 3)).rejects.toMatchObject({ code: "INVALID_CHALLENGE" });
    await expect(challenge(points, 3, 0)).rejects.toThrow();
    expect(await challenge(points, 3, 2)).toMatchObject({ challengeVisits: 3, challengeBonus: 2 });
    // Switching it off keeps the bonus value for next time.
    expect(await challenge(points, null)).toMatchObject({ challengeVisits: null, challengeBonus: 2 });
  });
});

describe("challenge bonus", () => {
  it("is booked once, with the confirmed visit that reaches the count, and shows on the card", async () => {
    const s = await shop();
    await challenge(s, 2, 2);
    const cashier = await staff(s, "cashier");
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await earlierVisit(s, card.id);
    expect((await getCard(card.cardToken)).challenge).toMatchObject({ visits: 1, target: 2, done: false });
    expect((await getCard(card.cardToken)).challenge?.text).toMatch(/^Komm 2-mal im \S+, dann gibt's 2 Stempel extra\.$/);

    // Each challenge shows its conditions and end date (Legal), with the excluded goods.
    expect((await getCard(card.cardToken)).challenge?.conditions).toMatch(/^Es zählen Besuche, die an der Kasse bestätigt werden, höchstens einer pro Tag\. Gilt bis \d{2}\.\d{2}\.\d{4}\. Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben\.$/);

    // Booked inside the cashier-confirmed award that completes it, and reported back for the cashier screen.
    const reached = await give(s, card.id, cashier);
    expect(reached).toMatchObject({ balance: 1 + 1 + 2, challengeBonus: 2 });
    const [bonus] = await bonusRows(card.id);
    expect(bonus).toMatchObject({ kind: "award", delta: 2, actorUserId: cashier, reason: "Monats-Challenge", idempotencyKey: `challenge:${reached.entryId}` });
    expect(await give(s, card.id, cashier)).not.toHaveProperty("challengeBonus");
    expect(await bonusRows(card.id)).toHaveLength(1);
    expect((await getCard(card.cardToken)).challenge).toMatchObject({ visits: 2, target: 2, done: true });
    expect((await getCard(card.cardToken)).activity.some(entry => entry.isChallengeBonus)).toBe(true);
  });

  it("counts visit days, not bookings: two awards on one day are one visit", async () => {
    const s = await shop();
    await challenge(s, 2, 1);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await give(s, card.id);
    await give(s, card.id);
    expect(await bonusRows(card.id)).toEqual([]);
    expect((await getCard(card.cardToken)).challenge).toMatchObject({ visits: 1, done: false });
  });

  it("counts only cashier-confirmed visits: an unconfirmed tap or a bonus is not a visit", async () => {
    const s = await shop();
    await challenge(s, 2, 1);
    await updateProgramExtras({ actorUserId: s.owner, programId: s.programId, welcomeBonus: 2 });
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await earlierVisit(s, card.id, "nfc_tap");
    await give(s, card.id);
    expect(await bonusRows(card.id)).toEqual([]);
  });

  it("is taken back when a correction leaves the month short, and can be earned again", async () => {
    const s = await shop();
    await challenge(s, 2, 2);
    const manager = await staff(s, "manager");
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await earlierVisit(s, card.id);
    const reached = await give(s, card.id);
    const [bonus] = await bonusRows(card.id);
    expect(await balanceOf(card.id)).toBe(4);
    await expect(reverseEntry({ userId: manager, locationId: s.locationId, entryId: bonus.id, reason: "Bonus versehentlich", idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "CHALLENGE_BONUS_WITH_AWARD" });

    const corrected = await reverseEntry({ userId: manager, locationId: s.locationId, entryId: reached.entryId, reason: "Falsche Karte gestempelt", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(corrected.balance).toBe(1);
    const [taken] = await db.select().from(ledgerEntries).where(eq(ledgerEntries.reversalOfId, bonus.id));
    expect(taken).toMatchObject({ delta: -2, kind: "reversal", idempotencyKey: `challenge-reversal:${bonus.id}` });
    expect((await getCard(card.cardToken)).challenge).toMatchObject({ visits: 1, done: false });

    const again = await give(s, card.id);
    expect(again.balance).toBe(1 + 1 + 2);
    expect((await bonusRows(card.id)).map(row => row.idempotencyKey)).toEqual([`challenge:${reached.entryId}`, `challenge:${again.entryId}`]);
  });

  it("stays when a correction still leaves enough visit days", async () => {
    const s = await shop();
    await challenge(s, 2, 1);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await earlierVisit(s, card.id);
    await give(s, card.id);
    const extra = await give(s, card.id);
    await reverseEntry({ userId: s.owner, locationId: s.locationId, entryId: extra.entryId, reason: "Doppelt gebucht heute", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(await db.select().from(ledgerEntries).where(eq(ledgerEntries.reversalOfId, (await bonusRows(card.id))[0].id))).toEqual([]);
  });

  it("replays an award key without a second bonus", async () => {
    const s = await shop();
    await challenge(s, 2, 1);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await earlierVisit(s, card.id);
    const request = { userId: s.owner, locationId: s.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() };
    await award(request);
    expect(await award(request)).toMatchObject({ duplicate: true });
    expect(await bonusRows(card.id)).toHaveLength(1);
    await expect(award({ ...request, idempotencyKey: `challenge:${randomUUID()}` })).rejects.toMatchObject({ code: "INVALID_KEY" });
  });

  it("is not a visit in the owner's numbers and stays inside its shop", async () => {
    const s = await shop();
    const other = await shop("stamp", "Other Synthetic Shop");
    await challenge(s, 2, 1);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const neighbour = await enroll({ slug: other.programSlug, acceptedTerms: true });
    await earlierVisit(other, neighbour.id);
    await give(other, neighbour.id);
    expect(await bonusRows(neighbour.id)).toEqual([]);
    await earlierVisit(s, card.id);
    await give(s, card.id);
    expect((await getMerchantMember(s.owner, card.id)).member).toMatchObject({ qualifyingCheckouts: 2 });
    await expect(getMerchantMember(other.owner, card.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
