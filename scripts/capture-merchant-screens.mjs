import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, request } from "@playwright/test";

// Read-only screenshots after creating a fresh synthetic local merchant.
// This script never accepts a remote destination or real contact data.
const origin = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const parsed = new URL(origin);
if (parsed.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(parsed.hostname) || parsed.port !== "3000") {
  throw new Error("Merchant capture requires the local development app on port 3000");
}
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.PUBLIC_BASE_URL !== origin || !["localhost", "127.0.0.1"].includes(database.hostname)
  || database.pathname !== "/looplocal") throw new Error("Synthetic local database and origin required");
const output = resolve(process.cwd(), "screenshots");
await mkdir(output, { recursive: true });
const owner = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: parsed.origin } });
const guest = await request.newContext({ baseURL: origin, extraHTTPHeaders: { Origin: parsed.origin } });
let browser;
try {
  assert.equal((await owner.get("/api/health")).status(), 200);
  assert.equal((await owner.post("/api/auth/sign-up/email", { data: {
    name: "Synthetic capture owner", email: `capture-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa`,
  } })).status(), 200);
  const setup = await owner.post("/api/merchant/onboard", { data: {
    businessName: "Morgenlicht Café (synthetisch)", locationName: "Kassel Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Morgenlicht Punkte", programType: "points", earningMode: "purchase", pointsPerCurrencyUnit: 3,
    rulesText: "Drei Punkte je vollem Euro eines bestätigten Einkaufs. Punktbruchteile werden abgerundet.",
    rewardTitle: "Kaffee", rewardCost: 14, brandColor: "#2f6b58",
  } });
  assert.equal(setup.status(), 201);
  const { programSlug } = await setup.json();
  const add = await owner.post("/api/merchant/program/rewards", { data: { action: "create", programSlug, title: "Frühstücksteller", cost: 45, termsText: "Ein Teller pro Einlösung." } });
  assert.equal(add.status(), 201);
  const enroll = async () => {
    const response = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
    assert.equal(response.status(), 201);
    return (await response.json()).cardToken;
  };
  const cardToken = await enroll();
  await enroll();
  const cardResponse = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
  const { scanCode } = await cardResponse.json();
  const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
  const { membershipId, ruleVersionId, rewards } = await lookup.json();
  const award = await owner.post("/api/cashier/award", { data: { membershipId, purchaseAmountMinor: 499, ruleVersionId, idempotencyKey: randomUUID(), requestId: randomUUID() } });
  assert.equal(award.status(), 200);
  const coffee = rewards.find(reward => reward.title === "Kaffee");
  assert.ok(coffee);
  const redeem = await owner.post("/api/cashier/redeem", { data: { membershipId, rewardVersionId: coffee.id, idempotencyKey: randomUUID(), requestId: randomUUID() } });
  assert.equal(redeem.status(), 200);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const merchant = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, storageState: await owner.storageState() });
  const page = await merchant.newPage();
  await page.goto("/merchant/program");
  await page.getByRole("heading", { name: "Prämien verwalten" }).waitFor();
  await page.locator(".reward-manager-row").nth(1).waitFor();
  await page.locator(".program-qr img").evaluate(async image => {
    if (image.complete && image.naturalWidth > 0) return;
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  });
  await page.screenshot({ path: resolve(output, "platform-after-programme.png"), fullPage: true });
  await page.goto("/merchant/customers");
  await page.getByRole("heading", { name: "Kartenübersicht" }).waitFor();
  await page.getByRole("button", { name: new RegExp(membershipId.slice(0, 12)) }).waitFor();
  await page.screenshot({ path: resolve(output, "platform-after-customers.png"), fullPage: true });
  await page.getByRole("button", { name: new RegExp(membershipId.slice(0, 12)) }).click();
  await page.getByText("Erfasste Käufe").waitFor();
  await page.screenshot({ path: resolve(output, "platform-after-customer-timeline.png"), fullPage: true });
  await page.goto("/cashier");
  await page.getByLabel("Kartencode manuell eingeben").fill(scanCode);
  await page.getByRole("button", { name: "Prüfen", exact: true }).click();
  await page.getByLabel("Kaufbetrag (EUR)").fill("4,99");
  await page.screenshot({ path: resolve(output, "platform-after-purchase-checkout.png"), fullPage: true });
  await merchant.close();

  const customer = await browser.newContext({ baseURL: origin, viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const cardPage = await customer.newPage();
  await cardPage.goto(`/card/${encodeURIComponent(cardToken)}`);
  await cardPage.locator(".customer-balance-line strong").waitFor();
  await cardPage.screenshot({ path: resolve(output, "platform-after-customer-card-390.png"), fullPage: true });
  await customer.close();
  console.log("Captured five actual local Chrome merchant/customer screenshots with synthetic data; no external destination or messaging.");
} finally {
  await Promise.all([owner.dispose(), guest.dispose()]);
  if (browser) await browser.close();
}
