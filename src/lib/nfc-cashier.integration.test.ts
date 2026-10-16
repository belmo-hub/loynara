import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, staffRoles, tapRequests } from "@/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster, type TapKeyProvider } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { activateSecureTag, cancelTapRequest, confirmTapRequest, pendingTapRequests, previewSecureTap, processSecureTap, provisionSecureTag, revokeSecureTag, setTapPolicy } from "./secure-tap";
import { revokeStaff } from "./staff";

// Cases not already covered by nfc-lifecycle.integration.test.ts and secure-tap.integration.test.ts:
// two different staff confirming at once, and a revoked cashier losing the list (not just confirmation) until reactivated.
// Skipped because they already exist: same-user concurrent confirm (lifecycle), confirm after cancel and cancel after
// confirm (lifecycle), cross-location and revoked-staff confirm plus cross-location list (lifecycle).

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const provider: TapKeyProvider = new DerivedTapKeyProvider(VERIFY);
const T0 = new Date("2026-10-08T10:00:00Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });

type Fx = Awaited<ReturnType<typeof nfcFixture>>;
/** A synthetic chip registered the way production does it: derived keys, reference chosen up front. */
async function register(f: Fx) {
  const uid = `04${randomBytes(6).toString("hex")}`;
  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const publicRef = randomBytes(18).toString("base64url");
  const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1, publicRef });
  await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid });
  return { publicRef, tap: (counter: number, extra: { cardToken?: string; now?: Date } = {}) => ({ tagRef: publicRef, fields: sdmFor({ uid, counter, keys }), keyProvider: provider, ...extra }) };
}
const ledgerCount = async (membershipId: string) => (await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, membershipId))).length;

describe("cashier confirmation of one NFC request", () => {
  it("two different staff confirm the same request at the same moment: one confirmation, one already_processed, exactly one ledger entry", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const pending = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    const requestId = pending.requestId!;

    const results = await Promise.allSettled([
      confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId, now: at(10) }),
      confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId, now: at(10) }),
    ]);
    expect(results.map(result => result.status)).toEqual(["fulfilled", "fulfilled"]);
    const states = results.map(result => (result as PromiseFulfilledResult<{ state: string }>).value.state).sort();
    expect(states).toEqual(["already_processed", "confirmed"]);

    const rows = await db.select().from(ledgerEntries).where(eq(ledgerEntries.membershipId, f.member.id));
    expect(rows).toHaveLength(1);
    expect(rows[0].delta).toBe(1);
    expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(1);
    const [request] = await db.select().from(tapRequests).where(eq(tapRequests.id, requestId));
    expect(request.status).toBe("confirmed");
    expect(request.ledgerEntryId).toBe(rows[0].id);
  });

  it("a revoked cashier loses the location's list at once, and sees it again only after reactivation; nothing changes meanwhile", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const pending = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(0) }));
    expect((await pendingTapRequests({ userId: cashier, locationId: f.location.id, now: at(1) })).map(row => row.id)).toEqual([pending.requestId]);

    await pool.query("update staff_roles set active = false where user_id = $1", [cashier]);
    await expect(pendingTapRequests({ userId: cashier, locationId: f.location.id, now: at(2) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await ledgerCount(f.member.id)).toBe(0);

    await pool.query("update staff_roles set active = true where user_id = $1", [cashier]);
    expect((await pendingTapRequests({ userId: cashier, locationId: f.location.id, now: at(3) })).map(row => row.id)).toEqual([pending.requestId]);
    expect(await ledgerCount(f.member.id)).toBe(0);
  });
});


it("makes staff revocation wait for a cancellation that already passed its access check", async () => {
  const f = await nfcFixture();
  const c = await register(f);
  const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
  const pending = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken }));
  const gate = await pool.connect();
  const finished: string[] = [];
  let cancellation: Promise<unknown> | undefined;
  let revocation: Promise<unknown> | undefined;
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  try {
    // The cancellation can lock its request row and read the role, but its UPDATE waits behind this table lock.
    await gate.query("BEGIN");
    await gate.query("LOCK TABLE tap_requests IN SHARE MODE");
    cancellation = cancelTapRequest({ userId: cashier, locationId: f.location.id, requestId: pending.requestId! }).finally(() => finished.push("cancellation"));
    let cancellationPid: number | undefined;
    for (let attempt = 0; attempt < 500 && !cancellationPid; attempt++) {
      cancellationPid = (await pool.query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE 'update \"tap_requests\"%'")).rows[0]?.pid;
      if (!cancellationPid) await pause();
    }
    expect(cancellationPid, "the cancellation must be waiting at its update").toBeDefined();
    // The revocation must now be seen blocked by the cancellation itself, not merely slow.
    revocation = revokeStaff({ actorUserId: f.userId, userId: cashier }).finally(() => finished.push("revocation"));
    let blocked = false;
    for (let attempt = 0; attempt < 500 && !blocked && !finished.includes("revocation"); attempt++) {
      blocked = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [cancellationPid])).rowCount! > 0;
      if (!blocked) await pause();
    }
    expect(blocked, "revocation must wait for the cancellation that already passed its access check").toBe(true);
  } finally { await gate.query("COMMIT"); gate.release(); }
  await expect(cancellation).resolves.toMatchObject({ state: "cancelled" });
  await revocation;
  expect(finished).toEqual(["cancellation", "revocation"]);
  expect((await db.select().from(staffRoles).where(eq(staffRoles.userId, cashier)))[0].active).toBe(false);
});

it("refuses a request that expires while confirmation waits for the membership lock", async () => {
  const f = await nfcFixture();
  const c = await register(f);
  const pending = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken }));
  const expiresAt = new Date(Date.now() + 1000);
  await db.update(tapRequests).set({ expiresAt }).where(eq(tapRequests.id, pending.requestId!));
  const blocker = await pool.connect();
  let confirmation: Promise<{ value?: unknown; error?: { code?: string } }> | undefined;
  try {
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM memberships WHERE id = $1 FOR UPDATE", [f.member.id]);
    confirmation = confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId! }).then(value => ({ value }), error => ({ error }));
    // Verify the real transaction has passed its initial expiry check and is waiting at the membership lock.
    let waiting = false;
    for (let attempt = 0; attempt < 100 && !waiting; attempt++) {
      waiting = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%memberships%'")).rowCount! > 0;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(waiting).toBe(true);
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt.getTime() - Date.now() + 50)));
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  const result = await confirmation!;
  expect(result.error?.code).toBe("TAP_EXPIRED");
  expect(await ledgerCount(f.member.id)).toBe(0);
  expect((await db.select().from(memberships).where(eq(memberships.id, f.member.id)))[0].balance).toBe(0);
});

it.each(["tag revocation", "NFC switched off"])("orders a confirmation that is waiting for the card against %s, so nothing is booked after the shutdown returned", async shutdown => {
  const f = await nfcFixture();
  const c = await register(f);
  const pending = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken }));
  const [tag] = (await pool.query<{ id: string }>("SELECT id FROM secure_tags WHERE public_ref = $1", [c.publicRef])).rows;
  const finished: string[] = [];
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const blocker = await pool.connect();
  let confirmation: Promise<unknown> | undefined;
  let stop: Promise<unknown> | undefined;
  try {
    // Another transaction holds the card, so the confirmation has passed its tag and policy checks and is waiting.
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM memberships WHERE id = $1 FOR UPDATE", [f.member.id]);
    confirmation = confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId! }).finally(() => finished.push("confirmation"));
    let confirmationPid: number | undefined;
    for (let attempt = 0; attempt < 500 && !confirmationPid; attempt++) {
      confirmationPid = (await pool.query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%from \"memberships\"%'")).rows[0]?.pid;
      if (!confirmationPid) await pause();
    }
    expect(confirmationPid, "the confirmation must be waiting for the card").toBeDefined();
    stop = (shutdown === "tag revocation"
      ? revokeSecureTag({ actorUserId: f.userId, tagId: tag.id })
      : setTapPolicy({ actorUserId: f.userId, programId: f.program.id, mode: "disabled", cooldownSeconds: null })).finally(() => finished.push("shutdown"));
    let blocked = false;
    for (let attempt = 0; attempt < 500 && !blocked && !finished.includes("shutdown"); attempt++) {
      blocked = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [confirmationPid])).rowCount! > 0;
      if (!blocked) await pause();
    }
    expect(blocked, `${shutdown} must wait for the confirmation that already passed its checks`).toBe(true);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  await confirmation;
  await stop;
  // The stamp was booked before the shutdown completed; none can follow it.
  expect(finished).toEqual(["confirmation", "shutdown"]);
  expect(await ledgerCount(f.member.id)).toBe(1);
});

it("gives up confirming after a short wait while the owner saves the programme, and the request stays pending", async () => {
  const f = await nfcFixture();
  const c = await register(f);
  const pending = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken }));
  const owner = await pool.connect();
  let result: unknown;
  try {
    await owner.query("BEGIN");
    await owner.query("SELECT id FROM programs WHERE id = $1 FOR UPDATE", [f.program.id]);
    result = await confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId! }).then(value => ({ value }), error => ({ error }));
  } finally { await owner.query("ROLLBACK"); owner.release(); }
  expect(result).toMatchObject({ error: { code: "PROGRAMME_BUSY" } });
  expect((await db.select().from(tapRequests).where(eq(tapRequests.id, pending.requestId!)))[0].status).toBe("pending_staff");
  await expect(confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: pending.requestId! })).resolves.toMatchObject({ state: "confirmed" });
  expect(await ledgerCount(f.member.id)).toBe(1);
});

it("lets a tap and a replacement of its tag finish one after the other instead of deadlocking", async () => {
  const f = await nfcFixture();
  const c = await register(f);
  const [tag] = (await pool.query<{ id: string }>("SELECT id FROM secure_tags WHERE public_ref = $1", [c.publicRef])).rows;
  const finished: string[] = [];
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const outcome = <T>(work: Promise<T>, name: string) => work.then(value => ({ value }), (error: { code?: string }) => ({ error })).finally(() => finished.push(name));
  const blocker = await pool.connect();
  let tap: Promise<unknown> | undefined;
  let replacement: Promise<unknown> | undefined;
  try {
    // Holding the card pauses the tap after it has taken its locks up to the card.
    await blocker.query("BEGIN");
    await blocker.query("SELECT id FROM memberships WHERE id = $1 FOR UPDATE", [f.member.id]);
    tap = outcome(processSecureTap(c.tap(2, { cardToken: f.member.cardToken })), "tap");
    let tapPid: number | undefined;
    for (let attempt = 0; attempt < 500 && !tapPid; attempt++) {
      tapPid = (await pool.query<{ pid: number }>("SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%from \"memberships\"%'")).rows[0]?.pid;
      if (!tapPid) await pause();
    }
    expect(tapPid, "the tap must be waiting for the card").toBeDefined();
    // The owner replaces this very tag meanwhile; it must queue behind the tap.
    replacement = outcome(provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: `04${randomBytes(6).toString("hex")}`, keyRef: `dv1_${randomBytes(9).toString("base64url")}`, configVersion: 1, replacesTagId: tag.id }), "replacement");
    let queued = false;
    for (let attempt = 0; attempt < 500 && !queued && !finished.includes("replacement"); attempt++) {
      queued = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [tapPid])).rowCount! > 0;
      if (!queued) await pause();
    }
    expect(queued, "the replacement must wait for the tap").toBe(true);
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  // Before the fix, the tap's request insert needed the programme the replacement held: PostgreSQL aborted one (40P01).
  expect(await tap).toHaveProperty("value");
  expect(await replacement).toHaveProperty("value");
  expect(finished).toEqual(["tap", "replacement"]);
});

it("lets a tap read of a tag being activated and the activation finish instead of deadlocking", async () => {
  const f = await nfcFixture();
  const uid = `04${randomBytes(6).toString("hex")}`, keyRef = `dv1_${randomBytes(9).toString("base64url")}`, publicRef = randomBytes(18).toString("base64url");
  const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1, publicRef });
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid });
  const policy = { tenantId: f.tenant.id, locationId: f.location.id, programId: f.program.id, mode: "staff_confirmed" as const, cooldownSeconds: 60 };
  const pause = () => new Promise(resolve => setTimeout(resolve, 20));
  const outcome = <T>(work: Promise<T>) => work.then(value => ({ value }), (error: { code?: string; cause?: { code?: string } }) => ({ error }));
  const blocker = await pool.connect();
  let activation: Promise<{ value?: unknown; error?: { code?: string; cause?: { code?: string } } }> | undefined;
  let read: Promise<{ value?: unknown; error?: { code?: string; cause?: { code?: string } } }> | undefined;
  try {
    // Something holds the programme (as a tap does), so the activation has to wait for it.
    await blocker.query("BEGIN");
    const blockerPid = (await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await blocker.query("SELECT id FROM programs WHERE id = $1 FOR KEY SHARE", [f.program.id]);
    activation = outcome(activateSecureTag({ actorUserId: f.userId, tagId: tag.id, expectedPolicy: policy }));
    let waiting = false;
    for (let attempt = 0; attempt < 500 && !waiting; attempt++) {
      waiting = (await pool.query("SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid))", [blockerPid])).rowCount! > 0;
      if (!waiting) await pause();
    }
    expect(waiting, "the activation must be waiting for the programme").toBe(true);
    // A phone reads the new tag meanwhile (programme, then tag). Before the fix the activation already held the tag.
    let settled = false;
    read = outcome(previewSecureTap({ tagRef: publicRef, fields: sdmFor({ uid, counter: 1, keys }), keyProvider: provider })).finally(() => { settled = true; });
    for (let attempt = 0; attempt < 25 && !settled; attempt++) await pause();
  } finally { await blocker.query("ROLLBACK"); blocker.release(); }
  const [activated, previewed] = await Promise.all([activation!, read!]);
  expect(activated).toMatchObject({ value: { status: "active" } });
  // The read may come before or after the activation; it must never be the deadlock victim.
  expect(previewed.error?.cause?.code ?? previewed.error?.code).not.toBe("40P01");
});
