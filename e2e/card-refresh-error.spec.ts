import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

for (const width of [375, 1280]) {
  test(`manual card refresh reports a recoverable failure and recovers without mutations (${width}px)`, async ({ baseURL, browser }) => {
    const url = baseURL ?? "http://localhost:3000";
    const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    try {
      expect((await owner.post("/api/auth/sign-up/email", { data: { name: "Synthetic refresh owner", email: `refresh-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
      const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic refresh Café", locationName: "Synthetic Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Refresh card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 } });
      expect(setup.status()).toBe(201);
      const { programSlug } = await setup.json() as { programSlug: string };
      const enrolled = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
      expect(enrolled.status()).toBe(201);
      const { cardToken } = await enrolled.json() as { cardToken: string };
      const context = await browser.newContext({ baseURL: url, storageState: await guest.storageState(), viewport: { width, height: 812 } });
      try {
        const page = await context.newPage();
        await page.goto(`/card/${encodeURIComponent(cardToken)}`);
        await expect(page.locator(".customer-card")).toContainText("Synthetic refresh Café");
        const before = await (await guest.get(`/api/card/${cardToken}`)).json();
        let fail = true; let reads = 0; let mutationRequests = 0;
        page.on("request", request => { if (request.method() !== "GET" && request.url().includes("/api/")) mutationRequests++; });
        await page.route(`**/api/card/${cardToken}`, async route => {
          reads++;
          if (fail) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic temporary service failure" }) });
          else await route.continue();
        });
        const refresh = page.getByRole("button", { name: "Karte aktualisieren" });
        const feedback = page.locator(".customer-balance-panel").getByRole("alert");
        // The visible card re-reads itself after about 5 s; a failed automatic read stays silent and keeps the card.
        await expect.poll(() => reads, { timeout: 10_000 }).toBeGreaterThan(0);
        await expect(feedback).toHaveCount(0);
        await expect(page.locator(".customer-card")).toContainText("Synthetic refresh Café");
        // Honor the existing real 5-second gate; do not override browser clocks. The failed read pushed the next automatic one to 10 s.
        await page.waitForTimeout(5_100);
        const beforeClick = reads;
        await refresh.focus(); await page.keyboard.press("Enter");
        await expect.poll(() => reads).toBe(beforeClick + 1);
        await expect(feedback).toContainText("zuletzt geladenen Stand");
        await expect(refresh).toBeEnabled();
        await expect(page.locator(".customer-card")).toContainText("Synthetic refresh Café");
        expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
        // Once reads succeed again, the next one (automatic or the button) clears the note.
        fail = false; await page.waitForTimeout(5_100);
        await refresh.focus(); await page.keyboard.press("Enter");
        await expect(feedback).toHaveCount(0);
        await expect(refresh).toBeEnabled();
        expect(mutationRequests).toBe(0);
        expect(await (await guest.get(`/api/card/${cardToken}`)).json()).toEqual(before);
      } finally { await context.close(); }
    } finally { await owner.dispose(); await guest.dispose(); }
  });
}
