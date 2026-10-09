import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { db, pool } from "@/db";
import { tapRequests } from "@/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster, type TapKeyProvider } from "./nfc-keys";
import { sdmFor } from "./nfc-test-support";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { activateSecureTag, cancelTapRequest, confirmTapRequest, processSecureTap, provisionSecureTag } from "./secure-tap";

/*
 * Adversarial review of a7a7c12 (agent 6). Reproduces a replay gap in the counter-tag flow.
 *
 * Run (Opus, on the integration stack):
 *   TEST_PG_CONTAINER=loynara-nfc-pg TEST_PG_PORT=54395 sh scripts/test-local.sh src/lib/nfc-counter-replay.adversarial.integration.test.ts
 *
 * Expected: both tests PASS once a tap that is answered from a waiting request consumes its counter.
 * On a7a7c12 both FAIL: processSecureTap only advances secure_tags.last_counter on the create and cooldown paths, not on
 * the "pending_staff, return the existing request" path (src/lib/secure-tap.ts, the `if (pending && pending.expiresAt > now)`
 * branch). A tap that was presented but not used therefore stays replayable.
 */

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
async function register(f: Fx) {
  chip += 1;
  const uid = `04${String(chip).padStart(12, "0")}`;
  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const publicRef = randomBytes(18).toString("base64url");
  const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid, keyRef, configVersion: 1, publicRef });
  await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid });
  return {
    tap: (counter: number, extra: { cardToken?: string; now?: Date } = {}) => ({ tagRef: publicRef, fields: sdmFor({ uid, counter, keys }), keyProvider: provider, ...extra }),
  };
}

describe("counter replay while a request waits (reproduction)", () => {
  it("a second tap answered from a waiting request keeps its counter unused, so after the first request is confirmed the same tap cannot open a new stamp request", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");

    const first = await processSecureTap(c.tap(1, { cardToken: f.member.cardToken, now: at(0) }));
    expect(first.state).toBe("pending_staff");
    // Second physical tap while the first waits: the server answers with the existing request.
    const second = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(5) }));
    expect(second).toMatchObject({ state: "pending_staff", requestId: first.requestId });

    await confirmTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId!, now: at(10) });

    // Counter 2 was already presented at 5 s. Presenting it again after the 60 s cooldown must not create a new request.
    // Expected: refused (REPLAYED_TAP) or answered from history. Actual on a7a7c12: a new pending_staff request for counter 2.
    const replay = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(200) })).then(result => result, error => error);
    expect(replay).not.toMatchObject({ state: "pending_staff" });
    expect(await db.select().from(tapRequests).where(eq(tapRequests.membershipId, f.member.id))).toHaveLength(1);
  });

  it("cancelling a waiting request does not free the counter of the tap that opened it either", async () => {
    const f = await nfcFixture();
    const c = await register(f);
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");

    const first = await processSecureTap(c.tap(1, { cardToken: f.member.cardToken, now: at(0) }));
    expect(first.state).toBe("pending_staff");
    const second = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(5) }));
    expect(second).toMatchObject({ state: "pending_staff", requestId: first.requestId });

    await cancelTapRequest({ userId: cashier, locationId: f.location.id, requestId: first.requestId! });

    // No cooldown applies after a cancel, so the only thing that can refuse this replay is the counter. Expected: refused.
    const replay = await processSecureTap(c.tap(2, { cardToken: f.member.cardToken, now: at(20) })).then(result => result, error => error);
    expect(replay).not.toMatchObject({ state: "pending_staff" });
    expect(await db.select().from(tapRequests).where(eq(tapRequests.membershipId, f.member.id))).toHaveLength(1);
  });
});
