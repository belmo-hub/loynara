import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid"), origin = "http://localhost:3000";
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || database.pathname !== "/looplocal_browser_staff_084") throw new Error("Owned synthetic invitation database required");
let merchant: Awaited<ReturnType<typeof createMerchant>>, ownerId: string;
let storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const owner = await auth.api.signUpEmail({ body: { name: "Synthetic invitation owner", email, password } }); ownerId = owner.user.id;
  merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic team Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Invitation test", programType: "stamp", rulesText: "Explicit synthetic visits", rewardTitle: "Coffee", rewardCost: 3 });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  try { expect((await context.request.post("/api/auth/sign-in/email", { data: { email, password } })).status()).toBe(200); storage = await context.storageState(); }
  finally { await context.close(); }
});
test.afterAll(async () => { await pool.end(); });
async function fixture(browser: Browser, baseURL: string | undefined, width: number) {
  const context = await browser.newContext({ baseURL, storageState: storage, extraHTTPHeaders: { Origin: origin }, viewport: { width, height: 844 } });
  const page = await context.newPage(); await page.goto("/merchant/staff");
  const section = page.locator('section[aria-labelledby="st-invite"]');
  const email = section.getByLabel("E-Mail-Adresse", { exact: true }), role = section.getByLabel("Rolle", { exact: true });
  const submit = section.getByRole("button", { name: "Einladungslink erstellen", exact: true });
  await expect(submit).toBeEnabled();
  return { context, page, section, email, role, submit };
}
async function rows(email: string) {
  return (await pool.query("SELECT id,tenant_id,location_id,invited_email,role,invited_by_user_id,accepted_at,revoked_at,expires_at FROM staff_invites WHERE tenant_id=$1 AND invited_email=$2", [merchant.tenantId, email])).rows;
}
async function audits(email: string) {
  return (await pool.query("SELECT a.action,a.actor_user_id,a.role,a.location_id FROM staff_audit_events a JOIN staff_invites i ON i.id=a.invite_id WHERE i.tenant_id=$1 AND i.invited_email=$2", [merchant.tenantId, email])).rows;
}

test("mobile definitive audit-write failure rolls back invitation, retains valid form and allows one explicit recovery", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 375), address = `${randomUUID()}@example.test`, trigger = "synthetic_invite_084_failure";
  try {
    await f.email.fill(address); await f.role.selectOption("manager");
    const actor = ownerId.replaceAll("'", "''");
    await pool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic invitation audit failure'; END $$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON staff_audit_events FOR EACH ROW WHEN (NEW.actor_user_id = '${actor}' AND NEW.action = 'invite_created') EXECUTE FUNCTION ${trigger}();`);
    const failed = f.page.waitForResponse(r => new URL(r.url()).pathname === "/api/staff/invite"); await f.submit.click(); const response = await failed;
    expect(response.status()).toBe(500); expect(await response.json()).toMatchObject({ error: "Internal error" });
    await expect(f.page.locator('.ow-notice[role="alert"]')).toBeVisible(); await expect(f.submit).toBeEnabled();
    await expect(f.email).toHaveValue(address); await expect(f.role).toHaveValue("manager");
    await expect(f.section.getByRole("status")).toHaveCount(0); expect(await rows(address)).toEqual([]); expect(await audits(address)).toEqual([]);
    await pool.query(`DROP TRIGGER ${trigger} ON staff_audit_events; DROP FUNCTION ${trigger}();`);
    await f.submit.click(); await expect(f.section.getByRole("status")).toContainText(`Einladung für ${address}`);
    await expect(f.email).toHaveValue("");
    expect(await rows(address)).toHaveLength(1); expect(await audits(address)).toEqual([{ action: "invite_created", actor_user_id: ownerId, role: "manager", location_id: merchant.locationId }]);
    expect((await rows(address))[0]).toMatchObject({ tenant_id: merchant.tenantId, location_id: merchant.locationId, invited_by_user_id: ownerId, role: "manager", accepted_at: null, revoked_at: null });
    expect((await rows(address))[0].expires_at.getTime()).toBeGreaterThan(Date.now());
  } finally { await pool.query(`DROP TRIGGER IF EXISTS ${trigger} ON staff_audit_events; DROP FUNCTION IF EXISTS ${trigger}();`); await f.context.close(); }
});

test("desktop older invitation acknowledgment cannot clear a newer email and role draft", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 1280), first = `${randomUUID()}@example.test`, next = `${randomUUID()}@example.test`;
  let committed!: () => void, release!: () => void; const started = new Promise<void>(r => { committed = r; }), hold = new Promise<void>(r => { release = r; });
  const payloads: Array<Record<string, unknown>> = [];
  try {
    await f.page.route("**/api/staff/invite", async route => {
      payloads.push(route.request().postDataJSON()); const response = await route.fetch(); expect(response.status()).toBe(201);
      if (payloads.length === 1) { expect(await rows(first)).toHaveLength(1); committed(); await hold; }
      await route.fulfill({ response });
    });
    await f.email.fill(first); await f.submit.click(); await started;
    await f.email.fill(next); await f.role.selectOption("manager"); await expect(f.submit).toBeDisabled(); release();
    await expect(f.section.getByRole("status")).toContainText(`Einladung für ${first}`);
    await expect(f.email).toHaveValue(next); await expect(f.role).toHaveValue("manager");
    await expect(f.submit).toBeEnabled(); expect(payloads).toHaveLength(1);
    await f.submit.click(); await expect(f.section.getByRole("status")).toContainText(`Einladung für ${next}`);
    expect(payloads).toHaveLength(2); expect(payloads[0]).toMatchObject({ email: first, role: "cashier", locationId: merchant.locationId }); expect(payloads[1]).toMatchObject({ email: next, role: "manager", locationId: merchant.locationId });
    expect(await rows(first)).toHaveLength(1); expect(await rows(next)).toHaveLength(1); expect(await audits(first)).toHaveLength(1); expect(await audits(next)).toHaveLength(1);
  } finally { release(); await f.context.close(); }
});

test("lost committed invitation response is unconfirmed, preserves inputs and refreshes the existing audit without creating another invitation", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 375), address = `${randomUUID()}@example.test`;
  let requests = 0;
  try {
    const baseline = Number((await pool.query("SELECT count(*) AS count FROM staff_audit_events WHERE tenant_id=$1", [merchant.tenantId])).rows[0].count);
    await f.page.route("**/api/staff/invite", async route => { requests++; const response = await route.fetch(); expect(response.status()).toBe(201); expect(await rows(address)).toHaveLength(1); expect(await audits(address)).toHaveLength(1); await route.abort("aborted"); });
    await f.email.fill(address); await f.role.selectOption("manager"); await f.submit.click();
    await expect(f.page.locator('.ow-notice[role="alert"]')).toContainText("nicht bestätigt");
    await expect(f.email).toHaveValue(address); await expect(f.role).toHaveValue("manager");
    await expect(f.section.getByRole("status")).toHaveCount(0); await expect(f.submit).toBeEnabled();
    await expect(f.page.getByRole("list", { name: "Teamereignisse" }).getByRole("listitem")).toHaveCount(baseline + 1);
    await f.page.waitForLoadState("networkidle"); expect(requests).toBe(1); expect(await rows(address)).toHaveLength(1);
    expect(await audits(address)).toEqual([{ action: "invite_created", actor_user_id: ownerId, role: "manager", location_id: merchant.locationId }]);
    expect((await pool.query("SELECT count(*)::int AS count FROM outbox_jobs WHERE tenant_id=$1 AND kind LIKE 'email.%'", [merchant.tenantId])).rows[0].count).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS count FROM staff_roles WHERE tenant_id=$1", [merchant.tenantId])).rows[0].count).toBe(1);
  } finally { await f.context.close(); }
});
