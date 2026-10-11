import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || database.pathname !== "/looplocal_browser_campaign_083") throw new Error("Owned synthetic campaign database required");
const origin = "http://localhost:3000";
test.afterAll(async () => { await pool.end(); });

async function fixture(browser: Browser, baseURL: string | undefined, width: number) {
  if (baseURL !== origin) throw new Error("Loopback application required");
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const owner = await auth.api.signUpEmail({ body: { name: "Synthetic draft owner", email, password } });
  const merchant = await createMerchant({ userId: owner.user.id, businessName: "Synthetic draft Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Draft test", programType: "stamp", rulesText: "One explicitly confirmed synthetic visit", rewardTitle: "Coffee", rewardCost: 3 });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin }, viewport: { width, height: 844 } });
  expect((await context.request.post("/api/auth/sign-in/email", { data: { email, password } })).status()).toBe(200);
  const initial = { title: "Synthetic original draft", subject: "Original subject", body: "Original synthetic body", audienceDefinition: { kind: "all" } };
  const created = await context.request.post("/api/merchant/campaigns", { data: { action: "create", programSlug: merchant.programSlug, ...initial } });
  expect(created.status()).toBe(201); const id = (await created.json()).campaign.id as string;
  expect(await (await context.request.get(`/api/merchant/campaigns?programSlug=${merchant.programSlug}`)).json()).toMatchObject({ deliveryMode: "disabled" });
  const page = await context.newPage(); await page.goto("/merchant/campaigns");
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Prüfen & speichern", exact: true })).toBeVisible();
  const current = async () => (await pool.query("SELECT * FROM campaigns WHERE id=$1", [id])).rows[0];
  const queue = async () => (await pool.query("SELECT * FROM outbox_jobs WHERE payload->>'campaignId'=$1 ORDER BY id", [id])).rows;
  async function edit(body: string) {
    await page.getByRole("button", { name: "Zurück", exact: true }).click();
    await page.getByLabel("Nachricht", { exact: true }).fill(body);
    await page.getByRole("button", { name: "Weiter", exact: true }).click();
  }
  async function reloadSaved(body: string) {
    await page.getByRole("button", { name: "Zur Kampagnenliste", exact: true }).click(); await page.reload();
    await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await page.getByRole("button", { name: "Zurück", exact: true }).click();
    await expect(page.getByLabel("Nachricht", { exact: true })).toHaveValue(body);
  }
  const save = page.getByRole("button", { name: "Entwurf aktualisieren", exact: true });
  return { owner, merchant, context, page, id, initial, current, queue, edit, reloadSaved, save };
}

test("mobile rejected database update preserves edits without claiming they are saved; explicit retry persists the current draft", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 375), before = await f.current(), queueBefore = await f.queue();
  const trigger = "synthetic_campaign_083_failure";
  try {
    await f.edit("Synthetic unsaved draft after valid validation");
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic draft persistence failure'; END $$;
      CREATE TRIGGER ${trigger} BEFORE UPDATE ON campaigns FOR EACH ROW WHEN (OLD.id = '${f.id}'::uuid) EXECUTE FUNCTION ${trigger}();`);
    const failed = f.page.waitForResponse(r => new URL(r.url()).pathname === "/api/merchant/campaigns" && r.request().method() === "POST");
    await f.save.click(); const response = await failed; expect(response.status()).toBe(500);
    expect(await response.json()).toMatchObject({ error: "Internal error" });
    await expect(f.page.locator('main [role="alert"]')).toBeVisible();
    await expect(f.save).toBeEnabled();
    await expect(f.page.getByText(/Ungespeicherte Änderungen/)).toBeVisible();
    expect(await f.current()).toEqual(before); expect(await f.queue()).toEqual(queueBefore);
    await expect(f.page.getByText("Entwurf gespeichert, nichts versendet.", { exact: true })).toHaveCount(0);
    await expect(f.page.getByText("Entwurf gespeichert. Es wurde nichts versendet.", { exact: true })).toHaveCount(0);
    await expect(f.page.getByRole("button", { name: "Zur Kampagnenliste", exact: true })).toHaveCount(0);
    await pool.query(`DROP TRIGGER ${trigger} ON campaigns; DROP FUNCTION ${trigger}();`);
    const currentBody = "Synthetic revised current draft for explicit retry"; await f.edit(currentBody);
    const retry = f.page.waitForResponse(r => new URL(r.url()).pathname === "/api/merchant/campaigns" && r.request().method() === "POST");
    await f.save.click(); const success = await retry; expect(success.status()).toBe(200);
    expect(success.request().postDataJSON()).toMatchObject({ action: "edit", campaignId: f.id, body: currentBody });
    await expect(f.page.getByText("Entwurf gespeichert. Es wurde nichts versendet.", { exact: true })).toBeVisible();
    expect(await f.current()).toMatchObject({ body: currentBody, status: "draft", schedule_revision: 0, scheduled_at: null });
    expect(await f.queue()).toEqual(queueBefore);
    await f.reloadSaved(currentBody);
  } finally {
    await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON campaigns; DROP FUNCTION IF EXISTS ${trigger}();`);
    await f.context.close();
  }
});

test("desktop lost committed draft response is unconfirmed, never automatically retries and preserves tenant isolation", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 1280), body = "Synthetic committed draft with response lost", payloads: Array<Record<string, unknown>> = [];
  try {
    const beforeQueue = await f.queue();
    await f.edit(body);
    await f.page.route("**/api/merchant/campaigns", async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; }
      payloads.push(route.request().postDataJSON());
      const response = await route.fetch(); expect(response.status()).toBe(200);
      if (payloads.length === 1) { expect(await f.current()).toMatchObject({ body, status: "draft" }); await route.abort("aborted"); }
      else await route.fulfill({ response });
    });
    await f.save.click();
    await expect(f.page.locator('main [role="alert"]')).toContainText("nicht bestätigt");
    await expect(f.page.getByText("Entwurf gespeichert, nichts versendet.", { exact: true })).toHaveCount(0);
    await expect(f.page.getByText(/Ungespeicherte Änderungen/)).toBeVisible();
    await expect(f.save).toBeEnabled(); await f.page.waitForLoadState("networkidle");
    expect(payloads).toHaveLength(1); expect(await f.current()).toMatchObject({ body, status: "draft" });
    await f.page.screenshot({ path: "/tmp/loy-083-campaign-unconfirmed-proof.png", fullPage: true });
    const latest = "Synthetic current edit after unconfirmed response"; await f.edit(latest);
    await expect(f.page.getByLabel("Nachricht", { exact: true })).toHaveCount(0);
    await f.save.click();
    await expect(f.page.getByText("Entwurf gespeichert. Es wurde nichts versendet.", { exact: true })).toBeVisible();
    expect(payloads).toHaveLength(2); expect(payloads[1]).toMatchObject({ action: "edit", campaignId: f.id, body: latest });
    expect(await f.current()).toMatchObject({ body: latest, status: "draft", schedule_revision: 0, scheduled_at: null });
    expect(await f.queue()).toEqual(beforeQueue);
    const foreignPassword = `Local!${randomUUID()}Aa`;
    const foreignOwner = await auth.api.signUpEmail({ body: { name: "Synthetic foreign draft owner", email: `${randomUUID()}@example.test`, password: foreignPassword } });
    await createMerchant({ userId: foreignOwner.user.id, businessName: "Synthetic foreign Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Foreign draft test", programType: "stamp", rulesText: "Synthetic visits", rewardTitle: "Coffee", rewardCost: 3 });
    const foreignContext = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
    try {
      expect((await foreignContext.request.post("/api/auth/sign-in/email", { data: { email: foreignOwner.user.email, password: foreignPassword } })).status()).toBe(200);
      const denied = await foreignContext.request.post("/api/merchant/campaigns", { data: { action: "edit", campaignId: f.id, ...f.initial, body: "Unauthorized foreign draft change" } });
      expect(denied.status()).toBe(404); expect(await denied.json()).toMatchObject({ code: "NOT_FOUND" });
      expect(await f.current()).toMatchObject({ body: latest }); expect(await f.queue()).toEqual(beforeQueue);
    } finally { await foreignContext.close(); }
    await f.reloadSaved(latest);
  } finally { await f.context.close(); }
});
