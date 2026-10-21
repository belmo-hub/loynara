import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, programs } from "@/db/schema";
import { award, redeem, reverseEntry } from "./loyalty";
import { getMerchantMember } from "./merchant-members";
import { createMerchant, enroll, getCard, getPublicProgram, updateProgramExtras } from "./product";
import { addMonths } from "./points-expiry-rules";
import { expireCardPoints, queueExpiryReminders, runPointsExpiry } from "./points-expiry";
import { credentialHash } from "./wallet/data";
import { setWalletConsent } from "./wallet-messages";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Integration tests require looplocal_test");

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

async function user() {
  const id = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic staff", `${id}@example.test`]);
  return id;
}
async function shop(programType: "points" | "stamp" = "points", name = "Synthetic Pizzeria") {
  const owner = await user();
  const merchant = await createMerchant({ userId: owner, businessName: name, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Pizzakarte", programType, rulesText: "Punkte für jeden bestätigten Besuch.", rewardTitle: "Pizza gratis", rewardCost: 100 });
  return { owner, ...merchant };
}
type Shop = Awaited<ReturnType<typeof shop>>;
const give = (s: Shop, membershipId: string, quantity: number) => award({ userId: s.owner, locationId: s.locationId, membershipId, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
const balanceOf = async (membershipId: string) => (await db.select({ balance: memberships.balance }).from(memberships).where(eq(memberships.id, membershipId)))[0].balance;
const expiryRows = (membershipId: string) => db.select().from(ledgerEntries).where(and(eq(ledgerEntries.membershipId, membershipId), eq(ledgerEntries.kind, "expiry")));
const entryTime = async (entryId: string) => (await db.select({ at: ledgerEntries.createdAt }).from(ledgerEntries).where(eq(ledgerEntries.id, entryId)))[0].at;
const setExpiry = (s: Shop, months: 6 | 12 | 24 | null, actorUserId = s.owner) => updateProgramExtras({ actorUserId, programId: s.programId, pointsExpiryMonths: months });

describe("points expiry setting", () => {
  it("is off by default: nothing expires and the card shows no rule", async () => {
    const s = await shop();
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await give(s, card.id, 40);
    expect(await runPointsExpiry(addMonths(new Date(), 60))).toBe(0);
    expect(await balanceOf(card.id)).toBe(40);
    expect((await getCard(card.cardToken)).pointsExpiry).toBeUndefined();
  });

  it("is the owner's alone, for points programmes only, and shown before the first visit", async () => {
    const s = await shop();
    const other = await shop("points", "Other Synthetic Shop");
    const cashier = await user();
    await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'cashier', $3)", [s.tenantId, cashier, s.locationId]);
    const manager = await user();
    await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'manager', $3)", [s.tenantId, manager, s.locationId]);
    await expect(setExpiry(s, 12, cashier)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setExpiry(s, 12, manager)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setExpiry(s, 12, other.owner)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateProgramExtras({ actorUserId: s.owner, programId: s.programId, pointsExpiryMonths: 3 as 6 })).rejects.toThrow();
    const stamps = await shop("stamp", "Synthetic Barber");
    await expect(setExpiry(stamps, 12)).rejects.toMatchObject({ code: "INVALID_POINTS_EXPIRY" });

    expect(await setExpiry(s, 12)).toMatchObject({ pointsExpiryMonths: 12 });
    const rule = "Punkte verfallen 12 Monate nach dem Sammeln, die ältesten zuerst.";
    expect((await getPublicProgram(s.programSlug)).pointsExpiryRule).toBe(rule);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    expect((await getCard(card.cardToken)).pointsExpiry).toEqual({ rule, notice: undefined });
    // The other shop is untouched.
    expect((await getPublicProgram(other.programSlug)).pointsExpiryRule).toBeUndefined();
  });
});

describe("the expiry job", () => {
  it("books a labelled ledger row exactly at the expiry instant, once", async () => {
    const s = await shop();
    await setExpiry(s, 6);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const first = await give(s, card.id, 40);
    const due = addMonths(await entryTime(first.entryId), 6);

    expect(await expireCardPoints(card.id, new Date(due.getTime() - 1))).toBe(0);
    expect(await expireCardPoints(card.id, due)).toBe(40);
    expect(await expireCardPoints(card.id, new Date(due.getTime() + 60_000))).toBe(0);
    expect(await runPointsExpiry(new Date(due.getTime() + 120_000))).toBe(0);

    const [row] = await expiryRows(card.id);
    expect(row).toMatchObject({ kind: "expiry", source: "expiry", delta: -40, actorUserId: null, locationId: s.locationId, tenantId: s.tenantId, reason: "Punkte verfallen", idempotencyKey: `expiry:${card.id}:${due.toISOString()}` });
    expect(await expiryRows(card.id)).toHaveLength(1);
    expect(await balanceOf(card.id)).toBe(0);
    expect((await getCard(card.cardToken)).activity.map(entry => entry.kind)).toEqual(["expiry", "award"]);
  });

  it("never expires points earned before the rule was switched on or changed", async () => {
    const s = await shop();
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await give(s, card.id, 30);
    await setExpiry(s, 6);
    const after = await give(s, card.id, 20);
    // Changing the period restarts it: the 20 points keep their 6-month promise only until the change, then never expire.
    await setExpiry(s, 24);
    const late = await give(s, card.id, 10);
    const far = addMonths(await entryTime(after.entryId), 12);
    expect(await expireCardPoints(card.id, far)).toBe(0);
    expect(await expireCardPoints(card.id, addMonths(await entryTime(late.entryId), 24))).toBe(10);
    expect(await balanceOf(card.id)).toBe(50);
  });

  it("uses up the oldest points first when a reward is redeemed", async () => {
    const s = await shop();
    await setExpiry(s, 6);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const old = await give(s, card.id, 50);
    await give(s, card.id, 80);
    const [reward] = (await getCard(card.cardToken)).rewards;
    await redeem({ userId: s.owner, locationId: s.locationId, membershipId: card.id, rewardVersionId: reward.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
    // 100 redeemed: the 50 old points and 50 of the newer ones; 30 newer points are left and none of them is due yet.
    expect(await expireCardPoints(card.id, addMonths(await entryTime(old.entryId), 6))).toBe(0);
    expect(await balanceOf(card.id)).toBe(30);
  });

  it("gives expired points back through an ordinary correction, which the job then leaves alone", async () => {
    const s = await shop();
    await setExpiry(s, 6);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const first = await give(s, card.id, 40);
    const due = addMonths(await entryTime(first.entryId), 6);
    await expireCardPoints(card.id, due);
    const [row] = await expiryRows(card.id);
    const manager = await user();
    await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'manager', $3)", [s.tenantId, manager, s.locationId]);
    const reversal = await reverseEntry({ userId: manager, locationId: s.locationId, entryId: row.id, reason: "Kulanz nach Rückfrage des Gastes", idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect(reversal.balance).toBe(40);
    // Points given back count as earned at the correction: nothing is due again right after it.
    expect(await expireCardPoints(card.id, new Date())).toBe(0);
    await expect(reverseEntry({ userId: manager, locationId: s.locationId, entryId: row.id, reason: "Kulanz nach Rückfrage des Gastes", idempotencyKey: randomUUID(), requestId: randomUUID() })).rejects.toMatchObject({ code: "ALREADY_REVERSED" });
  });

  it("rejects client keys in the expiry namespace", async () => {
    const s = await shop();
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await expect(award({ userId: s.owner, locationId: s.locationId, membershipId: card.id, quantity: 1, idempotencyKey: `expiry:${card.id}:x`, requestId: randomUUID() })).rejects.toMatchObject({ code: "INVALID_KEY" });
  });

  it("is not a visit and not a redemption in the owner's numbers, and stays inside its shop", async () => {
    const s = await shop();
    const other = await shop("points", "Other Synthetic Shop");
    await setExpiry(s, 6);
    await setExpiry(other, 24);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const neighbour = await enroll({ slug: other.programSlug, acceptedTerms: true });
    const first = await give(s, card.id, 40);
    await give(other, neighbour.id, 40);
    await runPointsExpiry(addMonths(await entryTime(first.entryId), 6));
    expect(await balanceOf(card.id)).toBe(0);
    expect(await balanceOf(neighbour.id)).toBe(40);
    expect(await expiryRows(neighbour.id)).toEqual([]);
    const detail = await getMerchantMember(s.owner, card.id);
    expect(detail.member).toMatchObject({ qualifyingCheckouts: 1, redemptionCount: 0 });
    await expect(getMerchantMember(other.owner, card.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("books nothing for an ended programme", async () => {
    const s = await shop();
    await setExpiry(s, 6);
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const first = await give(s, card.id, 40);
    await db.update(programs).set({ status: "ended" }).where(eq(programs.id, s.programId));
    expect(await runPointsExpiry(addMonths(await entryTime(first.entryId), 7))).toBe(0);
    expect(await balanceOf(card.id)).toBe(40);
  });
});

describe("the 30-day reminder", () => {
  async function applePass(s: Shop, card: { id: string; cardToken: string }, consent: boolean) {
    const { rows: [m] } = await pool.query("SELECT scan_code FROM memberships WHERE id = $1", [card.id]);
    const passId = randomUUID();
    await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, credential_hash, status) VALUES ($1,$2,$3,'apple',$4,$5,'created')",
      [passId, s.tenantId, card.id, `passfast:${passId}`, credentialHash(m.scan_code)]);
    if (consent) await setWalletConsent(card.cardToken, true);
  }

  it("goes to consented Wallet holders once per 30 days; everyone sees it on the card", async () => {
    const s = await shop();
    await setExpiry(s, 6);
    const consented = await enroll({ slug: s.programSlug, acceptedTerms: true });
    const silent = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await applePass(s, consented, true);
    await applePass(s, silent, false);
    const first = await give(s, consented.id, 80);
    await give(s, silent.id, 80);
    const due = addMonths(await entryTime(first.entryId), 6);
    const reminderAt = new Date(due.getTime() - 20 * 86_400_000);

    expect(await queueExpiryReminders(new Date(due.getTime() - 31 * 86_400_000))).toBe(0);
    expect(await queueExpiryReminders(reminderAt)).toBe(1);
    expect(await queueExpiryReminders(new Date(reminderAt.getTime() + 86_400_000))).toBe(0);
    const { rows } = await pool.query("SELECT m.kind, m.text, m.sent_by_user_id, r.membership_id FROM wallet_messages m JOIN wallet_message_recipients r ON r.message_id = m.id");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "expiry", sent_by_user_id: null, membership_id: consented.id });
    expect(rows[0].text).toMatch(/^Ab dem \d{2}\.\d{2}\.\d{4} verfallen 80 Punkte auf deiner Karte\. Löse sie vorher ein\.$/);
    const { rows: jobs } = await pool.query("SELECT kind FROM outbox_jobs WHERE kind = 'wallet.message'");
    expect(jobs).toHaveLength(1);
  });

  it("shows the notice on the card within 30 days of the first expiry", async () => {
    const s = await shop();
    const card = await enroll({ slug: s.programSlug, acceptedTerms: true });
    await setExpiry(s, 6);
    const { cardExpiry } = await import("./points-expiry");
    const first = await give(s, card.id, 25);
    const due = addMonths(await entryTime(first.entryId), 6);
    const [program] = await db.select().from(programs).where(eq(programs.id, s.programId));
    expect((await cardExpiry(db, s.tenantId, card.id, program, "Europe/Berlin", new Date(due.getTime() - 31 * 86_400_000)))?.notice).toBeUndefined();
    expect((await cardExpiry(db, s.tenantId, card.id, program, "Europe/Berlin", new Date(due.getTime() - 29 * 86_400_000)))?.notice).toMatch(/verfallen 25 Punkte/);
  });
});
