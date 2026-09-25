import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

test("owner edits merchant identity with a live preview and customer card sees the persisted result", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  try {
    expect((await owner.post("/api/auth/sign-up/email", { data: {
      name: "Synthetic brand owner", email: `brand-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa`,
    } })).status()).toBe(200);
    const setup = await owner.post("/api/merchant/onboard", { data: {
      businessName: "Before Café", locationName: "Before Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
      programName: "Brand card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5, brandColor: "#2f6b58",
    } });
    expect(setup.status()).toBe(201);
    const { programSlug } = await setup.json() as { programSlug: string };
    const enrollment = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(enrollment.status()).toBe(201);
    const { cardToken } = await enrollment.json() as { cardToken: string };
    const context = await browser.newContext({ baseURL: url, storageState: await owner.storageState() });
    try {
      const page = await context.newPage();
      await page.goto("/merchant/program");
      const editor = page.locator('section[aria-labelledby="brand-heading"]');
      await expect(editor.getByRole("heading", { name: "Markenauftritt" })).toBeVisible();
      await editor.getByLabel("Geschäftsname").fill("After Café");
      await editor.getByLabel("Standortname").fill("After Mitte");
      await editor.getByLabel("Markenfarbe").fill("#1f4d3f");
      await expect(editor.getByText("After Café", { exact: true })).toBeVisible();
      await expect(editor.getByText("After Café", { exact: true }).locator("..")).toHaveCSS("background-color", "rgb(31, 77, 63)");
      await editor.getByRole("button", { name: "Markenauftritt speichern" }).click();
      await expect(editor.getByRole("status")).toContainText("Markenauftritt gespeichert");
      const programme = await guest.get(`/api/program/${programSlug}`);
      expect(programme.status()).toBe(200);
      expect(await programme.json()).toMatchObject({ businessName: "After Café", locationName: "After Mitte", brandColor: "#1f4d3f" });
      const card = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
      expect(card.status()).toBe(200);
      expect(await card.json()).toMatchObject({ merchantName: "After Café", locationName: "After Mitte", brandColor: "#1f4d3f" });
      expect((await guest.get(`/api/merchant/program/brand?programSlug=${programSlug}`)).status()).toBe(401);
    } finally { await context.close(); }
  } finally { await Promise.all([owner.dispose(), guest.dispose()]); }
});
