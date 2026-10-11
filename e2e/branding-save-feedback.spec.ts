import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { addStaff } from "../src/lib/nfc-test-db";
import { createMerchant } from "../src/lib/product";
import { getMerchantBrand } from "../src/lib/merchant-brand";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_brand_068a") throw new Error("Dedicated synthetic branding database required");
async function merchantFixture() {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic branding owner", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: "Synthetic brand Café", locationName: "Synthetic Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic brand card", programType: "stamp", rulesText: "One synthetic visit", rewardTitle: "Coffee", rewardCost: 5 });
  return { userId, ...merchant };
}
let own: Awaited<ReturnType<typeof merchantFixture>>, foreign: typeof own;
let customerCardToken: string;
let storage: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
let cashierStorage: typeof storage;
let guestStorage: typeof storage;
const password = `Local!${randomUUID()}Aa`;
const origin = "http://localhost:3000";
async function credential(userId: string) { const ctx = await auth.$context; await ctx.internalAdapter.linkAccount({ userId, accountId: userId, providerId: "credential", password: await ctx.password.hash(password) }); }
async function signIn(context: import("@playwright/test").BrowserContext, userId: string) {
  expect((await context.request.post("/api/auth/sign-in/email", { headers: { Origin: origin }, data: { email: `${userId}@example.test`, password } })).status()).toBe(200);
}
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  own = await merchantFixture(); foreign = await merchantFixture();
  const guest = await browser.newContext({ baseURL });
  try { const enrolled = await guest.request.post("/api/enroll", { headers: { Origin: origin }, data: { slug: own.programSlug, acceptedTerms: true, marketingOptIn: false } }); expect(enrolled.status()).toBe(201); customerCardToken = (await enrolled.json()).cardToken; guestStorage = await guest.storageState(); }
  finally { await guest.close(); }
  await credential(own.userId); const cashier = await addStaff(own.tenantId, own.locationId, "cashier"); await credential(cashier);
  for (const userId of [own.userId, cashier]) {
    const context = await browser.newContext({ baseURL });
    try { await signIn(context, userId); if (userId === own.userId) storage = await context.storageState(); else cashierStorage = await context.storageState(); }
    finally { await context.close(); }
  }
});
test.afterAll(async () => { await pool.end(); });
async function pageFor(browser: Browser, baseURL: string | undefined, width: number) {
  const context = await browser.newContext({ baseURL, storageState: storage, viewport: { width, height: 812 } });
  const page = await context.newPage(); await page.goto("/merchant/program/card");
  await expect(page.getByLabel("Geschäftsname", { exact: true })).toBeVisible();
  return { context, page, status: page.locator(".ow-savestate"), save: page.getByRole("button", { name: "Kundenkarte speichern", exact: true }) };
}
async function publicBrand(context: import("@playwright/test").BrowserContext, name: string, location: string) {
  const response = await context.request.get(`/api/program/${own.programSlug}`); expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ businessName: name, locationName: location });
  const card = await context.request.get(`/api/card/${customerCardToken}`); expect(card.status()).toBe(200);
  expect(await card.json()).toMatchObject({ merchantName: name, locationName: location });
}
for (const width of [375, 1280]) {
  test(`lost committed save response stays uncertain and retains editable draft (${width}px)`, async ({ browser, baseURL }) => {
    const p = await pageFor(browser, baseURL, width); const name = `Committed-${randomUUID()}`; const location = `Location-${width}`; let writes = 0;
    const foreignBefore = await getMerchantBrand({ actorUserId: foreign.userId, programSlug: foreign.programSlug });
    try {
      await p.page.getByLabel("Geschäftsname", { exact: true }).fill(name); await p.page.getByLabel("Standortname", { exact: true }).fill(location);
      await p.page.route("**/api/merchant/program/brand", async route => {
        if (route.request().method() !== "POST") return route.continue();
        writes++; const actual = await route.fetch(); expect(actual.status()).toBe(200); expect(await actual.json()).toMatchObject({ businessName: name, locationName: location }); await route.abort("connectionreset");
      });
      await p.save.click(); await expect(p.status).toContainText("Speicherstatus unklar");
      await expect(p.status).not.toContainText("Speichern fehlgeschlagen");
      await expect(p.page.getByLabel("Geschäftsname", { exact: true })).toHaveValue(name);
      await expect(p.page.getByLabel("Standortname", { exact: true })).toHaveValue(location);
      expect(writes).toBe(1);
      if (width === 375) { await p.status.scrollIntoViewIfNeeded(); await p.page.screenshot({ path: "/tmp/loy-068-save-uncertainty-mobile.png" }); }
      await publicBrand(p.context, name, location);
      expect(await getMerchantBrand({ actorUserId: foreign.userId, programSlug: foreign.programSlug })).toEqual(foreignBefore);
      await p.page.unroute("**/api/merchant/program/brand");
      // A manual reload reads the server-authoritative committed configuration.
      // No automatic replay or invented save failure is needed to recover.
      await p.page.reload(); await expect(p.page.getByLabel("Geschäftsname", { exact: true })).toHaveValue(name);
      await expect(p.status).toContainText("Keine Änderungen"); expect(writes).toBe(1);
      expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await p.context.close(); }
  });
  test(`late save acknowledgment preserves newer owner edits (${width}px)`, async ({ browser, baseURL }) => {
    const p = await pageFor(browser, baseURL, width); const first = `Submitted-${randomUUID()}`; const newer = `Newer-${randomUUID()}`; let release!: () => void; let started!: () => void;
    const hold = new Promise<void>(r => { release = r; }); const committed = new Promise<void>(r => { started = r; });
    try {
      await p.page.getByLabel("Geschäftsname", { exact: true }).fill(first);
      await p.page.route("**/api/merchant/program/brand", async route => {
        if (route.request().method() !== "POST") return route.continue();
        const actual = await route.fetch(); expect(actual.status()).toBe(200); started(); await hold; await route.fulfill({ response: actual });
      });
      await p.save.click(); await committed;
      await p.page.getByLabel("Geschäftsname", { exact: true }).fill(newer);
      await p.page.getByLabel("Standortname", { exact: true }).fill("Newer location");
      await p.page.getByLabel("Farbwert (Hex)", { exact: true }).fill("#7c3848");
      const acknowledged = p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/merchant/program/brand" && r.request().method() === "POST");
      release(); await (await acknowledged).finished();
      await expect(p.page.getByLabel("Geschäftsname", { exact: true })).toHaveValue(newer);
      await expect(p.page.getByLabel("Standortname", { exact: true })).toHaveValue("Newer location");
      await expect(p.page.getByLabel("Farbwert (Hex)", { exact: true })).toHaveValue("#7c3848");
      await expect(p.status).toContainText("Ungespeicherte Änderungen"); await expect(p.save).toBeEnabled();
      expect((await getMerchantBrand({ actorUserId: own.userId, programSlug: own.programSlug })).businessName).toBe(first);
      await p.page.unroute("**/api/merchant/program/brand");
      await p.save.click(); await expect(p.status).toContainText("Gespeichert");
      const brand = await getMerchantBrand({ actorUserId: own.userId, programSlug: own.programSlug }); expect(brand.businessName).toBe(newer); await publicBrand(p.context, newer, brand.locationName);
      await p.page.reload(); await expect(p.page.getByLabel("Geschäftsname", { exact: true })).toHaveValue(newer);
      expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { release?.(); await p.context.close(); }
  });
}

async function persistedSnapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["tenants", "locations", "memberships", "ledger_entries", "consent_events", "outbox_jobs"]) result[table] = (await pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`)).rows[0].data;
  return result;
}
for (const width of [375, 1280]) test(`definitive terminated-session rejection preserves draft and legitimate retry (${width}px)`, async ({ browser, baseURL }) => {
  const p = await pageFor(browser, baseURL, width); const name = `Retry-${randomUUID()}`;
  try {
    await p.page.getByLabel("Geschäftsname", { exact: true }).fill(name);
    expect((await p.context.request.post("/api/auth/sign-out", { headers: { Origin: origin }, data: {} })).status()).toBe(200);
    const before = await persistedSnapshot();
    const failed = p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/merchant/program/brand" && r.request().method() === "POST");
    await p.save.click(); expect((await failed).status()).toBe(401);
    await expect(p.status).toContainText("Speichern fehlgeschlagen"); await expect(p.status).not.toContainText("Gespeichert");
    await expect(p.page.getByLabel("Geschäftsname", { exact: true })).toHaveValue(name); expect(await persistedSnapshot()).toEqual(before);
    await signIn(p.context, own.userId); storage = await p.context.storageState();
    await p.save.click(); await expect(p.status).toContainText("Gespeichert");
    await publicBrand(p.context, name, (await getMerchantBrand({ actorUserId: own.userId, programSlug: own.programSlug })).locationName);
    await p.page.reload(); await expect(p.page.getByLabel("Geschäftsname", { exact: true })).toHaveValue(name);
    expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await p.context.close(); }
});
test("staff and foreign tenant branding writes are denied without any persisted change", async ({ browser, baseURL }) => {
  const staff = await browser.newContext({ baseURL, storageState: cashierStorage }); const owner = await browser.newContext({ baseURL, storageState: storage });
  try {
    const before = await persistedSnapshot(); const data = { programSlug: own.programSlug, businessName: "Unauthorized", locationName: "Unauthorized", brandColor: "#123456" };
    expect((await staff.request.post("/api/merchant/program/brand", { headers: { Origin: origin }, data })).status()).toBe(403);
    expect((await owner.request.post("/api/merchant/program/brand", { headers: { Origin: origin }, data: { ...data, programSlug: foreign.programSlug } })).status()).toBe(403);
    expect(await persistedSnapshot()).toEqual(before);
  } finally { await staff.close(); await owner.close(); }
});
for (const width of [375, 1280]) test(`first visit and returning customer display persisted branding (${width}px)`, async ({ browser, baseURL }) => {
  const brand = await getMerchantBrand({ actorUserId: own.userId, programSlug: own.programSlug });
  for (const returning of [false, true]) {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 812 }, ...(returning ? { storageState: guestStorage } : {}) });
    try {
      const page = await context.newPage(); await page.goto(`/join/${own.programSlug}`);
      await expect(page.locator(".join-hero")).toContainText(brand.businessName); await expect(page.locator(".join-hero")).toContainText(brand.locationName);
      if (returning) { await expect(page.getByRole("heading", { name: "Willkommen zurück.", exact: true })).toBeVisible(); await page.getByRole("link", { name: "Meine Karte öffnen", exact: true }).click(); await expect(page.locator(".customer-card")).toContainText(brand.businessName); }
      else await expect(page.getByRole("button", { name: "Meine Karte erstellen", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await context.close(); }
  }
});
