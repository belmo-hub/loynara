import { randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type APIRequestContext } from "@playwright/test";
import { signUp } from "./support/sign-up";

// ENG-272: a staff member who opens an invitation signed out and creates an account or signs in comes back to the
// invitation, not into the owner's shop setup. Runs where public registration is on (the local and CI browser apps).

async function invite(owner: APIRequestContext, locationId: string, email: string) {
  const response = await owner.post("/api/staff/invite", { data: { locationId, email, role: "cashier" } });
  expect(response.status()).toBe(201);
  return (await response.json() as { token: string }).token;
}

let owner: APIRequestContext, locationId: string;
test.beforeAll(async ({ baseURL }) => {
  const url = baseURL ?? "http://localhost:3000";
  owner = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
  expect((await signUp(owner, { data: { name: "Synthetic invite owner", email: `owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const setup = await owner.post("/api/merchant/onboard", { data: { businessName: "Synthetic Pizzeria", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Pizza card", programType: "stamp", rulesText: "One confirmed visit", rewardTitle: "Pizza", rewardCost: 8 } });
  expect(setup.status()).toBe(201);
  ({ locationId } = await setup.json() as { locationId: string });
});
test.afterAll(async () => { await owner.dispose(); });

test("a new staff member registers from the invitation and is back on it to accept", async ({ page }) => {
  const email = `staff-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const token = await invite(owner, locationId, email);
  await page.goto(`/invite/${token}`);
  await page.getByRole("link", { name: "Konto erstellen", exact: true }).click();
  await expect(page).toHaveURL(`/register?next=${encodeURIComponent(`/invite/${token}`)}`);
  await page.getByLabel("Dein Name", { exact: true }).fill("Synthetic cashier");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByLabel("Passwort wiederholen", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  // Sign-up never signs in (ENG-283): the inbox answer leads to sign-in, which still returns to the invitation.
  await expect(page.getByRole("heading", { name: "Schau in dein Postfach." })).toBeVisible();
  await page.getByRole("link", { name: "Zur Anmeldung", exact: true }).click();
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(`/invite/${token}`);
  await page.getByRole("button", { name: "Einladung annehmen", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Willkommen im Team." })).toBeVisible();
});

test("an existing account signs in from the invitation and is back on it", async ({ page, baseURL }) => {
  const email = `staff-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const staff = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL!).origin } });
  try { expect((await signUp(staff, { data: { name: "Synthetic cashier", email, password } })).status()).toBe(200); }
  finally { await staff.dispose(); }
  const token = await invite(owner, locationId, email);
  await page.goto(`/invite/${token}`);
  await page.getByRole("link", { name: "Zur Anmeldung", exact: true }).click();
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Anmelden", exact: true }).click();
  await expect(page).toHaveURL(`/invite/${token}`);
});

test("a foreign next is ignored: the inbox answer still leads to the plain sign-in", async ({ page }) => {
  const email = `owner-${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  await page.goto(`/register?next=${encodeURIComponent("//evil.example/invite/abc")}`);
  await expect(page.getByRole("link", { name: "Anmelden", exact: true })).toHaveAttribute("href", "/login");
  await page.getByLabel("Dein Name", { exact: true }).fill("Synthetic owner");
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill(email);
  await page.getByLabel("Passwort", { exact: true }).fill(password);
  await page.getByLabel("Passwort wiederholen", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Konto erstellen", exact: true }).click();
  await expect(page.getByRole("link", { name: "Zur Anmeldung", exact: true })).toHaveAttribute("href", "/login");
  // ENG-342: the answer names the address, so a typo shows, and offers the spam hint, support and the resend.
  await expect(page.locator("h1 + p strong")).toHaveText(email);
  await expect(page.getByRole("link", { name: "support@getloynara.com", exact: true })).toHaveAttribute("href", "mailto:support@getloynara.com");
  await page.getByRole("button", { name: "E-Mail erneut senden", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Wir haben dir den Link noch einmal geschickt.");
});
