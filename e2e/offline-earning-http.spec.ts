import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("offline award lease is cashier-scoped and revoked staff sees a reviewable rejection", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const headers = { Origin: new URL(url).origin };
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  const cashier = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: headers });
  try {
    const cashierEmail = `offline-cashier-${randomUUID()}@example.test`;
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic owner", email: `offline-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    expect((await cashier.post("/api/auth/sign-up/email", { data: { name: "Synthetic cashier", email: cashierEmail, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Offline Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Offline test", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
    } });
    expect(onboard.status()).toBe(201);
    const { locationId, programSlug } = await onboard.json() as { locationId: string; programSlug: string };
    const invite = await owner.post("/api/staff/invite", { data: { locationId, email: cashierEmail, role: "cashier" } });
    expect(invite.status()).toBe(201);
    expect((await cashier.post("/api/staff/accept", { data: { token: (await invite.json()).token } })).status()).toBe(200);
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const card = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    const { scanCode } = await card.json() as { scanCode: string };
    const lookup = await cashier.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
    expect(lookup.status()).toBe(200);
    const { membershipId } = await lookup.json() as { membershipId: string };
    const deviceId = randomUUID();
    const lease = await cashier.post("/api/cashier/offline/lease", { data: { membershipId, deviceId } });
    expect(lease.status()).toBe(200);
    const { leaseId } = await lease.json() as { leaseId: string };
    const firstEvent = { leaseId, deviceId, eventId: randomUUID(), eventAt: new Date().toISOString(), award: { quantity: 1 } };
    expect((await owner.post("/api/cashier/offline/sync", { data: firstEvent })).status()).toBe(200);
    const initialBalance = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
    expect((await initialBalance.json()).balance).toBe(0);
    const accepted = await cashier.post("/api/cashier/offline/sync", { data: firstEvent });
    expect(accepted.status(), await accepted.text()).toBe(200);
    expect(await accepted.json()).toMatchObject({ status: "accepted", balance: 1 });
    expect(await (await cashier.post("/api/cashier/offline/sync", { data: firstEvent })).json()).toMatchObject({ status: "accepted", duplicate: true, balance: 1 });
    const cashierBrowser = await browser.newContext({ baseURL: url, storageState: await cashier.storageState() });
    const page = await cashierBrowser.newPage();
    await page.goto("/cashier");
    await page.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await page.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(page.getByText("Offline-Puffer bereit", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Vergabe prüfen" }).click();
    await page.getByRole("button", { name: "Offline-Vergabe vormerken" }).click();
    await expect(page.getByText("1 ausstehend", { exact: false })).toBeVisible();
    expect((await owner.post("/api/staff/revoke", { data: { userId: (await cashier.get("/api/me").then(response => response.json())).userId } })).status()).toBe(200);
    const revoked = await cashier.post("/api/cashier/offline/sync", { data: { ...firstEvent, eventId: randomUUID(), eventAt: new Date().toISOString() } });
    expect(revoked.status()).toBe(200);
    expect(await revoked.json()).toMatchObject({ status: "rejected", reason: "STAFF_REVOKED" });
    await page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren" }).click();
    await expect(page.getByText("Der Teamzugang ist nicht mehr aktiv.", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Offline-Vergabe vormerken" })).toHaveCount(0);
    await page.screenshot({ path: "screenshots/platform-after-offline-rejected.png", fullPage: true });
    await page.getByRole("button", { name: "Geprüft, aus Liste entfernen" }).click();
    await expect(page.getByText("0 ausstehend", { exact: false })).toBeVisible();
    expect((await guest.get(`/api/card/${encodeURIComponent(cardToken)}`).then(response => response.json())).balance).toBe(1);
    await cashierBrowser.close();
  } finally { await Promise.all([owner.dispose(), cashier.dispose(), guest.dispose()]); }
});
