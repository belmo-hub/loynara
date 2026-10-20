import { generateKeyPairSync, randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { mailgunEuProvider } from "./transactional-email";
import { PassFastClient } from "./wallet/passfast";
import { GoogleWalletClient } from "./wallet/google";
import { deliverTapPush, saveStaffPushSubscription } from "./staff-push";
import { nfcFixture } from "./nfc-test-db";
import { assertOwnedTestDatabase, assertTestDatabaseUrl } from "../../scripts/test-database-guard";

assertTestDatabaseUrl();
beforeEach(async () => { await assertOwnedTestDatabase(pool); await pool.query('TRUNCATE service_usage, tenants, "user" CASCADE'); });
afterEach(() => vi.unstubAllEnvs());
afterAll(() => pool.end());
const message = { to: "synthetic@example.test", subject: "Synthetic", body: "Synthetic", jobId: randomUUID() };
const mail: NodeJS.ProcessEnv = { NODE_ENV: "test", EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_SEND_APPROVED: "true", MAILGUN_EU_DOMAIN: "mail.example.test", MAILGUN_FROM_EMAIL: "support@mail.example.test", MAILGUN_EU_API_KEY: "synthetic", MAILGUN_EU_WEBHOOK_SIGNING_KEY: "synthetic", PUBLIC_BASE_URL: "https://app.example.test", SERVICE_EMAIL_MONTHLY_LIMIT: "1" };
it("stops email before transport after an uncertain attempt exhausts its budget", async () => {
  const http = vi.fn(async () => { throw new Error("synthetic-provider-secret"); });
  const provider = mailgunEuProvider(mail, http)!;
  expect(await provider.send(message)).toEqual({ state: "ambiguous" });
  await expect(provider.send({ ...message, jobId: randomUUID() })).rejects.toThrow("Optional service temporarily unavailable");
  expect(http).toHaveBeenCalledTimes(1);
  expect((await pool.query("SELECT service,attempts FROM service_usage")).rows).toEqual([{ service: "email", attempts: 1 }]);
});
it("blocks Wallet requests before transport when its kill switch is zero", async () => {
  vi.stubEnv("SERVICE_WALLET_MONTHLY_LIMIT", "0");
  const http = vi.fn(async () => Response.json({}));
  const client = new PassFastClient({ apiKey: "synthetic", appId: randomUUID(), templateId: randomUUID(), platforms: ["apple"] }, http);
  await expect(client.void(randomUUID(), "apple")).rejects.toThrow();
  expect(http).not.toHaveBeenCalled();
});

it.each([0, 1, 2])("charges Google OAuth and each API call separately and refuses before transport at cap %i", async cap => {
  vi.stubEnv("SERVICE_WALLET_MONTHLY_LIMIT", String(cap));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const issuerId = "3388000000023201754", objectId = `${issuerId}.loynara_${randomUUID()}`;
  const calls: string[] = [];
  const http: typeof fetch = async input => {
    calls.push(String(input));
    return Response.json(String(input) === "https://oauth2.googleapis.com/token" ? { access_token: "synthetic-token" } : { id: objectId });
  };
  const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey }, http);
  const config = { issuerId, logoUrl: "https://assets.example.test/synthetic.png" };
  if (cap === 2) expect(await client.getObject(objectId, config)).toEqual({ id: objectId });
  await expect(client.getObject(objectId, config)).rejects.toThrow("Optional service temporarily unavailable");
  expect(calls).toEqual([
    ...(cap >= 1 ? ["https://oauth2.googleapis.com/token"] : []),
    ...(cap >= 2 ? [`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${objectId}`] : []),
  ]);
  expect((await pool.query("SELECT service,attempts FROM service_usage")).rows).toEqual(cap ? [{ service: "wallet", attempts: cap }] : []);
});

it("does not refund or repeat an uncertain Google OAuth attempt", async () => {
  vi.stubEnv("SERVICE_WALLET_MONTHLY_LIMIT", "1");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { format: "pem", type: "pkcs8" }, publicKeyEncoding: { format: "pem", type: "spki" } });
  const http = vi.fn(async () => { throw new Error("synthetic uncertainty"); });
  const client = new GoogleWalletClient({ clientEmail: "issuer@example.test", privateKey }, http);
  const config = { issuerId: "3388000000023201754", logoUrl: "https://assets.example.test/synthetic.png" };
  const object = `${config.issuerId}.loynara_${randomUUID()}`;
  await expect(client.getObject(object, config)).rejects.toThrow();
  await expect(client.getObject(object, config)).rejects.toThrow("Optional service temporarily unavailable");
  expect(http).toHaveBeenCalledOnce();
  expect((await pool.query("SELECT service,attempts FROM service_usage")).rows).toEqual([{ service: "wallet", attempts: 1 }]);
});

it.each([0, 1])("blocks staff push before transport beyond a shared cap of %i without changing loyalty or removing devices", async cap => {
  vi.stubEnv("SERVICE_PUSH_MONTHLY_LIMIT", String(cap));
  const vapid = { VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`, VAPID_PRIVATE_KEY: "C".repeat(43), VAPID_SUBJECT: "mailto:ops@example.test" };
  for (const [key, value] of Object.entries(vapid)) vi.stubEnv(key, value);
  const fixture = await nfcFixture(), sessionId = randomUUID(), tag = randomUUID();
  await pool.query('INSERT INTO "session" (id,"expiresAt",token,"updatedAt","userId") VALUES ($1,now()+interval \'1 hour\',$1,now(),$2)', [sessionId, fixture.userId]);
  for (const name of ["first", "second"]) await saveStaffPushSubscription({
    userId: fixture.userId, sessionId, tenantId: fixture.tenant.id, locationId: fixture.location.id,
    subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name.padEnd(16, "0")}`, keys: { p256dh: `B${"x".repeat(86)}`, auth: "a".repeat(22) } },
  });
  await pool.query("INSERT INTO secure_tags (id,public_ref,tenant_id,location_id,program_id,uid,key_ref,config_version,status) VALUES ($1,$2,$3,$4,$5,$6,'synthetic',1,'active')", [tag, randomUUID().replaceAll("-", "").slice(0, 24), fixture.tenant.id, fixture.location.id, fixture.program.id, `04${randomUUID().replaceAll("-", "").slice(0, 12)}`]);
  const pending = await pool.query("INSERT INTO tap_requests (tag_id,counter,tenant_id,location_id,program_id,membership_id,status,expires_at) VALUES ($1,1,$2,$3,$4,$5,'pending_staff',now()+interval '5 minutes') RETURNING id", [tag, fixture.tenant.id, fixture.location.id, fixture.program.id, fixture.member.id]);
  const send = vi.fn(async () => ({ statusCode: 201, body: "", headers: {} }));
  expect(await deliverTapPush({ payload: { tapRequestId: pending.rows[0].id } }, { send, env: vapid })).toMatchObject({ status: "blocked", sent: cap });
  expect(send).toHaveBeenCalledTimes(cap);
  expect((await pool.query("SELECT service,attempts FROM service_usage")).rows).toEqual(cap ? [{ service: "push", attempts: 1 }] : []);
  expect((await pool.query("SELECT count(*)::int AS n FROM staff_push_subscriptions")).rows[0].n).toBe(2);
  expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [fixture.member.id])).rows[0].balance).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n).toBe(0);
  expect((await pool.query("SELECT status FROM tap_requests WHERE id=$1", [pending.rows[0].id])).rows[0].status).toBe("pending_staff");
});
