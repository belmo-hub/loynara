import { expect, request as apiRequest, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { balanceOf, customerWithCard, ledgerRowsFor, MASTER, merchantWithTag, pathOf, pendingOf, resetPeerLimits, sql, staffContext } from "./nfc-support";

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
    await ownerPage.goto("/merchant/program/nfc");
    await expect(ownerPage.getByText("1 aktives NFC-Schild, noch nicht berührt.")).toBeVisible();

    // customer taps with no card: asked to create one, with the existing-card hint
    const customer = await customerContext(browser, url);
    const page = await customer.newPage();
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Deine Karte erstellen" })).toBeVisible();
    await expect(page.getByText("Du hast schon eine Karte?")).toBeVisible();
    await page.getByRole("link", { name: "Karte erstellen" }).click();
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
    await expect(page.locator(".customer-balance-line strong")).toHaveText(/^1 von \d+$/);
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

test("a returning customer whose browser lost the binding confirms access on the saved card and the tap continues", async ({ baseURL, browser }) => {
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
    // A browser without an active binding never binds on its own: the guest confirms with the private card link.
    await expect(page.getByRole("status").filter({ hasText: "Bestätige deinen Browserzugang mit diesem privaten Kartenlink." })).toBeVisible({ timeout: 20_000 });
    expect((await (await m.cashier.get("/api/cashier/tap/pending")).json() as unknown[]).length).toBe(0);
    await page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" }).click();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await (await m.cashier.get("/api/cashier/tap/pending")).json() as unknown[]).length).toBe(1);
    await guest.dispose(); await fresh.close();
  } finally { await m.close(); }
});

test("points programme: the tap waits for the team, the cashier enters and reviews the amount, the guest sees the booked points", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url, "NFC Pizzeria", { programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je Euro Einkaufswert.", rewardCost: 100 });
  try {
    const guest = await customerWithCard(browser, url, m.me.programSlug);
    const page = await guest.context.newPage();
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    await expect(page.getByText("trägt deine Punkte ein")).toBeVisible();

    const cashierCtx = await staffContext(browser, url, m.cashier);
    const counter = await cashierCtx.newPage();
    await counter.goto("/cashier");
    const amount = counter.getByLabel("Kaufbetrag (EUR)");
    await expect(amount).toBeVisible({ timeout: 15_000 });
    await expect(counter.getByRole("button", { name: "Stempel bestätigen" })).toHaveCount(0);
    await amount.fill("16,70");
    // The preview shows what „Buchen“ books; typing books nothing, the one button does.
    await expect(counter.getByText("+16 Punkte · Neuer Stand: 16")).toBeVisible();
    expect(await ledgerRowsFor(guest.cardToken)).toBe(0);
    await expect(counter.getByRole("dialog")).toHaveCount(0);
    // A typed amount waits for the confirmation (ENG-274): „Abbrechen“ books nothing and leaves the amount selected.
    const dialog = counter.getByRole("dialog", { name: "Vergabe bestätigen?" });
    await counter.getByRole("button", { name: "Buchen", exact: true }).click();
    await expect(dialog).toContainText(`16 Punkte für einen Kauf über 16,70\u00a0€ für Karte ${guest.cardLocator}.`);
    await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(() => amount.evaluate((input: HTMLInputElement) => [document.activeElement === input, input.selectionStart, input.selectionEnd])).toEqual([true, 0, 5]);
    expect(await ledgerRowsFor(guest.cardToken)).toBe(0);
    await counter.getByRole("button", { name: "Buchen", exact: true }).click();
    await dialog.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
    await expect(counter.getByRole("status").filter({ hasText: `Punkte für ${guest.cardLocator} gebucht. Neuer Stand: 16.` })).toBeVisible();

    await expect(page.getByRole("heading", { name: "Punkte erhalten" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("+16", { exact: true })).toBeVisible();
    expect(await ledgerRowsFor(guest.cardToken)).toBe(1);
    expect(await balanceOf(url, guest.cardToken)).toBe(16);
    await Promise.all([guest.context.close(), cashierCtx.close()]);
  } finally { await m.close(); }
});

test("manual points: more than one point waits for the confirmation, then books once (ENG-274)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url, "NFC Pizzeria manuell", { programType: "points", earningMode: "manual", rulesText: "Das Team vergibt Punkte an der Kasse.", rewardCost: 100 });
  try {
    const guest = await customerWithCard(browser, url, m.me.programSlug);
    const page = await guest.context.newPage();
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const cashierCtx = await staffContext(browser, url, m.cashier);
    const counter = await cashierCtx.newPage();
    await counter.goto("/cashier");
    const points = counter.getByLabel("Punkte", { exact: true });
    await expect(points).toBeVisible({ timeout: 15_000 });
    await points.fill("5");
    const dialog = counter.getByRole("dialog", { name: "Vergabe bestätigen?" });
    await counter.getByRole("button", { name: "Buchen", exact: true }).click();
    await expect(dialog).toContainText(`5 Punkte für Karte ${guest.cardLocator}.`);
    expect(await ledgerRowsFor(guest.cardToken)).toBe(0);
    await dialog.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
    await expect(counter.getByRole("status").filter({ hasText: `Punkte für ${guest.cardLocator} gebucht. Neuer Stand: 5.` })).toBeVisible();
    expect(await ledgerRowsFor(guest.cardToken)).toBe(1);
    expect(await balanceOf(url, guest.cardToken)).toBe(5);
    await Promise.all([guest.context.close(), cashierCtx.close()]);
  } finally { await m.close(); }
});

/** A points request waiting at a 390 px counter, with its amount typed; the page records every confirm POST. */
async function typedRequest(browser: Browser, url: string, touch = false) {
  const m = await merchantWithTag(url, "NFC Pizzeria 390", { programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je Euro Einkaufswert.", rewardCost: 100 });
  const guest = await customerWithCard(browser, url, m.me.programSlug);
  const page = await guest.context.newPage();
  await page.goto(pathOf(m.nextUrl()));
  await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
  const cashierCtx = await browser.newContext({ baseURL: url, storageState: await m.cashier.storageState(), viewport: { width: 390, height: 844 }, hasTouch: touch });
  const counter = await cashierCtx.newPage();
  const confirms: string[] = [];
  counter.on("request", request => { if (request.method() === "POST" && /\/api\/cashier\/tap\/[^/]+\/confirm$/.test(new URL(request.url()).pathname)) confirms.push(request.url()); });
  await counter.goto("/cashier");
  const amount = counter.getByLabel("Kaufbetrag (EUR)");
  await expect(amount).toBeVisible({ timeout: 15_000 });
  await amount.fill("150");  // under the cashier's 500,00 € limit, so „Ja, vergeben“ can book
  const dialog = counter.getByRole("dialog", { name: "Vergabe bestätigen?" });
  return { m, guest, counter, confirms, dialog, close: async () => { await Promise.all([guest.context.close(), cashierCtx.close()]); await m.close(); } };
}

test("at 390 a double tap on „Buchen“ that lands on „Ja, vergeben“ books nothing (ENG-274)", async ({ baseURL, browser }) => {
  const f = await typedRequest(browser, baseURL ?? "http://localhost:3000");
  try {
    const { counter, dialog } = f;
    const buchen = counter.getByRole("button", { name: "Buchen", exact: true });
    // Measure where „Ja, vergeben“ appears, then scroll the page so „Buchen“ sits right under it.
    await buchen.click();
    const ja = (await dialog.getByRole("button", { name: "Ja, vergeben", exact: true }).boundingBox())!;
    await counter.waitForTimeout(450);  // past the guard, so this test does not lean on the panel ignoring early clicks
    await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const before = (await buchen.boundingBox())!;
    await counter.evaluate(dy => window.scrollBy(0, dy), before.y + before.height / 2 - (ja.y + ja.height / 2));
    const under = (await buchen.boundingBox())!;
    const x = ja.x + ja.width / 2, y = ja.y + ja.height / 2;
    expect(y).toBeGreaterThan(under.y); expect(y).toBeLessThan(under.y + under.height);
    await counter.mouse.dblclick(x, y);
    await counter.waitForTimeout(1_000);
    await expect(dialog).toBeVisible();
    expect(f.confirms).toHaveLength(0);
    expect(await ledgerRowsFor(f.guest.cardToken)).toBe(0);
    expect(await counter.evaluate(() => document.activeElement?.textContent)).toBe("Abbrechen");
    // A press that starts inside the guard and ends after it (down at about 250 ms, up 300 ms later) books nothing either.
    await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    const again = (await buchen.boundingBox())!;
    await counter.evaluate(dy => window.scrollBy(0, dy), again.y + again.height / 2 - y);
    await counter.mouse.click(x, y);
    await counter.waitForTimeout(250);
    await counter.mouse.down();
    await counter.waitForTimeout(300);
    await counter.mouse.up();
    await counter.waitForTimeout(1_000);
    await expect(dialog).toBeVisible();
    expect(f.confirms).toHaveLength(0);
    expect(await ledgerRowsFor(f.guest.cardToken)).toBe(0);
    // After the guard time „Ja, vergeben“ books, once.
    await dialog.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
    await expect(counter.getByRole("status").filter({ hasText: `Punkte für ${f.guest.cardLocator} gebucht.` })).toBeVisible();
    expect(f.confirms).toHaveLength(1);
  } finally { await f.close(); }
});

test("a request that expires while its confirmation is open closes the dialog without booking (ENG-274)", async ({ baseURL, browser }) => {
  const f = await typedRequest(browser, baseURL ?? "http://localhost:3000");
  try {
    const { counter, dialog } = f;
    // The request now runs out in a few seconds; once the panel shows that, open its confirmation and let it expire.
    await sql("update tap_requests set expires_at = now() + interval '8 seconds' where program_id = $1", [f.m.me.programId]);
    await expect(counter.getByText(/läuft ab in 0:0\d/)).toBeVisible({ timeout: 10_000 });
    await counter.getByRole("button", { name: "Buchen", exact: true }).click();
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect(counter.getByRole("heading", { name: "NFC-Anfragen" })).toBeFocused();
    await expect(counter.getByRole("status").filter({ hasText: "Diese Anfrage ist abgelaufen." })).toBeVisible();
    await counter.waitForTimeout(1_000);
    expect(f.confirms).toHaveLength(0);
    expect(await ledgerRowsFor(f.guest.cardToken)).toBe(0);
  } finally { await f.close(); }
});

test("the QR counter's confirmation names the amount in euros, like the NFC one (ENG-274)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url, "QR Pizzeria", { programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Ein Punkt je Euro Einkaufswert.", rewardCost: 100 });
  try {
    const guest = await customerWithCard(browser, url, m.me.programSlug);
    const cashierCtx = await staffContext(browser, url, m.cashier);
    const counter = await cashierCtx.newPage();
    await counter.goto("/cashier");
    await counter.getByLabel("Kartennummer oder Kartencode").fill(guest.scanCode);
    await counter.getByRole("button", { name: "Prüfen", exact: true }).click();
    await counter.getByRole("button", { name: "Kaufbetrag eingeben" }).click();
    await counter.getByLabel("Kaufbetrag (EUR)").fill("12,50");
    await counter.getByRole("button", { name: "Buchen", exact: true }).click();
    await expect(counter.getByRole("dialog", { name: "Vergabe bestätigen?" })).toContainText(`12 Punkte für einen Kauf über 12,50 € für Karte ${guest.cardLocator}.`);
    await Promise.all([guest.context.close(), cashierCtx.close()]);
  } finally { await m.close(); }
});

/**
 * A finger that lands on „Ja, vergeben“ 300 ms after „Buchen“ opened the dialog and lifts at 450 ms: real touch input
 * (CDP), so Chrome hit-tests the release and would fire its click on „Ja“. Then a fresh tap on „Ja“ books.
 */
async function straddlingTouch(page: Page, open: () => Promise<void>, dialog: Locator) {
  const cdp = await page.context().newCDPSession(page);
  await open();
  const opened = Date.now();
  const ja = (await dialog.getByRole("button", { name: "Ja, vergeben", exact: true }).boundingBox())!;
  const point = { x: ja.x + ja.width / 2, y: ja.y + ja.height / 2 };
  await page.waitForTimeout(Math.max(0, 300 - (Date.now() - opened)));
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await page.waitForTimeout(150);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await page.waitForTimeout(1_000);
  await expect(dialog).toBeVisible();
  return async () => { await page.touchscreen.tap(point.x, point.y); };
}

test("a touch that lands inside the guard and lifts after it books nothing, on the NFC and the QR dialog (ENG-274)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const f = await typedRequest(browser, url, true);
  try {
    const { counter, dialog, confirms } = f;
    const buchen = counter.getByRole("button", { name: "Buchen", exact: true });
    const tapJa = await straddlingTouch(counter, async () => { await buchen.tap(); await expect(dialog).toBeVisible(); }, dialog);
    expect(confirms).toHaveLength(0);
    expect(await ledgerRowsFor(f.guest.cardToken)).toBe(0);
    await tapJa();
    await expect(counter.getByRole("status").filter({ hasText: `Punkte für ${f.guest.cardLocator} gebucht.` })).toBeVisible();
    expect(confirms).toHaveLength(1);

    // The QR counter's dialog, at the same counter, for a second card.
    const second = await customerWithCard(browser, url, f.m.me.programSlug);
    const awards: string[] = [];
    counter.on("request", request => { if (request.method() === "POST" && new URL(request.url()).pathname === "/api/cashier/award") awards.push(request.url()); });
    await counter.getByLabel("Kartennummer oder Kartencode").fill(second.scanCode);
    await counter.getByRole("button", { name: "Prüfen", exact: true }).tap();
    await counter.getByRole("button", { name: "Kaufbetrag eingeben" }).tap();
    await counter.locator("#purchase-amount").fill("12,50");  // the QR sheet's field, not a finished NFC row's
    const qr = counter.getByRole("dialog", { name: "Vergabe bestätigen?" });
    const tapQrJa = await straddlingTouch(counter, async () => { await counter.locator(".cashier-book").tap(); await expect(qr).toBeVisible(); }, qr);
    expect(awards).toHaveLength(0);
    expect(await ledgerRowsFor(second.cardToken)).toBe(0);
    await tapQrJa();
    await expect(counter.locator(".cashier-booked")).toContainText("Neuer Stand: 12 Punkte");
    expect(awards).toHaveLength(1);
    await second.context.close();
  } finally { await f.close(); }
});

test("a request closed at another till while its confirmation is open closes the dialog without booking (ENG-274)", async ({ baseURL, browser }) => {
  const f = await typedRequest(browser, baseURL ?? "http://localhost:3000");
  try {
    const { counter, dialog } = f;
    await counter.getByRole("button", { name: "Buchen", exact: true }).click();
    await expect(dialog).toBeVisible();
    // A second staff session (the cashier's API context, apart from this browser) rejects the request in its time.
    const [open] = await pendingOf(f.m.cashier);
    expect((await f.m.cashier.post(`/api/cashier/tap/${open.id}/cancel`)).status()).toBe(200);
    await expect(dialog).toHaveCount(0, { timeout: 10_000 });
    await expect(counter.getByRole("heading", { name: "NFC-Anfragen" })).toBeFocused();
    await expect(counter.getByRole("status").filter({ hasText: "Diese Anfrage ist nicht mehr offen." })).toBeVisible();
    await counter.waitForTimeout(1_000);
    expect(f.confirms).toHaveLength(0);
    expect(await ledgerRowsFor(f.guest.cardToken)).toBe(0);
  } finally { await f.close(); }
});
