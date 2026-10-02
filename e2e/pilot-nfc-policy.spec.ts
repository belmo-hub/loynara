import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

// Pilot policy: automatic NFC awards are never offered or accepted on the production deployment.
// Run once normally (development: automatic stays available) and once with E2E_PILOT_PRODUCTION=1 against a
// server started with PRODUCTION_ENVIRONMENT=loynara-production (production-like: automatic refused).
const productionLike = process.env.E2E_PILOT_PRODUCTION === "1";

async function ownerWithProgramme(baseURL: string) {
  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin, ...(productionLike ? { "cf-connecting-ip": "203.0.113.7" } : {}) } });
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Pilot NFC owner", email: `nfc-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const onboard = await api.post("/api/merchant/onboard", { data: { businessName: "Pilot NFC Café", locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "NFC card", programType: "stamp", rulesText: "Ein Stempel je Besuch.", rewardTitle: "Kaffee", rewardCost: 5 } });
  expect(onboard.status()).toBe(201);
  const me = await (await api.get("/api/me")).json() as { programId: string; tapAutomaticAllowed?: boolean };
  return { api, me };
}

test(`NFC policy: server and UI follow the pilot policy (${productionLike ? "production-like" : "development"})`, async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const { api, me } = await ownerWithProgramme(url);
  try {
    expect(me.tapAutomaticAllowed).toBe(!productionLike);
    const policy = (mode: string) => api.post("/api/merchant/tap", { data: { action: "policy", programId: me.programId, mode, cooldownSeconds: 60 } });

    const ctx = await browser.newContext({ baseURL: url, storageState: await api.storageState(), extraHTTPHeaders: productionLike ? { "cf-connecting-ip": "203.0.113.7" } : {} });
    try {
      const page = await ctx.newPage();
      await page.goto("/merchant/program");
      await page.getByText("NFC-Tap (optional)").click();
      await expect(page.getByRole("radio", { name: /Aus/ })).toBeVisible();
      await expect(page.getByRole("radio", { name: /Mit Bestätigung/ })).toBeVisible();
      if (productionLike) {
        await expect(page.getByRole("radio", { name: /Automatisch/ })).toHaveCount(0);
        expect((await policy("automatic_fixed")).status()).toBe(400);
      } else {
        await expect(page.getByRole("radio", { name: /Automatisch/ })).toBeEnabled();
      }
    } finally { await ctx.close(); }

    expect((await policy("staff_confirmed")).status()).toBe(200);
    if (!productionLike) expect((await policy("automatic_fixed")).status()).toBe(200);
    else expect((await (await policy("automatic_fixed")).json() as { code: string }).code).toBe("TAP_AUTOMATIC_NOT_ALLOWED");
    expect((await api.post("/api/merchant/tap", { data: { action: "policy", programId: me.programId, mode: "disabled", cooldownSeconds: null } })).status()).toBe(200);
  } finally { await api.dispose(); }
});
