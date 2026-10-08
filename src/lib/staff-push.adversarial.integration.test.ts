import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushError } from "web-push";
import { pool } from "@/db";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { deliverTapPush, saveStaffPushSubscription } from "./staff-push";

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
