import { expect, test } from "@playwright/test";
import { MASTER, merchantWithTag, pathOf, resetPeerLimits } from "./nfc-support";

// ENG-160 (founder, 31 Oct): after an NFC join on an iPhone, the Wallet offer shows while the customer waits for the team,
// stays on the tap page, and stays once (not twice) when the stamp is then confirmed.
test.skip(!MASTER, "Run only against a server configured with the synthetic derived NFC provider (E2E_NFC_VERIFY_MASTER)");
test.beforeEach(async () => { await resetPeerLimits(); });

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

test("the Wallet band shows while waiting for the team and stays once after the stamp lands", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url);
  try {
    const customer = await browser.newContext({ baseURL: url, userAgent: IPHONE, viewport: { width: 390, height: 844 } });
    // No Apple Wallet credentials run in CI: only the location's availability flag is presented as on; join, tap and
    // confirmation stay real.
    await customer.route(/\/api\/program\/[^/?]+$/, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, json: { ...(await response.json()), appleWallet: true } });
    });
    const page = await customer.newPage();
    await page.goto(pathOf(m.nextUrl()));
    await page.getByRole("link", { name: "Karte erstellen", exact: true }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Meine Karte erstellen/ }).click();

    // Waiting: the band is already there, and the page stays the tap page.
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const band = page.getByRole("heading", { name: "Deine Karte ist fertig. Leg sie in Apple Wallet." });
    await expect(band).toBeVisible({ timeout: 15_000 });
    expect(new URL(page.url()).pathname).toMatch(/^\/tap\//);

    // Adding to Wallet from the band keeps the customer on the tap page (Reviewer N-1): Apple's sheet opens over it,
    // and 4 s later the band only resets its button instead of going to the card.
    await customer.route("**/api/wallet/apple", route => route.fulfill({ json: { status: "ready", url: "/api/wallet/apple/download/synthetic-ticket" } }));
    await customer.route("**/api/wallet/apple/download/synthetic-ticket", route => route.fulfill({ contentType: "application/vnd.apple.pkpass", body: Buffer.from("synthetic pass") }));
    const add = page.getByRole("button", { name: "Zu Apple Wallet hinzufügen" });
    await add.click();
    await page.waitForTimeout(4_500);
    expect(new URL(page.url()).pathname).toMatch(/^\/tap\//);
    await expect(add).toBeEnabled();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();

    // The team confirms; the stamp lands on the same page and the band stays, once.
    const cashierCtx = await browser.newContext({ baseURL: url, storageState: await m.cashier.storageState() });
    const cashierPage = await cashierCtx.newPage();
    await cashierPage.goto("/cashier");
    const confirm = cashierPage.getByRole("button", { name: "Stempel bestätigen", exact: true });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.click();
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
    await expect(band).toHaveCount(1);
    await expect(band).toBeVisible();
    await Promise.all([customer.close(), cashierCtx.close()]);
  } finally { await m.close(); }
});
