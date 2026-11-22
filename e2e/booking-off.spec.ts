import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test } from "@playwright/test";
import { signUp } from "./support/sign-up";

// Design blocker 3 (22 Nov): a shop without online booking sees its owner screens as before #330.
test.use({ baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", viewport: { width: 390, height: 844 }, hasTouch: true });

test("a shop with booking off: no Termine in Mehr, the old export note, and no day view or wizard to reach", async ({ browser, baseURL }) => {
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL!).origin } });
  expect((await signUp(owner, { data: { name: "Synthetic pizzeria owner", email: `off-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  expect((await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Pizzeria", locationName: "Kassel Nord", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", rulesText: "Synthetic rules.", rewardTitle: "Pizza", programName: "Synthetic", programType: "stamp", rewardCost: 10 } })).status()).toBe(201);
  const context = await browser.newContext({ baseURL, storageState: await owner.storageState(), viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  await page.goto("/merchant/more");
  await expect(page.getByText("Karten für Excel")).toBeVisible();
  await expect(page.getByText("Termine für Excel")).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Tagesansicht/ })).toHaveCount(0);
  await expect(page.getByText("Lade deine Karten und Buchungen für Excel herunter. Kontaktdaten deiner Kundinnen und Kunden sind nicht enthalten.")).toBeVisible();
  for (const path of ["/merchant/termine", "/merchant/termine/einrichten"]) {
    await page.goto(path);
    await expect(page.getByText("Online-Termine sind für diesen Standort nicht eingeschaltet.")).toBeVisible();
    await expect(page.getByText("Was für ein Betrieb bist du?")).toHaveCount(0);
  }
  await context.close(); await owner.dispose();
});
