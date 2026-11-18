import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type Browser, type Page, type Request } from "@playwright/test";

// The counter's look may change; what one booking sends may not (ENG-122g). One tap or one confirmation sends exactly one
// request, and its body has exactly the fields the counter has always sent.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function shop(baseURL: string, program: Record<string, unknown>) {
  const origin = { Origin: new URL(baseURL).origin };
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  const cashier = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  const guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic booking owner", email: `booking-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Booking Café", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Kaffee", ...program } });
  expect(setup.status()).toBe(201);
  const { programSlug } = await setup.json() as { programSlug: string };
  const { locationId } = await (await owner.get("/api/me")).json() as { locationId: string };
  const email = `booking-cashier-${randomUUID()}@example.test`;
  expect((await cashier.post("/api/auth/sign-up/email", { data: { name: "Synthetic booking cashier", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const { token } = await (await owner.post("/api/staff/invite", { data: { locationId, email, role: "cashier" } })).json() as { token: string };
  expect((await cashier.post("/api/staff/accept", { data: { token } })).status()).toBe(200);
  const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
  expect(joined.status()).toBe(201);
  const { cardToken } = await joined.json() as { cardToken: string };
  const { scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string };
  const lookup = await (await cashier.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`)).json() as { membershipId: string; cardLocator: string; ruleVersionId: string; rewards: Array<{ id: string; cost: number }> };
  const balance = async () => (await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { balance: number }).balance;
  return { cashier, scanCode, lookup, balance, close: async () => { await owner.dispose(); await cashier.dispose(); await guest.dispose(); } };
}

/** The cashier's counter with the card open; from then on every write it sends is recorded (the offline lease came with the lookup). */
async function openCard(browser: Browser, baseURL: string, cashier: APIRequestContext, scanCode: string) {
  const context = await browser.newContext({ baseURL, storageState: await cashier.storageState(), viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.goto("/cashier");
  const lease = page.waitForResponse(response => new URL(response.url()).pathname === "/api/cashier/offline/lease");
  await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await lease;
  const writes: Request[] = [];
  page.on("request", request => { if (request.method() !== "GET" && new URL(request.url()).pathname.startsWith("/api/")) writes.push(request); });
  return { page, writes, close: () => context.close() };
}

async function onlyWrite(page: Page, writes: Request[], path: string) {
  // Long enough for a doubled tap or a retry to have left the browser.
  await page.waitForTimeout(1_000);
  expect(writes.map(request => new URL(request.url()).pathname)).toEqual([path]);
  const response = await writes[0].response();
  expect(response?.status()).toBe(200);
  expect(await response?.json()).toMatchObject({ duplicate: false });
  const body = writes[0].postDataJSON() as Record<string, unknown>;
  expect(body.idempotencyKey).toMatch(UUID);
  expect(body.requestId).toMatch(UUID);
  expect(body.idempotencyKey).not.toBe(body.requestId);
  expect(Math.abs(Date.parse(String(body.deviceAt)) - Date.now())).toBeLessThan(60_000);
  return body;
}

test("one tap on „1 Stempel vergeben“ sends one award with the counter's body", async ({ browser, baseURL }) => {
  const f = await shop(baseURL!, { programName: "Stempelkarte", programType: "stamp", rewardCost: 5 });
  const counter = await openCard(browser, baseURL!, f.cashier, f.scanCode);
  try {
    await counter.page.getByRole("button", { name: "1 Stempel vergeben", exact: true }).click();
    await expect(counter.page.locator(".cashier-booked")).toContainText("Neuer Stand: 1 Stempel");
    const body = await onlyWrite(counter.page, counter.writes, "/api/cashier/award");
    expect(Object.keys(body).sort()).toEqual(["deviceAt", "idempotencyKey", "membershipId", "quantity", "requestId"]);
    expect(body).toMatchObject({ membershipId: f.lookup.membershipId, quantity: 1 });
    expect(await f.balance()).toBe(1);
  } finally { await counter.close(); await f.close(); }
});

test("redeeming a ready reward sends one redemption with the counter's body", async ({ browser, baseURL }) => {
  const f = await shop(baseURL!, { programName: "Stempelkarte", programType: "stamp", rewardCost: 5 });
  expect((await f.cashier.post("/api/cashier/award", { data: { membershipId: f.lookup.membershipId, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() } })).status()).toBe(200);
  const counter = await openCard(browser, baseURL!, f.cashier, f.scanCode);
  try {
    await counter.page.locator(".cashier-redeem-now").click();
    await counter.page.getByRole("dialog", { name: "Einlösung bestätigen?" }).getByRole("button", { name: "Ja, einlösen" }).click();
    await expect(counter.page.locator(".cashier-booked")).toContainText("Neuer Stand: 0 Stempel");
    const body = await onlyWrite(counter.page, counter.writes, "/api/cashier/redeem");
    expect(Object.keys(body).sort()).toEqual(["deviceAt", "idempotencyKey", "membershipId", "requestId", "rewardVersionId"]);
    expect(body).toMatchObject({ membershipId: f.lookup.membershipId, rewardVersionId: f.lookup.rewards[0].id });
    expect(await f.balance()).toBe(0);
  } finally { await counter.close(); await f.close(); }
});

test("booking a purchase amount sends one award with the amount and the rule version", async ({ browser, baseURL }) => {
  const f = await shop(baseURL!, { programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rewardCost: 30 });
  const counter = await openCard(browser, baseURL!, f.cashier, f.scanCode);
  try {
    await counter.page.getByRole("button", { name: "Kaufbetrag eingeben" }).click();
    await counter.page.getByLabel("Kaufbetrag (EUR)").fill("4,99");
    await expect(counter.page.locator("#purchase-preview")).toContainText("+14 Punkte");
    await counter.page.getByRole("button", { name: "Buchen", exact: true }).click();
    await counter.page.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
    await expect(counter.page.locator(".cashier-booked")).toContainText("Neuer Stand: 14 Punkte");
    const body = await onlyWrite(counter.page, counter.writes, "/api/cashier/award");
    expect(Object.keys(body).sort()).toEqual(["deviceAt", "idempotencyKey", "membershipId", "purchaseAmountMinor", "requestId", "ruleVersionId"]);
    expect(body).toMatchObject({ membershipId: f.lookup.membershipId, purchaseAmountMinor: 499, ruleVersionId: f.lookup.ruleVersionId });
    expect(await f.balance()).toBe(14);
  } finally { await counter.close(); await f.close(); }
});

test("a mistyped amount („1570“ for „15,70“) books nothing until the confirmation, and then exactly once (ENG-271)", async ({ browser, baseURL }) => {
  const f = await shop(baseURL!, { programName: "Punktekarte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3, rewardCost: 30 });
  const counter = await openCard(browser, baseURL!, f.cashier, f.scanCode);
  try {
    const { page } = counter;
    const dialog = page.getByRole("dialog", { name: "Vergabe bestätigen?" });
    const field = page.getByLabel("Kaufbetrag (EUR)");
    const selected = () => field.evaluate((input: HTMLInputElement) => [document.activeElement === input, input.selectionStart, input.selectionEnd, input.value.length]);
    await page.getByRole("button", { name: "Kaufbetrag eingeben" }).click();
    await field.fill("1570");
    // A double tap on „Buchen“: the second tap lands on the dialog's backdrop and must not throw the confirmation away.
    await page.getByRole("button", { name: "Buchen", exact: true }).dblclick();
    await expect(dialog).toContainText(`4.710 Punkte für einen Kauf über 1.570,00 EUR für Karte ${f.lookup.cardLocator}.`);
    await page.waitForTimeout(1_000);
    await expect(dialog).toBeVisible();
    expect(counter.writes).toHaveLength(0);
    // „Abbrechen“ books nothing and goes back to the amount, selected, so the right one is typed over it.
    await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(field).toHaveValue("1570");
    await expect.poll(selected).toEqual([true, 0, 4, 4]);
    await page.keyboard.type("15,70");
    await page.getByRole("button", { name: "Buchen", exact: true }).click();
    await expect(dialog).toContainText(`47 Punkte für einen Kauf über 15,70 EUR für Karte ${f.lookup.cardLocator}.`);
    // Esc does the same as „Abbrechen“.
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect.poll(selected).toEqual([true, 0, 5, 5]);
    expect(counter.writes).toHaveLength(0);
    expect(await f.balance()).toBe(0);
    await page.getByRole("button", { name: "Buchen", exact: true }).click();
    await dialog.getByRole("button", { name: "Ja, vergeben", exact: true }).click();
    await expect(page.locator(".cashier-booked")).toContainText("Neuer Stand: 47 Punkte");
    expect(await onlyWrite(page, counter.writes, "/api/cashier/award")).toMatchObject({ purchaseAmountMinor: 1_570 });
    expect(await f.balance()).toBe(47);
  } finally { await counter.close(); await f.close(); }
});
