import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, tapRequests } from "@/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster, type TapKeyProvider } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { activateSecureTag, confirmTapRequest, pendingTapRequests, processSecureTap, provisionSecureTag } from "./secure-tap";

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
