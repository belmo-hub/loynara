import { createCipheriv, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPushError, type RequestOptions } from "web-push";
import { pool } from "@/db";
import { addStaff, nfcFixture } from "./nfc-test-db";
import { activateSecureTag, confirmTapRequest, pendingTapRequests, processSecureTap, provisionSecureTag, type TapKeyProvider } from "./secure-tap";
import { claimOutboxJob } from "./outbox";
import { deleteStaffPushSubscription, deliverTapPush, dispatchTapPushNow, pushCapability, saveStaffPushSubscription, validPushEndpoint } from "./staff-push";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

// Synthetic VAPID-shaped values: only their format is checked here, the sender is replaced by a recorder.
const vapid = { VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`, VAPID_PRIVATE_KEY: "C".repeat(43), VAPID_SUBJECT: "mailto:ops@example.test" };
const keys = { p256dh: `B${"x".repeat(86)}`, auth: "a".repeat(22) };
const endpoint = (name: string) => `https://fcm.googleapis.com/fcm/send/${name}`;
const original = { ...process.env };

async function session(userId: string, expiresInSeconds = 3600) {
  const id = randomUUID();
  await pool.query(`INSERT INTO "session" (id, "expiresAt", token, "updatedAt", "userId") VALUES ($1, now() + $2::int * interval '1 second', $1, now(), $3)`, [id, expiresInSeconds, userId]);
  return id;
}

async function pendingRequest(f: Awaited<ReturnType<typeof nfcFixture>>, expiresInSeconds = 300) {
  const tag = randomUUID();
  await pool.query("INSERT INTO secure_tags (id, public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, status) VALUES ($1, $2, $3, $4, $5, $6, 'synthetic', 1, 'active')",
    [tag, randomUUID().replaceAll("-", "").slice(0, 24), f.tenant.id, f.location.id, f.program.id, `04${randomUUID().replaceAll("-", "").slice(0, 12)}`]);
  const { rows } = await pool.query<{ id: string }>("INSERT INTO tap_requests (tag_id, counter, tenant_id, location_id, program_id, membership_id, status, expires_at) VALUES ($1, 1, $2, $3, $4, $5, 'pending_staff', now() + $6::int * interval '1 second') RETURNING id",
    [tag, f.tenant.id, f.location.id, f.program.id, f.member.id, expiresInSeconds]);
  return rows[0].id;
}

function recorder() {
  const sent: Array<{ endpoint: string; payload: string; options: RequestOptions }> = [];
  const send = vi.fn(async (subscription: { endpoint: string }, payload: string, options: RequestOptions) => { sent.push({ endpoint: subscription.endpoint, payload, options }); return { statusCode: 201, body: "", headers: {} }; });
  return { sent, send };
}

beforeEach(async () => {
  Object.assign(process.env, vapid);
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterEach(() => { for (const key of Object.keys(vapid)) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } });
afterAll(async () => { await pool.end(); });

describe("push endpoint and configuration", () => {
  it("accepts only browser push services over HTTPS (no SSRF to arbitrary hosts)", () => {
    expect(validPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(validPushEndpoint("https://web.push.apple.com/QGq")).toBe(true);
    expect(validPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    for (const bad of ["http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.test/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x",
      "https://169.254.169.254/latest", "https://localhost/x", "https://evil.test/fcm.googleapis.com", "javascript:alert(1)", `https://fcm.googleapis.com/${"x".repeat(1000)}`]) {
      expect(validPushEndpoint(bad), bad).toBe(false);
    }
  });

  it("is unavailable without complete VAPID configuration, and then queues nothing", async () => {
    expect(pushCapability(vapid)).toEqual({ available: true, publicKey: vapid.VAPID_PUBLIC_KEY });
    expect(pushCapability({ ...vapid, VAPID_PRIVATE_KEY: "" }).available).toBe(false);
    expect(pushCapability({ ...vapid, VAPID_SUBJECT: "ops@example.test" }).available).toBe(false);
    delete process.env.VAPID_PRIVATE_KEY;
    const f = await nfcFixture();
    await expect(saveStaffPushSubscription({ userId: f.userId, sessionId: await session(f.userId), tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("a"), keys } }))
      .rejects.toMatchObject({ code: "PUSH_UNAVAILABLE" });
    expect(await deliverTapPush({ payload: { tapRequestId: await pendingRequest(f) } })).toMatchObject({ status: "suppressed" });
  });
});

describe("subscriptions", () => {
  it("binds a device to the signed-in staff member, rejects other locations and foreign endpoints, and only the owner can remove it", async () => {
    const f = await nfcFixture();
    const other = await nfcFixture();
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const cashierSession = await session(cashier);
    await saveStaffPushSubscription({ userId: cashier, sessionId: cashierSession, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("cashier"), expirationTime: null, keys, locale: "fr" } });
    // A cashier cannot subscribe for another tenant's location, nor with a non-push endpoint or extra fields.
    await expect(saveStaffPushSubscription({ userId: cashier, sessionId: cashierSession, tenantId: other.tenant.id, locationId: other.location.id, subscription: { endpoint: endpoint("x"), keys } })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveStaffPushSubscription({ userId: cashier, sessionId: cashierSession, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: "https://evil.test/hook", keys } })).rejects.toThrow();
    await expect(saveStaffPushSubscription({ userId: cashier, sessionId: cashierSession, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("y"), keys, userId: f.userId } })).rejects.toThrow();
    const { rows } = await pool.query("SELECT user_id, session_id, location_id, locale FROM staff_push_subscriptions");
    expect(rows).toEqual([{ user_id: cashier, session_id: cashierSession, location_id: f.location.id, locale: "fr" }]);

    await deleteStaffPushSubscription({ userId: f.userId, endpoint: endpoint("cashier") });
    expect((await pool.query("SELECT 1 FROM staff_push_subscriptions")).rowCount).toBe(1);
    await deleteStaffPushSubscription({ userId: cashier, endpoint: endpoint("cashier") });
    expect((await pool.query("SELECT 1 FROM staff_push_subscriptions")).rowCount).toBe(0);
  });

  it("moves a shared phone to whoever signs in on it, and signing out removes the device", async () => {
    const f = await nfcFixture();
    const first = await addStaff(f.tenant.id, f.location.id, "cashier");
    const second = await addStaff(f.tenant.id, f.location.id, "cashier");
    await saveStaffPushSubscription({ userId: first, sessionId: await session(first), tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("shared"), keys } });
    const secondSession = await session(second);
    await saveStaffPushSubscription({ userId: second, sessionId: secondSession, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("shared"), keys } });
    expect((await pool.query("SELECT user_id FROM staff_push_subscriptions")).rows).toEqual([{ user_id: second }]);
    await pool.query('DELETE FROM "session" WHERE id = $1', [secondSession]);
    expect((await pool.query("SELECT 1 FROM staff_push_subscriptions")).rowCount).toBe(0);
  });
});

describe("delivery", () => {
  it("wakes only current staff of the request's location, with no customer data in the payload", async () => {
    const f = await nfcFixture();
    const elsewhere = await nfcFixture();
    const subscribe = async (userId: string, tenantId: string, locationId: string, name: string, sessionId?: string) =>
      saveStaffPushSubscription({ userId, sessionId: sessionId ?? await session(userId), tenantId, locationId, subscription: { endpoint: endpoint(name), keys, locale: name === "fr-cashier" ? "fr" : "de" } });
    const cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const frCashier = await addStaff(f.tenant.id, f.location.id, "cashier");
    const revoked = await addStaff(f.tenant.id, f.location.id, "cashier");
    const expired = await addStaff(f.tenant.id, f.location.id, "cashier");
    await subscribe(f.userId, f.tenant.id, f.location.id, "owner");
    await subscribe(cashier, f.tenant.id, f.location.id, "cashier");
    await subscribe(frCashier, f.tenant.id, f.location.id, "fr-cashier");
    await subscribe(revoked, f.tenant.id, f.location.id, "revoked");
    await subscribe(expired, f.tenant.id, f.location.id, "expired", await session(expired, -60));
    await subscribe(elsewhere.userId, elsewhere.tenant.id, elsewhere.location.id, "other-tenant");
    await pool.query("UPDATE staff_roles SET active = false WHERE user_id = $1", [revoked]);

    const { sent, send } = recorder();
    const outcome = await deliverTapPush({ payload: { tapRequestId: await pendingRequest(f) } }, { send });
    expect(outcome).toEqual({ status: "complete", sent: 3 });
    expect(sent.map(item => item.endpoint).sort()).toEqual([endpoint("cashier"), endpoint("fr-cashier"), endpoint("owner")]);
    for (const item of sent) {
      expect(JSON.parse(item.payload)).toEqual({ v: 1, kind: "tap_pending", locale: item.endpoint === endpoint("fr-cashier") ? "fr" : "de" });
      expect(item.options).toMatchObject({ TTL: 120, urgency: "high", topic: "loynara-tap" });
      expect(item.payload).not.toMatch(/K-|sc_|card_|balance/);
    }
  });

  it("sends nothing once the request was confirmed or expired", async () => {
    const f = await nfcFixture();
    await saveStaffPushSubscription({ userId: f.userId, sessionId: await session(f.userId), tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("owner"), keys } });
    const { sent, send } = recorder();
    const expired = await pendingRequest(f, -1);
    expect(await deliverTapPush({ payload: { tapRequestId: expired } }, { send })).toMatchObject({ status: "suppressed" });
    const confirmed = await pendingRequest(f);
    await pool.query("UPDATE tap_requests SET status = 'confirmed' WHERE id = $1", [confirmed]);
    expect(await deliverTapPush({ payload: { tapRequestId: confirmed } }, { send })).toMatchObject({ status: "suppressed" });
    expect(await deliverTapPush({ payload: { tapRequestId: "not-a-uuid" } }, { send })).toMatchObject({ status: "failed" });
    expect(sent).toHaveLength(0);
  });

  it("drops gone devices at once, retries temporary failures and drops a device after repeated failures", async () => {
    const f = await nfcFixture();
    const owner = await session(f.userId);
    for (const name of ["gone", "flaky", "fine"]) await saveStaffPushSubscription({ userId: f.userId, sessionId: owner, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint(name), keys } });
    const request = await pendingRequest(f);
    const send = vi.fn(async (subscription: { endpoint: string }) => {
      if (subscription.endpoint === endpoint("gone")) throw new WebPushError("Gone", 410, {}, "", subscription.endpoint);
      if (subscription.endpoint === endpoint("flaky")) throw new WebPushError("Unavailable", 503, {}, "", subscription.endpoint);
      return { statusCode: 201, body: "", headers: {} };
    });
    expect(await deliverTapPush({ payload: { tapRequestId: request } }, { send })).toMatchObject({ status: "retry", sent: 1, delaySeconds: 15 });
    expect((await pool.query("SELECT endpoint FROM staff_push_subscriptions ORDER BY endpoint")).rows.map(row => row.endpoint)).toEqual([endpoint("fine"), endpoint("flaky")]);
    for (let attempt = 0; attempt < 4; attempt++) await deliverTapPush({ payload: { tapRequestId: request } }, { send });
    expect((await pool.query("SELECT endpoint FROM staff_push_subscriptions")).rows.map(row => row.endpoint)).toEqual([endpoint("fine")]);
  });
});

describe("queueing with the tap", () => {
  const zero = Buffer.alloc(16);
  const keyProvider: TapKeyProvider = { async getKeys() { return { metaReadKey: zero, fileReadKey: zero }; } };
  function sdm(uidHex: string, counter: number) {
    const uid = Buffer.from(uidHex, "hex");
    const ctr = Buffer.from([counter & 255, (counter >>> 8) & 255, (counter >>> 16) & 255]);
    const cipher = createCipheriv("aes-128-ecb", zero, null); cipher.setAutoPadding(false);
    const encrypted = Buffer.concat([cipher.update(Buffer.concat([Buffer.from([0xc7]), uid, ctr, Buffer.alloc(5)])), cipher.final()]).toString("hex");
    const cmac = (key: Buffer, data: Buffer) => Buffer.from(execFileSync("openssl", ["mac", "-macopt", "cipher:aes-128-cbc", "-macopt", `hexkey:${key.toString("hex")}`, "CMAC"], { input: data }).toString().trim(), "hex");
    const full = cmac(cmac(zero, Buffer.concat([Buffer.from("3cc300010080", "hex"), uid, ctr])), Buffer.alloc(0));
    return { encrypted, mac: Buffer.from(Array.from({ length: 8 }, (_, index) => full[index * 2 + 1])).toString("hex") };
  }

  it("queues exactly one wake-up per new pending request, sends it once, and shows card numbers instead of scan codes", async () => {
    const f = await nfcFixture({ cooldownSeconds: 60 });
    const tag = await provisionSecureTag({ actorUserId: f.userId, programId: f.program.id, uid: "04de5f1eacc040", keyRef: "synthetic", configVersion: 1 });
    await activateSecureTag({ actorUserId: f.userId, tagId: tag.id });
    await saveStaffPushSubscription({ userId: f.userId, sessionId: await session(f.userId), tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: endpoint("owner"), keys } });
    const tap = (counter: number) => processSecureTap({ tagRef: tag.publicRef, fields: sdm("04de5f1eacc040", counter), cardToken: f.member.cardToken, keyProvider });

    const first = await tap(1);
    expect(first).toMatchObject({ state: "pending_staff", cardLocator: expect.stringMatching(/^K-[A-Z2-9]{6}$/) });
    expect(first.pushJobId).toEqual(expect.any(String));
    // The same tap again, and a second tap while one is waiting, create no further wake-up.
    expect((await tap(1)).pushJobId).toBeUndefined();
    expect((await tap(2)).pushJobId).toBeUndefined();
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind = 'push.tap_pending'")).rows[0].n).toBe(1);

    const { sent, send } = recorder();
    await dispatchTapPushNow(first.pushJobId!, { send });
    await dispatchTapPushNow(first.pushJobId!, { send });
    expect(sent).toHaveLength(1);
    expect((await pool.query("SELECT status FROM outbox_jobs WHERE id = $1", [first.pushJobId])).rows[0].status).toBe("complete");
    expect(await claimOutboxJob(pool, { maxAttempts: 5, leaseMinutes: 5 })).toBeNull();

    const pending = await pendingTapRequests({ userId: f.userId, locationId: f.location.id });
    expect(pending).toHaveLength(1);
    expect(pending[0]).toEqual({ id: first.requestId, createdAt: expect.any(Date), expiresAt: expect.any(Date), balance: 0, cardLocator: first.cardLocator });
    expect(JSON.stringify(pending)).not.toContain(f.member.scanCode);
    // Confirming afterwards books once; a wake-up for the confirmed request would be suppressed.
    await confirmTapRequest({ userId: f.userId, locationId: f.location.id, requestId: first.requestId! });
    expect(await deliverTapPush({ payload: { tapRequestId: first.requestId! } }, { send })).toMatchObject({ status: "suppressed" });
  });
});
