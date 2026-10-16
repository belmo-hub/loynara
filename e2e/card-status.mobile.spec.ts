import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as { cardToken: string };

// The card page holds one status region at a time, and a panel's guidance stays on screen when another panel speaks.
test("two panels speak: both messages stay visible, one of them is the status", async ({ page }) => {
  const contact = { available: true, marketingAvailable: false, marketingExternal: false, contactPresent: false, emailVerified: false, marketingEmail: false };
  await page.route("**/api/card/*/contact", route => route.request().method() === "POST"
    ? route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "queued" }) })
    : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(contact) }));
  await page.goto(`/card/${encodeURIComponent(demo.cardToken)}`);
  await page.getByLabel("E-Mail-Adresse", { exact: true }).fill("gast@example.test");
  await page.getByRole("button", { name: "Bestätigungslink senden" }).click();
  const requested = page.getByText(/Bestätigungslink angefordert/);
  await expect(requested).toBeVisible();
  await expect(page.getByRole("status")).toHaveCount(1);

  // Copying may succeed or be refused by the browser; either way the copy panel speaks next.
  await page.getByRole("button", { name: "Kartenlink kopieren" }).click();
  await expect(page.getByRole("status")).toHaveCount(1);
  await expect(page.getByRole("status")).toContainText(/Kartenlink kopiert|Kopieren nicht möglich/);
  await expect(requested).toBeVisible();
});
