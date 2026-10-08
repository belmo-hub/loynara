import { expect, request as apiRequest, test, type Browser, type BrowserContext } from "@playwright/test";
import { MASTER, merchantWithTag, pathOf, resetPeerLimits } from "./nfc-support";

// Customer taps the counter tag -> pending request -> cashier confirms -> exactly one stamp -> customer, cashier and owner agree.
// Runs against a server started with NFC_KEY_PROVIDER=derived_v1 and NFC_VERIFY_MASTER_KEY=$E2E_NFC_VERIFY_MASTER (synthetic).
test.skip(!MASTER, "Run only against a server configured with the synthetic derived NFC provider (E2E_NFC_VERIFY_MASTER)");
test.beforeEach(async () => { await resetPeerLimits(); });

async function customerContext(browser: Browser, baseURL: string): Promise<BrowserContext> { return browser.newContext({ baseURL }); }

test("tap, enroll, wait, cashier confirms, exactly one stamp, calm reload, owner readiness, revoked tag", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url);
  try {
    // owner readiness before any customer
    const ownerCtx = await browser.newContext({ baseURL: url, storageState: await m.owner.storageState() });
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/merchant/program");
    await expect(ownerPage.getByText("1 aktives NFC-Schild, noch nicht berührt.")).toBeVisible();

    // customer taps with no card: asked to create one, with the existing-card hint
    const customer = await customerContext(browser, url);
    const page = await customer.newPage();
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Deine Karte erstellen" })).toBeVisible();
    await expect(page.getByText("Du hast schon eine Karte?")).toBeVisible();
    await page.getByRole("link", { name: "Karte erstellen" }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Meine Karte erstellen/ }).click();
    // enrollment returns to the same tap and waits for the cashier
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();

    // cashier sees the request without reloading, confirms once
    const cashierCtx = await browser.newContext({ baseURL: url, storageState: await m.cashier.storageState() });
    const cashierPage = await cashierCtx.newPage();
    await cashierPage.goto("/cashier");
    await expect(cashierPage.getByRole("heading", { name: /NFC-Anfragen/ })).toBeVisible();
    const confirm = cashierPage.getByRole("button", { name: "Stempel bestätigen", exact: true });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.dblclick();
    await expect(cashierPage.getByRole("status").filter({ hasText: /Stempel für K-[A-Z2-9]{6} bestätigt\. Neuer Stand: 1\.|Schon von jemand anderem bestätigt/ })).toBeVisible();

    // the waiting customer page updates itself, and a reload is calm
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible();
    await expect(page.getByText("Aktueller Stand: 1 Stempel")).toBeVisible();
    await expect(page.locator("main [role=alert], [role=alert]:not(#__next-route-announcer__):not(:empty)")).toHaveCount(0);   // no error banner (Next's empty route announcer excluded)

    // owner view agrees: one confirmed award
    const stats = await (await m.owner.get("/api/me")).json() as { stats?: { awards: number } };
    expect(stats.stats?.awards).toBe(1);
    await ownerPage.reload();
    await expect(ownerPage.getByText("1 aktives NFC-Schild, bereits benutzt.")).toBeVisible();

    // a later tap inside the cooldown does not queue a second confirmation
    await customer.pages()[0].goto(pathOf(m.nextUrl()));

    // revoked tag: a calm explanation, nothing queued
    await m.revoke();
    const stranger = await customerContext(browser, url);
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(pathOf(m.nextUrl()));
    await expect(strangerPage.getByRole("heading", { name: "Dieses Schild ist gerade nicht aktiv" })).toBeVisible();
    await expect(strangerPage.getByText("QR-Code an der Kasse").first()).toBeVisible();
    await expect.poll(async () => (await (await m.cashier.get("/api/cashier/tap/pending")).json() as unknown[]).length).toBe(0);
    await Promise.all([ownerCtx.close(), cashierCtx.close(), customer.close(), stranger.close()]);
  } finally { await m.close(); }
});

test("a returning customer whose browser lost the binding opens the saved card and the tap continues", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url);
  try {
    const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    const joined = await guest.post("/api/enroll", { data: { slug: m.me.programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };

    const fresh = await customerContext(browser, url);   // new browser profile: no cookie
    const page = await fresh.newPage();
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Deine Karte erstellen" })).toBeVisible();
    await page.goto(`/card/${encodeURIComponent(cardToken)}`);                 // same tab, saved link
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await (await m.cashier.get("/api/cashier/tap/pending")).json() as unknown[]).length).toBe(1);
    await guest.dispose(); await fresh.close();
  } finally { await m.close(); }
});
