import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

// Overview insights link to campaign goals and customer views. A client-side navigation (what a click does) must apply the
// link's parameters; reading window.location at first render lost them. Runs against dev or a production-like server.
const headers: Record<string, string> = process.env.E2E_PILOT_PRODUCTION === "1" ? { "cf-connecting-ip": "203.0.113.9" } : {};

test("insight links keep their goal and filter on client-side navigation", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin, ...headers } });
  try {
    expect((await api.post("/api/auth/sign-up/email", { data: { name: "Insight owner", email: `insight-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    expect((await api.post("/api/merchant/onboard", { data: { businessName: "Insight Café", locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Insight card", programType: "stamp", rulesText: "Ein Stempel je Besuch.", rewardTitle: "Kaffee", rewardCost: 8 } })).status()).toBe(201);
    const ctx = await browser.newContext({ baseURL: url, storageState: await api.storageState(), extraHTTPHeaders: headers });
    try {
      const page = await ctx.newPage();
      await page.goto("/merchant");
      await expect(page.getByRole("heading", { name: /Übersicht|Dein Treueprogramm einrichten/ })).toBeVisible();
      const push = (path: string) => page.evaluate(target => (window as unknown as { next: { router: { push(path: string): void } } }).next.router.push(target), path);

      await push("/merchant/customers?activity=drifting&days=60");
      await expect(page.getByLabel("Ansicht")).toHaveValue("drifting");
      await expect(page.getByLabel("Zeitraum")).toHaveValue("60");
      await expect(page.getByText("Warum diese Karten?")).toBeVisible();
      await push("/merchant/customers?activity=recent&days=14&scope=all");
      await expect(page.getByLabel("Ansicht")).toHaveValue("recent");
      await expect(page.getByLabel("Zeitraum")).toHaveValue("14");

      await push("/merchant/campaigns?goal=winback&days=60");
      await expect(page.getByText("Ziel:")).toContainText("Kunden zurückholen");
      await expect(page.getByLabel("Inaktiv seit mindestens (Tage)")).toHaveValue("60");
    } finally { await ctx.close(); }
  } finally { await api.dispose(); }
});
