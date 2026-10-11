import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { createMerchant } from "../src/lib/product";
import { configureReferrals, getCardReferralShare } from "../src/lib/referrals";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || !["/looplocal_browser_referral_070a", "/looplocal_browser_referral_070b"].includes(database.pathname)) throw new Error("Dedicated synthetic referral journey database required");
const origin = "http://localhost:3000";
async function merchantFixture(locale: "de" | "fr" = "de") {
  const userId = randomUUID();
  await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [userId, "Synthetic referral owner", `${userId}@example.test`]);
  const merchant = await createMerchant({ userId, businessName: `Synthetic ${locale} Café`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale, currency: "EUR", programName: "Synthetic referral card", programType: "stamp", rulesText: "One synthetic confirmed visit", rewardTitle: "Coffee", rewardCost: 5 });
  await configureReferrals({ actorUserId: userId, programSlug: merchant.programSlug, enabled: true, referrerBonus: 2, referredBonus: 1 });
  return { userId, ...merchant };
}
let own: Awaited<ReturnType<typeof merchantFixture>>, foreign: typeof own, disabledFrench: typeof own;
let shareUrl: string, foreignCode: string;
let referrerId: string;
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  own = await merchantFixture(); foreign = await merchantFixture(); disabledFrench = await merchantFixture("fr");
  await configureReferrals({ actorUserId: disabledFrench.userId, programSlug: disabledFrench.programSlug, enabled: false, referrerBonus: 2, referredBonus: 1 });
  for (const merchant of [own, foreign]) {
    const context = await browser.newContext({ baseURL });
    try {
      const response = await context.request.post("/api/enroll", { headers: { Origin: origin }, data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } }); expect(response.status()).toBe(201);
      const { cardToken } = await response.json();
      const share = await getCardReferralShare(cardToken);
      if (merchant === own) { const card = await context.newPage(); await card.goto(`/card/${cardToken}`); await expect(card.getByRole("heading", { name: "Karte empfehlen", exact: true })).toBeVisible(); shareUrl = await card.getByLabel("Link zum Teilen", { exact: true }).inputValue(); expect(shareUrl).toBe(share.shareUrl); referrerId = (await pool.query('SELECT id FROM memberships WHERE card_token=$1', [cardToken])).rows[0].id; }
      else foreignCode = new URL(share.shareUrl).searchParams.get("ref")!;
    } finally { await context.close(); }
  }
});
test.afterAll(async () => { await pool.end(); });
async function snapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["memberships", "referrals", "ledger_entries", "consent_events", "membership_contacts", "outbox_jobs"]) result[table] = (await pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`)).rows[0].data;
  return result;
}
for (const width of [375, 1280]) test(`valid referral survives terms navigation and attributes once without premature bonus (${width}px)`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } }); const page = await context.newPage(); let writes = 0;
  page.on("request", req => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/enroll") writes++; });
  try {
    const before = await snapshot(); await page.goto(shareUrl); await expect(page.getByText(/Empfehlungslink:/)).toBeVisible();
    const terms = context.waitForEvent("page"); await page.getByRole("link", { name: "Weitere Teilnahmebedingungen", exact: true }).click(); const termsPage = await terms; await expect(termsPage).toHaveURL(/\/teilnahmebedingungen$/); await termsPage.close();
    expect(page.url()).toBe(shareUrl); expect(await snapshot()).toEqual(before);
    const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/enroll");
    await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click(); expect((await response).status()).toBe(201);
    await expect(page).toHaveURL(/\/card\/card_[A-Za-z0-9_-]+$/); const cardToken = new URL(page.url()).pathname.split("/").at(-1)!;
    const member = (await pool.query('SELECT id,tenant_id,program_id,balance FROM memberships WHERE card_token=$1', [cardToken])).rows[0]; expect(member).toMatchObject({ tenant_id: own.tenantId, program_id: own.programId, balance: 0 });
    const referral = (await pool.query('SELECT * FROM referrals WHERE referred_membership_id=$1', [member.id])).rows; expect(referral).toHaveLength(1); expect(referral[0]).toMatchObject({ tenant_id: own.tenantId, program_id: own.programId, referrer_membership_id: referrerId, status: "pending", referrer_bonus: 2, referred_bonus: 1 });
    expect((await pool.query('SELECT count(*)::int AS n FROM ledger_entries')).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM consent_events')).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM membership_contacts')).rows[0].n).toBe(0);
    const enrolled = await snapshot(); await page.goto(shareUrl); await expect(page.getByRole("heading", { name: "Willkommen zurück.", exact: true })).toBeVisible(); await page.getByRole("link", { name: "Meine Karte öffnen", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/card/${cardToken}$`)); expect(writes).toBe(1); expect(await snapshot()).toEqual(enrolled);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await context.close(); }
});

for (const width of [375, 1280]) for (const kind of ["foreign", "unknown"]) test(`${kind} referral rejection offers keyboard-accessible ordinary enrollment without silent retry (${width}px)`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } }); const page = await context.newPage(); let writes = 0;
  page.on("request", req => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/enroll") writes++; });
  try {
    await page.goto(`/join/${own.programSlug}?ref=${kind === "foreign" ? foreignCode : "ref_" + "X".repeat(24)}`); await expect(page.getByText(/Empfehlungslink:/)).toBeVisible(); const before = await snapshot();
    const rejected = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/enroll"); await page.getByRole("checkbox").check(); await page.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click(); const response = await rejected; expect(response.status()).toBe(400); expect(await response.json()).toMatchObject({ code: "INVALID_REFERRAL" });
    expect(await snapshot()).toEqual(before); expect(writes).toBe(1);
    await expect(page.locator(".auth-error[role=alert]")).toContainText("Dieser Empfehlungslink ist nicht verfügbar");
    if (width === 375 && kind === "foreign") await page.screenshot({ path: "/tmp/loy-070-referral-recovery-mobile.png", animations: "disabled", fullPage: true });
    const ordinary = page.getByRole("link", { name: "Ohne Empfehlungslink fortfahren", exact: true }); await expect(ordinary).toHaveAttribute("href", `/join/${own.programSlug}`); await ordinary.focus(); await expect(ordinary).toBeFocused(); await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/join/${own.programSlug}$`)); await expect(page.getByRole("button", { name: "Meine Karte erstellen", exact: true })).toBeEnabled(); expect(writes).toBe(1); expect(await snapshot()).toEqual(before);
    await expect(page.getByRole("checkbox")).not.toBeChecked(); await page.getByRole("checkbox").check(); const enrolled = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/enroll"); await page.getByRole("button", { name: "Meine Karte erstellen", exact: true }).click(); expect((await enrolled).status()).toBe(201); await expect(page).toHaveURL(/\/card\/card_[A-Za-z0-9_-]+$/); expect(writes).toBe(2);
    const token = new URL(page.url()).pathname.split("/").at(-1)!; const member = (await pool.query('SELECT id,tenant_id,balance FROM memberships WHERE card_token=$1', [token])).rows[0]; expect(member).toMatchObject({ tenant_id: own.tenantId, balance: 0 }); expect((await pool.query('SELECT count(*)::int AS n FROM referrals WHERE referred_membership_id=$1', [member.id])).rows[0].n).toBe(0);
    expect((await pool.query('SELECT count(*)::int AS n FROM consent_events')).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM ledger_entries')).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM outbox_jobs')).rows[0].n).toBe(0); expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await context.close(); }
});


test("disabled French referral offers explicit ordinary enrollment before any write", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 } }); const page = await context.newPage(); let writes = 0;
  page.on("request", req => { if (req.method() === "POST" && new URL(req.url()).pathname === "/api/enroll") writes++; });
  try {
    const before = await snapshot(); await page.goto(`/join/${disabledFrench.programSlug}?ref=${foreignCode}`); await expect(page.getByText(/Ce lien de parrainage est indisponible/)).toBeVisible();
    const ordinary = page.getByRole("link", { name: "Continuer sans lien de parrainage", exact: true }); await expect(ordinary).toHaveAttribute("href", `/join/${disabledFrench.programSlug}`); expect(await snapshot()).toEqual(before); expect(writes).toBe(0);
    await ordinary.focus(); await page.keyboard.press("Enter"); await expect(page).toHaveURL(new RegExp(`/join/${disabledFrench.programSlug}$`)); await expect(page.getByRole("checkbox")).not.toBeChecked(); expect(writes).toBe(0); expect(await snapshot()).toEqual(before);
    await page.getByRole("checkbox").check(); const response = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/enroll"); await page.getByRole("button", { name: "Créer ma carte", exact: true }).click(); expect((await response).status()).toBe(201); await expect(page).toHaveURL(/\/card\/card_[A-Za-z0-9_-]+$/); expect(writes).toBe(1);
    const token = new URL(page.url()).pathname.split("/").at(-1)!; const member = (await pool.query('SELECT id,tenant_id,balance FROM memberships WHERE card_token=$1', [token])).rows[0]; expect(member).toMatchObject({ tenant_id: disabledFrench.tenantId, balance: 0 }); expect((await pool.query('SELECT count(*)::int AS n FROM referrals WHERE referred_membership_id=$1', [member.id])).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM consent_events')).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM ledger_entries')).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM outbox_jobs')).rows[0].n).toBe(0);
  } finally { await context.close(); }
});
