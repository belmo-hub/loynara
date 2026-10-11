import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { pool } from "../src/db";
import { prepareOfflineAward } from "../src/lib/offline-earning";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || !/^\/looplocal_cashier_124_[a-f0-9]{12}$/.test(database.pathname)) throw new Error("Owned disposable cashier database required");
const origin = "http://localhost:3000";
test.afterAll(async () => { await pool.end(); });
async function fixture(browser: Browser, baseURL: string | undefined) {
  if (baseURL !== origin) throw new Error("Loopback cashier application required");
  const email = `cashier-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const identity = await auth.api.signUpEmail({ body: { name: "Synthetic lease operator", email, password } });
  const merchant = await createMerchant({ userId: identity.user.id, businessName: "Synthetic lease Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Lease isolation", programType: "stamp", rulesText: "One confirmed synthetic visit", rewardTitle: "Coffee", rewardCost: 5 });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin }, viewport: { width: 390, height: 844 } });
  const customer = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  let signed = await context.request.post("/api/auth/sign-in/email", { data: { email, password } });
  if (signed.status() === 429) {
    const delay = Number(signed.headers()["x-retry-after"]);
    expect(delay).toBeGreaterThanOrEqual(0); expect(delay).toBeLessThanOrEqual(30);
    await new Promise(resolve => setTimeout(resolve, (delay + 1) * 1000));
    signed = await context.request.post("/api/auth/sign-in/email", { data: { email, password } });
  }
  expect(signed.status()).toBe(200);
  async function card() {
    const enrolling = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
    const response = await enrolling.request.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(response.status()).toBe(201);
    const token = (await response.json()).cardToken as string;
    const details = await (await enrolling.request.get(`/api/card/${token}`)).json() as { scanCode: string; cardLocator: string; balance: number };
    await enrolling.close();
    return { ...details, token };
  }
  const first = await card();
  const page = await context.newPage(); await page.goto("/cashier");
  async function open(scanCode: string) {
    await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(page.locator(".cashier-award-now")).toBeEnabled();
  }
  return { page, context, customer, first, card, open, userId: identity.user.id, locationId: merchant.locationId, async balance() { return (await (await customer.request.get(`/api/card/${first.token}`)).json()).balance as number; }, async close() { await context.close(); await customer.close(); } };
}
function barrier() {
  let release!: () => void;
  const promise = new Promise<void>(resolve => { release = resolve; });
  return { promise, release };
}
async function switched(page: Page) { await page.locator(".card-result-head").getByRole("button", { name: "Andere Karte" }).click(); }

for (const sameCard of [true, false]) test(`a delayed old lease network failure cannot contaminate a ${sameCard ? "reopened same" : "different"} card`, async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL), old = barrier(), started = barrier();
  let calls = 0;
  await f.page.route("**/api/cashier/offline/lease", async route => {
    if (++calls === 1) { started.release(); await old.promise; await route.abort("failed"); }
    else await route.continue();
  });
  try {
    await f.open(f.first.scanCode); await started.promise;
    await switched(f.page);
    const selected = sameCard ? f.first : await f.card();
    if (!sameCard) expect(selected.scanCode).not.toBe(f.first.scanCode);
    const fresh = f.page.waitForResponse(r => r.url().endsWith("/api/cashier/offline/lease") && r.ok());
    await f.open(selected.scanCode); await fresh;
    const failed = f.page.waitForEvent("requestfailed", { predicate: r => r.url().endsWith("/api/cashier/offline/lease") });
    old.release(); await failed;
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    // A DOM-backed eventual assertion: the old transport failure must not activate the offline fallback.
    await expect(f.page.getByRole("region", { name: "Offline-Vergaben" })).toHaveCount(0);
    await expect(f.page.getByRole("heading", { name: selected.cardLocator, exact: true })).toBeVisible();
    expect(await f.balance()).toBe(0);
  } finally { old.release(); await f.close(); }
});

test("an old lease HTTP failure cannot erase fresh recovery or change exactly-once offline accounting", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL), old = barrier(), started = barrier();
  let calls = 0;
  await f.page.route("**/api/cashier/offline/lease", async route => {
    if (++calls === 1) { started.release(); await old.promise; await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Synthetic OLD lease failure" }) }); }
    else await route.continue();
  });
  try {
    await f.open(f.first.scanCode); await started.promise; await switched(f.page);
    const fresh = f.page.waitForResponse(r => r.url().endsWith("/api/cashier/offline/lease") && r.ok());
    await f.open(f.first.scanCode); const leaseId = (await (await fresh).json()).leaseId as string;
    const failed = f.page.waitForResponse(r => r.url().endsWith("/api/cashier/offline/lease") && r.status() === 503);
    old.release(); await failed;
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await f.context.setOffline(true);
    await expect(f.page.getByText("Offline-Puffer bereit", { exact: false })).toBeVisible();
    await expect(f.page.getByText("Synthetic OLD lease failure", { exact: true })).toHaveCount(0);
    await f.page.locator(".cashier-award-now").click();
    await f.page.getByRole("button", { name: "Offline-Vergabe vormerken", exact: true }).click();
    await expect(f.page.getByText("1 ausstehend", { exact: false })).toBeVisible();
    const queued = await f.page.evaluate(() => JSON.parse(localStorage.getItem("looplocal.offline.events.v1") ?? "[]"));
    expect(queued).toHaveLength(1); expect(queued[0].leaseId).toBe(leaseId); expect(await f.balance()).toBe(0);
    await f.context.setOffline(false);
    await f.page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true }).click();
    await expect(f.page.getByText("Vom Server angenommen", { exact: false })).toBeVisible();
    expect(await f.balance()).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM ledger_entries l JOIN memberships m ON m.id=l.membership_id WHERE m.card_token=$1", [f.first.token])).rows[0].count)).toBe(1);
  } finally { old.release(); await f.close(); }
});

test("a current lease network failure remains visible and never credits a customer", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL);
  let calls = 0;
  await f.page.route("**/api/cashier/offline/lease", route => ++calls === 1 ? route.abort("failed") : route.continue());
  try {
    await f.open(f.first.scanCode);
    await expect(f.page.getByRole("region", { name: "Offline-Vergaben" })).toContainText("Keine Verbindung");
    await expect(f.page.getByText("Offline-Puffer bereit", { exact: false })).toHaveCount(0);
    expect(await f.balance()).toBe(0);
    await switched(f.page);
    const recovered = f.page.waitForResponse(r => r.url().endsWith("/api/cashier/offline/lease") && r.ok());
    await f.open(f.first.scanCode); await recovered;
    await expect(f.page.getByRole("region", { name: "Offline-Vergaben" })).toHaveCount(0);
    await f.context.setOffline(true);
    await expect(f.page.getByText("Offline-Puffer bereit", { exact: false })).toBeVisible();
  } finally { await f.close(); }
});


test("a historical lease success cannot replace the current same-card lease", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL), old = barrier(), started = barrier();
  let calls = 0, historicalId = "";
  await f.page.route("**/api/cashier/offline/lease", async route => {
    if (++calls !== 1) { await route.continue(); return; }
    // A real domain-issued lease at a historical synthetic clock models a response held beyond its lifetime.
    // No database rows or authorization guards are rewritten; the fresh request uses the actual HTTP endpoint.
    const historical = await prepareOfflineAward({ ...route.request().postDataJSON(), userId: f.userId, locationId: f.locationId, now: new Date(Date.now() - 60 * 60_000) });
    expect(historical.expiresAt.getTime()).toBeLessThan(Date.now());
    historicalId = historical.leaseId; started.release(); await old.promise;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(historical) });
  });
  try {
    await f.open(f.first.scanCode); await started.promise; await switched(f.page);
    const fresh = f.page.waitForResponse(r => r.url().endsWith("/api/cashier/offline/lease") && r.ok());
    await f.open(f.first.scanCode); const current = await (await fresh).json() as { leaseId: string; expiresAt: string };
    const leaseId = current.leaseId;
    expect(new Date(current.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(leaseId).not.toBe(historicalId);
    const stale = f.page.waitForResponse(r => r.url().endsWith("/api/cashier/offline/lease") && r.ok());
    old.release(); await stale;
    await f.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await f.context.setOffline(true); await f.page.locator(".cashier-award-now").click();
    await f.page.getByRole("button", { name: "Offline-Vergabe vormerken", exact: true }).click();
    const queued = await f.page.evaluate(() => JSON.parse(localStorage.getItem("looplocal.offline.events.v1") ?? "[]"));
    expect(queued).toHaveLength(1); expect(queued[0].leaseId).toBe(leaseId); expect(await f.balance()).toBe(0);
    await f.context.setOffline(false);
    await f.page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true }).click();
    await expect(f.page.getByText("Vom Server angenommen", { exact: false })).toBeVisible();
    expect(await f.balance()).toBe(1);
    expect(Number((await pool.query("SELECT count(*) FROM ledger_entries l JOIN memberships m ON m.id=l.membership_id WHERE m.card_token=$1", [f.first.token])).rows[0].count)).toBe(1);
  } finally { old.release(); await f.close(); }
});
