import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, programRuleVersions, programs, purchaseAwards, tapRequests } from "@/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster, type TapKeyProvider } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { activateSecureTag, cancelTapRequest, confirmTapRequest, pendingTapRequests, previewSecureTap, processSecureTap, provisionSecureTag, secureTapStatus, setTapPolicy } from "./secure-tap";

// NFC taps for points programmes: the tap only opens a request; the cashier enters the purchase amount (or the points)
// and confirms, under the same rules as a counter award. Nothing is booked before that, and never automatically.

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const provider: TapKeyProvider = new DerivedTapKeyProvider(VERIFY);
const T0 = new Date("2026-10-19T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

type Fx = Awaited<ReturnType<typeof nfcFixture>>;
/** The points merchant with a registered, active counter tag, its current rule version and one cashier. */
async function pointsShop(mode: "purchase" | "manual" = "purchase") {
  const f = await nfcFixture({ points: mode, tapMode: "disabled" });
  await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "staff_confirmed", cooldownSeconds: 60 });
  const c = await register(f);
  const [rule] = await db.select().from(programRuleVersions).where(eq(programRuleVersions.programId, f.program.id));
  const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
  return { ...f, ...c, ruleVersionId: rule.id, cashier };
}
async function register(f: Fx) {
  const uid = `04${randomBytes(6).toString("hex")}`;
  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const publicRef = randomBytes(18).toString("base64url");
  const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1, publicRef });
  await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid });
  return { publicRef, tap: (counter: number, now = at(0)) => ({ tagRef: publicRef, fields: sdmFor({ uid, counter, keys }), keyProvider: provider, cardToken: f.member.cardToken, now }) };
}
const entries = (membershipId: string) => db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, membershipId));
const balance = async (membershipId: string) => (await db.select().from(memberships).where(eq(memberships.id, membershipId)))[0].balance;
const requestStatus = async (id: string) => (await db.select().from(tapRequests).where(eq(tapRequests.id, id)))[0].status;

describe("NFC tap for a points programme", () => {
  it("enables staff-confirmed tap and a tag, refuses automatic tap, and shows the cashier what the entry needs", async () => {
    const f = await nfcFixture({ points: "purchase", tapMode: "disabled" });
    await expect(setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "automatic_fixed", cooldownSeconds: 60 })).rejects.toMatchObject({ code: "INVALID_TAP_POLICY" });
    expect(await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "staff_confirmed", cooldownSeconds: 60 })).toEqual({ mode: "staff_confirmed", cooldownSeconds: 60 });
    const c = await register(f);
    expect(await previewSecureTap(c.tap(2))).toMatchObject({ mode: "staff_confirmed", programType: "points", hasMembership: true });
    const pending = await processSecureTap(c.tap(2));
    expect(pending.state).toBe("pending_staff");
    const [rule] = await db.select().from(programRuleVersions).where(eq(programRuleVersions.programId, f.program.id));
    expect(await pendingTapRequests({ userId: f.userId, locationId: f.location.id, now: at(1) })).toEqual([expect.objectContaining({ id: pending.requestId, programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, currency: "EUR", ruleVersionId: rule.id })]);
    expect(await entries(f.member.id)).toHaveLength(0);
  });

  it("books nothing until the cashier confirms the entered amount, then exactly the reviewed points through the staff ledger", async () => {
    const s = await pointsShop();
    const pending = await processSecureTap(s.tap(2));
    expect(pending).toMatchObject({ state: "pending_staff", balance: 0 });
    expect(await secureTapStatus({ tagRef: s.publicRef, requestId: pending.requestId!, cardToken: s.member.cardToken, now: at(5) })).toMatchObject({ state: "pending_staff", balance: 0 });
    // the stamp confirmation (no amount) cannot book a points request
    await expect(confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, now: at(10) })).rejects.toMatchObject({ code: "INVALID_EARNING_MODE" });
    expect(await entries(s.member.id)).toHaveLength(0);

    const confirmed = await confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award: { purchaseAmountMinor: 1670, ruleVersionId: s.ruleVersionId }, now: at(20) });
    expect(confirmed).toMatchObject({ state: "confirmed", balance: 16 });
    const [entry] = await entries(s.member.id);
    expect(entry).toMatchObject({ delta: 16, kind: "award", source: "staff_online", actorUserId: s.cashier, idempotencyKey: expect.stringMatching(/^tap:/) });
    expect((await db.select().from(purchaseAwards).where(eq(purchaseAwards.ledgerEntryId, entry.id)))[0]).toMatchObject({ amountMinor: 1670, pointsAwarded: 16, ruleVersionId: s.ruleVersionId });
    expect(await requestStatus(pending.requestId!)).toBe("confirmed");
    // the waiting guest page learns the booked points
    expect(await secureTapStatus({ tagRef: s.publicRef, requestId: pending.requestId!, cardToken: s.member.cardToken, now: at(21) })).toMatchObject({ state: "confirmed", balance: 16, credited: 16 });
  });

  it("Ablehnen books nothing, and the rejected request can no longer be confirmed", async () => {
    const s = await pointsShop();
    const pending = await processSecureTap(s.tap(2));
    expect(await cancelTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId! })).toEqual({ state: "cancelled" });
    await expect(confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award: { purchaseAmountMinor: 1000, ruleVersionId: s.ruleVersionId }, now: at(10) })).rejects.toMatchObject({ code: "TAP_EXPIRED" });
    expect(await entries(s.member.id)).toHaveLength(0);
    expect(await balance(s.member.id)).toBe(0);
    expect((await secureTapStatus({ tagRef: s.publicRef, requestId: pending.requestId!, cardToken: s.member.cardToken, now: at(11) })).state).toBe("cancelled");
  });

  it("a replayed confirmation or tap books nothing more; a replay with another amount is refused as a reused key", async () => {
    const s = await pointsShop();
    const pending = await processSecureTap(s.tap(2));
    const award = { purchaseAmountMinor: 2500, ruleVersionId: s.ruleVersionId };
    await confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award, now: at(10) });
    expect(await confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award, now: at(11) })).toMatchObject({ state: "already_processed" });
    await expect(confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award: { purchaseAmountMinor: 9900, ruleVersionId: s.ruleVersionId }, now: at(12) })).rejects.toMatchObject({ code: "KEY_REUSED" });
    expect((await processSecureTap(s.tap(2, at(13)))).state).toBe("confirmed");   // the same tap URL again
    expect((await entries(s.member.id)).map(entry => entry.delta)).toEqual([25]);
    expect(await balance(s.member.id)).toBe(25);
  });

  it("two staff confirming the same request at once with different amounts: one booking, nothing doubled", async () => {
    const s = await pointsShop();
    const pending = await processSecureTap(s.tap(2));
    const results = await Promise.allSettled([
      confirmTapRequest({ userId: s.userId, locationId: s.location.id, requestId: pending.requestId!, award: { purchaseAmountMinor: 1200, ruleVersionId: s.ruleVersionId }, now: at(10) }),
      confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award: { purchaseAmountMinor: 3400, ruleVersionId: s.ruleVersionId }, now: at(10) }),
    ]);
    expect(results.filter(result => result.status === "fulfilled" && result.value.state === "confirmed")).toHaveLength(1);
    const loser = results.find(result => !(result.status === "fulfilled" && result.value.state === "confirmed"))!;
    expect(loser).toMatchObject({ status: "rejected", reason: { code: "KEY_REUSED" } });
    const rows = await entries(s.member.id);
    expect(rows).toHaveLength(1);
    expect([12, 34]).toContain(rows[0].delta);
    expect(await balance(s.member.id)).toBe(rows[0].delta);
  });

  it("deliberate breaks: an amount above the cashier's limit or a tampered entry books nothing and leaves the request open", async () => {
    const s = await pointsShop();
    const pending = await processSecureTap(s.tap(2));
    const confirm = (award: Parameters<typeof confirmTapRequest>[0]["award"]) => confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award, now: at(10) });
    await expect(confirm({ purchaseAmountMinor: 50_001, ruleVersionId: s.ruleVersionId })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });   // cashier limit 500 €
    await expect(confirm({ purchaseAmountMinor: -500, ruleVersionId: s.ruleVersionId })).rejects.toMatchObject({ code: "INVALID_PURCHASE_AMOUNT" });
    await expect(confirm({ purchaseAmountMinor: 99, ruleVersionId: s.ruleVersionId })).rejects.toMatchObject({ code: "NO_POINTS" });
    await expect(confirm({ quantity: 400 })).rejects.toMatchObject({ code: "INVALID_EARNING_MODE" });   // points typed into a purchase programme
    await expect(confirm({ purchaseAmountMinor: 1000, ruleVersionId: s.member.id })).rejects.toMatchObject({ code: "STALE_RULE" });
    expect(await entries(s.member.id)).toHaveLength(0);
    expect(await requestStatus(pending.requestId!)).toBe("pending_staff");
    // the owner may book what the cashier may not
    expect(await confirmTapRequest({ userId: s.userId, locationId: s.location.id, requestId: pending.requestId!, award: { purchaseAmountMinor: 50_001, ruleVersionId: s.ruleVersionId }, now: at(11) })).toMatchObject({ state: "confirmed", balance: 500 });
  });

  it("a manual points programme takes the points the cashier types, within the cashier's limit", async () => {
    const s = await pointsShop("manual");
    const pending = await processSecureTap(s.tap(2));
    const confirm = (award: Parameters<typeof confirmTapRequest>[0]["award"]) => confirmTapRequest({ userId: s.cashier, locationId: s.location.id, requestId: pending.requestId!, award, now: at(10) });
    await expect(confirm({ quantity: 11 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });   // cashier limit 10
    await expect(confirm({ quantity: 2.5 })).rejects.toMatchObject({ code: "INVALID_QUANTITY" });
    await expect(confirm({ purchaseAmountMinor: 1000, ruleVersionId: s.ruleVersionId })).rejects.toMatchObject({ code: "INVALID_EARNING_MODE" });
    expect(await confirm({ quantity: 7 })).toMatchObject({ state: "confirmed", balance: 7 });
    expect((await entries(s.member.id)).map(entry => entry.delta)).toEqual([7]);
  });

  it("a stamp tap stays one fixed stamp: an amount sent with it is refused", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const pending = await processSecureTap(c.tap(2));
    await expect(confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId!, award: { quantity: 5 }, now: at(10) })).rejects.toMatchObject({ code: "INVALID_EARNING_MODE" });
    expect(await confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId!, now: at(11) })).toMatchObject({ state: "confirmed", balance: 1 });
  });

  it("never books points automatically, even if a programme still carries an automatic tap setting", async () => {
    const s = await pointsShop();
    await db.update(programs).set({ tapMode: "automatic_fixed" }).where(eq(programs.id, s.program.id));
    const result = await processSecureTap(s.tap(2));
    expect(result.state).toBe("pending_staff");
    expect(await entries(s.member.id)).toHaveLength(0);
  });
});
