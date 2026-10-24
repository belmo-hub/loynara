import { expect, request as apiRequest, test, type Page } from "@playwright/test";
import {
  balanceOf, customerCardNumber, customerWithCard, expectNoCredentials, fakeCamera, ledgerRowsFor, MASTER, merchantWithTag, pathOf, pendingOf,
  resetPeerLimits, showQr, sql, staffContext,
} from "./nfc-support";

// The employee's own phone: a customer taps the counter tag, the request appears on every cashier phone of the location,
// and exactly one confirmation books exactly one stamp. The counter QR stays available on the same screen.
// Runs against the isolated integration server (NFC_KEY_PROVIDER=derived_v1, synthetic E2E_NFC_VERIFY_MASTER only).
test.skip(!MASTER, "Run only against a server configured with the synthetic derived NFC provider (E2E_NFC_VERIFY_MASTER)");
test.beforeEach(async () => { await resetPeerLimits(); });

const BASE_FALLBACK = "http://localhost:3000";
const panel = (page: Page) => page.getByRole("region", { name: "NFC-Anfragen" });
const notifications = (page: Page) => page.getByRole("region", { name: "Benachrichtigungen" });
const confirmButton = (page: Page) => panel(page).getByRole("button", { name: "Stempel bestätigen", exact: true });
const rejectButton = (page: Page) => panel(page).getByRole("button", { name: "Ablehnen", exact: true });
const statusText = (page: Page, text: string) => page.getByRole("status").filter({ hasText: text });
const EMPTY = "Keine offenen NFC-Anfragen";

test("a: a bound customer's tap is at the top of /cashier with the customer's card number; one confirm books exactly one stamp", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const card = await customerWithCard(browser, url, m.me.programSlug);
  const cashier = await staffContext(browser, url, m.cashier);
  try {
    const customerPage = await card.context.newPage();
    await customerPage.goto(pathOf(m.nextUrl()));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shown = await customerCardNumber(customerPage);
    expect(shown).toBe(card.cardLocator);

    const page = await cashier.newPage();
    // every pending-list response the cashier phone receives must be credential-free
    const bodies: Promise<string>[] = [];
    page.on("response", response => { if (new URL(response.url()).pathname === "/api/cashier/tap/pending") bodies.push(response.text().catch(() => "")); });
    await page.goto("/cashier");
    await expect(panel(page).getByText(shown, { exact: true })).toBeVisible({ timeout: 15_000 });

    // the request sits above the camera on the counter screen
    const camera = page.getByRole("button", { name: "Kamera öffnen" });
    await expect(camera).toBeVisible();
    expect((await panel(page).boundingBox())!.y).toBeLessThan((await camera.boundingBox())!.y);
    await expectNoCredentials(page, card);
    for (const body of await Promise.all(bodies)) {
      expect(body).not.toContain(card.scanCode);
      expect(body).not.toContain(card.cardToken);
      expect(body).not.toMatch(/(^|[^A-Za-z0-9])(sc|card)_/);
    }

    await confirmButton(page).click();
    await expect(statusText(page, `Stempel für ${shown} bestätigt. Neuer Stand: 1.`)).toBeVisible();
    expect(await balanceOf(url, card.cardToken)).toBe(1);
    expect(await ledgerRowsFor(card.cardToken)).toBe(1);
    expect((await (await m.owner.get("/api/me")).json() as { stats?: { awards: number } }).stats?.awards).toBe(1);
    await expect(panel(page).getByText(shown, { exact: true })).toHaveCount(0);
    await expect(customerPage.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
    await expect(customerPage.locator(".customer-balance-line strong")).toHaveText(/^1\s*Stempel$/);
  } finally {
    await cashier.close(); await card.context.close(); await m.close();
  }
});

test("b: owner and cashier both see the request; one confirms, the other's confirm reports it already done, and exactly one award is booked", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const card = await customerWithCard(browser, url, m.me.programSlug);
  const ownerCtx = await staffContext(browser, url, m.owner);
  const cashierCtx = await staffContext(browser, url, m.cashier);
  try {
    const customerPage = await card.context.newPage();
    await customerPage.goto(pathOf(m.nextUrl()));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shown = await customerCardNumber(customerPage);

    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/cashier");
    const cashierPage = await cashierCtx.newPage();
    // The second phone's list is frozen once it shows the request, so its confirm is made on a screen that is out of date.
    let frozen: string | null = null;
    let latest = "";
    await cashierPage.route("**/api/cashier/tap/pending", async route => {
      if (frozen !== null) { await route.fulfill({ status: 200, contentType: "application/json", headers: { "Cache-Control": "no-store" }, body: frozen }); return; }
      const response = await route.fetch();
      latest = await response.text();
      await route.fulfill({ response, body: latest });
    });
    await cashierPage.goto("/cashier");
    await expect(panel(ownerPage).getByText(shown, { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(panel(cashierPage).getByText(shown, { exact: true })).toBeVisible({ timeout: 15_000 });
    frozen = latest;

    await confirmButton(ownerPage).click();
    await expect(statusText(ownerPage, `Stempel für ${shown} bestätigt. Neuer Stand: 1.`)).toBeVisible();

    await confirmButton(cashierPage).click();
    await expect(statusText(cashierPage, "Schon von jemand anderem bestätigt. Es wurde nichts doppelt gebucht.")).toBeVisible();
    await cashierPage.unroute("**/api/cashier/tap/pending");

    expect(await balanceOf(url, card.cardToken)).toBe(1);
    expect(await ledgerRowsFor(card.cardToken)).toBe(1);
    expect((await (await m.owner.get("/api/me")).json() as { stats?: { awards: number } }).stats?.awards).toBe(1);
    await expect(customerPage.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
  } finally {
    await ownerCtx.close(); await cashierCtx.close(); await card.context.close(); await m.close();
  }
});

test("c: a declined request books nothing, the cashier is told so, and the customer's screen says it was not confirmed", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const card = await customerWithCard(browser, url, m.me.programSlug);
  const cashier = await staffContext(browser, url, m.cashier);
  try {
    const customerPage = await card.context.newPage();
    await customerPage.goto(pathOf(m.nextUrl()));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shown = await customerCardNumber(customerPage);

    const page = await cashier.newPage();
    await page.goto("/cashier");
    await expect(panel(page).getByText(shown, { exact: true })).toBeVisible({ timeout: 15_000 });
    await rejectButton(page).click();
    await expect(statusText(page, "Anfrage abgelehnt. Es wurde nichts gebucht.")).toBeVisible();
    await expect(panel(page).getByText(EMPTY)).toBeVisible();

    await expect(customerPage.getByRole("heading", { name: "Nicht bestätigt" })).toBeVisible({ timeout: 15_000 });
    expect(await balanceOf(url, card.cardToken)).toBe(0);
    expect(await ledgerRowsFor(card.cardToken)).toBe(0);

    // a declined request cannot be confirmed afterwards
    const [declined] = await m.requests();
    expect(declined.status).toBe("cancelled");
    const late = await m.cashier.post(`/api/cashier/tap/${declined.id}/confirm`);
    expect(late.status()).toBe(400);
    expect(await late.json()).toMatchObject({ code: "TAP_EXPIRED" });
    expect(await balanceOf(url, card.cardToken)).toBe(0);
  } finally {
    await cashier.close(); await card.context.close(); await m.close();
  }
});

test("d: an expired request leaves the cashier list, its confirm returns TAP_EXPIRED, and nothing is booked", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const card = await customerWithCard(browser, url, m.me.programSlug);
  const cashier = await staffContext(browser, url, m.cashier);
  try {
    const customerPage = await card.context.newPage();
    await customerPage.goto(pathOf(m.nextUrl()));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shown = await customerCardNumber(customerPage);

    const page = await cashier.newPage();
    await page.goto("/cashier");
    await expect(panel(page).getByText(shown, { exact: true })).toBeVisible({ timeout: 15_000 });
    const [open] = await pendingOf(m.cashier);
    expect(open.cardLocator).toBe(shown);

    await sql("update tap_requests set expires_at = now() - interval '1 minute' where id = $1", [open.id]);
    await expect(panel(page).getByText(shown, { exact: true })).toHaveCount(0, { timeout: 8_000 });
    await expect(panel(page).getByText(EMPTY)).toBeVisible();

    const late = await m.cashier.post(`/api/cashier/tap/${open.id}/confirm`);
    expect(late.status()).toBe(400);
    expect(await late.json()).toMatchObject({ code: "TAP_EXPIRED" });
    expect(await balanceOf(url, card.cardToken)).toBe(0);
    expect(await ledgerRowsFor(card.cardToken)).toBe(0);
    await expect(customerPage.getByRole("heading", { name: "Anfrage abgelaufen" })).toBeVisible({ timeout: 15_000 });
  } finally {
    await cashier.close(); await card.context.close(); await m.close();
  }
});

test("e: opening the same signed tap link again books nothing and creates no second request, before and after confirmation", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const card = await customerWithCard(browser, url, m.me.programSlug);
  const cashier = await staffContext(browser, url, m.cashier);
  try {
    const signed = m.nextUrl();
    const customerPage = await card.context.newPage();
    await customerPage.goto(pathOf(signed));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shown = await customerCardNumber(customerPage);
    const [first] = await m.requests();
    expect(await m.requests()).toHaveLength(1);

    // the same link in the same tab and in a new tab
    await customerPage.goto(pathOf(signed));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const again = await card.context.newPage();
    await again.goto(pathOf(signed));
    await expect(again.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(again)).toBe(shown);
    expect((await m.requests()).map(row => row.id)).toEqual([first.id]);
    expect(await balanceOf(url, card.cardToken)).toBe(0);
    expect(await ledgerRowsFor(card.cardToken)).toBe(0);
    const pending = await pendingOf(m.cashier);
    expect(pending.map(row => row.id)).toEqual([first.id]);

    // confirm, then replay the link once more: still one stamp, and the replay reports the confirmed state
    const page = await cashier.newPage();
    await page.goto("/cashier");
    await expect(panel(page).getByText(shown, { exact: true })).toBeVisible({ timeout: 15_000 });
    await confirmButton(page).click();
    await expect(statusText(page, `Stempel für ${shown} bestätigt. Neuer Stand: 1.`)).toBeVisible();
    await again.goto(pathOf(signed));
    await expect(again.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible();
    expect((await m.requests()).map(row => row.id)).toEqual([first.id]);
    expect(await balanceOf(url, card.cardToken)).toBe(1);
    expect(await ledgerRowsFor(card.cardToken)).toBe(1);
  } finally {
    await cashier.close(); await card.context.close(); await m.close();
  }
});

test("f: a cashier of another merchant never sees the request, and cannot confirm or decline it; nothing is booked", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const first = await merchantWithTag(url, "NFC Café Eins");
  const second = await merchantWithTag(url, "NFC Café Zwei");
  const card = await customerWithCard(browser, url, first.me.programSlug);
  const otherCashier = await staffContext(browser, url, second.cashier);
  try {
    const customerPage = await card.context.newPage();
    await customerPage.goto(pathOf(first.nextUrl()));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shown = await customerCardNumber(customerPage);
    const [open] = await pendingOf(first.cashier);
    expect(open.cardLocator).toBe(shown);

    expect(await pendingOf(second.cashier)).toEqual([]);
    const page = await otherCashier.newPage();
    await page.goto("/cashier");
    await expect(panel(page).getByText(EMPTY)).toBeVisible();
    await expect(page.getByText(shown, { exact: true })).toHaveCount(0);

    for (const api of [second.cashier, second.owner]) {
      const confirm = await api.post(`/api/cashier/tap/${open.id}/confirm`);
      expect([403, 404]).toContain(confirm.status());
      expect(["NOT_FOUND", "FORBIDDEN"]).toContain((await confirm.json() as { code?: string }).code);
      const cancel = await api.post(`/api/cashier/tap/${open.id}/cancel`);
      expect([403, 404]).toContain(cancel.status());
    }
    expect(await balanceOf(url, card.cardToken)).toBe(0);
    expect(await ledgerRowsFor(card.cardToken)).toBe(0);
    expect((await first.requests()).map(row => row.status)).toEqual(["pending_staff"]);

    // the first merchant's cashier is unaffected and can still confirm it, once
    expect((await pendingOf(first.cashier)).map(row => row.id)).toEqual([open.id]);
    const confirmed = await first.cashier.post(`/api/cashier/tap/${open.id}/confirm`);
    expect(await confirmed.json()).toMatchObject({ state: "confirmed", balance: 1 });
    expect(await balanceOf(url, card.cardToken)).toBe(1);
    expect(await ledgerRowsFor(card.cardToken)).toBe(1);
  } finally {
    await otherCashier.close(); await card.context.close(); await first.close(); await second.close();
  }
});

test("g1: without PushManager the notification card says notifications are unavailable, and a new tap appears by polling within 3 s", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const card = await customerWithCard(browser, url, m.me.programSlug);
  const cashier = await staffContext(browser, url, m.cashier);
  await cashier.addInitScript(() => { delete (window as unknown as { PushManager?: unknown }).PushManager; });
  try {
    const page = await cashier.newPage();
    await page.goto("/cashier");
    expect(await page.evaluate(() => "PushManager" in window)).toBe(false);
    await expect(notifications(page)).toContainText("Benachrichtigungen sind auf diesem Gerät nicht verfügbar");
    await expect(notifications(page).getByRole("button")).toHaveCount(0);

    const customerPage = await card.context.newPage();
    await customerPage.goto(pathOf(m.nextUrl()));
    await expect(customerPage.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shown = await customerCardNumber(customerPage);
    await expect(panel(page).getByText(shown, { exact: true })).toBeVisible({ timeout: 3_000 });
  } finally {
    await cashier.close(); await card.context.close(); await m.close();
  }
});

test("g2: with PushManager the card offers to turn notifications on (not clicked); the service worker and manifest are served", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const cashier = await staffContext(browser, url, m.cashier);
  try {
    const config = await (await m.cashier.get("/api/cashier/push/config")).json() as { available: boolean };
    expect(config.available, "this server must have VAPID keys configured for the enable offer").toBe(true);

    const page = await cashier.newPage();
    await page.goto("/cashier");
    expect(await page.evaluate(() => "PushManager" in window)).toBe(true);
    await expect(notifications(page).getByRole("button", { name: "Benachrichtigungen einschalten" })).toBeVisible();
    await expect(notifications(page)).not.toContainText("nicht verfügbar");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/cashier.webmanifest");

    const assets = await apiRequest.newContext({ baseURL: url });
    try {
      const worker = await assets.get("/cashier-sw.js");
      expect(worker.status()).toBe(200);
      expect(worker.headers()["content-type"]).toMatch(/javascript/);
      const manifest = await assets.get("/cashier.webmanifest");
      expect(manifest.status()).toBe(200);
      expect(await manifest.json()).toMatchObject({ scope: "/cashier", start_url: "/cashier" });
    } finally { await assets.dispose(); }
  } finally {
    await cashier.close(); await m.close();
  }
});

test("h: the QR fallback books one stamp on the same cashier page where the NFC panel is visible", async ({ baseURL, browser }) => {
  const url = baseURL ?? BASE_FALLBACK;
  const m = await merchantWithTag(url);
  const card = await customerWithCard(browser, url, m.me.programSlug);
  const cashier = await staffContext(browser, url, m.cashier);
  await fakeCamera(cashier);
  try {
    const page = await cashier.newPage();
    await page.goto("/cashier");
    await page.getByRole("button", { name: "Kamera öffnen" }).click();
    await expect(page.getByRole("region", { name: "Kassenkamera" })).toContainText("Kamera bereit.");
    await expect(panel(page)).toBeVisible();

    await showQr(page, card.scanCode);
    await expect(page.getByRole("heading", { name: card.cardLocator })).toBeVisible();
    const stamp = page.getByRole("button", { name: "1 Stempel vergeben" });
    await expect(stamp).toBeEnabled({ timeout: 5_000 });
    await stamp.click();
    await expect(page.locator(".cashier-booked")).toContainText("+1 Stempel");
    await expect(page.locator(".cashier-booked")).toContainText(`Neuer Stand: 1 Stempel.${card.cardLocator}`);
    await expect(panel(page)).toBeVisible();
    expect(await balanceOf(url, card.cardToken)).toBe(1);
    expect(await ledgerRowsFor(card.cardToken)).toBe(1);
    expect(await m.requests()).toEqual([]);
  } finally {
    await cashier.close(); await card.context.close(); await m.close();
  }
});
