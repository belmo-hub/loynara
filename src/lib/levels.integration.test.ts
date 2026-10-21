import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries } from "@/db/schema";
import { award, reverseEntry } from "./loyalty";
import { createMerchant, enroll, getCard, lookupCard, updateProgramExtras } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
async function shop(name = "Synthetic Barber") {
  const owner = await user();
  return { owner, ...(await createMerchant({ userId: owner, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Karte", programType: "stamp", rulesText: "Ein Stempel pro bestätigtem Besuch.", rewardTitle: "Haarschnitt gratis", rewardCost: 10 })) };
}
type Shop = Awaited<ReturnType<typeof shop>>;
async function staff(s: Shop, role: "cashier" | "manager") {
  const id = await user();
  await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, $3, $4)", [s.tenantId, id, role, s.locationId]);
  return id;
}
/** A confirmed visit `ago` before now (an interval like '89 days 23 hours'); returns its ledger id. */
async function visitAgo(s: Shop, membershipId: string, ago: string, source = "staff_online") {
  const { rows: [row] } = await pool.query<{ id: string }>(`INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, created_at)
    VALUES ($1, $2, $3, 1, 'award', $4, $5, gen_random_uuid(), $6, now() - $7::interval) RETURNING id`,
    [s.tenantId, s.locationId, membershipId, source, source === "nfc_tap" ? null : s.owner, `synthetic-${randomUUID()}`, ago]);
  await pool.query("UPDATE memberships SET balance = balance + 1 WHERE id = $1", [membershipId]);
  return row.id;
}
const levels = (s: Shop, patch: Partial<Parameters<typeof updateProgramExtras>[0]> = {}, actorUserId = s.owner) =>
  updateProgramExtras({ actorUserId, programId: s.programId, levelsEnabled: true, levelSilverVisits: 3, levelGoldVisits: 5, levelBronzePerk: "", levelSilverPerk: "Kaffee aufs Haus", levelGoldPerk: "Bart gratis", ...patch });
const levelOf = async (token: string) => (await getCard(token)).level;
/** The Berlin date `days` from now, as the card writes it. */
const inDays = (days: number) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }).format(new Date(Date.now() + days * 86_400_000));

describe("level settings", () => {
  it("are off by default: no level on the card or at the counter", async () => {
    const s = await shop();
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await visitAgo(s, card.id, "1 day");
    expect(await levelOf(card.cardToken)).toBeUndefined();
    expect((await lookupCard({ userId: s.owner, locationId: s.locationId, scanCode: card.scanCode })).level).toBeUndefined();
  });

  it("have no silent default thresholds: switching on needs both", async () => {
    const s = await shop();
    await expect(updateProgramExtras({ actorUserId: s.owner, programId: s.programId, levelsEnabled: true })).rejects.toMatchObject({ code: "INVALID_LEVELS" });
    await expect(updateProgramExtras({ actorUserId: s.owner, programId: s.programId, levelsEnabled: true, levelSilverVisits: 3 })).rejects.toMatchObject({ code: "INVALID_LEVELS" });
    expect(await updateProgramExtras({ actorUserId: s.owner, programId: s.programId, levelsEnabled: true, levelSilverVisits: 3, levelGoldVisits: 6 })).toMatchObject({ levelsEnabled: true, levelSilverVisits: 3, levelGoldVisits: 6 });
  });

  it("are the owner's alone, with Gold above Silber and short plain perks", async () => {
    const s = await shop();
    const other = await shop("Other Synthetic Shop");
    await expect(levels(s, {}, await staff(s, "cashier"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(levels(s, {}, await staff(s, "manager"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(levels(s, {}, other.owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(levels(s, { levelSilverVisits: 5, levelGoldVisits: 5 })).rejects.toMatchObject({ code: "INVALID_LEVELS" });
    await expect(levels(s, { levelGoldPerk: "Mehr auf www.example.de" })).rejects.toMatchObject({ code: "INVALID_LEVELS" });
    await expect(levels(s, { levelGoldPerk: "x".repeat(61) })).rejects.toMatchObject({ code: "INVALID_LEVELS" });
    expect(await levels(s, { levelGoldPerk: "x".repeat(60) })).toMatchObject({ levelsEnabled: true, levelSilverVisits: 3, levelGoldVisits: 5 });
  });
});

describe("levels", () => {
  it("move from none to Bronze, Silber and Gold at the thresholds, and show the perk to the customer and the cashier", async () => {
    const s = await shop();
    await levels(s);
    const cashier = await staff(s, "cashier");
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    expect(await levelOf(card.cardToken)).toEqual({ name: null, perk: undefined, until: undefined, visits: 0, next: { name: "Silber", visits: 3 } });
    await visitAgo(s, card.id, "10 days");
    expect(await levelOf(card.cardToken)).toEqual({ name: "Bronze", perk: undefined, until: inDays(80), visits: 1, next: { name: "Silber", visits: 2 } });
    await visitAgo(s, card.id, "9 days");
    expect((await levelOf(card.cardToken))?.name).toBe("Bronze");
    await visitAgo(s, card.id, "8 days");
    expect(await levelOf(card.cardToken)).toEqual({ name: "Silber", perk: "Kaffee aufs Haus", until: inDays(80), visits: 3, next: { name: "Gold", visits: 2 } });
    await visitAgo(s, card.id, "7 days");
    await award({ userId: cashier, locationId: s.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(await levelOf(card.cardToken)).toEqual({ name: "Gold", perk: "Bart gratis", until: inDays(80), visits: 5, next: null });
    expect((await lookupCard({ userId: cashier, locationId: s.locationId, scanCode: card.scanCode })).level).toMatchObject({ name: "Gold", perk: "Bart gratis" });
    // A perk is never booked: the card holds exactly the five visits.
    expect((await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, card.id))).map(row => row.source).sort()).toEqual(Array(5).fill("staff_online"));
  });

  it("count visit days inside the last 90 days only", async () => {
    const s = await shop();
    await levels(s, { levelSilverVisits: 2, levelGoldVisits: 3 });
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await visitAgo(s, card.id, "90 days 1 minute");
    expect((await levelOf(card.cardToken))?.visits).toBe(0);
    await visitAgo(s, card.id, "89 days 23 hours");
    expect((await levelOf(card.cardToken))?.visits).toBe(1);
  });

  it("count days, not bookings, and only cashier-confirmed, uncorrected visits", async () => {
    const s = await shop();
    await levels(s, { levelSilverVisits: 2, levelGoldVisits: 3 });
    await updateProgramExtras({ actorUserId: s.owner, programId: s.programId, welcomeBonus: 2 });
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await award({ userId: s.owner, locationId: s.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await award({ userId: s.owner, locationId: s.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await visitAgo(s, card.id, "3 days", "nfc_tap");
    expect(await levelOf(card.cardToken)).toMatchObject({ name: "Bronze", visits: 1 });
    const corrected = await visitAgo(s, card.id, "2 days");
    expect(await levelOf(card.cardToken)).toMatchObject({ name: "Silber", visits: 2 });
    await reverseEntry({ userId: s.owner, locationId: s.locationId, entryId: corrected, reason: "Falsche Karte gestempelt", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(await levelOf(card.cardToken)).toMatchObject({ name: "Bronze", visits: 1 });
  });

  it("stay inside their shop", async () => {
    const s = await shop();
    const other = await shop("Other Synthetic Shop");
    await levels(s, { levelSilverVisits: 2, levelGoldVisits: 3 });
    await levels(other, { levelSilverVisits: 2, levelGoldVisits: 3 });
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const neighbour = await enroll({ slug: other.programSlug, acceptedTerms: true });
    await visitAgo(s, card.id, "2 days");
    await visitAgo(s, card.id, "1 day");
    expect((await levelOf(card.cardToken))?.name).toBe("Silber");
    expect((await levelOf(neighbour.cardToken))?.name).toBeNull();
    await expect(lookupCard({ userId: other.owner, locationId: other.locationId, scanCode: card.scanCode })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
