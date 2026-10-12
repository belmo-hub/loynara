import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid"), origin = "http://localhost:3000";
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || database.pathname !== "/looplocal_browser_onboarding_128") throw new Error("Owned synthetic onboarding database required");
test.afterAll(async () => { await pool.end(); });
async function fixture(browser: Browser, baseURL: string | undefined, width: number) {
  if (baseURL !== origin) throw new Error("Loopback application required");
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const account = await auth.api.signUpEmail({ body: { name: "Synthetic setup owner", email, password } });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin }, viewport: { width, height: 844 } });
  expect((await context.request.post("/api/auth/sign-in/email", { data: { email, password } })).status()).toBe(200);
  expect(await (await context.request.get("/api/me")).json()).toMatchObject({ tenantId: null });
  const page = await context.newPage(); await page.goto("/merchant"); await expect(page).toHaveURL(/\/merchant\/program$/);
  const name = `Synthetic Café ${randomUUID().slice(0,8)}`;
  await page.getByLabel("Geschäftsname").fill(name); await page.getByLabel("Standort", { exact: true }).fill("Synthetic Mitte"); await page.getByLabel("Stadt").fill("Kassel"); await page.getByRole("button", { name: "Café", exact: true }).click();
  for (let step = 0; step < 3; step++) await page.getByRole("button", { name: "Weiter", exact: true }).click();
  await page.getByLabel("Programmname", { exact: true }).fill("Synthetic persisted programme");
  return { context, page, name, userId: account.user.id, submit: page.getByRole("button", { name: "Programm starten", exact: true }) };
}
async function snapshot(userId: string) {
  const role = (await pool.query("SELECT tenant_id FROM staff_roles WHERE user_id=$1", [userId])).rows;
  if (!role.length) return { role, data: {} };
  const data: Record<string, unknown[]> = {};
  for (const table of ["tenants", "locations", "programs", "program_rule_versions", "rewards", "reward_versions", "staff_roles", "subscriptions", "billing_location_plans"]) {
    const key = table === "tenants" ? "id" : "tenant_id";
    data[table] = (await pool.query(`SELECT * FROM ${table} t WHERE ${key}=$1 ORDER BY to_jsonb(t)::text`, [role[0].tenant_id])).rows;
  }
  return { role, data };
}
async function completed(f: Awaited<ReturnType<typeof fixture>>) {
  await expect(f.page).toHaveURL(/\/merchant$/); await expect(f.page.getByRole("region", { name: "Startklar", exact: true })).toBeVisible();
  const actual = await snapshot(f.userId); for (const rows of Object.values(actual.data)) expect(rows).toHaveLength(1);
  expect(actual.data.tenants[0]).toMatchObject({ name: f.name }); expect(actual.data.locations[0]).toMatchObject({ name: "Synthetic Mitte", city: "Kassel" }); expect(actual.data.programs[0]).toMatchObject({ name: "Synthetic persisted programme" });
  await f.page.reload(); await expect(f.page.getByRole("region", { name: "Startklar", exact: true })).toBeVisible(); expect(await snapshot(f.userId)).toEqual(actual);
  expect((await pool.query("SELECT count(*)::int AS n FROM memberships WHERE tenant_id=$1", [actual.role[0].tenant_id])).rows[0].n).toBe(0);
  expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE tenant_id=$1", [actual.role[0].tenant_id])).rows[0].n).toBe(0);
  return actual;
}

for (const width of [375, 1280]) test(`committed onboarding with failed account refresh shows recovery feedback and retries without duplication (${width}px)`, async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, width);
  let refreshFailed = false;
  const results: Record<string, unknown>[] = [];
  try {
    await f.page.route("**/api/merchant/onboard", async route => {
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      results.push(await response.json());
      await route.fulfill({ response });
    });
    await f.page.route("**/api/me", async route => {
      if (!refreshFailed && results.length === 1) {
        refreshFailed = true;
        await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Synthetic account refresh unavailable" }) });
      } else await route.continue();
    });
    await f.submit.click();
    await expect(f.submit).toBeEnabled();
    await expect(f.page.locator('.ow-notice[role="alert"]')).toContainText("Einrichtung konnte noch nicht geladen werden");
    await expect(f.page.getByLabel("Programmname", { exact: true })).toHaveValue("Synthetic persisted programme");
    await expect(f.page).toHaveURL(/\/merchant\/program$/);
    expect(refreshFailed).toBe(true);
    expect(results).toHaveLength(1);
    const committed = await snapshot(f.userId);
    for (const rows of Object.values(committed.data)) expect(rows).toHaveLength(1);
    await f.submit.click();
    const actual = await completed(f);
    expect(results).toHaveLength(2);
    expect(results[1]).toEqual(results[0]);
    expect(actual).toEqual(committed);
    expect(await f.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await f.context.close(); }
});
