import { expect, test, type Browser, type Page } from "@playwright/test";
import { MASTER, merchantWithTag, pathOf, resetPeerLimits } from "./nfc-support";

// ENG-160 (founder, 31 Oct): after an NFC join on an iPhone, the Wallet offer shows while the customer waits for the team.
// While waiting, Apple's sheet leaves the customer on the tap page; once the stamp has landed, the card page takes over
// as in ENG-130. A stamp landing above a customer scrolled down to the band is brought into view (Design, 31 Oct).
test.skip(!MASTER, "Run only against a server configured with the synthetic derived NFC provider (E2E_NFC_VERIFY_MASTER)");
test.beforeEach(async () => { await resetPeerLimits(); });

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const BAND = "Deine Karte ist fertig. Leg sie in Apple Wallet.";

/** A fresh shop and an iPhone guest who joined from the plate and now waits for the team, with the band showing. */
async function waitingGuest(browser: Browser, url: string) {
  const m = await merchantWithTag(url);
  const customer = await browser.newContext({ baseURL: url, userAgent: IPHONE, viewport: { width: 390, height: 844 } });
  // No Apple Wallet credentials run in CI: only the location's availability flag and Apple's pass are stand-ins; join,
  // tap and confirmation stay real.
  await customer.route(/\/api\/program\/[^/?]+$/, async route => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), appleWallet: true } });
  });
  // Apple's prepare answers after a realistic pause, so a page that navigates away too early cancels it (Design, 31 Oct).
  await customer.route("**/api/wallet/apple", async route => { await new Promise(resolve => setTimeout(resolve, 300)); await route.fulfill({ json: { status: "ready", url: "/api/wallet/apple/download/synthetic-ticket" } }); });
  await customer.route("**/api/wallet/apple/download/synthetic-ticket", route => route.fulfill({ contentType: "application/vnd.apple.pkpass", body: Buffer.from("synthetic pass") }));
  const page = await customer.newPage();
  await page.goto(pathOf(m.nextUrl()));
  await page.getByRole("link", { name: "Karte erstellen", exact: true }).click();
  await page.getByRole("checkbox").first().check();
  await page.getByRole("button", { name: /Meine Karte erstellen/ }).click();
  await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
  await expect(page.getByRole("heading", { name: BAND })).toBeVisible({ timeout: 15_000 });
  expect(new URL(page.url()).pathname).toMatch(/^\/tap\//);
  const reject = async () => {
    const cashier = await browser.newContext({ baseURL: url, storageState: await m.cashier.storageState() });
    const counter = await cashier.newPage();
    await counter.goto("/cashier");
    await counter.getByRole("button", { name: "Ablehnen", exact: true }).click({ timeout: 15_000 });
    return cashier;
  };
  const confirm = async () => {
    const cashier = await browser.newContext({ baseURL: url, storageState: await m.cashier.storageState() });
    const counter = await cashier.newPage();
    await counter.goto("/cashier");
    await counter.getByRole("button", { name: "Stempel bestätigen", exact: true }).click({ timeout: 15_000 });
    return cashier;
  };
  return { m, customer, page, confirm, reject };
}
const addToWallet = (page: Page) => page.getByRole("button", { name: "Hinzufügen zu Apple Wallet" }).click();
/** Tap add and wait until the pass itself is requested, as Apple's sheet would be opened. */
async function addAndOpenSheet(page: Page) {
  const pass = page.waitForRequest(/\/api\/wallet\/apple\/download\//);
  await addToWallet(page);
  await pass;
}

test("scrolled down to the band, the confirmed stamp comes into view and the band stays once", async ({ baseURL, browser }) => {
  const { m, customer, page, confirm } = await waitingGuest(browser, baseURL ?? "http://localhost:3000");
  try {
    // Read down past the band to the page's end, as a customer waiting at the counter might.
    await page.getByRole("heading", { name: BAND }).scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const cashier = await confirm();
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
    // Chrome's scroll anchoring may already keep the card on screen; WebKit has none, and the page scrolls to it.
    await expect(page.locator(".customer-card")).toBeInViewport();
    await expect(page.getByRole("heading", { name: BAND })).toHaveCount(1);
    expect(new URL(page.url()).pathname).toMatch(/^\/tap\//);
    await cashier.close();
  } finally { await customer.close(); await m.close(); }
});

test("an Apple add while waiting stays on the tap page; the stamp landing then opens the card", async ({ baseURL, browser }) => {
  const { m, customer, page, confirm } = await waitingGuest(browser, baseURL ?? "http://localhost:3000");
  try {
    await addAndOpenSheet(page);
    await page.waitForTimeout(4_500);
    expect(new URL(page.url()).pathname).toMatch(/^\/tap\//);
    await expect(page.getByRole("button", { name: "Hinzufügen zu Apple Wallet" })).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const cashier = await confirm();
    await expect(page).toHaveURL(/\/card\/card_/, { timeout: 15_000 });
    await cashier.close();
  } finally { await customer.close(); await m.close(); }
});

test("an Apple add after the stamp has landed goes to the card, as on the join's step", async ({ baseURL, browser }) => {
  const { m, customer, page, confirm } = await waitingGuest(browser, baseURL ?? "http://localhost:3000");
  try {
    const cashier = await confirm();
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
    await addAndOpenSheet(page);
    await expect(page).toHaveURL(/\/card\/card_/, { timeout: 10_000 });
    await cashier.close();
  } finally { await customer.close(); await m.close(); }
});

test("a failed Apple add keeps the band and its error on the tap page when the stamp lands", async ({ baseURL, browser }) => {
  const { m, customer, page, confirm } = await waitingGuest(browser, baseURL ?? "http://localhost:3000");
  try {
    await customer.unroute("**/api/wallet/apple");
    await customer.route("**/api/wallet/apple", route => route.fulfill({ status: 503, json: { code: "WALLET_UNAVAILABLE" } }));
    await addToWallet(page);
    const error = page.getByRole("alert").filter({ hasText: "Wallet ist gerade nicht verfügbar" });
    await expect(error).toBeVisible();
    const cashier = await confirm();
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).pathname).toMatch(/^\/tap\//);
    await expect(error).toBeVisible();
    await cashier.close();
  } finally { await customer.close(); await m.close(); }
});

test("an Apple add while waiting, then a rejected request, stays on the tap page and says so", async ({ baseURL, browser }) => {
  const { m, customer, page, reject } = await waitingGuest(browser, baseURL ?? "http://localhost:3000");
  try {
    await addAndOpenSheet(page);
    await page.waitForTimeout(4_500);
    // The customer is down at the band; the new state must come into view, not render above them.
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
    const cashier = await reject();
    await expect(page.getByRole("heading", { name: "Nicht bestätigt" })).toBeInViewport({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    expect(new URL(page.url()).pathname).toMatch(/^\/tap\//);
    await cashier.close();
  } finally { await customer.close(); await m.close(); }
});
