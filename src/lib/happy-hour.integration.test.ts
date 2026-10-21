import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, programRuleVersions, programs, staffRoles } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, getCard, updateProgram, updateProgramHappyHour } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { process.env.PUBLIC_BASE_URL = "http://localhost:3000"; await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
// A points shop that earns by purchase amount: 2 points per euro, so 5.00 EUR is 10 points.
async function shop(userId: string, type: "stamp" | "points" = "points") {
  const merchant = await createMerchant({ userId, businessName: "Synthetic Happy Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Punktekarte", programType: type, rulesText: "Punkte pro Euro.", rewardTitle: "Kaffee gratis", rewardCost: 100 });
  if (type === "points") await updateProgram({ actorUserId: userId, programSlug: merchant.programSlug, name: "Punktekarte", rulesText: "Zwei Punkte pro Euro.", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 2 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  return { ...merchant, card };
}
const buy = async (userId: string, m: Awaited<ReturnType<typeof shop>>, key: string = randomUUID()) => {
  const [rule] = await db.select().from(programRuleVersions).where(eq(programRuleVersions.programId, m.programId)).orderBy(desc(programRuleVersions.version)).limit(1);
  return award({ userId, locationId: m.locationId, membershipId: m.card.id, purchaseAmountMinor: 500, ruleVersionId: rule.id, idempotencyKey: key, requestId: randomUUID() });
};
const rows = (membershipId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, membershipId)).orderBy(ledgerEntries.createdAt);
const balanceOf = async (id: string) => (await db.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, id)))[0].balance;
const allDay = { days: [1, 2, 3, 4, 5, 6, 7], start: "00:00", end: "24:00" };
const today = () => ({ Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 })[new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", weekday: "short" }).format(new Date()) as "Mon"];
const on = (owner: string, m: { programId: string }, windows: unknown[] = [allDay]) => updateProgramHappyHour({ actorUserId: owner, programId: m.programId, happyHourEnabled: true, happyHourWindows: windows });

describe("happy hour", () => {
  it("is off by default: a purchase books only itself", async () => {
    const owner = await user(); const m = await shop(owner);
    expect(await buy(owner, m)).toMatchObject({ balance: 10, creditedQuantity: 10 });
    expect((await rows(m.card.id)).map(r => r.source)).toEqual(["staff_online"]);
  });

  it("books a second labelled row in the same transaction while a window is running, and it is no visit", async () => {
    const owner = await user(); const m = await shop(owner);
    await on(owner, m);
    const first = await buy(owner, m);
    expect(first).toMatchObject({ balance: 20, creditedQuantity: 10 });
    const [purchase, extra] = await rows(m.card.id);
    expect(extra).toMatchObject({ kind: "award", source: "happy_hour", delta: 10, reason: "Happy Hour", actorUserId: owner, idempotencyKey: `happyhour:${purchase.id}`, requestId: purchase.requestId });
    expect(await balanceOf(m.card.id)).toBe(20);
    // A replay of the purchase books nothing more.
    expect(await buy(owner, m, purchase.idempotencyKey)).toMatchObject({ duplicate: true, balance: 20 });
    expect(await rows(m.card.id)).toHaveLength(2);
    // One visit, one purchase: the extra row is neither.
    expect((await getMerchantMember(owner, m.card.id)).member).toMatchObject({ qualifyingCheckouts: 1 });
    const view = await getCard(m.card.cardToken);
    expect(view.happyHourUntil).toBe("24:00");
    expect(view.activity.filter(a => a.isHappyHour).map(a => a.delta)).toEqual([10]);
  });

  it("books nothing outside the windows, with the switch off, and shows no line on the card", async () => {
    const owner = await user(); const m = await shop(owner);
    await on(owner, m, [{ days: [1, 2, 3, 4, 5, 6, 7].filter(d => d !== today()), start: "00:00", end: "24:00" }]);
    expect(await buy(owner, m)).toMatchObject({ balance: 10 });
    expect((await getCard(m.card.cardToken)).happyHourUntil).toBeUndefined();
    await updateProgramHappyHour({ actorUserId: owner, programId: m.programId, happyHourEnabled: false, happyHourWindows: [allDay] });
    expect(await buy(owner, m)).toMatchObject({ balance: 20 });
    expect((await rows(m.card.id)).map(r => r.source)).toEqual(["staff_online", "staff_online"]);
  });

  it("is reversed together with its award and cannot be corrected on its own", async () => {
    const owner = await user(); const m = await shop(owner);
    await on(owner, m);
    const { entryId } = await buy(owner, m);
    const [, extra] = await rows(m.card.id);
    await expect(reverseEntry({ userId: owner, locationId: m.locationId, entryId: extra.id, reason: "Nur die Happy Hour zurück", idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "HAPPY_HOUR_WITH_AWARD" });
    expect(await reverseEntry({ userId: owner, locationId: m.locationId, entryId, reason: "Versehentlich gebucht", idempotencyKey: randomUUID(), requestId: randomUUID() })).toMatchObject({ balance: 0 });
    const reversals = (await rows(m.card.id)).filter(r => r.kind === "reversal");
    expect(reversals.map(r => [r.reversalOfId, r.delta])).toEqual(expect.arrayContaining([[entryId, -10], [extra.id, -10]]));
    expect(reversals.find(r => r.reversalOfId === extra.id)!.idempotencyKey).toBe(`happyhour-reversal:${entryId}`);
    expect(await balanceOf(m.card.id)).toBe(0);
  });

  it("gives a stamp programme nothing, even when the flag is forced on, and refuses to switch it on", async () => {
    const owner = await user(); const m = await shop(owner, "stamp");
    await expect(on(owner, m)).rejects.toMatchObject({ code: "INVALID_HAPPY_HOUR" });
    await db.update(programs).set({ happyHourEnabled: true, happyHourWindows: [allDay] }).where(eq(programs.id, m.programId));
    expect(await award({ userId: owner, locationId: m.locationId, membershipId: m.card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() })).toMatchObject({ balance: 1 });
    expect((await rows(m.card.id)).map(r => r.source)).toEqual(["staff_online"]);
    expect((await getCard(m.card.cardToken)).happyHourUntil).toBeUndefined();
  });

  it("gives a points programme with manual quantities nothing", async () => {
    const owner = await user(); const m = await shop(owner);
    await on(owner, m);
    await updateProgram({ actorUserId: owner, programSlug: m.programSlug, name: "Punktekarte", rulesText: "Punkte von Hand.", programType: "points", earningMode: "manual" });
    expect(await award({ userId: owner, locationId: m.locationId, membershipId: m.card.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() })).toMatchObject({ balance: 5 });
    expect((await getCard(m.card.cardToken)).happyHourUntil).toBeUndefined();
  });

  it("is owner-only and tenant-scoped", async () => {
    const owner = await user(); const m = await shop(owner);
    const otherOwner = await user(); await shop(otherOwner);
    await expect(on(otherOwner, m)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const cashier = await user();
    const [tenantRow] = await db.select({ tenantId: programs.tenantId }).from(programs).where(eq(programs.id, m.programId));
    await db.insert(staffRoles).values({ tenantId: tenantRow.tenantId, userId: cashier, role: "cashier", locationId: m.locationId });
    await expect(on(cashier, m)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.select().from(programs).where(eq(programs.id, m.programId)))[0]).toMatchObject({ happyHourEnabled: false, happyHourWindows: [] });
  });

  it("refuses windows across midnight, a fourth window, an empty switch-on, and the database backs the limits", async () => {
    const owner = await user(); const m = await shop(owner);
    await expect(on(owner, m, [{ days: [5], start: "22:00", end: "02:00" }])).rejects.toMatchObject({ code: "INVALID_HAPPY_HOUR" });
    await expect(on(owner, m, [allDay, allDay, allDay, allDay])).rejects.toThrow();
    await expect(on(owner, m, [])).rejects.toMatchObject({ code: "INVALID_HAPPY_HOUR" });
    await expect(db.update(programs).set({ happyHourEnabled: true }).where(eq(programs.id, m.programId))).rejects.toThrow();
    await expect(db.update(programs).set({ happyHourWindows: [allDay, allDay, allDay, allDay] }).where(eq(programs.id, m.programId))).rejects.toThrow();
  });

  it("refuses client keys in the happy-hour namespaces, and a type change switches it off", async () => {
    const owner = await user(); const m = await shop(owner);
    for (const key of ["happyhour:abcdefgh", "happyhour-reversal:abcdefgh"]) {
      await expect(buy(owner, m, key)).rejects.toMatchObject({ code: "INVALID_KEY" });
    }
    expect(await rows(m.card.id)).toEqual([]);
    await on(owner, m);
    await updateProgram({ actorUserId: owner, programSlug: m.programSlug, name: "Stempelkarte", rulesText: "Ein Stempel.", programType: "stamp", earningMode: "manual" });
    expect((await db.select().from(programs).where(and(eq(programs.id, m.programId))))[0]).toMatchObject({ happyHourEnabled: false });
  });
});
