import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

// Pilot policy: automatic NFC awards are never offered or accepted on the production deployment.
// Run once normally (development: automatic stays available) and once with E2E_PILOT_PRODUCTION=1 against a
// server started with PRODUCTION_ENVIRONMENT=loynara-production (production-like: automatic refused).
// NFC may remain disabled. Assertions follow the server capability instead of requiring verification keys.
// This legacy suite provisions users through open local registration; the independent overnight safe suite
// exercises the actual closed-registration production configuration with pre-provisioned synthetic users.
const productionLike = process.env.E2E_PILOT_PRODUCTION === "1";

async function ownerWithProgramme(baseURL: string) {
  const api = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin, ...(productionLike ? { "cf-connecting-ip": "203.0.113.7" } : {}) } });
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Pilot NFC owner", email: `nfc-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const onboard = await api.post("/api/merchant/onboard", { data: { businessName: "Pilot NFC Café", locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "NFC card", programType: "stamp", rulesText: "Ein Stempel je Besuch.", rewardTitle: "Kaffee", rewardCost: 5 } });
  expect(onboard.status()).toBe(201);
  const me = await (await api.get("/api/me")).json() as { programId: string; programSlug: string; tapAutomaticAllowed?: boolean; hiddenSurfaces?: string[] };
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
      await expect(page.getByRole("heading", { name: "Sammelregeln & Prämien" })).toBeVisible();
      if (me.hiddenSurfaces?.includes("nfc")) {
        // Without an NFC key provider configured: the NFC card is withheld (nothing to choose, nothing that can fail), and the server still refuses automatic taps.
        await expect(page.getByText("NFC-Tap (optional)")).toHaveCount(0);
        if (productionLike) expect((await policy("automatic_fixed")).status()).toBe(400);
      } else {
        await page.getByText("NFC-Tap (optional)").click();
        await expect(page.getByRole("radio", { name: /Aus/ })).toBeVisible();
        await expect(page.getByRole("radio", { name: /Mit Bestätigung/ })).toBeVisible();
        await expect(page.getByRole("radio", { name: /Automatisch/ })).toBeEnabled();
      }
    } finally { await ctx.close(); }

    expect((await policy("staff_confirmed")).status()).toBe(200);
    if (!productionLike) expect((await policy("automatic_fixed")).status()).toBe(200);
    else expect((await (await policy("automatic_fixed")).json() as { code: string }).code).toBe("TAP_AUTOMATIC_NOT_ALLOWED");
    expect((await api.post("/api/merchant/tap", { data: { action: "policy", programId: me.programId, mode: "disabled", cooldownSeconds: null } })).status()).toBe(200);
  } finally { await api.dispose(); }
});

test("manager sees an accurate read-only programme action while the owner keeps the edit action", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const { api: owner, me } = await ownerWithProgramme(url);
  const manager = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin, ...(productionLike ? { "cf-connecting-ip": "203.0.113.8" } : {}) } });
  try {
    const email = `manager-${randomUUID()}@example.test`;
    expect((await manager.post("/api/auth/sign-up/email", { data: { name: "Pilot manager", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const invite = await owner.post("/api/staff/invite", { data: { locationId: (await (await owner.get("/api/me")).json() as { locationId: string }).locationId, email, role: "manager" } });
    expect(invite.status()).toBe(201);
    expect((await manager.post("/api/staff/accept", { data: { token: (await invite.json() as { token: string }).token } })).status()).toBe(200);
    // The overview shows the programme card only once a card exists (a brand-new merchant sees the setup view).
    const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin, ...(productionLike ? { "cf-connecting-ip": "203.0.113.9" } : {}) } });
    try { expect((await guest.post("/api/enroll", { data: { slug: me.programSlug, acceptedTerms: true, marketingOptIn: false } })).status()).toBe(201); } finally { await guest.dispose(); }

    for (const [name, api, expected, absent] of [["owner", owner, "Programm bearbeiten", "Programm ansehen"], ["manager", manager, "Programm ansehen", "Programm bearbeiten"]] as const) {
      const ctx = await browser.newContext({ baseURL: url, storageState: await api.storageState() });
      try {
        const page = await ctx.newPage();
        await page.goto("/merchant");
        await expect(page.getByRole("link", { name: expected }), name).toBeVisible();
        await expect(page.getByRole("link", { name: absent }), name).toHaveCount(0);
      } finally { await ctx.close(); }
    }
  } finally { await manager.dispose(); await owner.dispose(); }
});

test("cashier screen shows the NFC confirmation panel only for staff-confirmed programmes", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const { api: owner, me } = await ownerWithProgramme(url);
  const cashier = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin, ...(productionLike ? { "cf-connecting-ip": "203.0.113.10" } : {}) } });
  try {
    const email = `cashier-${randomUUID()}@example.test`;
    expect((await cashier.post("/api/auth/sign-up/email", { data: { name: "Pilot cashier", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
    const { locationId } = await (await owner.get("/api/me")).json() as { locationId: string };
    const invite = await owner.post("/api/staff/invite", { data: { locationId, email, role: "cashier" } });
    expect(invite.status()).toBe(201);
    expect((await cashier.post("/api/staff/accept", { data: { token: (await invite.json() as { token: string }).token } })).status()).toBe(200);

    const ctx = await browser.newContext({ baseURL: url, storageState: await cashier.storageState(), extraHTTPHeaders: productionLike ? { "cf-connecting-ip": "203.0.113.10" } : {} });
    try {
      const page = await ctx.newPage();
      await page.goto("/cashier");
      await expect(page.getByRole("heading", { name: /Karte scannen/ })).toBeVisible();
      await expect(page.getByRole("heading", { name: "NFC-Anfragen" })).toHaveCount(0);
      expect((await owner.post("/api/merchant/tap", { data: { action: "policy", programId: me.programId, mode: "staff_confirmed", cooldownSeconds: 60 } })).status()).toBe(200);
      await page.reload();
      if (me.hiddenSurfaces?.includes("nfc")) await expect(page.getByRole("heading", { name: "NFC-Anfragen" })).toHaveCount(0);
      else await expect(page.getByRole("heading", { name: "NFC-Anfragen" })).toBeVisible();
    } finally { await ctx.close(); }
  } finally { await cashier.dispose(); await owner.dispose(); }
});

test("login page carries no internal wording and offers registration only where it is enabled", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: "Gut, dass du da bist." })).toBeVisible();
  await expect(page.getByText(/Produktvorschau|synthet|Demo/i)).toHaveCount(0);
  // This suite's server has registration enabled (see PUBLIC_REGISTRATION_ENABLED); production keeps it disabled and shows the "Zugang wird eingerichtet" line instead.
  await expect(page.getByRole("link", { name: "Konto erstellen" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Anmelden", exact: true })).toBeEnabled();
});

const HIDDEN_ROUTES = ["/merchant/billing", "/merchant/billing/fixture/x", "/merchant/automations"];

test(`pilot surfaces: ${productionLike ? "withheld on real production" : "all available outside production"}`, async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const { api, me } = await ownerWithProgramme(url);
  const headers: Record<string, string> = productionLike ? { "cf-connecting-ip": "203.0.113.11" } : {};
  const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin, ...headers } });
  try {
    expect((await guest.post("/api/enroll", { data: { slug: me.programSlug, acceptedTerms: true, marketingOptIn: false } })).status()).toBe(201); // a first card, so the overview is the active-business view
    const ctx = await browser.newContext({ baseURL: url, storageState: await api.storageState(), extraHTTPHeaders: headers });
    try {
      const page = await ctx.newPage();
      const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
      await page.goto("/merchant");
      await expect(page.getByRole("heading", { name: "Übersicht", exact: true })).toBeVisible();
      if (productionLike) {
        await expect(nav.getByRole("link", { name: "Aktionen" })).toBeVisible();
        await expect(nav.getByRole("link", { name: "Auswertung" })).toHaveCount(0);
        await expect(page.getByText("Was jetzt zählt")).toBeVisible();
        for (const path of HIDDEN_ROUTES) {
          await page.goto(path);
          await expect(page.getByRole("heading", { name: "Diese Seite gibt es nicht." }), path).toBeVisible();
          await expect(page.getByText(/Tarif|Abrechnung bestätigen|€|Automationen|Regel aktivieren/)).toHaveCount(0);
        }
        // Campaigns and audiences are draft-only: usable, but no schedule control and no send wording while delivery is disabled.
        await page.goto("/merchant/audiences");
        await expect(page.getByRole("heading", { name: "Segmente prüfen" })).toBeVisible();
        await page.goto("/merchant/campaigns");
        await expect(page.getByRole("heading", { name: "Kampagnen", exact: true })).toBeVisible();
        await expect(page.getByText("E-Mail-Versand ist noch nicht freigeschaltet.")).toBeVisible();
        await page.getByRole("button", { name: /Kunden zurückholen/ }).click();
        await page.getByRole("button", { name: "Weiter" }).click();
        await page.getByRole("button", { name: "Weiter" }).click();
        await expect(page.getByRole("button", { name: "Entwurf speichern" })).toBeVisible();
        await expect(page.getByRole("button", { name: "Planen", exact: true })).toHaveCount(0);
        await expect(page.getByLabel("Termin für den Versand")).toHaveCount(0);
        await page.goto("/merchant/settings");
        await expect(page.getByRole("link", { name: "Abrechnung" })).toHaveCount(0);
        await page.goto("/merchant/analytics");
        await expect(page.getByRole("heading", { name: "Auswertung", exact: true })).toBeVisible();
        await expect(page.getByText(/Zustellversuche|Kampagnenversuche|noch nicht/i)).toHaveCount(0);
        await page.goto("/merchant/program/card");
        await expect(page.getByText(/Apple Wallet|Google Wallet|Logo/)).toHaveCount(0);
        // The app root is the login page, without draft pricing. (The sign-up page redirect follows PUBLIC_REGISTRATION_ENABLED and is covered by a unit test; this suite needs registration on to create its accounts.)
        await page.goto("/");
        await expect(page).toHaveURL(`${url}/login`);
        await expect(page.getByText(/€|Preis|FAIR PRO STANDORT/)).toHaveCount(0);
      } else {
        await page.goto("/merchant/billing");
        await expect(page.getByRole("heading", { name: "Tarif und Abrechnung" })).toBeVisible();
        await page.goto("/merchant/campaigns");
        await expect(page.getByRole("heading", { name: "Kampagnen", exact: true })).toBeVisible();
        await page.goto("/merchant");
        await expect(nav.getByRole("link", { name: "Aktionen" })).toBeVisible();
      }
    } finally { await ctx.close(); }
  } finally { await guest.dispose(); await api.dispose(); }
});
