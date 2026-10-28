import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";

// ENG-099 3c: the earning sentence by purchase amount, the owner's own rule when switching to manual points, and Legal's
// exclusions on the sign-up page.
const EXCLUDED = "Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.";

async function owner(url: string, programme: Record<string, unknown>) {
  const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await api.post("/api/auth/sign-up/email", { data: { name: "Synthetic rules owner", email: `rules-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const made = await api.post("/api/merchant/onboard", { data: {
    businessName: "Synthetic Feinkost", locationName: "Kassel West", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Genusskarte", rewardTitle: "Espresso gratis", rewardCost: 50, ...programme,
  } });
  expect(made.status()).toBe(201);
  return { api, ...(await made.json() as { programSlug: string }) };
}

test("switching to manual points starts the rule empty and offers the extra rules to take over (C2)", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const extras = "Nicht für Pfand, Gutscheine und Geschenkkarten.";
  const shop = await owner(url, { programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: extras });
  const toRule = async () => {
    const context = await browser.newContext({ baseURL: url, storageState: await shop.api.storageState() });
    const page = await context.newPage();
    await page.goto("/merchant/program/earning");
    await page.getByText("Manuell", { exact: true }).click();
    await page.getByRole("button", { name: "Weiter" }).click();
    await expect(page.getByRole("heading", { name: "Wie sammeln deine Kunden?" })).toBeVisible();
    return { context, page, rule: page.getByLabel("Regel auf der Karte", { exact: true }), adopt: page.getByRole("button", { name: "In die Regel übernehmen" }) };
  };
  try {
    const { context, page, rule, adopt } = await toRule();
    try {
      await expect(rule).toHaveValue("");
      await expect(rule).toHaveAttribute("placeholder", "z. B. 10 Punkte pro Pizza.");
      await expect(page.getByText(`Bisher unter „Weitere Regeln“: ${extras}`)).toBeVisible();
      await rule.fill("5 Punkte pro Einkauf.");
      await adopt.click();
      await expect(rule).toHaveValue(`5 Punkte pro Einkauf.\n${extras}`);
      await expect(rule).toBeFocused();
      await expect(adopt).toHaveCount(0); // taken over once, so a second tap cannot add it twice
      // The rule is still the owner's own and needs 10 characters.
      await rule.fill("");
      await page.getByRole("button", { name: "Weiter" }).click();
      await expect(page.getByText("Der Regeltext braucht mindestens 10 Zeichen.")).toBeVisible();
      await expect(adopt).toBeVisible();
    } finally { await context.close(); }
    // Without extra rules there is nothing to take over.
    expect((await shop.api.post("/api/merchant/program/update", { data: { programSlug: shop.programSlug, rulesText: "" } })).status()).toBe(200);
    const empty = await toRule();
    try {
      await expect(empty.rule).toHaveValue("");
      await expect(empty.page.getByText("Bisher unter „Weitere Regeln“")).toHaveCount(0);
      await expect(empty.adopt).toHaveCount(0);
    } finally { await empty.context.close(); }
  } finally { await shop.api.dispose(); }
});

test("the sign-up page names Legal's exclusions once, last, with the win-back bonus on; the card keeps them in its line", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const shop = await owner(url, { programType: "stamp", rulesText: "Ein Stempel pro Heißgetränk." });
  try {
    expect((await shop.api.post("/api/merchant/program/winback", { data: { programSlug: shop.programSlug, winback: { enabled: true, days: 30, bonus: 1 } } })).status()).toBe(200);
    const context = await browser.newContext({ baseURL: url });
    try {
      const page = await context.newPage();
      await page.goto(`/join/${encodeURIComponent(shop.programSlug)}`);
      const rules = page.getByRole("heading", { name: "So funktioniert das Programm" }).locator("..");
      await expect(rules).toContainText("Willkommen-zurück-Bonus");
      expect((await rules.innerText()).split(EXCLUDED)).toHaveLength(2);
      await expect(rules.locator("p").last()).toHaveText(EXCLUDED);
      const joined = await context.request.post("/api/enroll", { data: { slug: shop.programSlug, acceptedTerms: true, marketingOptIn: false }, headers: { Origin: new URL(url).origin } });
      expect(joined.status()).toBe(201);
      await page.goto(`/card/${encodeURIComponent((await joined.json() as { cardToken: string }).cardToken)}`);
      // The card has no line of its own for them: the win-back line keeps its sentence, unchanged.
      const card = page.locator("#customer-rules p").first();
      await expect(card).toContainText("Willkommen-zurück-Bonus");
      expect((await card.innerText()).endsWith(` ${EXCLUDED}`)).toBe(true);
      expect((await page.locator("#customer-rules").innerText()).split(EXCLUDED)).toHaveLength(2);
    } finally { await context.close(); }
  } finally { await shop.api.dispose(); }
});
