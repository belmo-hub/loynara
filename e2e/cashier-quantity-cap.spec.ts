import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type DemoAccess = { cashierEmail: string; cashierPassword: string; programSlug: string };

test("a cashier's quantity picker stops at the server limit of 10", async ({ browser, page }) => {
  const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as DemoAccess;
  const cashier = await browser.newPage();
  try {
    await page.goto(`/join/${encodeURIComponent(demo.programSlug)}`);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Meine Karte erstellen" }).click();
    await expect.poll(() => new URL(page.url()).pathname.startsWith("/card/")).toBe(true);
    // The card no longer reveals the raw scan code as text; the QR image carries it, as a camera would read it.
    await expect(page.getByRole("button", { name: "Kartencode anzeigen" })).toHaveCount(0);
    const scanCode = new URL(await page.locator(".customer-qr img").getAttribute("src") ?? "", "http://localhost").searchParams.get("value") ?? "";

    await cashier.goto("/login");
    await cashier.getByLabel("E-Mail-Adresse").fill(demo.cashierEmail);
    await cashier.getByLabel("Passwort").fill(demo.cashierPassword);
    await cashier.getByRole("button", { name: "Anmelden" }).click();
    await expect.poll(() => new URL(cashier.url()).pathname).toBe("/cashier");
    await cashier.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(cashier.locator(".quantity-row output")).toHaveText("1");

    const more = cashier.getByRole("button", { name: "Menge erhöhen" });
    for (let click = 0; click < 15; click++) if (await more.isEnabled()) await more.click();
    await expect(cashier.locator(".quantity-row output")).toHaveText("10");
    await expect(more).toBeDisabled();
    await cashier.getByRole("button", { name: "Vergabe prüfen" }).click();
    await expect(cashier.getByRole("dialog", { name: "Vergabe bestätigen?" })).toContainText("10");
  } finally { await cashier.close(); }
});
