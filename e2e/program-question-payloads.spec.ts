import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type BrowserContext, type Page } from "@playwright/test";

// ENG-099 N-3: each Programm question posts only its own fields, so saving one setting never resends, and so re-checks,
// another. PAYLOADS is that contract per screen: a field added to a question's body fails the question's test here.
// The saves are answered in the browser, so every question starts from the same stored programme.
const EXTRAS = "/api/merchant/program/extras", WINBACK = "/api/merchant/program/winback", UPDATE = "/api/merchant/program/update";
type Shop = "stamp" | "purchase" | "manual";
type Question = { shop: Shop; path: string; url: string; keys: string[]; answer: (page: Page) => Promise<void> };

const speichern = (page: Page) => page.getByRole("button", { name: "Speichern", exact: true }).click();
/** A rule screen: „Weiter“ through the steps, then „Neue Regelversion speichern“. */
const review = async (page: Page, steps = 1) => {
  for (let step = 0; step < steps; step++) await page.getByRole("button", { name: "Weiter" }).click();
  await page.getByRole("button", { name: "Neue Regelversion speichern" }).click();
};

const PAYLOADS: Record<string, Question> = {
  "08 Startbonus": { shop: "stamp", path: "welcome-bonus", url: EXTRAS, keys: ["programId", "welcomeBonus"], answer: async page => { await page.getByText("+2 Stempel").click(); await speichern(page); } },
  "09 Willkommen zurück": { shop: "stamp", path: "winback", url: WINBACK, keys: ["programSlug", "winback"], answer: async page => { await page.getByRole("switch", { name: /Willkommen-zurück-Bonus/ }).check(); await speichern(page); } },
  "10 Monats-Challenge": { shop: "stamp", path: "challenge", url: EXTRAS, keys: ["programId", "challengeVisits", "challengeBonus"], answer: async page => { await page.getByRole("switch", { name: /Monats-Challenge/ }).check(); await speichern(page); } },
  "11 Kundenlevel": { shop: "stamp", path: "levels", url: EXTRAS, keys: ["programId", "levelsEnabled", "levelSilverVisits", "levelGoldVisits", "levelBronzePerk", "levelSilverPerk", "levelGoldPerk"], answer: async page => { await page.getByLabel("Gold ab").fill("9"); await speichern(page); } },
  "11 Kundenlevel aus": { shop: "stamp", path: "levels", url: EXTRAS, keys: ["programId", "levelsEnabled"], answer: async page => { await page.getByRole("switch", { name: /Kundenlevel/ }).uncheck(); await speichern(page); } },
  "12 Neuigkeit": { shop: "stamp", path: "news", url: EXTRAS, keys: ["programId", "cardNews"], answer: async page => { await page.getByLabel("Neuigkeit", { exact: true }).fill("Neu: Frühstück ab 8 Uhr"); await speichern(page); } },
  "12 Neuigkeit entfernen": { shop: "stamp", path: "news", url: EXTRAS, keys: ["programId", "cardNews"], answer: page => page.getByRole("button", { name: "Neuigkeit entfernen" }).click() },
  "13 Google-Bewertung": { shop: "stamp", path: "review-link", url: EXTRAS, keys: ["programId", "reviewUrl"], answer: async page => { await page.getByLabel("Link zur Google-Bewertung").fill("https://g.page/r/abc/review"); await speichern(page); } },
  "15 Durchschnittsbon": { shop: "stamp", path: "average-spend", url: EXTRAS, keys: ["programId", "averageVisitSpendMinor"], answer: async page => { await page.getByLabel("Durchschnittsbon pro Buchung").fill("13,90"); await speichern(page); } },
  "16 Punkte verfallen": { shop: "purchase", path: "points-expiry", url: EXTRAS, keys: ["programId", "pointsExpiryMonths"], answer: async page => { await page.getByText("Nach 24 Monaten").click(); await speichern(page); } },
  "14 Regel auf der Karte": { shop: "stamp", path: "rule", url: UPDATE, keys: ["programSlug", "rulesText"], answer: async page => { await page.getByLabel("Regel auf der Karte", { exact: true }).fill("Ein Stempel pro Heißgetränk. Kaltgetränke zählen nicht."); await review(page); } },
  "52 Weitere Regeln": { shop: "purchase", path: "rule", url: UPDATE, keys: ["programSlug", "rulesText"], answer: async page => { await page.getByLabel("Weitere Regeln (optional)", { exact: true }).fill("Nur Mo–Fr."); await review(page); } },
  "33 Punkte pro 1 €": { shop: "purchase", path: "earning", url: UPDATE, keys: ["programSlug", "earningMode", "pointsPerCurrencyUnit"], answer: async page => { await page.getByRole("button", { name: "1 Punkt mehr" }).click(); await review(page); } },
  "33 Manuell zu Nach Einkaufswert (C1)": { shop: "manual", path: "earning", url: UPDATE, keys: ["programSlug", "earningMode", "pointsPerCurrencyUnit", "rulesText"], answer: async page => { await page.getByText("Nach Einkaufswert", { exact: true }).click(); await review(page); } },
  "33 Nach Einkaufswert zu Manuell (C2)": { shop: "purchase", path: "earning", url: UPDATE, keys: ["programSlug", "earningMode", "rulesText"], answer: async page => {
    await page.getByText("Manuell", { exact: true }).click();
    await page.getByRole("button", { name: "Weiter" }).click();
    await page.getByLabel("Regel auf der Karte", { exact: true }).fill("10 Punkte pro Einkauf.");
    await review(page);
  } },
  "36 Programmname": { shop: "stamp", path: "card", url: UPDATE, keys: ["programSlug", "name"], answer: async page => { await page.getByLabel("Programmname").fill("Kaffeekarte Mitte"); await page.getByRole("button", { name: "Kundenkarte speichern" }).click(); } },
};

const shops = {} as Record<Shop, Awaited<ReturnType<BrowserContext["storageState"]>>>;
test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  const make = async (shop: Shop, programme: Record<string, unknown>, extras?: Record<string, unknown>) => {
    const api = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    try {
      expect((await api.post("/api/auth/sign-up/email", { data: { name: "Synthetic payload owner", email: `payloads-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
      expect((await api.post("/api/merchant/onboard", { data: { businessName: `Synthetic ${shop}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Testkarte", rewardTitle: "Kaffee", rewardCost: 100, ...programme } })).status()).toBe(201);
      if (extras) expect((await api.post(EXTRAS, { data: { programId: (await (await api.get("/api/me")).json() as { programId: string }).programId, ...extras } })).status()).toBe(200);
      shops[shop] = await api.storageState();
    } finally { await api.dispose(); }
  };
  await make("stamp", { programType: "stamp", rulesText: "Ein Stempel pro Heißgetränk." }, { levelsEnabled: true, levelSilverVisits: 4, levelGoldVisits: 8, cardNews: "Ab Montag neue Öffnungszeiten." });
  await make("purchase", { programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 1, rulesText: "Nicht für Pfand, Gutscheine und Geschenkkarten." });
  await make("manual", { programType: "points", earningMode: "manual", rulesText: "10 Punkte pro Pizza." });
});

for (const [name, question] of Object.entries(PAYLOADS)) test(`${name} posts only its own fields`, async ({ baseURL, browser }) => {
  const context = await browser.newContext({ baseURL: baseURL ?? "http://localhost:3000", storageState: shops[question.shop] });
  try {
    const page = await context.newPage();
    const bodies: Array<Record<string, unknown>> = [];
    await page.route(target => target.pathname === question.url, async route => {
      if (route.request().method() !== "POST") return route.continue();
      bodies.push(route.request().postDataJSON());
      await route.fulfill({ json: {} });
    });
    await page.goto(`/merchant/program/${question.path}`);
    await expect(page.locator("h1").first()).toBeVisible();
    await question.answer(page);
    await expect.poll(() => bodies.length).toBe(1);
    expect(Object.keys(bodies[0]).sort()).toEqual([...question.keys].sort());
    if (question.url === WINBACK) expect(Object.keys(bodies[0].winback as object).sort()).toEqual(["bonus", "days", "enabled"]);
  } finally { await context.close(); }
});
