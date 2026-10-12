import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushError } from "web-push";
import { pool } from "@/db";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { deliverTapPush, saveStaffPushSubscription } from "./staff-push";
import { acceptStaffInvite, createStaffInvite, revokeStaff } from "./staff";

/*
 * Adversarial review of a7a7c12 (agent 6). Push subscription ownership and retry behaviour.
 *
 * Run (Opus, on the integration stack):
 *   TEST_PG_CONTAINER=loynara-nfc-pg TEST_PG_PORT=54395 sh scripts/test-local.sh src/lib/staff-push.adversarial.integration.test.ts
 *
 * Expected on a7a7c12: the cross-tenant takeover test FAILS (the ON CONFLICT (endpoint) upsert in saveStaffPushSubscription
 * rebinds the row to whichever merchant saves the same endpoint, with no check of the existing owner), and the retry test
 * FAILS (deliverTapPush re-sends to every recipient on each attempt, including devices that already got the wake-up).
 */

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const vapid = { VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`, VAPID_PRIVATE_KEY: "C".repeat(43), VAPID_SUBJECT: "mailto:ops@example.test" };
const keys = { p256dh: `B${"x".repeat(86)}`, auth: "a".repeat(22) };
const otherKeys = { p256dh: `B${"y".repeat(86)}`, auth: "b".repeat(22) };
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name.padEnd(16, "0")}`;
const original = { ...process.env };

async function session(userId: string, expiresInSeconds = 3600) {
  const id = randomUUID();
  await pool.query(`INSERT INTO "session" (id, "expiresAt", token, "updatedAt", "userId") VALUES ($1, now() + $2::int * interval '1 second', $1, now(), $3)`, [id, expiresInSeconds, userId]);
  return id;
}

async function pendingRequest(f: Awaited<ReturnType<typeof nfcFixture>>) {
  const tag = randomUUID();
  await pool.query("INSERT INTO secure_tags (id, public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, status) VALUES ($1, $2, $3, $4, $5, $6, 'synthetic', 1, 'active')",
    [tag, randomUUID().replaceAll("-", "").slice(0, 24), f.tenant.id, f.location.id, f.program.id, `04${randomUUID().replaceAll("-", "").slice(0, 12)}`]);
  const { rows } = await pool.query<{ id: string }>("INSERT INTO tap_requests (tag_id, counter, tenant_id, location_id, program_id, membership_id, status, expires_at) VALUES ($1, 1, $2, $3, $4, $5, 'pending_staff', now() + interval '300 seconds') RETURNING id",
    [tag, f.tenant.id, f.location.id, f.program.id, f.member.id]);
  return rows[0].id;
}

beforeEach(async () => {
  Object.assign(process.env, vapid);
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterEach(() => { for (const key of Object.keys(vapid)) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });
afterAll(async () => { await pool.end(); });

describe("push subscription ownership (reproduction)", () => {
  it("a login at another merchant cannot re-bind a device that a live session of a different merchant is subscribed with", async () => {
    const a = await nfcFixture();
    const b = await nfcFixture();
    const cashierA = await addStaff(a.tenant.id, a.location.id, "cashier");
    await saveStaffPushSubscription({ userId: cashierA, sessionId: await session(cashierA), tenantId: a.tenant.id, locationId: a.location.id, subscription: { endpoint: endpoint("device-a"), keys } });

    // The endpoint is a bearer-style URL; holding it must not be enough to move the device to another merchant.
    const cashierB = await addStaff(b.tenant.id, b.location.id, "cashier");
    const attempt = await saveStaffPushSubscription({ userId: cashierB, sessionId: await session(cashierB), tenantId: b.tenant.id, locationId: b.location.id, subscription: { endpoint: endpoint("device-a"), keys: otherKeys } })
      .then(result => result, error => error);
    expect(attempt).not.toEqual({ subscribed: true });

    const { rows } = await pool.query("SELECT user_id, tenant_id, p256dh FROM staff_push_subscriptions");
    expect(rows).toEqual([{ user_id: cashierA, tenant_id: a.tenant.id, p256dh: keys.p256dh }]);
  });
});

describe("retry after a temporary failure (reproduction)", () => {
  it("a retry only reaches the devices that failed, not devices that already received the wake-up", async () => {
    const f = await nfcFixture();
    const owner = await session(f.userId);
    for (const name of ["fine", "flaky"]) {
      await saveStaffPushSubscription({ userId: f.userId, sessionId: owner, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint(name), keys } });
    }
    const request = await pendingRequest(f);
    let flakyAvailable = false;
    const send = vi.fn(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint === endpoint("flaky") && !flakyAvailable) throw new WebPushError("Unavailable", 503, {}, "", subscription.endpoint);
      return { statusCode: 201, body: "", headers: {} };
    });

    expect(await deliverTapPush({ payload: { tapRequestId: request } }, { send })).toMatchObject({ status: "retry" });
    flakyAvailable = true;
    expect(await deliverTapPush({ payload: { tapRequestId: request } }, { send })).toMatchObject({ status: "complete" });

    // Expected: "fine" is woken exactly once. Actual on a7a7c12: twice (the second attempt starts again from every recipient).
    const finePushes = send.mock.calls.filter(([subscription]) => subscription.endpoint === endpoint("fine")).length;
    expect(finePushes).toBe(1);
  });
});


describe("recipient authorization after selection", () => {
  it("does not notify a selected device after its login expires before transport", async () => {
    const f = await nfcFixture(), login = await session(f.userId);
    await saveStaffPushSubscription({ userId: f.userId, sessionId: login, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("expired-after-selection"), keys } });
    const requestId = await pendingRequest(f), send = vi.fn(async () => ({ statusCode: 201, body: "", headers: {} }));
    const result = await deliverTapPush({ payload: { tapRequestId: requestId } }, { send, renew: async () => {
      // Synthetic passage of the persisted login expiry, after the initial recipient read.
      await pool.query(`UPDATE "session" SET "expiresAt"=clock_timestamp()-interval '1 second' WHERE id=$1`, [login]);
      return true;
    } });
    expect(send).not.toHaveBeenCalled(); expect(result.sent).toBe(0);
    expect((await pool.query("SELECT status FROM tap_requests WHERE id=$1", [requestId])).rows).toEqual([{ status: "pending_staff" }]);
  });
  it("keeps a valid device reachable after an unrelated merchant revokes its own cashier", async () => {
    const f = await nfcFixture(), foreign = await nfcFixture();
    const cashier = await addStaff(foreign.tenant.id, foreign.location.id, "cashier");
    await saveStaffPushSubscription({ userId: f.userId, sessionId: await session(f.userId), tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("authorized-own-device"), keys } });
    await saveStaffPushSubscription({ userId: cashier, sessionId: await session(cashier), tenantId: foreign.tenant.id, locationId: foreign.location.id, subscription: { endpoint: endpoint("foreign-revoked-device"), keys } });
    const requestId = await pendingRequest(f), send = vi.fn(async () => ({ statusCode: 201, body: "", headers: {} }));
    const result = await deliverTapPush({ payload: { tapRequestId: requestId } }, { send, renew: async () => {
      await revokeStaff({ actorUserId: foreign.userId, userId: cashier }); return true;
    } });
    expect(result).toMatchObject({ status: "complete", sent: 1 }); expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ endpoint: endpoint("authorized-own-device") }), expect.any(String), expect.any(Object));
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT balance FROM memberships WHERE id = ANY($1)", [[f.member.id, foreign.member.id]])).rows).toEqual([{ balance: 0 }, { balance: 0 }]);
    const retry = await deliverTapPush({ payload: { tapRequestId: requestId } }, { send });
    expect(retry.sent).toBe(0); expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not notify a cashier whose supported revocation commits before the network send", async () => {
    const f = await nfcFixture(), cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    await saveStaffPushSubscription({ userId: cashier, sessionId: await session(cashier), tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("revoked-after-selection"), keys } });
    const requestId = await pendingRequest(f);
    const before = (await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member.id])).rows;
    const send = vi.fn(async () => ({ statusCode: 201, body: "", headers: {} }));
    const renew = vi.fn(async () => {
      await expect(revokeStaff({ actorUserId: f.userId, userId: cashier })).resolves.toMatchObject({ active: false });
      return true;
    });
    const result = await deliverTapPush({ payload: { tapRequestId: requestId } }, { send, renew });
    expect(renew).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member.id])).rows).toEqual(before);
    expect((await pool.query("SELECT status FROM tap_requests WHERE id=$1", [requestId])).rows).toEqual([{ status: "pending_staff" }]);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1", [f.tenant.id])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM staff_audit_events WHERE tenant_id=$1 AND subject_user_id=$2 AND action='access_revoked'", [f.tenant.id, cashier])).rows[0].n).toBe(1);
    // A later explicit owner invitation can restore the same account's access.
    // The originally suppressed request remains recoverable, without another role or loyalty entry.
    const email = (await pool.query('SELECT email FROM "user" WHERE id=$1', [cashier])).rows[0].email as string;
    const invitation = await createStaffInvite({ actorUserId: f.userId, locationId: f.location.id, email, role: "cashier" });
    await acceptStaffInvite({ userId: cashier, token: invitation.token });
    const recovered = await deliverTapPush({ payload: { tapRequestId: requestId } }, { send });
    expect(recovered).toMatchObject({ status: "complete", sent: 1 }); expect(send).toHaveBeenCalledTimes(1);
    expect((await deliverTapPush({ payload: { tapRequestId: requestId } }, { send })).sent).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM staff_roles WHERE user_id=$1", [cashier])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member.id])).rows).toEqual(before);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1", [f.tenant.id])).rows[0].n).toBe(0);
  });
});
