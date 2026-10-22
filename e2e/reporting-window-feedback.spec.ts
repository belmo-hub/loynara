import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { nfcFixture } from "../src/lib/nfc-test-db";
import { eq } from "drizzle-orm";
import { ledgerEntries, memberships } from "../src/db/schema";
import { db, pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_report_069a") throw new Error("Dedicated synthetic reporting database required");
const origin = "http://localhost:3000";
let own: Awaited<ReturnType<typeof nfcFixture>>;
let storage: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
const password = `Local!${randomUUID()}Aa`;
async function signIn(context: import("@playwright/test").BrowserContext) {
  expect((await context.request.post("/api/auth/sign-in/email", { headers: { Origin: origin }, data: { email: `${own.userId}@example.test`, password } })).status()).toBe(200);
}
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  own = await nfcFixture({ tapMode: "disabled" });
  // Historical synthetic events are inserted once, following the established
  // analytics fixture pattern. The append-only ledger guard remains enabled.
  await db.update(memberships).set({ balance: 2 }).where(eq(memberships.id, own.member.id));
  await db.insert(ledgerEntries).values([1, 60].map(days => ({ tenantId: own.tenant.id, locationId: own.location.id, membershipId: own.member.id, actorUserId: own.userId, requestId: randomUUID(), idempotencyKey: randomUUID(), kind: "award" as const, source: "staff_online" as const, delta: 1, createdAt: new Date(Date.now() - days * 86_400_000) })));
  const ctx = await auth.$context; await ctx.internalAdapter.linkAccount({ userId: own.userId, accountId: own.userId, providerId: "credential", password: await ctx.password.hash(password) });
  const context = await browser.newContext({ baseURL });
  try { await signIn(context); storage = await context.storageState(); } finally { await context.close(); }
});
test.afterAll(async () => { await pool.end(); });
for (const width of [375, 1280]) test(`supported window ignores late obsolete report and failed read is recoverable (${width}px)`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: storage, viewport: { width, height: 812 } });
  const page = await context.newPage(); let release!: () => void; let started!: () => void;
  const hold = new Promise<void>(r => { release = r; }); const fetched = new Promise<void>(r => { started = r; });
  const metric = page.locator('.ow-metric').filter({ has: page.getByRole('heading', { name: 'Bestätigte Buchungen', exact: true }) }).locator('.ow-metric-value');
  try {
    await page.goto('/merchant/analytics'); await expect(metric).toHaveText('1');
    await page.route('**/api/merchant/analytics?window=90', async route => {
      const actual = await route.fetch(); expect(actual.status()).toBe(200); const report = await actual.json(); expect(report).toMatchObject({ windowDays: 90, qualifyingCheckouts: 2 });
      expect(report.locationActivity[0]).toMatchObject({ locationId: own.location.id, awardActions: 2 }); expect(report.staffActivity[0]).toMatchObject({ userId: own.userId, awardActions: 2 }); started(); await hold; await route.fulfill({ response: actual });
    });
    await page.getByLabel('Zeitraum', { exact: true }).selectOption('90'); await fetched;
    await expect(metric).toHaveCount(0);
    await page.getByLabel('Zeitraum', { exact: true }).selectOption('30'); await expect(metric).toHaveText('1');
    const obsolete = page.waitForResponse(r => new URL(r.url()).pathname === '/api/merchant/analytics' && new URL(r.url()).searchParams.get('window') === '90'); release(); await (await obsolete).finished();
    await expect(page.getByLabel('Zeitraum', { exact: true })).toHaveValue('30'); await expect(metric).toHaveText('1');
    await page.unroute('**/api/merchant/analytics?window=90');
    expect((await context.request.post('/api/auth/sign-out', { headers: { Origin: origin }, data: {} })).status()).toBe(200);
    const rejection = page.waitForResponse(r => new URL(r.url()).pathname === '/api/merchant/analytics' && new URL(r.url()).searchParams.get('window') === '90');
    await page.getByLabel('Zeitraum', { exact: true }).selectOption('90'); expect((await rejection).status()).toBe(401);
    await expect(page.locator('.ow-notice[role="alert"]')).toBeVisible(); await expect(metric).toHaveCount(0);
    await signIn(context); storage = await context.storageState(); await page.getByRole('button', { name: 'Erneut laden', exact: true }).click();
    await expect(page.getByLabel('Zeitraum', { exact: true })).toHaveValue('90'); await expect(metric).toHaveText('2');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { release?.(); await context.close(); }
});
