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

test("a failed invitation says what to do", async ({ page }) => {
  await signIn(page);
  await page.goto("/merchant/staff");
  const form = page.locator('section[aria-labelledby="st-invite"]'), alert = page.locator('.ow-notice[role="alert"]');
  await form.getByLabel("E-Mail-Adresse", { exact: true }).fill("team@example.test");
  for (const [answer, text] of [[fail(500, { error: "Internal error" }), "kann gerade nicht erstellt werden"], [fail(404, { error: "Location not selected", code: "NOT_FOUND" }), "Standort"]] as const) {
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
  await page.route("**/api/staff/revoke", route => route.fulfill(fail(404, { error: "Staff member not found", code: "NOT_FOUND" })));
  await page.goto("/merchant/staff");
  await page.getByRole("listitem").filter({ hasText: "kasse@example.test" }).getByRole("button", { name: "Sperren", exact: true }).click();
  await page.getByRole("button", { name: "Zugang sperren", exact: true }).click();
  const alert = page.locator('.ow-notice[role="alert"]');
  await expect(alert).toContainText("aktuelle Liste");
  expect(await alert.innerText()).not.toMatch(english);
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
