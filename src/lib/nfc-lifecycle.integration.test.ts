import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, programs, secureTags, tapRequests } from "@/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster, type TapKeyProvider } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { activateSecureTag, cancelTapRequest, confirmTapRequest, pendingTapRequests, previewSecureTap, processSecureTap, programTagStatus, provisionSecureTag, revokeSecureTag, setTapPolicy, tapCardToken, tapCookieName, tapCookieHeader } from "./secure-tap";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const provider: TapKeyProvider = new DerivedTapKeyProvider(VERIFY);
const T0 = new Date("2026-10-02T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

type Fx = Awaited<ReturnType<typeof nfcFixture>>;
let chip = 0;
/** Register a synthetic chip exactly as production registration does: derived keys, reference chosen up front, counter floor from the proof reads. */
async function register(f: Fx, options: { uid?: string; initialCounter?: number } = {}) {
  chip += 1;
  const uid = options.uid ?? `04${String(chip).padStart(12, "0")}`;
  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const publicRef = randomBytes(18).toString("base64url");
  const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1, publicRef });
  await activateSecureTag({ actorUserId: f.userId, tagId: tag.id, initialCounter: options.initialCounter });
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid });
  return { tag, uid, publicRef, tap: (counter: number, extra: { cardToken?: string; now?: Date } = {}) => ({ tagRef: publicRef, fields: sdmFor({ uid, counter, keys }), keyProvider: provider, ...extra }) };
}
const ledgerCount = async (membershipId: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, membershipId))).length;

describe("counter-tag flow: customer tap to cashier confirmation to ledger", () => {
  it("prepared reservation and activation refuse policy drift under the programme lock", async () => {
    const f = await nfcFixture();
    const policy = { tenantId: f.tenant.id, locationId: f.location.id, programId: f.program.id, mode: "staff_confirmed" as const, cooldownSeconds: 60 };
    await expect(provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: "04000000000001", keyRef: "prepared_cpu", configVersion: 1, expectedPolicy: { ...policy, cooldownSeconds: 61 } })).rejects.toMatchObject({ code: "PREPARED_POLICY_MISMATCH" });
    expect(await db.select().from(secureTags)).toHaveLength(0);
    const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: "04000000000001", keyRef: "prepared_cpu", configVersion: 1, expectedPolicy: policy });
    await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "automatic_fixed", cooldownSeconds: 60 });
    await expect(activateSecureTag({ actorUserId: f.userId, tagId: tag.id, expectedPolicy: policy })).rejects.toMatchObject({ code: "PREPARED_POLICY_MISMATCH" });
    expect((await db.select().from(secureTags))[0].status).toBe("provisioned");
  });
  it("enrolled customer: pending, polled idempotently, listed for the cashier, confirmed exactly once, reload is calm", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");

    const first = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    expect(first).toMatchObject({ state: "pending_staff", merchantName: "Tap Test Café", programSlug: f.program.slug });
    expect(first.requestId).toBeTruthy();
    // polling and retries: the same tap reports the same request and books nothing
    for (const seconds of [3, 8, 13]) expect(await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(seconds) }))).toMatchObject({ state: "pending_staff", requestId: first.requestId });
    expect(await db.select().from(tapRequests)).toHaveLength(1);

    const pending = await pendingTapRequests({ userId: cashier, locationId: f.location.id, now: at(10) });
    expect(pending.map(p => p.id)).toEqual([first.requestId]);
    // The cashier sees the card number, never the scan code (a credential).
    expect(pending[0]).toMatchObject({ cardLocator: expect.stringMatching(/^K-[A-Z2-9]{6}$/), balance: 0 });
    expect(JSON.stringify(pending)).not.toContain(f.member.scanCode);

    expect(await confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId!, now: at(20) })).toMatchObject({ state: "confirmed", balance: 1 });
    // double tap on the button, retried request, second device: still one award
    expect(await confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId!, now: at(21) })).toMatchObject({ state: "already_processed" });
    expect(await ledgerCount(f.member.id)).toBe(1);
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(1);

    // the customer reloads the tap page after confirmation: a calm state, not "already used"
    expect(await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(30) }))).toMatchObject({ state: "confirmed", balance: 1 });
    expect(await pendingTapRequests({ userId: cashier, locationId: f.location.id, now: at(30) })).toEqual([]);
    // an immediate second tap is held back by the cooldown instead of becoming a second request to confirm
    expect(await processSecureTap(c.tap(3, { cardToken: f.member.cardToken, now: at(40) }))).toMatchObject({ state: "cooldown" });
    expect(await ledgerCount(f.member.id)).toBe(1);
  });

  it("documented repeated SDM material produces one request and one award, including concurrent retries after cooldown", async () => {
    const f = await nfcFixture(); const c = await register(f, { initialCounter: 3 });
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const material = c.tap(4, { cardToken: f.member.cardToken, now: at(0) });
    const repeated = await Promise.all(Array.from({ length: 4 }, () => processSecureTap(material)));
    expect(new Set(repeated.map(result => result.requestId)).size).toBe(1);
    expect(repeated.every(result => result.state === "pending_staff")).toBe(true);
    expect(await db.select().from(tapRequests)).toHaveLength(1);
    const requestId = repeated[0].requestId!;
    const confirmations = await Promise.all([0, 1].map(() => confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId, now: at(10) })));
    expect(confirmations.map(result => result.state).sort()).toEqual(["already_processed", "confirmed"]);
    const replays = await Promise.all(Array.from({ length: 4 }, () => processSecureTap({ ...material, now: at(120) })));
    expect(replays.every(result => result.state === "confirmed")).toBe(true);
    expect(await db.select().from(tapRequests)).toHaveLength(1);
    expect(await ledgerCount(f.member.id)).toBe(1);
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(1);
  });

  it("a visitor without a card is asked to enroll, and a card for another programme is not accepted", async () => {
    const f = await nfcFixture();
    const other = await nfcFixture();
    const c = await register(f);
    expect(await processSecureTap(c.tap(2, { now: at(0) }))).toMatchObject({ state: "needs_enrollment" });
    expect(await processSecureTap(c.tap(3, { cardToken: other.member.cardToken, now: at(1) }))).toMatchObject({ state: "needs_enrollment" });
    expect(await db.select().from(tapRequests)).toHaveLength(0);
    // the browser binding is per programme: the cookie of another programme is not read
    const request = new Request("https://example.test/api/tap/x", { headers: { cookie: tapCookieHeader(other.program.id, other.member.cardToken, "https://example.test").split(";")[0] } });
    expect(tapCardToken(request, f.program.id)).toBeUndefined();
    expect(tapCardToken(request, other.program.id)).toBe(other.member.cardToken);
    // preview (the GET the page makes first) tells enrolled and new visitors apart without booking
    expect(await previewSecureTap(c.tap(4, { cardToken: f.member.cardToken }))).toMatchObject({ hasMembership: true, mode: "staff_confirmed" });
    expect(await previewSecureTap(c.tap(5))).toMatchObject({ hasMembership: false });
  });

  it("an unconfirmed request expires: the customer is told to tap again, the cashier cannot confirm it, nothing is booked", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const first = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    expect(await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(6 * 60) }))).toMatchObject({ state: "expired" });
    await expect(confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId!, now: at(6 * 60) })).rejects.toMatchObject({ code: "TAP_EXPIRED" });
    expect(await pendingTapRequests({ userId: cashier, locationId: f.location.id, now: at(6 * 60) })).toEqual([]);
    expect(await ledgerCount(f.member.id)).toBe(0);
    // a fresh tap is a new request
    expect(await processSecureTap(c.tap(3, { cardToken: f.member.cardToken, now: at(6 * 60 + 5) }))).toMatchObject({ state: "pending_staff" });
  });

  it("a cashier can decline a request: the customer sees it, it cannot be confirmed afterwards, and a confirmed award cannot be cancelled", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const first = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    expect(await cancelTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId! })).toEqual({ state: "cancelled" });
    expect(await cancelTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId! })).toEqual({ state: "cancelled" }); // idempotent
    expect(await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(5) }))).toMatchObject({ state: "cancelled" });
    await expect(confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId!, now: at(6) })).rejects.toMatchObject({ code: "TAP_EXPIRED" });
    const second = await processSecureTap(c.tap(3, { cardToken: f.member.cardToken, now: at(10) }));
    await confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: second.requestId!, now: at(11) });
    await expect(cancelTapRequest({ userId: cashier, locationId: f.location.id, requestId: second.requestId! })).rejects.toMatchObject({ code: "TAP_ALREADY_CONFIRMED" });
    expect(await ledgerCount(f.member.id)).toBe(1);
  });

  it("only staff of the right tenant and location see, confirm or cancel requests; revoked staff cannot", async () => {
    const f = await nfcFixture();
    const stranger = await nfcFixture();
    const c = await register(f);
    const first = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    const [secondLocation] = await db.insert((await import("@/db/schema")).locations).values({ tenantId: f.tenant.id, name: "Berlin", city: "Berlin", country: "DE", timezone: "Europe/Berlin" }).returning();
    const elsewhere = await addStaff(f.tenant.id, secondLocation.id, "cashier");
    const manager = await addStaff(f.tenant.id, f.location.id, "manager");
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");

    await expect(pendingTapRequests({ userId: elsewhere, locationId: f.location.id, now: at(1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmTapRequest({ userId: elsewhere, locationId: f.location.id, requestId: first.requestId!, now: at(1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmTapRequest({ userId: stranger.userId, locationId: f.location.id, requestId: first.requestId!, now: at(1) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(cancelTapRequest({ userId: stranger.userId, locationId: f.location.id, requestId: first.requestId! })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(confirmTapRequest({ userId: cashier, locationId: secondLocation.id, requestId: first.requestId!, now: at(1) })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pendingTapRequests({ userId: manager, locationId: f.location.id, now: at(1) })).length).toBe(1);
    await pool.query("update staff_roles set active = false where user_id = $1", [cashier]);
    await expect(confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId!, now: at(2) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await ledgerCount(f.member.id)).toBe(0);
    expect(await confirmTapRequest({ userId: manager, locationId: f.location.id, requestId: first.requestId!, now: at(3) })).toMatchObject({ state: "confirmed" });
  });

  it("disabled policy, revoked tags and unknown references are unavailable without leaking why", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const first = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "disabled", cooldownSeconds: null });
    expect(await processSecureTap(c.tap(3, { cardToken: f.member.cardToken, now: at(1) }))).toMatchObject({ state: "disabled" });
    await expect(confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId!, now: at(2) })).rejects.toMatchObject({ code: "TAP_EXPIRED" });
    await setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "staff_confirmed", cooldownSeconds: 60 });
    const second = await processSecureTap(c.tap(4, { cardToken: f.member.cardToken, now: at(3) }));
    await revokeSecureTag({ actorUserId: f.userId, tagId: c.tag.id });
    await expect(processSecureTap(c.tap(5, { cardToken: f.member.cardToken, now: at(4) }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(previewSecureTap(c.tap(5))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: second.requestId!, now: at(5) })).rejects.toMatchObject({ code: "TAP_EXPIRED" });
    await expect(processSecureTap({ ...c.tap(6), tagRef: "AAAAAAAAAAAAAAAAAAAAAAAA" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await ledgerCount(f.member.id)).toBe(0);
  });

  it("fails closed without verification keys, with the wrong master, or with a forged or replayed tap", async () => {
    const f = await nfcFixture();
    const c = await register(f, { initialCounter: 5 });
    const input = c.tap(6, { cardToken: f.member.cardToken, now: at(0) });
    const broken: TapKeyProvider = { async getKeys() { throw new Error("secret store down"); } };
    await expect(processSecureTap({ ...input, keyProvider: broken })).rejects.toBeTruthy();
    await expect(processSecureTap({ ...input, keyProvider: new DerivedTapKeyProvider(parseMaster("11223344556677889900aabbccddeeff00112233445566778899aabbccddeeff")) })).rejects.toMatchObject({ code: "INVALID_TAP" });
    await expect(processSecureTap({ ...input, fields: { ...input.fields, mac: "0000000000000000" } })).rejects.toMatchObject({ code: "INVALID_TAP" });
    // reads made while provisioning (counters <= the registered floor) can never be replayed
    await expect(processSecureTap(c.tap(5, { cardToken: f.member.cardToken, now: at(1) }))).rejects.toMatchObject({ code: "REPLAYED_TAP" });
    await expect(processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(1) }))).rejects.toMatchObject({ code: "REPLAYED_TAP" });
    expect(await db.select().from(tapRequests)).toHaveLength(0);
    expect(await ledgerCount(f.member.id)).toBe(0);
  });

  it("registering the same chip again: one live tag per chip, a revoked chip can be registered again, the old reference stays dead", async () => {
    const f = await nfcFixture();
    const first = await register(f, { uid: "04aa00000000aa" });
    await expect(register(f, { uid: "04aa00000000aa" })).rejects.toBeTruthy();         // live duplicate refused
    await revokeSecureTag({ actorUserId: f.userId, tagId: first.tag.id });
    const again = await register(f, { uid: "04aa00000000aa" });                          // revoked chip registers again, new reference
    expect(again.publicRef).not.toBe(first.publicRef);
    await expect(processSecureTap(first.tap(2, { cardToken: f.member.cardToken, now: at(0) }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await processSecureTap(again.tap(2, { cardToken: f.member.cardToken, now: at(0) }))).toMatchObject({ state: "pending_staff" });
    const rows = await db.select().from(secureTags).where(eq(secureTags.uid, "04aa00000000aa"));
    expect(rows.map(row => row.status).sort()).toEqual(["active", "revoked"]);
  });

  it("owner readiness view lists non-secret fields only and is owner-only", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    const view = await programTagStatus({ actorUserId: f.userId, programId: f.program.id });
    expect(view).toMatchObject({ mode: "staff_confirmed", cooldownSeconds: 60 });
    expect(view.tags).toEqual([expect.objectContaining({ status: "active", everTapped: true })]);
    const text = JSON.stringify(view);
    for (const secret of [c.uid, c.publicRef, "keyRef", "uid"]) expect(text).not.toContain(secret);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    await expect(programTagStatus({ actorUserId: cashier, programId: f.program.id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await db.select().from(programs).where(eq(programs.id, f.program.id)))[0].tapMode).toBe("staff_confirmed");
  });
});

describe("automatic taps stay off for the first release", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("production refuses automatic_fixed and a legacy automatic programme still waits for staff", async () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production");
    const f = await nfcFixture();
    await expect(setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "automatic_fixed", cooldownSeconds: 60 })).rejects.toMatchObject({ code: "TAP_AUTOMATIC_NOT_ALLOWED" });
  });
});
