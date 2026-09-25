import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type DemoAccess = {
  cashierEmail: string;
  cashierPassword: string;
  programSlug: string;
};

test("a guest joins, earns a reward, redeems it, and sees persisted activity", async ({ browser, page }) => {
  const demo = JSON.parse(readFileSync(resolve("var/demo-access.json"), "utf8")) as DemoAccess;
  const cashier = await browser.newPage();

  try {
    const programResponse = await page.request.get(`/api/program/${encodeURIComponent(demo.programSlug)}`);
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json() as { active: boolean; rewardCost: number; programType: "stamp" | "points"; locale: string };
    expect(program.active).toBe(true);
    expect(program.locale).toBe("de");
    expect(program.rewardCost).toBeGreaterThan(0);
    expect(program.rewardCost).toBeLessThanOrEqual(100);
    const unit = program.programType === "stamp" ? "Stempel" : "Punkte";

    await page.goto(`/join/${encodeURIComponent(demo.programSlug)}`);
    await expect(page.getByRole("heading", { name: "Mach deinen Besuch zählbar." })).toBeVisible();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Meine Karte erstellen" }).click();
    await expect.poll(() => new URL(page.url()).pathname.startsWith("/card/")).toBe(true);
    await expect(page.locator(".customer-balance-line strong")).toHaveText(`0 ${unit}`);
    const scanCode = await page.locator(".customer-qr-panel code").innerText();
    expect(scanCode.startsWith("sc_")).toBe(true);
    await expect.poll(() => page.locator(".customer-qr img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await cashier.goto("/login");
    await cashier.getByLabel("E-Mail-Adresse").fill(demo.cashierEmail);
    await cashier.getByLabel("Passwort").fill(demo.cashierPassword);
    await cashier.getByRole("button", { name: "Anmelden" }).click();
    await expect.poll(() => new URL(cashier.url()).pathname).toBe("/cashier");
    await expect(cashier.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible();

    await cashier.getByLabel("Kartencode manuell eingeben").fill(scanCode);
    await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(cashier.locator(".balance-display strong")).toHaveText(`0 ${unit}`);
    await expect(cashier.locator(".reward-action-list button").first()).toBeDisabled();
    for (let stamp = 1; stamp < program.rewardCost; stamp++) {
      await cashier.getByRole("button", { name: "Menge erhöhen" }).click();
    }
    await cashier.getByRole("button", { name: "Vergabe prüfen" }).click();
    await expect(cashier.getByRole("dialog", { name: "Vergabe bestätigen?" })).toBeVisible();
    await cashier.getByRole("button", { name: "Ja, vergeben" }).click();
    await expect(cashier.locator(".balance-display strong")).toHaveText(`${program.rewardCost} ${unit}`);
    await expect(cashier.locator(".reward-action-list button").first()).toBeEnabled();

    await page.reload();
    await expect(page.locator(".customer-balance-line strong")).toHaveText(`${program.rewardCost} ${unit}`);
    await expect(page.locator(".customer-activity-list")).toContainText(`+${program.rewardCost} ${unit}`);

    await cashier.locator(".reward-action-list button").first().click();
    await expect(cashier.getByRole("dialog", { name: "Einlösung bestätigen?" })).toBeVisible();
    await cashier.getByRole("button", { name: "Ja, einlösen" }).click();
    await expect(cashier.locator(".balance-display strong")).toHaveText(`0 ${unit}`);

    await page.reload();
    await expect(page.locator(".customer-balance-line strong")).toHaveText(`0 ${unit}`);
    await expect(page.locator(".customer-activity-list")).toContainText(`+${program.rewardCost} ${unit}`);
    await expect(page.locator(".customer-activity-list")).toContainText(`-${program.rewardCost} ${unit}`);
    await expect(page.getByText("Prämie eingelöst")).toBeVisible();
  } finally {
    await cashier.close();
  }
});
