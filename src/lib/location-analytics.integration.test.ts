import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, programRuleVersions, programs, staffRoles } from "@/db/schema";
import { award, reverseEntry, winbackState } from "./loyalty";
import { createMerchant, enroll } from "./product";
import { getLocationAnalytics } from "./merchant-analytics";
import { createAdditionalLocation } from "./locations";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Location analytics tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await pool.end(); });

const day = 86_400_000;
async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic location tester", `${id}@example.test`]);
  return id;
}
const shop = (userId: string, name: string) => createMerchant({ userId, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `${name} Karte`, programType: "stamp", rulesText: "Ein Stempel pro Besuch.", rewardTitle: "Kaffee", rewardCost: 10 });
const second = (owner: string) => createAdditionalLocation(owner, { name: "Zweiter Laden", city: "Kassel", country: "DE", timezone: "Europe/Berlin", programName: "Zweite Karte", programType: "stamp", rulesText: "Ein Stempel pro Besuch.", rewardTitle: "Kaffee", rewardCost: 10 });
/** A confirmed stamp at `locationId`'s till, `daysAgo` before `asOf` (the ledger is append-only, so it is inserted with its time). */
const stampAt = (t: { tenantId: string; locationId: string; actor: string }, membershipId: string, at: Date, requestId = randomUUID()) =>
  db.insert(ledgerEntries).values({ tenantId: t.tenantId, locationId: t.locationId, membershipId, actorUserId: t.actor, requestId, idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1, createdAt: at }).returning();

describe("per-location Übersicht analytics (ENG-076)", () => {
  it("counts new cards by programme location and checkouts by till, without corrected, bonus or out-of-window entries", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Location A");
    const b = await second(owner);
    await db.update(programs).set({ welcomeBonus: 2 }).where(eq(programs.id, a.programId));
    const asOf = new Date(Date.now() + 1000);
    const regular = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const once = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const old = await enroll({ slug: a.programSlug, acceptedTerms: true });
    await db.update(memberships).set({ createdAt: new Date(asOf.getTime() - 40 * day) }).where(eq(memberships.id, old.id));
    const visitorB = await enroll({ slug: b.programSlug, acceptedTerms: true });
    const ta = { tenantId: a.tenantId, locationId: a.locationId, actor: owner };
    // Through the real booking path: the first award also books the welcome bonus, which is not a checkout.
    await award({ userId: owner, locationId: a.locationId, membershipId: regular.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await stampAt(ta, regular.id, new Date(asOf.getTime() - 5 * day));
    await stampAt(ta, once.id, new Date(asOf.getTime() - 2 * day));
    const wrong = await award({ userId: owner, locationId: a.locationId, membershipId: old.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await reverseEntry({ userId: owner, locationId: a.locationId, entryId: wrong.entryId, reason: "Synthetic wrong card", idempotencyKey: randomUUID(), requestId: randomUUID() });
    await stampAt(ta, old.id, new Date(asOf.getTime() - 31 * day)); // before the window
    // A card of B's programme booked at A's till counts as A's checkout, and as B's new card.
    await stampAt(ta, visitorB.id, new Date(asOf.getTime() - day));
    await stampAt({ tenantId: a.tenantId, locationId: b.locationId, actor: owner }, visitorB.id, new Date(asOf.getTime() - day));

    const atA = await getLocationAnalytics(owner, { locationId: a.locationId, asOf });
    expect(atA).toMatchObject({ locationId: a.locationId, windowDays: 30, asOf: asOf.toISOString(), current: { newCards: 2, qualifyingCheckouts: 4, repeatCards: 1 }, previous: null });
    expect(atA.from).toBe(new Date(asOf.getTime() - 30 * day).toISOString());
    expect((await getLocationAnalytics(owner, { locationId: b.locationId, asOf })).current).toEqual({ newCards: 1, qualifyingCheckouts: 1, repeatCards: 0, redemptions: 0, winbacks: 0 });
  });

  it("adds the previous 30 days only once the programme has run a full previous period", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Location Previous");
    const asOf = new Date(Date.now() + 1000);
    const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const ta = { tenantId: a.tenantId, locationId: a.locationId, actor: owner };
    await stampAt(ta, card.id, new Date(asOf.getTime() - 45 * day));
    await stampAt(ta, card.id, new Date(asOf.getTime() - 35 * day));
    await stampAt(ta, card.id, new Date(asOf.getTime() - 3 * day));
    await db.update(programs).set({ effectiveAt: new Date(asOf.getTime() - 59 * day) }).where(eq(programs.id, a.programId));
    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).previous).toBeNull();
    await db.update(programs).set({ effectiveAt: new Date(asOf.getTime() - 60 * day) }).where(eq(programs.id, a.programId));
    const report = await getLocationAnalytics(owner, { locationId: a.locationId, asOf });
    expect(report.current).toEqual({ newCards: 1, qualifyingCheckouts: 1, repeatCards: 0, redemptions: 0, winbacks: 0 });
    expect(report.previous).toEqual({ newCards: 0, qualifyingCheckouts: 2, repeatCards: 1, redemptions: 0, winbacks: 0 });
  });

  it("counts the owner's cards inside the win-back window with the counter's local-day rule, only where the surface is offered", async () => {
    const owner = await user();
    const manager = await user();
    const a = await shop(owner, "Synthetic Location Winback");
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: manager, role: "manager", locationId: a.locationId });
    const asOf = new Date(Date.now() + 1000);
    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).winback).toEqual({ enabled: false, inWindow: 0 });
    await db.update(programs).set({ winbackEnabled: true, winbackDays: 30 }).where(eq(programs.id, a.programId));
    const ta = { tenantId: a.tenantId, locationId: a.locationId, actor: owner };
    const lapsed = async (daysAgo: number, closed = false) => {
      const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
      await stampAt(ta, card.id, new Date(asOf.getTime() - daysAgo * day));
      if (closed) await db.update(memberships).set({ closedAt: new Date(asOf.getTime() - day) }).where(eq(memberships.id, card.id));
    };
    await lapsed(32); await lapsed(42); // inside 30..44 local days (away from the edges, so a DST hour cannot move them)
    await lapsed(20); await lapsed(50); await lapsed(35, true); // too recent, too long ago, closed
    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).winback).toEqual({ enabled: true, inWindow: 2 });
    expect((await getLocationAnalytics(manager, { locationId: a.locationId, asOf })).winback).toBeNull();
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).winback).toBeNull();
  });

  it("counts exactly the cards the counter would give the win-back bonus: from day N to day N + 14, not a day earlier or later", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Location Winback Edges");
    await db.update(programs).set({ winbackEnabled: true, winbackDays: 30 }).where(eq(programs.id, a.programId));
    // 12:00 Berlin, and every stamp at 12:00 Berlin N days earlier (no clock change in between), so N is the local-day lapse.
    const asOf = new Date("2026-10-20T10:00:00Z");
    const lapses = [29, 30, 44, 45];
    const cards = [];
    for (const daysAgo of lapses) {
      const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
      await stampAt({ tenantId: a.tenantId, locationId: a.locationId, actor: owner }, card.id, new Date(asOf.getTime() - daysAgo * day));
      cards.push(card.id);
    }
    const atCounter = await Promise.all(cards.map(async id => (await winbackState(db, id, asOf)) !== null));
    expect(atCounter).toEqual([false, true, true, false]);
    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).winback).toEqual({ enabled: true, inWindow: atCounter.filter(Boolean).length });
  });

  it("lets owners read their own locations and managers only theirs; cashiers, strangers and other tenants are refused", async () => {
    const owner = await user();
    const otherOwner = await user();
    const manager = await user();
    const cashier = await user();
    const a = await shop(owner, "Synthetic Location Scope");
    const b = await second(owner);
    const foreign = await shop(otherOwner, "Synthetic Location Foreign");
    await db.insert(staffRoles).values([
      { tenantId: a.tenantId, userId: manager, role: "manager", locationId: b.locationId },
      { tenantId: a.tenantId, userId: cashier, role: "cashier", locationId: a.locationId },
    ]);
    const card = await enroll({ slug: foreign.programSlug, acceptedTerms: true });
    await stampAt({ tenantId: foreign.tenantId, locationId: foreign.locationId, actor: otherOwner }, card.id, new Date());

    expect((await getLocationAnalytics(manager, { locationId: b.locationId })).locationId).toBe(b.locationId);
    await expect(getLocationAnalytics(manager, { locationId: a.locationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLocationAnalytics(cashier, { locationId: a.locationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getLocationAnalytics(await user(), { locationId: a.locationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getLocationAnalytics(owner, { locationId: foreign.locationId })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getLocationAnalytics(owner, { locationId: "not-a-uuid" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await getLocationAnalytics(otherOwner, { locationId: foreign.locationId })).current.qualifyingCheckouts).toBe(1);
    expect((await getLocationAnalytics(owner, { locationId: a.locationId })).current.qualifyingCheckouts).toBe(0);
    await db.update(staffRoles).set({ active: false }).where(and(eq(staffRoles.userId, owner), eq(staffRoles.tenantId, a.tenantId)));
    await expect(getLocationAnalytics(owner, { locationId: a.locationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the board's days, diary and tiles (ENG-085)", () => {
  // Tue 27 Oct 2026, 12:00 Berlin (winter time since Sun 25 Oct 03:00): today is the 27th, the strip ends on the 26th.
  const asOf = new Date("2026-10-27T11:00:00Z");
  const entry = (t: { tenantId: string; locationId: string; actor: string }, membershipId: string, at: string, patch: Partial<typeof ledgerEntries.$inferInsert> = {}) =>
    db.insert(ledgerEntries).values({ tenantId: t.tenantId, locationId: t.locationId, membershipId, actorUserId: t.actor, requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award", source: "staff_online", delta: 1, createdAt: new Date(at), ...patch }).returning();

  it("counts bookings per local day across the clock change, with the counting rule, and finds the first and last booking", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Days");
    await db.update(programs).set({ effectiveAt: new Date("2026-09-01T00:00:00Z") }).where(eq(programs.id, a.programId));
    const t = { tenantId: a.tenantId, locationId: a.locationId, actor: owner };
    const card = (await enroll({ slug: a.programSlug, acceptedTerms: true })).id;
    await entry(t, card, "2026-09-20T10:00:00Z"); // first booking, long before the strip
    await entry(t, card, "2026-10-24T21:59:59Z"); // 23:59:59 on Sat 24 (summer time)
    await entry(t, card, "2026-10-24T22:00:00Z"); // 00:00 on Sun 25: the night of the clock change
    await entry(t, card, "2026-10-25T22:59:59Z"); // 23:59:59 on Sun 25 (winter time)
    const request = randomUUID();
    await entry(t, card, "2026-10-26T08:00:00Z", { requestId: request }); await entry(t, card, "2026-10-26T08:00:01Z", { requestId: request }); // one booking, two entries
    const [wrong] = await entry(t, card, "2026-10-26T09:00:00Z");
    await entry(t, card, "2026-10-26T09:05:00Z", { kind: "reversal", source: "staff_correction", delta: -1, reversalOfId: wrong.id, reason: "Synthetic wrong card" });
    await entry(t, card, "2026-10-26T10:00:00Z", { source: "welcome_bonus", delta: 3 }); // a bonus is no booking
    await entry(t, card, "2026-10-27T09:00:00Z"); // today: not in the strip, but the last booking

    const report = await getLocationAnalytics(owner, { locationId: a.locationId, asOf });
    expect(report).toMatchObject({ timezone: "Europe/Berlin", today: "2026-10-27", lastBookingOn: "2026-10-27", firstBookingOn: "2026-09-20", fullTwoWeeks: true });
    expect(report.days).toHaveLength(15);
    expect(report.days[0].date).toBe("2026-10-12");
    expect(report.days.slice(-3)).toEqual([{ date: "2026-10-24", bookings: 1 }, { date: "2026-10-25", bookings: 2 }, { date: "2026-10-26", bookings: 1 }]);
    await db.update(programs).set({ effectiveAt: new Date("2026-10-13T00:00:00Z") }).where(eq(programs.id, a.programId));
    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).fullTwoWeeks).toBe(false); // younger than the 15 days the best-day rule compares
  });

  it("keeps the diary to 10 local days and 50 entries a day, corrections and redemptions as their own entries, no bonus rows, no ids or times", async () => {
    const owner = await user();
    const a = await shop(owner, "Synthetic Diary");
    const t = { tenantId: a.tenantId, locationId: a.locationId, actor: owner };
    const card = (await enroll({ slug: a.programSlug, acceptedTerms: true })).id;
    for (let d = 1; d <= 12; d++) await entry(t, card, new Date(asOf.getTime() - d * day).toISOString());
    for (let n = 0; n < 52; n++) await entry(t, card, new Date(asOf.getTime() - 60_000 * (n + 1)).toISOString()); // 52 bookings today
    const [wrong] = await entry(t, card, "2026-10-26T09:00:00Z", { delta: 4 });
    await entry(t, card, "2026-10-26T09:05:00Z", { kind: "reversal", source: "staff_correction", delta: -4, reversalOfId: wrong.id, reason: "Synthetic correction" });
    await entry(t, card, "2026-10-26T09:10:00Z", { kind: "redeem", delta: -10 });
    await entry(t, card, "2026-10-26T09:20:00Z", { source: "welcome_bonus", delta: 3 });
    await entry(t, card, "2026-09-20T10:00:00Z"); // outside the 30 local days

    const report = await getLocationAnalytics(owner, { locationId: a.locationId, asOf });
    expect(report.diary.map(d => d.date)).toEqual(["2026-10-27", "2026-10-26", "2026-10-25", "2026-10-24", "2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20", "2026-10-19", "2026-10-18"]);
    expect(report.diary[0]).toMatchObject({ bookings: 52, units: 52, more: 2 });
    expect(report.diary[0].entries).toHaveLength(50);
    expect(report.diary[1]).toEqual({ date: "2026-10-26", bookings: 1, units: 1, more: 0, entries: [{ kind: "award", amount: 4 }, { kind: "correction", amount: 4 }, { kind: "redemption", amount: 0 }, { kind: "award", amount: 1 }] }); // in time order
    const json = JSON.stringify({ days: report.days, diary: report.diary });
    expect(json).not.toContain(card);
    expect(json).not.toMatch(/T\d{2}:\d{2}/);
  });

  it("counts redemptions and booked welcome-back bonuses that were not corrected, and shows every role the bonus setting", async () => {
    const owner = await user();
    const manager = await user();
    const a = await shop(owner, "Synthetic Tiles");
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: manager, role: "manager", locationId: a.locationId });
    const t = { tenantId: a.tenantId, locationId: a.locationId, actor: owner };
    const card = (await enroll({ slug: a.programSlug, acceptedTerms: true })).id;
    await entry(t, card, "2026-10-20T09:00:00Z", { kind: "redeem", delta: -10 });
    const [undone] = await entry(t, card, "2026-10-21T09:00:00Z", { kind: "redeem", delta: -10 });
    await entry(t, card, "2026-10-21T09:05:00Z", { kind: "reversal", source: "staff_correction", delta: 10, reversalOfId: undone.id, reason: "Synthetic redemption mistake" });
    await entry(t, card, "2026-10-22T09:00:00Z", { source: "winback_bonus" });
    const [bonus] = await entry(t, card, "2026-10-23T09:00:00Z", { source: "winback_bonus" });
    await entry(t, card, "2026-10-23T09:05:00Z", { kind: "reversal", source: "staff_correction", delta: -1, reversalOfId: bonus.id, reason: "Synthetic bonus mistake" });

    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).current).toMatchObject({ redemptions: 1, winbacks: 1 });
    expect((await getLocationAnalytics(manager, { locationId: a.locationId, asOf })).winbackSetting).toEqual({ enabled: false, days: 30 });
    await db.update(programs).set({ winbackEnabled: true, winbackDays: 45, winbackBonus: 0 }).where(eq(programs.id, a.programId));
    expect((await getLocationAnalytics(owner, { locationId: a.locationId, asOf })).winbackSetting).toEqual({ enabled: false, days: 45 }); // no bonus, not on
    await db.update(programs).set({ winbackBonus: 1 }).where(eq(programs.id, a.programId));
    expect((await getLocationAnalytics(manager, { locationId: a.locationId, asOf })).winbackSetting).toEqual({ enabled: true, days: 45 });
  });

  it("gives no role a euro or card field (AC5), whatever the shop records", async () => {
    const owner = await user();
    const manager = await user();
    const a = await createMerchant({ userId: owner, businessName: "Synthetic Euro Guard", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punkte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt pro Euro.", rewardTitle: "Kaffee", rewardCost: 100 });
    await db.insert(staffRoles).values({ tenantId: a.tenantId, userId: manager, role: "manager", locationId: a.locationId });
    const card = await enroll({ slug: a.programSlug, acceptedTerms: true });
    const [rule] = await db.select({ id: programRuleVersions.id }).from(programRuleVersions).where(eq(programRuleVersions.programId, a.programId));
    await award({ userId: owner, locationId: a.locationId, membershipId: card.id, purchaseAmountMinor: 4_250, ruleVersionId: rule.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
    for (const actor of [owner, manager]) {
      const json = JSON.stringify(await getLocationAnalytics(actor, { locationId: a.locationId }));
      for (const forbidden of ["Minor", "currency", "EUR", "4250", "42,50", card.id, card.cardToken, card.scanCode, "@example.test"]) expect(json).not.toContain(forbidden);
    }
  });
});
