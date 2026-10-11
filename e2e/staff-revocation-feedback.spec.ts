import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { addStaff, nfcFixture } from "../src/lib/nfc-test-db";
import { pool } from "../src/db";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_report_069a") throw new Error("Dedicated synthetic staff feedback database required");
const origin = "http://localhost:3000";
let own: Awaited<ReturnType<typeof nfcFixture>>;
let storage: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
const password = `Local!${randomUUID()}Aa`;
async function signIn(context: import("@playwright/test").BrowserContext) {
  expect((await context.request.post("/api/auth/sign-in/email", { headers: { Origin: origin }, data: { email: `${own.userId}@example.test`, password } })).status()).toBe(200);
}
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["staff_roles", "staff_invites", "staff_audit_events", "ledger_entries", "consent_events", "outbox_jobs"]) result[table] = (await pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`)).rows[0].data;
  return result;
}
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  own = await nfcFixture({ tapMode: "disabled" }); await nfcFixture({ tapMode: "disabled" });
  const ctx = await auth.$context; await ctx.internalAdapter.linkAccount({ userId: own.userId, accountId: own.userId, providerId: "credential", password: await ctx.password.hash(password) });
  const context = await browser.newContext({ baseURL });
  try { await signIn(context); storage = await context.storageState(); } finally { await context.close(); }
});
test.afterAll(async () => { await pool.end(); });
for (const width of [375, 1280]) for (const same of [false, true]) test(`obsolete revocation rejection cannot discard a newer confirmation (${width}px, same=${same})`, async ({ browser, baseURL }) => {
  const first = await addStaff(own.tenant.id, own.location.id, "cashier"); const second = await addStaff(own.tenant.id, own.location.id, "manager"); const selected = same ? first : second;
  const context = await browser.newContext({ baseURL, storageState: storage, viewport: { width, height: 812 } });
  const page = await context.newPage(); let release!: () => void; let started!: () => void;
  const hold = new Promise<void>(r => { release = r; }); const denied = new Promise<void>(r => { started = r; }); let writes = 0;
  const row = (id: string) => page.locator('section[aria-labelledby="st-list"]').getByRole('listitem').filter({ hasText: `${id}@example.test` });
  const dialog = page.getByRole('alertdialog', { name: 'Zugang sperren?', exact: true });
  try {
    await page.goto('/merchant/staff'); await row(first).getByRole('button', { name: 'Sperren', exact: true }).click();
    expect((await context.request.post('/api/auth/sign-out', { headers: { Origin: origin }, data: {} })).status()).toBe(200); const before = await snapshot();
    await page.route('**/api/staff/revoke', async route => {
      writes++; expect(route.request().postDataJSON()).toEqual({ userId: first }); const actual = await route.fetch(); expect(actual.status()).toBe(401); started(); await hold; await route.fulfill({ response: actual });
    });
    await dialog.getByRole('button', { name: 'Zugang sperren', exact: true }).click(); await denied;
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await row(selected).getByRole('button', { name: 'Sperren', exact: true }).click();
    await expect(dialog).toContainText(`${selected}@example.test`);
    await expect(dialog.getByRole('button', { name: 'Zugang sperren', exact: true })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Wird gesperrt …', exact: true })).toHaveCount(0);
    const completed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/staff/revoke'); release(); expect((await completed).status()).toBe(401);
    await expect(dialog).toBeVisible(); await expect(dialog).toContainText(`${selected}@example.test`);
    await expect(dialog.getByRole('button', { name: 'Zugang sperren', exact: true })).toBeEnabled();
    expect(writes).toBe(1); expect(await snapshot()).toEqual(before);
    if (width === 375 && !same) await page.screenshot({ path: '/tmp/loy-069-staff-confirmation-mobile.png', animations: 'disabled' });
    await expect(page.locator('.ow-notice[role="alert"]')).toBeVisible(); await expect(page.getByText('Der Teamzugang wurde gesperrt.', { exact: true })).toHaveCount(0);
    await page.unroute('**/api/staff/revoke'); await signIn(context); storage = await context.storageState();
    await dialog.getByRole('button', { name: 'Zugang sperren', exact: true }).click();
    await expect(dialog).toHaveCount(0); await expect(row(selected)).toContainText('Gesperrt'); await expect(row(same ? second : first)).toContainText('Aktiv');
    expect((await pool.query('SELECT active FROM staff_roles WHERE user_id=$1 AND tenant_id=$2', [selected,own.tenant.id])).rows[0].active).toBe(false);
    expect((await pool.query('SELECT count(*)::int AS count FROM staff_audit_events WHERE subject_user_id=$1 AND action=$2', [selected,'access_revoked'])).rows[0].count).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { release?.(); await context.close(); }
});

for (const width of [375, 1280]) test(`old committed revocation reloads its result and preserves another pending confirmation (${width}px)`, async ({ browser, baseURL }) => {
  const first = await addStaff(own.tenant.id, own.location.id, "cashier"); const second = await addStaff(own.tenant.id, own.location.id, "manager");
  const context = await browser.newContext({ baseURL, storageState: storage, viewport: { width, height: 812 } }); const page = await context.newPage();
  let release!: () => void; let started!: () => void; let writes = 0;
  const hold = new Promise<void>(r => { release = r; }); const committed = new Promise<void>(r => { started = r; });
  const row = (id: string) => page.locator('section[aria-labelledby="st-list"]').getByRole('listitem').filter({ hasText: `${id}@example.test` }); const dialog = page.getByRole('alertdialog', { name: 'Zugang sperren?', exact: true });
  try {
    await page.goto('/merchant/staff'); await row(first).getByRole('button', { name: 'Sperren', exact: true }).click();
    await page.route('**/api/staff/revoke', async route => { writes++; expect(route.request().postDataJSON()).toEqual({ userId: first }); const actual = await route.fetch(); expect(actual.status()).toBe(200); started(); await hold; await route.fulfill({ response: actual }); });
    await dialog.getByRole('button', { name: 'Zugang sperren', exact: true }).click(); await committed;
    const afterCommit = await snapshot();
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await row(second).getByRole('button', { name: 'Sperren', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Zugang sperren', exact: true })).toBeDisabled();
    const completion = page.waitForResponse(r => new URL(r.url()).pathname === '/api/staff/revoke'); release(); expect((await completion).status()).toBe(200);
    await expect(dialog).toContainText(`${second}@example.test`); await expect(dialog.getByRole('button', { name: 'Zugang sperren', exact: true })).toBeEnabled();
    await expect(row(first)).toContainText('Gesperrt'); await expect(row(second)).toContainText('Aktiv'); expect(writes).toBe(1); expect(await snapshot()).toEqual(afterCommit);
    await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click(); await expect(dialog).toHaveCount(0); expect(await snapshot()).toEqual(afterCommit);
    expect((await pool.query('SELECT count(*)::int AS count FROM staff_audit_events WHERE subject_user_id=$1 AND action=$2', [first,'access_revoked'])).rows[0].count).toBe(1);
    expect((await pool.query('SELECT count(*)::int AS count FROM staff_audit_events WHERE subject_user_id=$1 AND action=$2', [second,'access_revoked'])).rows[0].count).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { release?.(); await context.close(); }
});
