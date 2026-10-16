import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { configureReferrals } from "../src/lib/referrals";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_referral_087") throw new Error("Dedicated synthetic referral database required");
const origin = "http://localhost:3000";
const fixtures: Record<string, { slug: string; tenant: string; share: string; referrer: string }> = {};
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  for (const locale of ["de", "fr"]) {
    const context = await browser.newContext({ baseURL });
    try {
      const id = randomUUID();
      const signup = await context.request.post("/api/auth/sign-up/email", { headers: { Origin: origin }, data: { name: "Synthetic referral owner", email: `${id}@example.test`, password: "Synthetic-Referrals-087-Only!" } });
      expect(signup.ok()).toBe(true); const { user } = await signup.json();
      const setup = await context.request.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: `Synthetic ${locale} ${id}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale, currency: "EUR", programName: "Synthetic referrals", programType: "stamp", rulesText: "One synthetic confirmed visit", rewardTitle: "Coffee", rewardCost: 5 } });
      expect(setup.status()).toBe(201); const merchant = await setup.json();
      await configureReferrals({ actorUserId: user.id, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
      const enrolled = await context.request.post("/api/enroll", { headers: { Origin: origin }, data: { slug: merchant.programSlug, acceptedTerms: true } }); expect(enrolled.status()).toBe(201); const { cardToken } = await enrolled.json();
      const card = await context.newPage(); await card.goto(`/card/${cardToken}`); const share = await card.getByLabel(locale === "fr" ? "Lien à partager" : "Link zum Teilen", { exact: true }).inputValue();
      const referrer = (await pool.query("SELECT id FROM memberships WHERE card_token=$1", [cardToken])).rows[0].id;
      fixtures[locale] = { slug: merchant.programSlug, tenant: merchant.tenantId, share, referrer };
    } finally { await context.close(); }
  }
});
test.afterAll(async () => { await pool.end(); });
async function snapshot(tenant: string) {
  const result: Record<string, unknown> = {};
  for (const table of ["memberships", "referrals", "ledger_entries", "consent_events", "membership_contacts", "outbox_jobs"]) result[table] = (await pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t WHERE tenant_id=$1`, [tenant])).rows[0].data;
  return result;
}
async function assertPending(tenant: string, referrer: string) {
  const members = (await pool.query("SELECT id,balance FROM memberships WHERE tenant_id=$1 ORDER BY id", [tenant])).rows;
  const referrals = (await pool.query("SELECT status,referrer_membership_id,referred_membership_id,referrer_bonus,referred_bonus FROM referrals WHERE tenant_id=$1", [tenant])).rows;
  expect(members.every(m => m.balance === 0)).toBe(true);
  expect(referrals.every(r => r.status === "pending" && r.referrer_membership_id === referrer && r.referrer_bonus === 2 && r.referred_bonus === 1)).toBe(true);
  for (const table of ["ledger_entries", "consent_events", "membership_contacts", "outbox_jobs"]) expect((await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`, [tenant])).rows[0].n).toBe(0);
  return { members, referrals };
}
test("late attribution failure rolls back enrollment and preserves accepted terms for explicit retry", async ({ browser, baseURL }) => {
  const f = fixtures.de, context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } }), page = await context.newPage();
  const before = await snapshot(f.tenant);
  await pool.query(`CREATE FUNCTION synthetic_referral_087_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic late referral attribution failure'; END $$; CREATE TRIGGER synthetic_referral_087 BEFORE INSERT ON referrals FOR EACH ROW EXECUTE FUNCTION synthetic_referral_087_fail()`);
  try {
    await page.goto(f.share); await page.getByRole("checkbox").check(); const failed = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/enroll"); await page.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click(); expect((await failed).status()).toBe(500);
    await expect(page.locator("form").getByRole("alert")).toHaveText("Internal error"); await expect(page.getByRole("checkbox")).toBeChecked(); expect(page.url()).toBe(f.share); expect(await snapshot(f.tenant)).toEqual(before);
  } finally { await pool.query("DROP TRIGGER synthetic_referral_087 ON referrals; DROP FUNCTION synthetic_referral_087_fail()"); }
  try {
    await page.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click(); await expect(page).toHaveURL(/\/card\/card_[A-Za-z0-9_-]+$/); const pending = await assertPending(f.tenant, f.referrer); expect(pending.members).toHaveLength(2); expect(pending.referrals).toHaveLength(1);
  } finally { await context.close(); }
});
for (const [locale, width, kind] of [["de", 375, "empty"], ["fr", 1280, "lost"]] as const) test(`${locale} ${kind} committed enrollment is unconfirmed without automatic creation (${width}px)`, async ({ browser, baseURL }) => {
  const f = fixtures[locale], context = await browser.newContext({ baseURL, viewport: { width, height: 812 } }), page = await context.newPage(); let writes = 0; let token = "";
  const before = await assertPending(f.tenant, f.referrer);
  page.on("request", req => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/enroll") writes++; });
  await page.route("**/api/enroll", async route => {
    const committed = await route.fetch(); expect(committed.status()).toBe(201); token = (await committed.json()).cardToken;
    const persisted = await pool.query("SELECT id FROM memberships WHERE tenant_id=$1 AND card_token=$2", [f.tenant, token]); expect(persisted.rows).toHaveLength(1);
    if (kind === "empty") await route.fulfill({ response: committed, body: "" }); else await route.abort("failed");
  });
  try {
    await page.goto(f.share); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: locale === "fr" ? "Créer ma carte" : "Meine Karte erstellen", exact: true }).click();
    await expect.soft(page.locator("form").getByRole("alert")).toContainText(locale === "fr" ? "La création de la carte n’est pas confirmée" : "Die Kartenerstellung wurde nicht bestätigt");
    expect(writes).toBe(1); await expect(page.getByRole("checkbox")).toBeChecked(); expect(page.url()).toBe(f.share);
    const pending = await assertPending(f.tenant, f.referrer); expect(pending.members).toHaveLength(before.members.length + 1); expect(pending.referrals).toHaveLength(before.referrals.length + 1); const persisted = await snapshot(f.tenant);
    await page.unroute("**/api/enroll");
    if (kind === "empty") {
      await page.reload(); await expect(page.getByRole("heading", { name: "Willkommen zurück.", exact: true })).toBeVisible(); await page.getByRole("link", { name: "Meine Karte öffnen", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/card/${token}$`));
    } else {
      // route.fetch uses the browser context's request jar. Strip only the undelivered response cookies from this fixture:
      // a wholly interrupted response gives no guarantee the real browser received membership credentials.
      await context.clearCookies(); await page.reload(); await expect(page.getByRole("button", { name: "Créer ma carte", exact: true })).toBeVisible();
    }
    expect(writes).toBe(1); expect(await snapshot(f.tenant)).toEqual(persisted); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await context.close(); }
});
