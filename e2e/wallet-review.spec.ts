import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type BrowserContext, type Page } from "@playwright/test";

// Synthetic browser acceptance only. Availability/issuance are stubbed; provider flags remain OFF.
const sizes = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 768, height: 1024 }, { width: 390, height: 844 }, { width: 320, height: 800 }];
const states = [
  { name: "disabled", apple: "unavailable", google: "unavailable" },
  { name: "apple", apple: "available", google: "unavailable" },
  { name: "google-test", apple: "unavailable", google: "test_only" },
  { name: "google-published", apple: "unavailable", google: "available" },
  { name: "both", apple: "available", google: "available" },
] as const;
const agents = [
  { name: "desktop", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36" },
  { name: "ios", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" },
  { name: "android", ua: "Mozilla/5.0 (Linux; Android 15; Synthetic) AppleWebKit/537.36 Chrome/145.0.0.0 Mobile Safari/537.36" },
] as const;
let owner: APIRequestContext;
let guest: APIRequestContext;
let programSlug: string;
let locationId: string;
let cardToken: string;
let cardTokens: string[];
let appOrigin: string;

async function signup(baseURL: string, label: string) {
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const email = `wallet-review-${label}-${randomUUID()}@example.test`;
  const response = await context.post("/api/auth/sign-up/email", { data: { name: `Synthetic Wallet ${label}`, email, password: `Local!${randomUUID()}Aa` } });
  expect(response.status(), "synthetic signup must succeed").toBe(200);
  return { context, email };
}

test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  expect(["localhost", "127.0.0.1"]).toContain(new URL(url).hostname);
  appOrigin = new URL(url).origin;
  owner = (await signup(url, "owner")).context;
  guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: appOrigin } });
  const setup = await owner.post("/api/merchant/onboard", { data: {
    businessName: "Synthetic Wallet Café", locationName: "Synthetic Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Synthetic Wallet Programme", programType: "stamp", rulesText: "Ein synthetischer Stempel pro bestätigtem Kassenvorgang.", rewardTitle: "Synthetic Kaffee", rewardCost: 5, brandColor: "#214739",
  } });
  expect(setup.status()).toBe(201);
  ({ programSlug, locationId } = await setup.json());
  const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
  expect(joined.status()).toBe(201);
  ({ cardToken } = await joined.json());
  cardTokens = [cardToken];
  // Development StrictMode reads the card twice per mount; keep each width below the real per-card read limit.
  for (let i = 1; i < sizes.length; i++) {
    const additional = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false, additionalCard: true } });
    expect(additional.status()).toBe(201);
    cardTokens.push((await additional.json()).cardToken);
  }
  expect(await (await guest.get("/api/wallet/status")).json()).toEqual({ apple: "unavailable", google: "unavailable" });
});

test.afterAll(async () => { await owner?.dispose(); await guest?.dispose(); });

async function localOnly(context: BrowserContext) {
  await context.route("**/*", async route => {
    if (new URL(route.request().url()).origin !== appOrigin) await route.abort("blockedbyclient");
    else await route.continue();
  });
}
async function cardReady(page: Page, token = cardToken) {
  await page.goto(`/card/${encodeURIComponent(token)}`);
  await expect(page.locator(".customer-header-merchant")).toHaveText("Synthetic Wallet Café");
}
async function fits(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth), "page must have no horizontal overflow").toBeLessThanOrEqual(width);
  expect(await page.locator(".wallet-add").evaluateAll(elements => elements.every(element => {
    const r = element.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth && r.height >= 44;
  }))).toBe(true);
}

test("customer availability and platform matrix fits five viewports (75 combinations)", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(180_000);
  for (const viewport of sizes) for (const agent of agents) {
    const context = await browser.newContext({ baseURL, viewport, userAgent: agent.ua });
    try {
      await localOnly(context);
      const page = await context.newPage();
      // This matrix exercises Wallet presentation, not referrals; avoid spending the real shared-IP referral quota 150 times.
      await page.route("**/api/card/*/referral", route => route.fulfill({ json: { enabled: false } }));
      let state: typeof states[number] = states[0];
      await page.route("**/api/wallet/status", route => route.fulfill({ json: { apple: state.apple, google: state.google } }));
      for (state of states) {
        await cardReady(page, cardTokens[sizes.indexOf(viewport)]);
        const apple = state.apple === "available" && agent.name !== "android";
        const google = state.google !== "unavailable" && agent.name !== "ios";
        await expect(page.locator(".wallet-add--apple")).toHaveCount(apple ? 1 : 0);
        await expect(page.locator(".wallet-add--google")).toHaveCount(google ? 1 : 0);
        await expect(page.locator(".customer-wallet-add")).toHaveCount(apple || google ? 1 : 0);
        await expect(page.locator(".wallet-mode-note")).toHaveCount(google && state.google === "test_only" ? 1 : 0);
        if (apple && google) expect(await page.locator(".wallet-add span").allTextContents()).toEqual(["Zu Apple Wallet hinzufügen", "Zu Google Wallet hinzufügen"]);
        if (apple || google) await page.locator(".customer-wallet-add").scrollIntoViewIfNeeded();
        await fits(page, viewport.width);
        await page.screenshot({ path: testInfo.outputPath(`wallet-customer-${viewport.width}-${agent.name}-${state.name}.png`), fullPage: true, mask: [page.locator(".customer-qr img")] });
      }
    } finally { await context.close(); }
  }
});

test("slow issuance disables both buttons, prevents duplicate calls and recovers from a generic error", async ({ page }) => {
  await page.route("**/api/wallet/status", route => route.fulfill({ json: { apple: "available", google: "available" } }));
  let calls = 0;
  let release: () => void = () => {};
  const released = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/wallet/apple", async route => {
    calls++;
    await released;
    await route.fulfill({ status: 502, json: { code: "WALLET_PROVIDER_ERROR", error: "provider fixture private-key.pem" } });
  });
  await cardReady(page);
  const apple = page.locator(".wallet-add--apple");
  await apple.click();
  await expect(apple).toHaveText("Wird vorbereitet …");
  await expect(apple).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".wallet-add--google")).toBeDisabled();
  await apple.dispatchEvent("click");
  expect(calls).toBe(1);
  release();
  await expect(page.locator(".wallet-error[role=alert]")).toContainText("Wallet ist gerade nicht erreichbar");
  await expect(page.locator(".wallet-error[role=alert]")).not.toContainText("private-key");
  await expect(apple).toBeEnabled();
  await expect(page.locator(".customer-header-merchant")).toBeVisible();
});

test("status-check failure hides Wallet and leaves browser card usable", async ({ page }) => {
  await page.route("**/api/wallet/status", route => route.fulfill({ status: 503, json: { error: "Synthetic status failure" } }));
  await cardReady(page);
  await expect(page.locator(".customer-wallet-add")).toHaveCount(0);
  await expect(page.locator(".customer-qr img")).toBeVisible();
});

test("failed Google Save is explained on the card without a provider redirect", async ({ page }) => {
  await page.route("**/api/wallet/status", route => route.fulfill({ json: { apple: "unavailable", google: "test_only" } }));
  await page.route("**/api/wallet/google", route => route.fulfill({ status: 503, json: { code: "WALLET_UNAVAILABLE" } }));
  await cardReady(page);
  await page.locator(".wallet-add--google").click();
  await expect(page.locator(".wallet-error[role=alert]")).toContainText("Deine Karte funktioniert weiterhin hier im Browser");
  expect(new URL(page.url()).origin).toBe(appOrigin);
  await expect(page.locator(".wallet-add--google")).toBeEnabled();
});

test("real disabled-provider download renders safe navigation HTML and Back restores the card", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.route("**/api/wallet/status", route => route.fulfill({ json: { apple: "available", google: "unavailable" } }));
  await page.route("**/api/wallet/apple", route => route.fulfill({ json: { status: "ready", url: "/api/wallet/apple/download/synthetic-expired-ticket" } }));
  await cardReady(page);
  const responsePromise = page.waitForResponse(response => response.url().includes("/api/wallet/apple/download/"));
  await page.locator(".wallet-add--apple").click();
  const response = await responsePromise;
  expect(response.status()).toBe(503); // real flags are OFF; unavailable is evaluated before expiry
  expect(response.headers()["content-type"]).toContain("text/html");
  await expect(page.getByRole("heading", { name: "Wallet gerade nicht verfügbar" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("WALLET_UNAVAILABLE");
  await expect(page.locator("body")).not.toContainText("synthetic-expired-ticket");
  await fits(page, 320);
  await page.screenshot({ path: testInfo.outputPath("wallet-download-error-320.png"), fullPage: true });
  await page.getByRole("button", { name: "Zurück zur Karte" }).click();
  await expect(page.locator(".customer-header-merchant")).toHaveText("Synthetic Wallet Café");
});

test("owner readiness states distinguish issuance and delayed updates across five widths", async ({ browser, baseURL }, testInfo) => {
  test.setTimeout(120_000);
  const readiness = [
    { name: "disabled", apple: "not_set_up", google: "not_set_up", logo: "missing", googleLogo: "fallback", passes: { apple: 0, google: 0 }, delayedUpdates: 0 },
    { name: "test-only", apple: "not_set_up", google: "test_only", logo: "needs_png", googleLogo: "fallback", passes: { apple: 0, google: 2 }, delayedUpdates: 0 },
    { name: "ready", apple: "ready", google: "ready", logo: "ready", googleLogo: "merchant", passes: { apple: 1, google: 2 }, delayedUpdates: 0 },
    { name: "delayed", apple: "ready", google: "ready", logo: "too_large", googleLogo: "fallback", passes: { apple: 1, google: 2 }, delayedUpdates: 3 },
  ];
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState() });
  try {
    await localOnly(context);
    const page = await context.newPage();
    let state = readiness[0];
    await page.route("**/api/merchant/program/wallet?**", route => route.fulfill({ json: { ...state, ink: "light" } }));
    for (const viewport of sizes) for (state of readiness) {
      await page.setViewportSize(viewport);
      await page.goto("/merchant/program/card");
      await expect(page.getByRole("heading", { name: "Kundenkarte", level: 1 })).toBeVisible();
      const status = page.locator(".ow-wallet-ready");
      await expect(status).toBeVisible();
      if (state.name === "test-only") await expect(status).toContainText("Testphase");
      if (state.name === "ready") {
        await expect(status).toContainText("3 Wallet-Karten wurden erstellt");
        await expect(status).toContainText("Ob sie auf dem Gerät gespeichert wurden, ist hier nicht bestätigt");
      }
      if (state.name === "delayed") {
        await expect(status).toContainText("muss geprüft und erneut gestartet werden");
        await expect(status).not.toContainText("automatisch nachgezogen");
      }
      await status.scrollIntoViewIfNeeded();
      await fits(page, viewport.width);
      await page.screenshot({ path: testInfo.outputPath(`wallet-owner-${viewport.width}-${state.name}.png`), fullPage: true });
    }
  } finally { await context.close(); }
});

test("owner Wallet previews wrap long merchant/programme/reward labels", async ({ browser, baseURL }, testInfo) => {
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState() });
  try {
    await localOnly(context);
    const page = await context.newPage();
    await page.route("**/api/program/*", async route => {
      const response = await route.fetch();
      const programme = await response.json();
      await route.fulfill({ json: { ...programme, programName: "P".repeat(180), rewardTitle: "R".repeat(180), rewards: programme.rewards.map((reward: { title: string }) => ({ ...reward, title: "R".repeat(180) })) } });
    });
    await page.goto("/merchant/program/card");
    await page.getByLabel("Geschäftsname").fill("W".repeat(180));
    for (const viewport of sizes) {
      await page.setViewportSize(viewport);
      if (viewport.width <= 900) await page.getByRole("button", { name: "Vorschau", exact: true }).click();
      for (const provider of ["Apple Wallet", "Google Wallet"]) {
        await page.getByRole("tab", { name: provider }).click();
        await expect(page.locator(".ow-pass")).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath(`wallet-preview-${viewport.width}-${provider.startsWith("Apple") ? "apple" : "google"}-long.png`), fullPage: true });
        const overflow = await page.locator(".ow-studio *").evaluateAll(elements => elements.filter(element => element.getBoundingClientRect().right > window.innerWidth).map(element => ({ tag: element.tagName, class: element.className, right: Math.round(element.getBoundingClientRect().right) })).slice(0, 10));
        expect(overflow, "studio labels must remain within the viewport").toEqual([]);
        await fits(page, viewport.width);
        expect(await page.locator(".ow-pass").evaluate(element => element.scrollWidth <= element.clientWidth), "preview must not clip long labels").toBe(true);
      }
    }
  } finally { await context.close(); }
});

test("real readiness API authorizes owners and rejects manager, cashier and guest", async ({ baseURL }) => {
  expect((await owner.get(`/api/merchant/program/wallet?programSlug=${programSlug}`)).status()).toBe(200);
  expect((await guest.get(`/api/merchant/program/wallet?programSlug=${programSlug}`)).status()).toBe(401);
  for (const role of ["manager", "cashier"]) {
    const staff = await signup(baseURL ?? appOrigin, role);
    try {
      const invited = await owner.post("/api/staff/invite", { data: { email: staff.email, locationId, role } });
      expect(invited.status()).toBe(201);
      const { token } = await invited.json();
      expect((await staff.context.post("/api/staff/accept", { data: { token } })).status()).toBe(200);
      expect((await staff.context.get(`/api/merchant/program/wallet?programSlug=${programSlug}`)).status()).toBe(403);
    } finally { await staff.context.dispose(); }
  }
});


test("Wallet OFF preserves hardened closure guidance and confirmation", async ({ page }) => {
  const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, additionalCard: true } });
  expect(joined.status()).toBe(201);
  const token = (await joined.json()).cardToken;
  await cardReady(page, token);
  await expect(page.locator(".customer-wallet-add")).toHaveCount(0);
  await page.getByRole("button", { name: "Karte schließen", exact: true }).click();
  await expect(page.locator(".customer-close-confirm")).not.toContainText("Wallet");
  await page.getByRole("button", { name: "Schließung verbindlich bestätigen" }).click();
  await expect(page.getByRole("heading", { name: "Karte geschlossen." })).toBeVisible();
  await expect(page.locator(".card-state-page")).not.toContainText("Wallet");
});


test("asynchronous pending polls the protected status without repeating issuance and obtains a fresh archive ticket", async ({ page }, testInfo) => {
  let checks=0,issues=0;
  await page.route("**/api/wallet/status",async route=>{
    expect(route.request().method()).toBe("POST"); expect(route.request().postDataJSON()).toEqual({token:cardToken}); checks++;
    await route.fulfill({json:{apple:"available",google:"unavailable",applePass:checks<3?{status:"pending"}:{status:"ready",url:"/api/wallet/apple/download/browser-ready-ticket"}}});
  });
  await page.route("**/api/wallet/apple",route=>{issues++;return route.fulfill({status:202,json:{status:"pending"}});});
  await page.route("**/api/wallet/apple/download/browser-ready-ticket",route=>route.fulfill({contentType:"text/html",body:"<html><body><h1>Synthetic archive handoff</h1></body></html>"}));
  await cardReady(page); const button=page.locator(".wallet-add--apple"); await button.click();
  await expect(button).toHaveText("Wird vorbereitet …"); await expect(button).toBeDisabled(); await expect(page.locator(".wallet-add--google")).toHaveCount(0);
  await page.screenshot({path:testInfo.outputPath("apple-pending.png"),fullPage:true,mask:[page.locator(".customer-qr img")]});
  await expect(page.getByRole("heading",{name:"Synthetic archive handoff"})).toBeVisible({timeout:20_000});expect(issues).toBe(1);expect(checks).toBe(3);
});

test("actual providers-OFF card hides actions and direct issuance is unavailable while returning join works",async({page})=>{
  await cardReady(page);await expect(page.locator(".customer-wallet-add")).toHaveCount(0);
  for(const provider of ["apple","google"]){const response=await guest.post(`/api/wallet/${provider}`,{data:{token:cardToken}});expect(response.status()).toBe(503);}
  const status=await guest.post("/api/wallet/status",{data:{token:cardToken}});expect(await status.json()).toMatchObject({apple:"unavailable",google:"unavailable",applePass:{status:"unavailable"}});
  await page.goto(`/join/${encodeURIComponent(programSlug)}`);await expect(page.getByRole("heading",{name:"Willkommen zurück."})).toBeVisible();await expect(page.getByRole("button",{name:"Meine Karte erstellen"})).toHaveCount(0);await page.getByRole("link",{name:"Meine Karte öffnen"}).click();await page.waitForURL(/\/card\//);await expect(page.locator(".customer-header-merchant")).toHaveText("Synthetic Wallet Café");
  await page.goto(`/join/${encodeURIComponent(programSlug)}`);await expect(page.getByRole("heading",{name:"Willkommen zurück."})).toBeVisible();await page.getByRole("link",{name:"Meine Karte öffnen"}).click();await page.waitForURL(/\/card\//);await expect(page.locator(".customer-header-merchant")).toHaveText("Synthetic Wallet Café");
});
