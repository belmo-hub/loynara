import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, programs, staffRoles } from "@/db/schema";
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
    expect((await getLocationAnalytics(owner, { locationId: b.locationId, asOf })).current).toEqual({ newCards: 1, qualifyingCheckouts: 1, repeatCards: 0 });
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
    expect(report.current).toEqual({ newCards: 1, qualifyingCheckouts: 1, repeatCards: 0 });
    expect(report.previous).toEqual({ newCards: 0, qualifyingCheckouts: 2, repeatCards: 1 });
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
