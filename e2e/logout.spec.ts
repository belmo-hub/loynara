import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";

type Role = "owner" | "manager" | "cashier";

async function account(baseURL: string) {
  const url = new URL(baseURL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error("Logout tests require the synthetic local app");
  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: url.origin } });
  const email = `logout-${randomUUID()}@example.test`;
  const password = `Local!${randomUUID()}Aa`;
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Synthetic logout user", email, password } })).status()).toBe(200);
  return { api, email, password };
}

async function merchant(baseURL: string, businessName = "Synthetic Logout A") {
  const user = await account(baseURL);
  const response = await user.api.post("/api/merchant/onboard", { data: {
    businessName, locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Logout test card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5,
  } });
  expect(response.status()).toBe(201);
  return { ...user, ...(await response.json() as { tenantId: string; locationId: string }) };
}

async function fixture(baseURL: string, role: Role) {
  const owner = await merchant(baseURL);
  let staff: Awaited<ReturnType<typeof account>> | undefined;
  if (role !== "owner") {
    staff = await account(baseURL);
    const invited = await owner.api.post("/api/staff/invite", { data: { email: staff.email, locationId: owner.locationId, role } });
    expect(invited.status()).toBe(201);
    const { token } = await invited.json() as { token: string };
    expect((await staff.api.post("/api/staff/accept", { data: { token } })).status()).toBe(200);
  }
  return { user: staff ?? owner, dispose: () => Promise.all([owner.api.dispose(), staff?.api.dispose()]) };
}

async function unauthenticated(api: APIRequestContext) {
  expect((await api.get("/api/auth/get-session")).status()).toBe(200);
  expect(await (await api.get("/api/auth/get-session")).json()).toBeNull();
  for (const path of ["/api/me", "/api/merchant/customers", `/api/cashier/lookup?code=sc_${"a".repeat(32)}`]) {
    expect((await api.get(path)).status(), path).toBe(401);
  }
}

for (const role of ["owner", "manager", "cashier"] as const) {
  test(`${role} can sign out and Back cannot restore authenticated access`, async ({ baseURL, browser }) => {
    const url = baseURL ?? "http://localhost:3000";
    const f = await fixture(url, role);
    const context = await browser.newContext({ baseURL: url, storageState: await f.user.api.storageState() });
    const oldCookie = (await context.cookies()).map(cookie => `${cookie.name}=${cookie.value}`).join("; ");
    const replay = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Cookie: oldCookie } });
    try {
      expect((await replay.get("/api/me")).status()).toBe(200);
      const page = await context.newPage();
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(role === "cashier" ? "/cashier" : "/merchant");
      await page.getByRole("button", { name: role === "cashier" ? "Menü: Sprache und Abmelden" : "Navigation öffnen" }).click();
      await expect(page.getByRole("button", { name: "Abmelden", exact: true })).toBeVisible();
      // The mobile drawer is visible before its opening transition reaches the viewport.
      await expect.poll(async () => (await page.getByRole("button", { name: "Abmelden", exact: true }).boundingBox())?.x ?? -1).toBeGreaterThanOrEqual(0);
      const control = await page.getByRole("button", { name: "Abmelden", exact: true }).boundingBox();
      expect(control).not.toBeNull();
      expect(control!.x).toBeGreaterThanOrEqual(0);
      expect(control!.x + control!.width).toBeLessThanOrEqual(320);
      expect(control!.height).toBeGreaterThanOrEqual(44);
      await page.setViewportSize({ width: 1280, height: 800 });
      // Leave an earlier protected history entry; replace must not just hide the current page.
      await page.goto(role === "cashier" ? "/cashier?logout-test=1" : "/merchant/program");
      if (role === "cashier") await page.getByRole("button", { name: "Menü: Sprache und Abmelden" }).click();
      await expect(page.getByRole("button", { name: "Abmelden", exact: true })).toBeVisible();
      const response = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-out") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Abmelden", exact: true }).focus();
      await page.keyboard.press("Enter");
      expect((await response).status()).toBe(200);
      await expect(page).toHaveURL(`${url}/login`);
      await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeVisible();
      await unauthenticated(context.request);
      await unauthenticated(replay); // Replaying the old cookie must fail: session deletion, not cookie-only logout.
      await page.goBack();
      await expect(page).toHaveURL(`${url}/login`);
      await expect(page.locator(".ow-who, .cashier-location")).toHaveCount(0);
      await unauthenticated(context.request);
    } finally { await context.close(); await replay.dispose(); await f.dispose(); }
  });
}

test("failed sign-out preserves access, reports an error and allows retry", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const f = await fixture(url, "owner");
  const context = await browser.newContext({ baseURL: url, storageState: await f.user.api.storageState() });
  try {
    const page = await context.newPage();
    await page.goto("/merchant");
    let release!: () => void;
    const pending = new Promise<void>(resolve => { release = resolve; });
    await page.route("**/api/auth/sign-out", async route => {
      await pending;
      await route.fulfill({ status: 503, json: { message: "Synthetic temporary failure" } });
    });
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page.getByRole("button", { name: "Abmeldung läuft …", exact: true })).toBeDisabled();
    release();
    await expect(page.locator(".owner-app").getByRole("alert")).toContainText("Abmelden fehlgeschlagen");
    await expect(page).toHaveURL(`${url}/merchant`);
    expect((await context.request.get("/api/me")).status()).toBe(200);
    await page.unroute("**/api/auth/sign-out");
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page).toHaveURL(`${url}/login`);
    await unauthenticated(context.request);
  } finally { await context.close(); await f.dispose(); }
});

for (const role of ["owner", "cashier"] as const) {
  test(`${role} rechecks authentication when a cached page is restored`, async ({ baseURL, browser }) => {
    const url = baseURL ?? "http://localhost:3000";
    const f = await fixture(url, role);
    const context = await browser.newContext({ baseURL: url, storageState: await f.user.api.storageState() });
    try {
      const page = await context.newPage();
      await page.goto(role === "cashier" ? "/cashier" : "/merchant");
      if (role === "cashier") await page.getByRole("button", { name: "Menü: Sprache und Abmelden" }).click();
      await expect(page.getByRole("button", { name: "Abmelden", exact: true })).toBeVisible();
      expect((await context.request.post("/api/auth/sign-out", { headers: { Origin: url }, data: {} })).status()).toBe(200);
      // Automation can disable native BFCache; exercise its actual persisted pageshow contract explicitly.
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })));
      await expect(page).toHaveURL(`${url}/login`);
      await expect(page.locator(".ow-who, .cashier-location")).toHaveCount(0);
      await unauthenticated(context.request);
    } finally { await context.close(); await f.dispose(); }
  });
}

test("logout with unsaved edits clears merchant state before a different account logs in", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const first = await merchant(url);
  const second = await merchant(url, "Synthetic Logout B");
  const location = await first.api.post("/api/merchant/locations", { data: {
    name: "Logout A zweiter Standort", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second logout card", programType: "stamp", rulesText: "Synthetic test.", rewardTitle: "Tee", rewardCost: 5,
  } });
  expect(location.status()).toBe(201);
  const { locationId } = await location.json() as { locationId: string };
  expect((await first.api.post("/api/merchant/locations/select", { data: { locationId } })).status()).toBe(200);
  const context = await browser.newContext({ baseURL: url, storageState: await first.api.storageState() });
  try {
    const page = await context.newPage();
    await page.goto("/merchant/program/card");
    await expect(page.getByLabel("Standortname")).toHaveValue("Logout A zweiter Standort");
    await page.getByLabel("Geschäftsname").fill("Unsaved logout draft");
    const dialogs: string[] = [];
    page.on("dialog", async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page).toHaveURL(`${url}/login`);
    expect(dialogs).toEqual([]);
    await page.getByLabel("E-Mail-Adresse").fill(second.email);
    await page.getByLabel("Passwort", { exact: true }).fill(second.password);
    await page.getByRole("button", { name: "Anmelden", exact: true }).click();
    await expect(page.locator(".ow-who")).toContainText("Synthetic Logout B");
    await expect(page.locator(".ow-loc-name")).toHaveText("Erster Standort");
    const me = await (await context.request.get("/api/me")).json() as { tenantId: string; locationId: string };
    expect(me.tenantId).toBe(second.tenantId);
    expect(me.locationId).toBe(second.locationId);
    await expect(page.locator(".owner-app")).not.toContainText("Logout A zweiter Standort");
    await expect(page.locator(".owner-app")).not.toContainText("Unsaved logout draft");
  } finally { await context.close(); await first.api.dispose(); await second.api.dispose(); }
});

test("an authenticated identity-only account can sign out of the setup shell", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const user = await account(url);
  const context = await browser.newContext({ baseURL: url, storageState: await user.api.storageState() });
  try {
    const page = await context.newPage();
    await page.goto("/merchant");
    await page.getByRole("button", { name: "Abmelden", exact: true }).click();
    await expect(page).toHaveURL(`${url}/login`);
    await unauthenticated(context.request);
  } finally { await context.close(); await user.api.dispose(); }
});
