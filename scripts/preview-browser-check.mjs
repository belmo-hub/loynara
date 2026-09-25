import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium, expect } from "@playwright/test";
import { parse } from "dotenv";

const repo = process.cwd();
const access = JSON.parse(readFileSync(resolve(repo, "var/preview-access.json"), "utf8"));
const origin = "http://localhost:3001";
const previewEnv = parse(readFileSync(resolve(repo, "var/preview.env")));
if (previewEnv.PUBLIC_BASE_URL !== origin || previewEnv.BETTER_AUTH_URL !== origin
  || previewEnv.DATABASE_URL !== "postgresql://looplocal_preview:looplocal_preview_local_only@127.0.0.1:54330/looplocal_preview"
  || previewEnv.EXTERNAL_EMAIL_ENABLED !== "false" || previewEnv.LIVE_BILLING_ENABLED !== "false") {
  console.error("Compiled browser check requires the isolated localhost preview with external services off.");
  process.exit(1);
}
let browser;
let step = "launch";

(async () => {
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ baseURL: origin });
  const customer = await context.newPage();
  const cashier = await context.newPage();

  step = "health";
  const health = await customer.request.get("/api/health");
  assert.equal(health.status(), 200);
  assert.equal((await health.json()).database, "reachable");

  step = "read program";
  const response = await customer.request.get(`/api/program/${encodeURIComponent(access.programSlug)}`);
  assert.equal(response.status(), 200);
  const program = await response.json();
  assert.equal(program.programType, "stamp");
  assert.ok(program.rewardCost >= 2 && program.rewardCost <= 100);

  step = "join without contact";
  await customer.goto(`/join/${encodeURIComponent(access.programSlug)}`);
  await expect(customer.getByRole("textbox", { name: "E-Mail-Adresse" })).toHaveCount(0);
  await customer.getByRole("checkbox").first().check();
  await customer.getByRole("button", { name: "Meine Karte erstellen" }).click();
  await customer.waitForURL(/\/card\//);
  const cardPath = new URL(customer.url()).pathname;
  await expect(customer.locator(".customer-balance-line strong")).toContainText("0 Stempel");

  step = "reopen card and reveal checkout code";
  const reopened = await context.newPage();
  await reopened.goto(cardPath);
  await expect(reopened.locator(".customer-balance-line strong")).toContainText("0 Stempel");
  await reopened.getByRole("button", { name: "Kartencode anzeigen" }).click();
  const scanCode = await reopened.locator(".customer-qr-panel code").innerText();
  assert.ok(scanCode.startsWith("sc_") && scanCode.length > 20);
  await expect.poll(() => reopened.locator(".customer-qr img").evaluate(image => image.naturalWidth)).toBeGreaterThan(0);

  step = "cashier login and manual lookup";
  await cashier.goto("/login");
  await cashier.getByLabel("E-Mail-Adresse").fill(access.cashierEmail);
  await cashier.getByLabel("Passwort").fill(access.cashierPassword);
  await cashier.getByRole("button", { name: "Anmelden" }).click();
  await cashier.waitForURL(/\/cashier/);
  await cashier.getByLabel("Kartencode manuell eingeben").fill(scanCode);
  await cashier.getByRole("button", { name: "Prüfen", exact: true }).click();
  await expect(cashier.locator(".balance-display strong")).toContainText("0 Stempel");
  await expect(cashier.locator(".quantity-row output")).toHaveText("1");

  step = "explicit award one";
  await cashier.getByRole("button", { name: "Vergabe prüfen" }).click();
  await expect(cashier.getByRole("dialog", { name: "Vergabe bestätigen?" })).toBeVisible();
  await cashier.getByRole("button", { name: "Ja, vergeben" }).click();
  await expect(cashier.locator(".balance-display strong")).toContainText("1 Stempel");
  await expect(cashier.locator(".quantity-row output")).toHaveText("1");
  await reopened.reload();
  await expect(reopened.locator(".customer-balance-line strong")).toContainText("1 Stempel");

  step = "earn reward threshold";
  for (let i = 1; i < program.rewardCost - 1; i++) await cashier.getByRole("button", { name: "Menge erhöhen" }).click();
  await expect(cashier.locator(".quantity-row output")).toHaveText(String(program.rewardCost - 1));
  await cashier.getByRole("button", { name: "Vergabe prüfen" }).click();
  await cashier.getByRole("button", { name: "Ja, vergeben" }).click();
  await expect(cashier.locator(".balance-display strong")).toContainText(`${program.rewardCost} Stempel`);
  await reopened.reload();
  await expect(reopened.locator(".customer-balance-line strong")).toContainText(`${program.rewardCost} Stempel`);

  step = "explicit redeem and reopen";
  await cashier.locator(".reward-action-list button").first().click();
  await expect(cashier.getByRole("dialog", { name: "Einlösung bestätigen?" })).toBeVisible();
  await cashier.getByRole("button", { name: "Ja, einlösen" }).click();
  await expect(cashier.locator(".balance-display strong")).toContainText("0 Stempel");
  await reopened.reload();
  await expect(reopened.locator(".customer-balance-line strong")).toContainText("0 Stempel");
  await expect(reopened.locator(".customer-activity-list")).toContainText(`-${program.rewardCost} Stempel`);

  console.log(JSON.stringify({ browser: "Chrome via Playwright", join: true, reopen: true, manualLookup: true, awardOne: true, rewardThreshold: program.rewardCost, redeem: true, finalBalance: 0, camera: "NOT RUN" }));
})().catch(error => {
  console.error(`Preview browser smoke failed at ${step}: ${error.name}`);
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
});
