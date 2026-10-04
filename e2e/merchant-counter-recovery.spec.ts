import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext, type Request } from "@playwright/test";

async function account(baseURL: string, label: string) {
  const context = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  const email = `${label}-${randomUUID()}@example.test`;
  expect((await context.post("/api/auth/sign-up/email", { data: { name: `Synthetic ${label}`, email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  return { context, email };
}

async function shop(context: APIRequestContext) {
  const response = await context.post("/api/merchant/onboard", { data: {
    businessName: "Synthetic Recovery Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Synthetic card", programType: "stamp", rulesText: "One synthetic stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
  } });
  expect(response.status()).toBe(201);
  return await response.json() as { tenantId: string; locationId: string; programSlug: string };
}

test("the counter finds a card by its random number, a mistake is corrected, and a lost card link is reissued", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await account(url, "recovery-owner");
  const cashier = await account(url, "recovery-cashier");
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const contexts = [] as Array<{ close(): Promise<void> }>;
  try {
    const merchant = await shop(owner.context);
    const invite = await owner.context.post("/api/staff/invite", { data: { email: cashier.email, locationId: merchant.locationId, role: "cashier" } });
    expect(invite.status()).toBe(201);
    expect((await cashier.context.post("/api/staff/accept", { data: { token: (await invite.json() as { token: string }).token } })).status()).toBe(200);
    const joined = await guest.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const { cardLocator, scanCode } = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { cardLocator: string; scanCode: string };
    expect(cardLocator).toMatch(/^K-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);

    // ── Cashier: typed number → minimal preview → deliberate open → award ──
    const cashierContext = await browser.newContext({ baseURL: url, storageState: await cashier.context.storageState() });
    contexts.push(cashierContext);
    const counter = await cashierContext.newPage();
    const lookups: string[] = [];
    counter.on("request", (request: Request) => { if (request.url().includes("/api/cashier/lookup")) lookups.push(new URL(request.url()).search); });
    await counter.goto("/cashier");
    await counter.getByLabel("Kartennummer oder Kartencode").fill(` ${cardLocator.toLowerCase().replace("-", " ")} `); // pasted in lower case with a space
    await counter.getByRole("button", { name: "Prüfen" }).click();
    await expect(counter.getByRole("heading", { name: cardLocator })).toBeVisible();
    await expect(counter.getByText("Kaffeekarte").or(counter.getByText("Synthetic card"))).toBeVisible();
    await expect(counter.getByText("Aktueller Kontostand")).toHaveCount(0); // no balance, rewards or award controls yet
    await expect(counter.getByRole("button", { name: "Vergabe prüfen" })).toHaveCount(0);
    await counter.getByRole("button", { name: "Karte öffnen" }).click();
    await expect(counter.getByText("Per Kartennummer geöffnet, ohne Scan.")).toBeVisible();
    await expect(counter.getByText("Aktueller Kontostand")).toBeVisible();
    expect(lookups).toHaveLength(2);
    expect(lookups[0]).not.toContain("confirm=1");
    expect(lookups[1]).toContain("confirm=1");
    await counter.getByRole("button", { name: "Vergabe prüfen" }).click();
    await counter.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(counter.getByText("1 Stempel vergeben.")).toBeVisible();
    // An unknown or look-alike number gets a plain German answer, not a server message.
    await counter.getByRole("button", { name: /Andere Karte/ }).click();
    await counter.getByLabel("Kartennummer oder Kartencode").fill("K-AAAAAA");
    await counter.getByRole("button", { name: "Prüfen" }).click();
    await expect(counter.getByText("Keine aktive Karte mit dieser Nummer", { exact: false })).toBeVisible();
    await counter.getByLabel("Kartennummer oder Kartencode").fill("K-0O1ILA");
    await counter.getByRole("button", { name: "Prüfen" }).click();
    await expect(counter.getByText("enthält weder 0, O, 1, I noch L", { exact: false })).toBeVisible();

    // ── Owner: correct the award (only the existing reversal endpoint is used) ──
    const ownerContext = await browser.newContext({ baseURL: url, storageState: await owner.context.storageState() });
    contexts.push(ownerContext);
    const page = await ownerContext.newPage();
    const writes: Array<{ url: string; body: Record<string, unknown> }> = [];
    page.on("request", request => { if (request.method() === "POST" && request.url().includes("/api/")) writes.push({ url: new URL(request.url()).pathname, body: request.postDataJSON() as Record<string, unknown> }); });
    await page.goto("/merchant/customers");
    await page.getByLabel("Kartennummer suchen").fill(cardLocator.toLowerCase());
    await page.getByRole("button", { name: "Suchen" }).click();
    await page.getByRole("button", { name: new RegExp(`Karte ${cardLocator}`) }).click();
    await expect(page.getByText("1 Stempel", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: "Korrigieren" }).first().click();
    const correct = page.getByRole("button", { name: "Korrektur buchen" });
    await expect(correct).toBeDisabled(); // a reason is mandatory
    await page.getByLabel(/Grund/).fill("Versehentlich vergeben, Kunde war nicht da");
    await correct.click();
    await expect(page.getByText("Korrektur gebucht.")).toBeVisible();
    await expect(page.getByText("Grund: Versehentlich vergeben, Kunde war nicht da")).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toBe("/api/transactions/reverse");
    expect(Object.keys(writes[0].body).sort()).toEqual(["entryId", "idempotencyKey", "locationId", "reason"]);
    const afterCorrection = await (await owner.context.get("/api/merchant/customers")).json() as { members: Array<{ balance: number; qualifyingCheckouts: number }> };
    expect(afterCorrection.members[0]).toMatchObject({ balance: 0, qualifyingCheckouts: 0 });

    // ── Owner: reissue with the explicit entitlement confirmation ──
    writes.length = 0;
    await page.getByRole("button", { name: "Karte neu ausstellen" }).click();
    const dialog = page.getByRole("alertdialog");
    await expect(dialog.getByText("Berechtigung geprüft", { exact: true }).first()).toBeVisible();
    await expect(dialog.getByText("Stelle die Karte nur neu aus, wenn du geprüft hast, dass die Person zu dieser Karte gehört. Der bisherige Kartenlink und QR-Code werden sofort ungültig. Guthaben, Kartennummer und Verlauf bleiben erhalten.")).toBeVisible();
    const submit = dialog.getByRole("button", { name: "Neuen Link ausstellen" });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel(/Grund/).fill("Neues Handy, alten Kartenlink auf dem alten Gerät gezeigt");
    await dialog.getByLabel("Wie hast du geprüft?").selectOption({ label: "Vorhandener Kartenlink" });
    await expect(submit).toBeDisabled(); // still no confirmation
    await dialog.getByRole("checkbox", { name: "Berechtigung geprüft" }).check();
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole("dialog").getByText("Der alte Link und der alte QR-Code funktionieren nicht mehr.")).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0].url).toMatch(/\/api\/merchant\/customers\/[0-9a-f-]+\/reissue$/);
    expect(writes[0].body).toMatchObject({ verificationMethod: "card_link", entitlementConfirmed: true, reason: "Neues Handy, alten Kartenlink auf dem alten Gerät gezeigt" });
    expect(String(writes[0].body.idempotencyKey)).toHaveLength(36);
    await page.getByRole("button", { name: "Fertig" }).click();

    // The old link and QR are dead; the number is unchanged.
    expect((await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).status()).toBe(404);
    expect((await owner.context.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`)).status()).toBe(404);
    const reopened = await (await owner.context.get("/api/merchant/customers")).json() as { members: Array<{ cardLocator: string; balance: number }> };
    expect(reopened.members[0]).toMatchObject({ cardLocator, balance: 0 });
  } finally {
    for (const context of contexts) await context.close();
    await Promise.all([owner.context.dispose(), cashier.context.dispose(), guest.dispose()]);
  }
});

test("a cashier cannot reach the owner pages, readiness or the correction and reissue endpoints", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await account(url, "gate-owner");
  const cashier = await account(url, "gate-cashier");
  const manager = await account(url, "gate-manager");
  try {
    const merchant = await shop(owner.context);
    for (const [staff, role] of [[cashier, "cashier"], [manager, "manager"]] as const) {
      const invite = await owner.context.post("/api/staff/invite", { data: { email: staff.email, locationId: merchant.locationId, role } });
      expect((await staff.context.post("/api/staff/accept", { data: { token: (await invite.json() as { token: string }).token } })).status()).toBe(200);
    }
    expect((await cashier.context.get("/api/merchant/readiness")).status()).toBe(403);
    expect((await manager.context.get("/api/merchant/readiness")).status()).toBe(200);
    const body = { reason: "Versuch ohne Berechtigung", verificationMethod: "card_link", entitlementConfirmed: true, idempotencyKey: randomUUID() };
    expect((await cashier.context.post(`/api/merchant/customers/${randomUUID()}/reissue`, { data: body })).status()).toBe(403);
    expect((await cashier.context.post("/api/transactions/reverse", { data: { locationId: merchant.locationId, entryId: randomUUID(), reason: "Versuch ohne Berechtigung", idempotencyKey: randomUUID() } })).status()).toBe(403);
    // Reissue also needs the explicit confirmation and a known method.
    expect((await manager.context.post(`/api/merchant/customers/${randomUUID()}/reissue`, { data: { ...body, entitlementConfirmed: false } })).status()).toBe(400);
    expect((await manager.context.post(`/api/merchant/customers/${randomUUID()}/reissue`, { data: { ...body, verificationMethod: "passport" } })).status()).toBe(400);
    expect((await manager.context.post(`/api/merchant/customers/${randomUUID()}/reissue`, { data: { reason: body.reason } })).status()).toBe(400);

    // A cashier who opens the owner area ends up at the counter and never asks for readiness.
    const cashierContext = await browser.newContext({ baseURL: url, storageState: await cashier.context.storageState() });
    try {
      const page = await cashierContext.newPage();
      const readiness: string[] = [];
      page.on("request", request => { if (request.url().includes("/api/merchant/readiness")) readiness.push(request.url()); });
      await page.goto("/merchant");
      await expect(page).toHaveURL(/\/cashier$/);
      expect(readiness).toHaveLength(0);
    } finally { await cashierContext.close(); }
  } finally { await Promise.all([owner.context.dispose(), cashier.context.dispose(), manager.context.dispose()]); }
});
