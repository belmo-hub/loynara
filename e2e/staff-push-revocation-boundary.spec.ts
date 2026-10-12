import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { addStaff, nfcFixture } from "../src/lib/nfc-test-db";
import { deliverTapPush, saveStaffPushSubscription } from "../src/lib/staff-push";
import { pool } from "../src/db";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid"), origin = "http://localhost:3000";
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || database.pathname !== "/looplocal_browser_push_135") throw new Error("Owned synthetic push boundary database required");
const vapid = { VAPID_PUBLIC_KEY: `B${"A".repeat(86)}`, VAPID_PRIVATE_KEY: "C".repeat(43), VAPID_SUBJECT: "mailto:ops@example.test" };
const keys = { p256dh: `B${"x".repeat(86)}`, auth: "a".repeat(22) };
const original = { ...process.env };
test.beforeAll(() => { Object.assign(process.env, vapid); });
test.afterAll(async () => { for (const key of Object.keys(vapid)) { if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; } await pool.end(); });

for (const width of [375, 1280]) test(`committed owner revocation suppresses a previously selected push recipient (${width}px)`, async ({ browser, baseURL }) => {
  expect(baseURL).toBe(origin);
  const f = await nfcFixture(), foreign = await nfcFixture(), cashier = await addStaff(f.tenant.id, f.location.id, "cashier");
  const password = `Local!${randomUUID()}Aa`, adapter = await auth.$context;
  for (const userId of [f.userId, cashier]) await adapter.internalAdapter.linkAccount({ userId, accountId: userId, providerId: "credential", password: await adapter.password.hash(password) });
  const owner = await browser.newContext({ baseURL, viewport: { width, height: 844 }, extraHTTPHeaders: { Origin: origin } });
  const staff = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  try {
    for (const [context, userId] of [[owner, f.userId], [staff, cashier]] as const) expect((await context.request.post("/api/auth/sign-in/email", { data: { email: `${userId}@example.test`, password } })).status()).toBe(200);
    const login = (await pool.query('SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1', [cashier])).rows[0].id as string;
    await saveStaffPushSubscription({ userId: cashier, sessionId: login, tenantId: f.tenant.id, locationId: f.location.id, subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/synthetic-135-${randomUUID()}`, keys } });
    const tag = randomUUID();
    await pool.query("INSERT INTO secure_tags (id,public_ref,tenant_id,location_id,program_id,uid,key_ref,config_version,status) VALUES ($1,$2,$3,$4,$5,$6,'synthetic',1,'active')", [tag, randomUUID().replaceAll("-", "").slice(0,24), f.tenant.id, f.location.id, f.program.id, `04${randomUUID().replaceAll("-", "").slice(0,12)}`]);
    const request = (await pool.query("INSERT INTO tap_requests (tag_id,counter,tenant_id,location_id,program_id,membership_id,status,expires_at) VALUES ($1,1,$2,$3,$4,$5,'pending_staff',now()+interval '300 seconds') RETURNING id", [tag, f.tenant.id, f.location.id, f.program.id, f.member.id])).rows[0].id as string;
    const page = await owner.newPage(); await page.goto("/merchant/staff");
    const row = page.locator('section[aria-labelledby="st-list"]').getByRole("listitem").filter({ hasText: `${cashier}@example.test` });
    await row.getByRole("button", { name: "Sperren", exact: true }).click();
    let sends = 0;
    const result = await deliverTapPush({ payload: { tapRequestId: request } }, { env: vapid, send: async () => { sends++; return { statusCode: 201, body: "", headers: {} }; }, renew: async () => {
      const response = page.waitForResponse(r => new URL(r.url()).pathname === "/api/staff/revoke");
      await page.getByRole("alertdialog", { name: "Zugang sperren?", exact: true }).getByRole("button", { name: "Zugang sperren", exact: true }).click();
      expect((await response).status()).toBe(200); await expect(row).toContainText("Gesperrt"); return true;
    } });
    expect(sends).toBe(0); expect(result.sent).toBe(0);
    const denied = await staff.request.post("/api/cashier/award", { data: { membershipId: f.member.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } });
    expect(denied.status()).toBe(403);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=ANY($1)", [[f.member.id,foreign.member.id]])).rows).toEqual([{ balance: 0 }, { balance: 0 }]);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=ANY($1)", [[f.tenant.id,foreign.tenant.id]])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM staff_audit_events WHERE tenant_id=$1 AND subject_user_id=$2 AND action='access_revoked'", [f.tenant.id,cashier])).rows[0].n).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await owner.close(); await staff.close(); }
});
