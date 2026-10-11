import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || database.pathname !== "/looplocal_browser_login_081") throw new Error("Owned synthetic login database required");
const origin = "http://localhost:3000";
test.afterAll(async () => { await pool.end(); });

async function fixture(browser: Browser, baseURL: string | undefined, width: number) {
  if (baseURL !== origin) throw new Error("Loopback application required");
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const owner = await auth.api.signUpEmail({ body: { name: "Synthetic login operator", email, password } });
  const merchant = await createMerchant({ userId: owner.user.id, businessName: "Synthetic login Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Login test", programType: "stamp", rulesText: "One explicitly confirmed synthetic visit", rewardTitle: "Coffee", rewardCost: 3 });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin }, viewport: { width, height: 844 } });
  const page = await context.newPage(); await page.goto("/login");
  const emailInput = page.getByLabel("E-Mail-Adresse", { exact: true }), passwordInput = page.getByLabel("Passwort", { exact: true });
  await emailInput.fill(email); await passwordInput.fill(password);
  const submit = page.getByRole("button", { name: "Anmelden", exact: true });
  await expect(submit).toBeEnabled();
  const sessions = async () => Number((await pool.query('SELECT count(*) AS count FROM "session" WHERE "userId"=$1', [owner.user.id])).rows[0].count);
  async function signedIn() {
    await expect(page).toHaveURL(/\/merchant$/);
    const me = await context.request.get("/api/me"); expect(me.status()).toBe(200);
    expect(await me.json()).toMatchObject({ tenantId: merchant.tenantId, locationId: merchant.locationId, role: "owner" });
  }
  return { email, password, owner, merchant, context, page, emailInput, passwordInput, submit, sessions, signedIn };
}

test("mobile first login distinguishes rejected credentials from a temporary real session-write failure and permits explicit recovery", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 375), baseline = await f.sessions();
  const functionName = "synthetic_login_081_failure";
  try {
    const userLiteral = f.owner.user.id.replaceAll("'", "''");
    await pool.query(`CREATE FUNCTION ${functionName}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic session service unavailable'; END $$;
      CREATE TRIGGER synthetic_login_081_failure BEFORE INSERT ON "session" FOR EACH ROW WHEN (NEW."userId" = '${userLiteral}') EXECUTE FUNCTION ${functionName}();`);
    const failed = f.page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/sign-in/email");
    await f.submit.click(); const unavailable = await failed;
    expect(unavailable.status()).toBeGreaterThanOrEqual(500);
    await expect(f.page.locator('.auth-form [role="alert"]')).toContainText("vorübergehend");
    await expect(f.page.locator('.auth-form [role="alert"]')).not.toContainText(/session|Synthetic|INTERNAL|password|fetch/i);
    await expect(f.page).toHaveURL(/\/login$/);
    await expect(f.emailInput).toHaveValue(f.email); await expect(f.passwordInput).toHaveValue(f.password);
    expect(await f.sessions()).toBe(baseline);
    await pool.query(`DROP TRIGGER synthetic_login_081_failure ON "session"; DROP FUNCTION ${functionName}();`);
    await f.passwordInput.fill("Wrong!SyntheticPassword081");
    const rejected = f.page.waitForResponse(r => new URL(r.url()).pathname === "/api/auth/sign-in/email");
    await f.submit.click(); const response = await rejected;
    expect(response.status()).toBe(401); expect(await response.json()).toMatchObject({ code: "INVALID_EMAIL_OR_PASSWORD" });
    await expect(f.page.locator('.auth-form [role="alert"]')).toContainText("E-Mail-Adresse oder Passwort");
    expect(await f.sessions()).toBe(baseline);
    await f.passwordInput.fill(f.password);
    await f.submit.click(); await f.signedIn(); expect(await f.sessions()).toBe(baseline + 1);
    const foreignOwner = await auth.api.signUpEmail({ body: { name: "Synthetic foreign owner", email: `${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } });
    const foreignMerchant = await createMerchant({ userId: foreignOwner.user.id, businessName: "Synthetic foreign Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Foreign login test", programType: "stamp", rulesText: "One explicitly confirmed synthetic visit", rewardTitle: "Coffee", rewardCost: 3 });
    const foreign = await f.context.request.post("/api/merchant/locations/select", { data: { locationId: foreignMerchant.locationId } });
    expect(foreign.status()).toBe(404); // Existing route conceals locations outside the owner's tenant.
    expect(await (await f.context.request.get("/api/me")).json()).toMatchObject({ tenantId: f.merchant.tenantId, locationId: f.merchant.locationId, role: "owner" });
    expect((await f.context.request.post("/api/auth/sign-out", { data: {} })).status()).toBe(200);
    expect((await f.context.request.get("/api/me")).status()).toBe(401);
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS synthetic_login_081_failure ON "session"; DROP FUNCTION IF EXISTS ${functionName}();`);
    await f.context.close();
  }
});

test("desktop login reports a lost committed response as unconfirmed, retains credentials and never automatically signs in again", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 1280), baseline = await f.sessions();
  let requests = 0;
  try {
    await f.page.route("**/api/auth/sign-in/email", async route => {
      requests++; const response = await route.fetch(); expect(response.status()).toBe(200);
      if (requests === 1) {
        expect(await f.sessions()).toBe(baseline + 1);
        await route.abort("aborted");
      } else await route.fulfill({ response });
    });
    await f.submit.click();
    await expect(f.page.locator('.auth-form [role="alert"]')).toContainText("nicht bestätigt");
    await expect(f.page.locator('.auth-form [role="alert"]')).not.toContainText(/fehlgeschlagen|Failed|fetch|token|password/i);
    await expect(f.page).toHaveURL(/\/login$/);
    await expect(f.emailInput).toHaveValue(f.email); await expect(f.passwordInput).toHaveValue(f.password);
    await f.page.waitForLoadState("networkidle");
    expect(requests).toBe(1); expect(await f.sessions()).toBe(baseline + 1);
    await f.page.screenshot({ path: "/tmp/loy-081-login-uncertain-proof.png", fullPage: true });
    await f.submit.click(); await f.signedIn();
    expect(requests).toBe(2); expect(await f.sessions()).toBe(baseline + 2);
  } finally { await f.context.close(); }
});
