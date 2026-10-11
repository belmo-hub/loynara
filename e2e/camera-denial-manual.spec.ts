import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || !["/looplocal_browser_camera_076a", "/looplocal_browser_camera_076b"].includes(database.pathname)) throw new Error("Owned synthetic camera-denial database required");
const origin = "http://localhost:3000";
let merchant: Awaited<ReturnType<typeof createMerchant>>, foreign: typeof merchant;
let storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
const cashierId = randomUUID();

test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  const input = { city: "Kassel", country: "DE" as const, timezone: "Europe/Berlin", locale: "de" as const, currency: "EUR" as const, programType: "stamp" as const, rulesText: "One synthetic explicitly confirmed visit", rewardTitle: "Coffee", rewardCost: 5 };
  for (const name of ["local", "foreign"] as const) {
    const id = randomUUID();
    await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [id, "Synthetic camera owner", `${id}@example.test`]);
    const created = await createMerchant({ ...input, userId: id, businessName: `Synthetic ${name} camera Café`, programName: `Synthetic ${name} camera card` });
    if (name === "local") merchant = created; else foreign = created;
  }
  const password = `Local!${randomUUID()}Aa`;
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [cashierId, "Synthetic camera cashier", `${cashierId}@example.test`]);
  await pool.query("INSERT INTO staff_roles (tenant_id,user_id,role,location_id) VALUES ($1,$2,'cashier',$3)", [merchant.tenantId, cashierId, merchant.locationId]);
  const ctx = await auth.$context;
  await ctx.internalAdapter.linkAccount({ userId: cashierId, accountId: cashierId, providerId: "credential", password: await ctx.password.hash(password) });
  const staff = await browser.newContext({ baseURL });
  try {
    expect((await staff.request.post("/api/auth/sign-in/email", { headers: { Origin: origin }, data: { email: `${cashierId}@example.test`, password } })).status()).toBe(200);
    storage = await staff.storageState();
  } finally { await staff.close(); }
});
test.afterAll(async () => { await pool.end(); });

for (const width of [375, 1280]) test(`actual denied camera preserves scoped manual lookup and exactly-once confirmed awards (${width}px)`, async ({ browser, baseURL }) => {
  const staff = await browser.newContext({ baseURL, storageState: storage, extraHTTPHeaders: { Origin: origin }, viewport: { width, height: 812 } });
  const guest = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const customers: BrowserContext[] = [];
  try {
    const page = await staff.newPage();
    const cdp = await staff.newCDPSession(page);
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    if (!targetInfo.browserContextId) throw new Error("Owned browser context required");
    await cdp.send("Browser.setPermission", { permission: { name: "camera" }, setting: "denied", origin, browserContextId: targetInfo.browserContextId });
    await page.goto("/cashier");
    expect(await page.evaluate(async () => (await navigator.permissions.query({ name: "camera" as PermissionName })).state)).toBe("denied");
    await page.getByRole("button", { name: "Kamera öffnen", exact: true }).click();
    await expect(page.locator(".counter-camera p[role=alert]")).toContainText("Kamerazugriff abgelehnt");
    await expect(page.locator(".counter-camera p[role=alert]")).toContainText("Code manuell");
    await page.getByRole("button", { name: "Kamera erneut versuchen", exact: true }).click();
    await expect(page.locator(".counter-camera p[role=alert]")).toContainText("Kamerazugriff abgelehnt");
    await page.getByRole("button", { name: "Kamera ausschalten", exact: true }).click();
    await expect(page.getByRole("region", { name: "Kassenkamera" })).toHaveCount(0);
    const code = page.getByLabel("Kartennummer oder Kartencode");
    await expect(code).toBeVisible();
    for (const invalid of ["K-000001", "not-a-card"]) {
      await code.fill(invalid); await code.press("Enter");
      await expect(page.locator(".cashier-status")).toContainText("Kartennummer nicht erkannt");
      await expect(page.getByRole("button", { name: "Karte öffnen", exact: true })).toHaveCount(0);
    }
    const foreignJoin = await guest.request.post("/api/enroll", { data: { slug: foreign.programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(foreignJoin.status()).toBe(201);
    const foreignToken = (await foreignJoin.json()).cardToken;
    const foreignCard = await (await guest.request.get(`/api/card/${foreignToken}`)).json();
    await code.fill(foreignCard.cardLocator); await code.press("Enter");
    await expect(page.locator(".cashier-status")).toContainText("Keine aktive Karte");
    expect((await staff.request.get(`/api/cashier/lookup?code=${foreignCard.scanCode}`)).status()).toBe(404);
    for (let i = 0; i < 2; i++) {
      const customer = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
      customers.push(customer);
      const joined = await customer.request.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } });
      expect(joined.status()).toBe(201);
      const token = (await joined.json()).cardToken;
      const card = await (await customer.request.get(`/api/card/${token}`)).json();
      const member = (await pool.query("SELECT id FROM memberships WHERE card_token=$1", [token])).rows[0];
      await code.fill(card.cardLocator); await code.press("Enter");
      await expect(page.locator(".cashier-preview")).toContainText(card.cardLocator);
      await expect(page.locator(".cashier-preview")).toContainText("Synthetic local camera card");
      expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1", [member.id])).rows[0].n).toBe(0);
      const open = page.getByRole("button", { name: "Karte öffnen", exact: true });
      await open.focus(); await page.keyboard.press("Enter");
      await expect(page.locator(".balance-display")).toContainText("0");
      await expect(page.getByRole("note")).toContainText("Per Kartennummer geöffnet, ohne Scan");
      expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1", [member.id])).rows[0].n).toBe(0);
      const booking = page.waitForRequest(r => new URL(r.url()).pathname === "/api/cashier/award");
      const award = page.getByRole("button", { name: "1 Stempel vergeben", exact: true });
      await award.focus(); await page.keyboard.press("Enter");
      const payload = (await booking).postDataJSON();
      await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand: 1 Stempel");
      const retries = await Promise.all([1, 2].map(() => staff.request.post("/api/cashier/award", { data: payload })));
      for (const retry of retries) expect(retry.status()).toBe(200);
      expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1", [member.id])).rows[0].n).toBe(1);
      expect((await customer.request.get(`/api/card/${token}`)).status()).toBe(200);
      expect((await (await customer.request.get(`/api/card/${token}`)).json()).balance).toBe(1);
      await page.getByRole("button", { name: "Andere Karte", exact: true }).click();
    }
    expect((await (await guest.request.get(`/api/card/${foreignToken}`)).json()).balance).toBe(0);
    await page.getByRole("button", { name: "Kamera öffnen", exact: true }).click();
    await expect(page.locator(".counter-camera p[role=alert]")).toContainText("Kamerazugriff abgelehnt");
    await page.getByRole("button", { name: "Kamera ausschalten", exact: true }).click();
    await expect(code).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const anonymous = await guest.request.get("/api/cashier/lookup?code=K-AAAAAA");
    expect(anonymous.status()).toBe(401);
  } finally { for (const customer of customers) await customer.close(); await staff.close(); await guest.close(); }
});

test("a delayed offline sync acknowledgement cannot overwrite a freshly reopened card balance", async ({ browser, baseURL }) => {
  const staff = await browser.newContext({ baseURL, storageState: storage, extraHTTPHeaders: { Origin: origin } });
  const customer = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  let release: (() => void) | undefined;
  try {
    const joined = await customer.request.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const token = (await joined.json()).cardToken;
    const card = await (await customer.request.get(`/api/card/${token}`)).json();
    const member = (await pool.query("SELECT id FROM memberships WHERE card_token=$1", [token])).rows[0];
    const page = await staff.newPage();
    await page.goto("/cashier");
    const lease = page.waitForResponse(r => new URL(r.url()).pathname === "/api/cashier/offline/lease" && r.ok());
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
    await page.getByLabel("Kartennummer oder Kartencode").press("Enter");
    await lease;
    await staff.setOffline(true);
    await expect(page.getByText("Offline-Puffer bereit", { exact: false })).toBeVisible();
    await page.locator(".cashier-award-now").click();
    await page.getByRole("button", { name: "Offline-Vergabe vormerken", exact: true }).click();
    await expect(page.locator(".cashier-booked")).toContainText("Vorgemerkt, noch nicht gebucht");
    expect((await (await customer.request.get(`/api/card/${token}`)).json()).balance).toBe(0);
    await staff.setOffline(false);
    // Keep the real server response at the network boundary while the cashier continues.
    // No fake response payload, ledger mutation, retry timestamp or provider is used.
    const delayed = new Promise<void>(resolve => { release = resolve; });
    let acknowledged!: () => void;
    const committed = new Promise<void>(resolve => { acknowledged = resolve; });
    await page.route("**/api/cashier/offline/sync", async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      expect(await response.json()).toMatchObject({ status: "accepted", balance: 1 });
      acknowledged();
      await delayed;
      await route.fulfill({ response });
    });
    await page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true }).click();
    await committed;
    expect((await (await customer.request.get(`/api/card/${token}`)).json()).balance).toBe(1);
    await page.getByRole("button", { name: "Andere Karte", exact: true }).click();
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
    await page.getByLabel("Kartennummer oder Kartencode").press("Enter");
    await expect(page.locator(".balance-display strong")).toHaveText("1 Stempel");
    await page.getByRole("button", { name: "1 Stempel vergeben", exact: true }).click();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand: 2 Stempel");
    await page.getByRole("button", { name: "Andere Karte", exact: true }).click();
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
    await page.getByLabel("Kartennummer oder Kartencode").press("Enter");
    await expect(page.locator(".balance-display strong")).toHaveText("2 Stempel");
    release!();
    await expect(page.getByText("Vom Server angenommen", { exact: false })).toBeVisible();
    await expect(page.locator(".balance-display strong")).toHaveText("2 Stempel");
    expect((await (await customer.request.get(`/api/card/${token}`)).json()).balance).toBe(2);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1", [member.id])).rows[0].n).toBe(2);
  } finally { release?.(); await staff.close(); await customer.close(); }
});

test("offline synchronization still refreshes the unchanged open card and replay does not add credit", async ({ browser, baseURL }) => {
  const staff = await browser.newContext({ baseURL, storageState: storage, extraHTTPHeaders: { Origin: origin } });
  const customer = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  try {
    const joined = await customer.request.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const token = (await joined.json()).cardToken;
    const card = await (await customer.request.get(`/api/card/${token}`)).json();
    const page = await staff.newPage();
    await page.goto("/cashier");
    const lease = page.waitForResponse(r => new URL(r.url()).pathname === "/api/cashier/offline/lease" && r.ok());
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
    await page.getByLabel("Kartennummer oder Kartencode").press("Enter");
    await lease;
    await staff.setOffline(true);
    await expect(page.getByText("Offline-Puffer bereit", { exact: false })).toBeVisible();
    await page.locator(".cashier-award-now").click();
    await page.getByRole("button", { name: "Offline-Vergabe vormerken", exact: true }).click();
    await expect(page.locator(".cashier-booked")).toContainText("Vorgemerkt, noch nicht gebucht");
    await staff.setOffline(false);
    await page.getByRole("button", { name: "Andere Karte", exact: true }).click();
    await page.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
    await page.getByLabel("Kartennummer oder Kartencode").press("Enter");
    await expect(page.locator(".balance-display strong")).toHaveText("0 Stempel");
    const request = page.waitForRequest(r => new URL(r.url()).pathname === "/api/cashier/offline/sync");
    await page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true }).click();
    const payload = (await request).postDataJSON();
    await expect(page.getByText("Vom Server angenommen", { exact: false })).toBeVisible();
    await expect(page.locator(".balance-display strong")).toHaveText("1 Stempel");
    const replays = await Promise.all([1, 2].map(() => staff.request.post("/api/cashier/offline/sync", { data: payload })));
    for (const replay of replays) {
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toMatchObject({ status: "accepted", duplicate: true, balance: 1 });
    }
    expect((await (await customer.request.get(`/api/card/${token}`)).json()).balance).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries l JOIN memberships m ON m.id=l.membership_id WHERE m.card_token=$1", [token])).rows[0].n).toBe(1);
  } finally { await staff.close(); await customer.close(); }
});
