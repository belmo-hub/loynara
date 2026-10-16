import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";

// The owner area never shows the server's own error text: failed team changes and a failed account load say in German
// what happened and what to do. Answers are stubbed with what the API really sends (src/lib/http.ts respondError).
const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { ownerEmail: string; ownerPassword: string };
const english = /Internal error|not found|not selected|required/i;

async function signIn(page: Page) {
  const origin = new URL(test.info().project.use.baseURL!).origin;
  const res = await page.request.post("/api/auth/sign-in/email", { data: { email: demo.ownerEmail, password: demo.ownerPassword }, headers: { Origin: origin } });
  expect(res.ok()).toBe(true);
}
const fail = (status: number, body: object) => ({ status, contentType: "application/json", body: JSON.stringify(body) });
// Stubs that pass a request through can still be fetching when a test ends (the page reloads lists after a failure).
test.afterEach(({ page }) => page.unrouteAll({ behavior: "ignoreErrors" }));

test("a failed invitation says what to do", async ({ page }) => {
  await signIn(page);
  await page.goto("/merchant/staff");
  const form = page.locator('section[aria-labelledby="st-invite"]'), alert = page.locator('.ow-notice[role="alert"]');
  await form.getByLabel("E-Mail-Adresse", { exact: true }).fill("team@example.test");
  for (const [answer, text] of [[fail(500, { error: "Internal error" }), "kann gerade nicht erstellt werden"], [fail(404, { error: "Location not selected", code: "NOT_FOUND" }), "Standort"],
    [fail(400, { error: "Die Einrichtung deines Geschäfts ist unvollständig.", code: "SETUP_INCOMPLETE" }), "wende dich an den Support"]] as const) {
    await page.route("**/api/staff/invite", route => route.fulfill(answer));
    await form.getByRole("button", { name: "Einladungslink erstellen" }).click();
    await expect(alert).toContainText(text);
    expect(await alert.innerText()).not.toMatch(english);
    await page.unroute("**/api/staff/invite");
  }
});

test("a failed revocation says what to do", async ({ page }) => {
  await signIn(page);
  await page.route("**/api/staff", async route => {
    const list = await (await route.fetch()).json() as { staff: object[] };
    await route.fulfill({ json: { ...list, staff: [...list.staff, { userId: "u-synthetic", email: "kasse@example.test", role: "cashier", locationId: null, active: true }] } });
  });
  await page.goto("/merchant/staff");
  const alert = page.locator('.ow-notice[role="alert"]');
  // A refusal, then a 200 whose body never arrived: the second may have revoked the access, so it is never called a failure.
  for (const [answer, text] of [[fail(404, { error: "Staff member not found", code: "NOT_FOUND" }), "aktuelle Liste"], [{ status: 200, contentType: "application/json", body: "" }, "nicht bestätigt"]] as const) {
    await page.route("**/api/staff/revoke", route => route.fulfill(answer));
    await page.getByRole("listitem").filter({ hasText: "kasse@example.test" }).getByRole("button", { name: "Sperren", exact: true }).click();
    await page.getByRole("button", { name: "Zugang sperren", exact: true }).click();
    await expect(alert).toContainText(text);
    expect(await alert.innerText()).not.toMatch(/Internal error|not found|wurde nicht gesperrt/i);
    await page.unroute("**/api/staff/revoke");
  }
});

test("a failed account load tells a lost connection from a server failure", async ({ page }) => {
  await signIn(page);
  const screen = page.getByRole("alert").filter({ hasText: "Dein Bereich ist nicht erreichbar" });
  await page.route("**/api/me", route => route.fulfill(fail(500, { error: "Internal error" })));
  await page.goto("/merchant");
  await expect(screen).toContainText("kann gerade nicht geladen werden");
  expect(await screen.innerText()).not.toMatch(english);
  await page.unroute("**/api/me");
  await page.route("**/api/me", route => route.abort("internetdisconnected"));
  await screen.getByRole("button", { name: "Erneut versuchen" }).click();
  await expect(screen).toContainText("Verbindung fehlt");
});

test("a failed location switch says what to do", async ({ page }) => {
  await signIn(page);
  // A second location (synthetic, never selected for real) makes the switcher appear in the "Mehr" panel.
  await page.route("**/api/merchant/locations", async route => {
    const list = await (await route.fetch()).json() as { locations: object[] };
    await route.fulfill({ json: { ...list, locations: [...list.locations, { id: "00000000-0000-4000-8000-000000000001", name: "Zweiter Standort", city: "Köln", programSlug: null, programName: null, programType: null, cards: 0 }] } });
  });
  await page.goto("/merchant");
  await page.getByRole("button", { name: "Mehr: Navigation öffnen" }).click();
  const switcher = page.getByRole("combobox", { name: "Aktiver Standort" }), alert = page.locator('.ow-loc [role="alert"]');
  for (const [answer, text] of [[fail(404, { error: "Location not found", code: "NOT_FOUND" }), "aktuellen Liste"], [fail(500, { error: "Internal error" }), "bisheriger Standort bleibt aktiv"],
    [{ status: 200, contentType: "application/json", body: "" }, "prüfe, welcher Standort aktiv ist"]] as const) {
    await page.route("**/api/merchant/locations/select", route => route.fulfill(answer));
    await switcher.selectOption({ label: "Zweiter Standort" });
    await expect(alert).toContainText(text);
    expect(await alert.innerText()).not.toMatch(/Internal error|not found|leer/i);
    await page.unroute("**/api/merchant/locations/select");
  }
});
