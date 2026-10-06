import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("synthetic referral link earns once after checkout and reverses with its qualifying award", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const origin = new URL(url).origin;
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: origin } });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: origin } });
  try {
    const email = `referral-${randomUUID()}@example.test`;
    expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic referral owner", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const onboard = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Synthetic Referral Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Synthetic Referral Card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5,
    } });
    expect(onboard.status()).toBe(201);
    const { programSlug, locationId } = await onboard.json() as { programSlug: string; locationId: string };
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(joined.status()).toBe(201);
    const { cardToken: referrerToken } = await joined.json() as { cardToken: string };
    const disabled = await guest.get(`/api/card/${encodeURIComponent(referrerToken)}/referral`);
    expect(disabled.status()).toBe(200);
    expect(await disabled.json()).toEqual({ enabled: false });
    expect((await guest.get(`/api/merchant/referrals/settings?programSlug=${encodeURIComponent(programSlug)}`)).status()).toBe(401);

    const ownerBrowser = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    const guestBrowser = await browser.newContext({ baseURL: url });
    const friendBrowser = await browser.newContext({ baseURL: url });
    try {
      const merchantPage = await ownerBrowser.newPage();
      await merchantPage.goto("/merchant/referrals");
      await expect(merchantPage.getByRole("heading", { name: "Empfehlungen", exact: true })).toBeVisible();
      await merchantPage.getByRole("checkbox", { name: /Empfehlungen für neue Anmeldungen/ }).check();
      await merchantPage.getByLabel("Bonus für empfehlende Karte (Stempel)").fill("2");
      await merchantPage.getByLabel("Bonus für neue Karte (Stempel)").fill("1");
      await merchantPage.getByRole("button", { name: "Regel speichern" }).click();
      await expect(merchantPage.getByText(/Empfehlungsregel gespeichert/)).toBeVisible();

      const referrerPage = await guestBrowser.newPage();
      await referrerPage.goto(`/card/${encodeURIComponent(referrerToken)}`);
      await expect(referrerPage.getByRole("heading", { name: "Karte empfehlen" })).toBeVisible();
      const shareUrl = await referrerPage.getByLabel("Link zum Teilen").inputValue();
      expect(shareUrl).toContain(`/join/${programSlug}?ref=ref_`);
      // The friend uses their own phone. (In the referrer's own browser the join page would offer the referrer's card.)
      const publicPage = await friendBrowser.newPage();
      await publicPage.goto(shareUrl);
      await expect(publicPage.getByText(/Empfehlungslink:/)).toBeVisible();
      await publicPage.getByRole("checkbox").check();
      await publicPage.getByRole("button", { name: "Meine Karte erstellen" }).click();
      await expect(publicPage).toHaveURL(/\/card\/card_[A-Za-z0-9_-]+$/);
      const referredToken = new URL(publicPage.url()).pathname.split("/").at(-1)!;
      const referredCard = await guest.get(`/api/card/${encodeURIComponent(referredToken)}`);
      expect(referredCard.status()).toBe(200);
      const { scanCode } = await referredCard.json() as { scanCode: string };
      expect((await guest.get(`/api/card/${encodeURIComponent(referrerToken)}`).then(response => response.json()) as { balance: number }).balance).toBe(0);
      const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
      expect(lookup.status()).toBe(200);
      const { membershipId } = await lookup.json() as { membershipId: string };
      const award = await owner.post("/api/cashier/award", { data: { membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } });
      expect(award.status()).toBe(200);
      const { entryId, balance } = await award.json() as { entryId: string; balance: number };
      expect(balance).toBe(2);
      expect((await guest.get(`/api/card/${encodeURIComponent(referrerToken)}`).then(response => response.json()) as { balance: number }).balance).toBe(2);
      await merchantPage.reload();
      await expect(merchantPage.getByText("Bonus gebucht")).toBeVisible();
      await merchantPage.screenshot({ path: "screenshots/platform-after-referrals.png", fullPage: true });

      const reversal = await owner.post("/api/transactions/reverse", { data: { locationId, entryId, reason: "Synthetic checkout correction", idempotencyKey: randomUUID() } });
      expect(reversal.status()).toBe(200);
      expect((await guest.get(`/api/card/${encodeURIComponent(referrerToken)}`).then(response => response.json()) as { balance: number }).balance).toBe(0);
      expect((await guest.get(`/api/card/${encodeURIComponent(referredToken)}`).then(response => response.json()) as { balance: number }).balance).toBe(0);
      await merchantPage.reload();
      await expect(merchantPage.getByText("Bonus korrigiert")).toBeVisible();
      const analytics = await owner.get("/api/merchant/analytics?window=30");
      expect(analytics.status()).toBe(200);
      expect((await analytics.json() as { referrals: { attributed: number; qualified: number; reversed: number } }).referrals).toEqual({ attributed: 1, qualified: 1, reversed: 1 });
      await merchantPage.goto("/merchant/analytics");
      await expect(merchantPage.getByRole("heading", { name: "Empfehlungen im Zeitraum" })).toBeVisible();
      await expect(merchantPage.getByText("Nach Korrektur zurückgenommen")).toBeVisible();
      await expect(merchantPage.getByText("Über Empfehlungslink angemeldet")).toBeVisible();
      await merchantPage.screenshot({ path: "screenshots/platform-after-referral-analytics.png", fullPage: true });
    } finally { await ownerBrowser.close(); await guestBrowser.close(); await friendBrowser.close(); }
  } finally { await owner.dispose(); await guest.dispose(); }
});
