import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

type DemoAccess = {
  cashierEmail: string;
  cashierPassword: string;
  programSlug: string;
  ownerEmail: string; ownerPassword: string; merchantName: string;
};

for (const width of [375, 1280]) {
test(`cohort customer/cashier/merchant journey at ${width}px`, async ({ browser, page }) => {
  await page.setViewportSize({ width, height: 900 });
  const demo = JSON.parse(readFileSync(resolve("/tmp/loy-105-browser-fixture.json"), "utf8")) as DemoAccess;
  const cashier = await browser.newPage({ viewport: { width, height: 900 } });

  try {
    const programResponse = await page.request.get(`/api/program/${encodeURIComponent(demo.programSlug)}`);
    expect(programResponse.ok()).toBe(true);
    const program = await programResponse.json() as { active: boolean; rewardCost: number; rewardTitle: string; programType: "stamp" | "points"; locale: string };
    expect(program.active).toBe(true);
    expect(program.locale).toBe("de");
    expect(program.rewardCost).toBeGreaterThan(0);
    expect(program.rewardCost).toBeLessThanOrEqual(100);
    const unit = program.programType === "stamp" ? "Stempel" : "Punkte";

    await page.goto(`/join/${encodeURIComponent(demo.programSlug)}`);
    await expect(page.getByRole("heading", { name: "Mach deinen Besuch zählbar." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "E-Mail-Adresse" })).toHaveCount(0);
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "Meine Karte erstellen" }).click();
    await expect.poll(() => new URL(page.url()).pathname.startsWith("/card/")).toBe(true);
    await expect(page.locator(".customer-balance-line strong")).toHaveText(`0 ${unit}`);
    await expect(page.locator(".reward-remaining")).toContainText(`Noch ${program.rewardCost} ${unit} bis zu deiner Prämie: ${program.rewardTitle}`);
    // The card no longer reveals the raw scan code as text; the QR image carries it, as a camera would read it.
    await expect(page.getByRole("button", { name: "Kartencode anzeigen" })).toHaveCount(0);
    const scanCode = new URL(await page.locator(".customer-qr img").getAttribute("src") ?? "", "http://localhost").searchParams.get("value") ?? "";
    expect(scanCode.startsWith("sc_")).toBe(true);
    await expect.poll(() => page.locator(".customer-qr img").evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    await cashier.goto("/login");
    await cashier.getByLabel("E-Mail-Adresse").fill(demo.cashierEmail);
    await cashier.getByLabel("Passwort").fill(demo.cashierPassword);
    await cashier.getByRole("button", { name: "Anmelden" }).click();
    await expect.poll(() => new URL(cashier.url()).pathname).toBe("/cashier");
    await expect(cashier.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible();
    const cameraButton = await cashier.getByRole("button", { name: "Kamera öffnen" }).boundingBox();
    const manualField = await cashier.getByLabel("Kartennummer oder Kartencode").boundingBox();
    expect(cameraButton).not.toBeNull();
    expect(manualField).not.toBeNull();
    expect(cameraButton!.y).toBeLessThan(manualField!.y);
    await expect(cashier.getByLabel("Kartennummer oder Kartencode")).toHaveAttribute("placeholder", "z. B. K-7QX2MA");

    await cashier.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(cashier.locator(".balance-display strong")).toHaveText(`0 ${unit}`);
    await expect(cashier.locator(".reward-action-list button").first()).toBeDisabled();
    for (let stamp = 1; stamp < program.rewardCost; stamp++) {
      await cashier.getByRole("button", { name: "Menge erhöhen" }).click();
    }
    // More than one stamp at once still asks for confirmation.
    await cashier.locator(".cashier-award-now").click();
    await expect(cashier.getByRole("dialog", { name: "Vergabe bestätigen?" })).toBeVisible();
    await cashier.getByRole("button", { name: "Ja, vergeben" }).click();
    // The card closes right after booking; the confirmation names the card number and the new balance.
    await expect(cashier.locator(".cashier-booked")).toContainText(`Neuer Stand: ${program.rewardCost} ${unit}`);
    await expect(cashier.locator(".cashier-booked")).toContainText("Prämie verfügbar. Zum Einlösen die Karte erneut scannen.");
    await expect(cashier.locator(".cashier-award-now")).toHaveCount(0);
    await cashier.getByRole("button", { name: "Andere Karte" }).click();
    await cashier.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(cashier.locator(".balance-display strong")).toHaveText(`${program.rewardCost} ${unit}`);
    await expect(cashier.locator(".quantity-row output")).toHaveText("1");
    await expect(cashier.locator(".reward-action-list button").first()).toBeEnabled();

    await page.reload();
    await expect(page.locator(".customer-balance-line strong")).toHaveText(`${program.rewardCost} ${unit}`);
    await expect(page.locator(".customer-activity-list")).toContainText(`+${program.rewardCost} ${unit}`);
    await expect(page.locator(".reward-remaining")).toContainText("Deine Prämie ist bereit");

    await cashier.locator(".reward-action-list button").first().click();
    await expect(cashier.getByRole("dialog", { name: "Einlösung bestätigen?" })).toBeVisible();
    await cashier.getByRole("button", { name: "Ja, einlösen" }).click();
    await expect(cashier.locator(".cashier-booked")).toContainText(`Neuer Stand: 0 ${unit}`);
    await cashier.getByRole("button", { name: "Andere Karte" }).click();
    await cashier.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(cashier.locator(".balance-display strong")).toHaveText(`0 ${unit}`);
    await cashier.getByRole("button", { name: "Menge erhöhen" }).click();
    await cashier.getByRole("button", { name: "Menge erhöhen" }).click();
    await expect(cashier.locator(".quantity-row output")).toHaveText("3");
    await cashier.getByRole("button", { name: "Andere Karte" }).click();
    await cashier.getByLabel("Kartennummer oder Kartencode").fill(scanCode);
    await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
    await expect(cashier.locator(".quantity-row output")).toHaveText("1");

    await page.reload();
    await expect(page.locator(".customer-balance-line strong")).toHaveText(`0 ${unit}`);
    await expect(page.locator(".customer-activity-list")).toContainText(`+${program.rewardCost} ${unit}`);
    await expect(page.locator(".customer-activity-list")).toContainText(`-${program.rewardCost} ${unit}`);
    await expect(page.locator(".reward-remaining")).toContainText(`Noch ${program.rewardCost} ${unit} bis zu deiner Prämie: ${program.rewardTitle}`);
    await expect(page.getByText("Prämie eingelöst")).toBeVisible();

    await page.getByRole("button", { name: "Karte schließen" }).click();
    await expect(page.getByText("Buchungen und Einlösungen bleiben vorerst")).toBeVisible();
    await page.getByRole("button", { name: "Schließung verbindlich bestätigen" }).click();
    await expect(page.getByRole("heading", { name: "Karte geschlossen." })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "Karte nicht erreichbar." })).toBeVisible();
    await cashier.goto("/login");
    await cashier.getByLabel("E-Mail-Adresse").fill(demo.ownerEmail);
    await cashier.getByLabel("Passwort").fill(demo.ownerPassword);
    await cashier.getByRole("button", { name: "Anmelden" }).click();
    await expect.poll(() => new URL(cashier.url()).pathname).toBe("/merchant");
    await expect(cashier.getByRole("heading", { name: "Übersicht", exact: true })).toBeVisible();
    await expect(cashier.locator(width < 768 ? ".ow-topbar-loc" : ".ow-who")).toContainText(demo.merchantName);
    await page.screenshot({ path: `/tmp/loy-105-customer-${width}.png` });
    await cashier.screenshot({ path: `/tmp/loy-105-merchant-${width}.png` });
  } finally {
    await cashier.close();
  }
});

}
