import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { signUp } from "./support/sign-up";

// ENG-379, Design r2: back on Mehr after „Passwort ändern“, the outcome line under Konto must clear the tab bar on a
// phone. In WebKit it first landed 35 px under it, and off screen at 200 % text: it was placed before Mehr settled.
async function change(page: Page, from: string, to: string) {
  await page.goto("/merchant/more");
  await page.getByRole("link", { name: /Passwort ändern/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Passwort ändern" })).toBeVisible();
  await page.getByLabel("Aktuelles Passwort").fill(from);
  await page.getByLabel("Neues Passwort").fill(to);
  await page.getByRole("button", { name: "Passwort speichern" }).click();
  await expect(page).toHaveURL(/\/merchant\/more$/);
  await expect(page.locator(".ow-prog-outcome")).toBeVisible();
  await expect(async () => {
    const note = (await page.locator(".ow-prog-outcome").boundingBox())!, tabs = (await page.locator(".ow-tabs").boundingBox())!;
    expect(note.y).toBeGreaterThanOrEqual(0);
    expect(note.y + note.height).toBeLessThanOrEqual(tabs.y);
  }).toPass({ timeout: 5_000 });
  await expect(page.getByRole("link", { name: /Passwort ändern/ })).toBeFocused();
}

test("the outcome of a password change is in view above the tab bar, at 100 and 200 % text", async ({ page }) => {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  if (!["localhost", "127.0.0.1"].includes(new URL(origin).hostname)) throw new Error("Requires the synthetic local app");
  const email = `password-m-${randomUUID()}@example.test`, first = `Local!${randomUUID()}Aa`, second = `Neu!${randomUUID()}Bb`, third = `Neu!${randomUUID()}Cc`;
  const request = page.context().request;
  expect((await signUp(request, { headers: { Origin: origin }, data: { name: "Synthetic password owner", email, password: first } })).status()).toBe(200);
  expect((await request.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: "Synthetic Passwort Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Passwort card", programType: "stamp", rulesText: "Synthetic local test only.", rewardTitle: "Kaffee", rewardCost: 5 } })).status()).toBe(201);

  await change(page, first, second);
  await page.addInitScript(() => document.addEventListener("DOMContentLoaded", () => document.head.appendChild(Object.assign(document.createElement("style"), { textContent: "html { font-size: 200% !important }" }))));
  await change(page, second, third);
});
