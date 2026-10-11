import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { pool } from "../src/db";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_qr_092") throw new Error("Dedicated synthetic draft-response database required");
const origin = "http://localhost:3000";
test.afterAll(async () => { await pool.end(); });
for (const [malformed, width] of [["missing", 375], ["wrong-id", 1280]] as const) test(`committed draft ${malformed} acknowledgment is unconfirmed, preserving edits (${width}px)`, async ({ browser, baseURL }) => {
  expect(baseURL).toBe(origin); const context = await browser.newContext({ baseURL, viewport: { width, height: 812 }, extraHTTPHeaders: { Origin: origin } });
  try {
    const id = randomUUID(); const signup = await context.request.post("/api/auth/sign-up/email", { data: { name: "Synthetic draft owner", email: `${id}@example.test`, password: "Synthetic-Draft-092-Only!" } }); expect(signup.ok()).toBe(true);
    const setup = await context.request.post("/api/merchant/onboard", { data: { businessName: `Synthetic draft ${id}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "One confirmed purchase", rewardTitle: "Coffee", rewardCost: 5 } }); expect(setup.status()).toBe(201); const merchant = await setup.json();
    const content = { title: "Synthetic draft", subject: "Synthetic subject", body: "Synthetic original draft", audienceDefinition: { kind: "all" } }; const created = await context.request.post("/api/merchant/campaigns", { data: { action: "create", programSlug: merchant.programSlug, ...content } }); expect(created.status()).toBe(201); const campaign = (await created.json()).campaign;
    const page = await context.newPage(); await page.goto("/merchant/campaigns"); await page.getByRole("button", { name: "Bearbeiten", exact: true }).click(); await page.getByRole("button", { name: "Zurück", exact: true }).click(); const submitted = "Synthetic committed draft requiring acknowledgment"; await page.getByLabel("Nachricht", { exact: true }).fill(submitted); await page.getByRole("button", { name: "Weiter", exact: true }).click(); let writes = 0;
    await page.route("**/api/merchant/campaigns", async route => {
      if (route.request().method() !== "POST") { await route.continue(); return; } writes++; const real = await route.fetch(); expect(real.status()).toBe(200);
      expect((await pool.query("SELECT body FROM campaigns WHERE id=$1 AND tenant_id=$2", [campaign.id, merchant.tenantId])).rows[0].body).toBe(route.request().postDataJSON().body);
      if (writes === 1) await route.fulfill({ response: real, json: malformed === "missing" ? {} : { campaign: { ...(await real.json()).campaign, id: randomUUID() } } }); else await route.fulfill({ response: real });
    });
    const save = page.getByRole("button", { name: "Entwurf aktualisieren", exact: true }); await save.click(); await expect(page.locator('main [role="alert"]')).toContainText("nicht bestätigt"); await expect(page.getByText("Entwurf gespeichert. Es wurde nichts versendet.", { exact: true })).toHaveCount(0); await expect(page.getByText(/Ungespeicherte Änderungen/)).toBeVisible(); expect(writes).toBe(1);
    expect((await pool.query("SELECT body,status,scheduled_at,schedule_revision FROM campaigns WHERE id=$1 AND tenant_id=$2", [campaign.id, merchant.tenantId])).rows[0]).toMatchObject({ body: submitted, status: "draft", scheduled_at: null, schedule_revision: 0 });
    await page.getByRole("button", { name: "Zurück", exact: true }).click(); const latest = "Synthetic latest edit after unconfirmed response"; await page.getByLabel("Nachricht", { exact: true }).fill(latest); await page.getByRole("button", { name: "Weiter", exact: true }).click(); await save.click(); await expect(page.getByText("Entwurf gespeichert. Es wurde nichts versendet.", { exact: true })).toBeVisible(); expect(writes).toBe(2);
    expect((await pool.query("SELECT body,status FROM campaigns WHERE id=$1 AND tenant_id=$2", [campaign.id, merchant.tenantId])).rows[0]).toMatchObject({ body: latest, status: "draft" }); expect((await pool.query("SELECT count(*)::int AS n FROM campaigns WHERE tenant_id=$1", [merchant.tenantId])).rows[0].n).toBe(1);
    for (const table of ["campaign_recipients", "campaign_attempts", "outbox_jobs"]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`, [merchant.tenantId])).rows[0].n).toBe(0);
    await page.getByRole("button", { name: "Zur Kampagnenliste", exact: true }).click(); await page.reload(); await page.getByRole("button", { name: "Bearbeiten", exact: true }).click(); await page.getByRole("button", { name: "Zurück", exact: true }).click(); await expect(page.getByLabel("Nachricht", { exact: true })).toHaveValue(latest);
  } finally { await context.close(); }
});
