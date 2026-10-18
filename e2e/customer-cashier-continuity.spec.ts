import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { setTapPolicy } from "../src/lib/secure-tap";
import { deriveVerificationKeys, parseMaster } from "../src/lib/nfc-keys";
import { sdmFor, tapUrl } from "../src/lib/nfc-test-support";
import { pool } from "../src/db";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_continuity_071a") throw new Error("Owned synthetic customer/cashier database required");
const origin = "http://localhost:3000";
let merchant: Awaited<ReturnType<typeof createMerchant>>; let userId: string, publicRef: string, uid: string, keyRef: string;
let storage: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== origin) throw new Error("Loopback application required");
  userId = randomUUID(); await pool.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,false)', [userId,"Synthetic continuity owner",`${userId}@example.test`]);
  merchant = await createMerchant({ userId, businessName: "Synthetic continuity Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic continuity card", programType: "stamp", rulesText: "One synthetic confirmed visit", rewardTitle: "Coffee", rewardCost: 5 });
  await setTapPolicy({ actorUserId: userId, programId: merchant.programId, mode: "staff_confirmed", cooldownSeconds: 60 });
  publicRef = randomBytes(18).toString("base64url"); uid = `04${randomBytes(6).toString("hex")}`; keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  // A disposable synthetic stand row, without any physical tag/operator action.
  await pool.query("INSERT INTO secure_tags (public_ref,tenant_id,location_id,program_id,uid,key_ref,config_version,last_counter,status,activated_at) VALUES ($1,$2,$3,$4,$5,$6,1,0,'active',now())", [publicRef,merchant.tenantId,merchant.locationId,merchant.programId,uid,keyRef]);
  const password = `Local!${randomUUID()}Aa`; const ctx = await auth.$context; await ctx.internalAdapter.linkAccount({ userId, accountId: userId, providerId: "credential", password: await ctx.password.hash(password) });
  const owner = await browser.newContext({ baseURL });
  try { expect((await owner.request.post("/api/auth/sign-in/email", { headers: { Origin: origin }, data: { email: `${userId}@example.test`, password } })).status()).toBe(200); storage = await owner.storageState(); } finally { await owner.close(); }
});
test.afterAll(async () => { await pool.end(); });
for (const width of [375, 1280]) test(`interrupted recognized-customer visit preserves confirmation and the same card (${width}px)`, async ({ browser, baseURL }) => {
  const customer = await browser.newContext({ baseURL, viewport: { width, height: 812 } }); const owner = await browser.newContext({ baseURL, storageState: storage });
  try {
    const enrolled = await customer.request.post("/api/enroll", { headers: { Origin: origin }, data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } }); expect(enrolled.status()).toBe(201); const { cardToken } = await enrolled.json();
    const cardData = await customer.request.get(`/api/card/${cardToken}`); const card = await cardData.json(); expect(card.balance).toBe(0); const member = (await pool.query('SELECT id FROM memberships WHERE card_token=$1', [cardToken])).rows[0];
    const url = new URL(tapUrl(origin,publicRef,sdmFor({ uid, counter: width, keys: deriveVerificationKeys(parseMaster(process.env.NFC_VERIFY_MASTER_KEY),keyRef,uid) }))); const path = url.pathname+url.search;
    const cookies = await customer.cookies(); const passive = await customer.request.get(`/api${path}`); expect(passive.status()).toBe(200); expect(await passive.json()).toMatchObject({ hasMembership: true, merchantName: "Synthetic continuity Café", cardLocator: card.cardLocator, mode: "staff_confirmed" }); expect(await customer.cookies()).toEqual(cookies);
    expect((await pool.query('SELECT count(*)::int AS n FROM tap_requests WHERE membership_id=$1', [member.id])).rows[0].n).toBe(0);
    const page = await customer.newPage(); await page.goto(path); await expect(page.getByRole("heading", { name: "Warte auf das Team", exact: true })).toBeVisible(); await expect(page.getByText(card.cardLocator,{exact:true})).toBeVisible();
    const request = (await pool.query('SELECT id,status FROM tap_requests WHERE membership_id=$1', [member.id])).rows; expect(request).toHaveLength(1); expect(request[0].status).toBe("pending_staff");
    expect((await pool.query('SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1', [member.id])).rows[0].n).toBe(0);
    await page.getByRole("link", { name: "Karte und Prämien ansehen", exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/card/${cardToken}$`));
    const counter = await owner.newPage(); await counter.goto("/cashier"); const panel = counter.getByRole("region",{name:"NFC-Anfragen",exact:true}); const row = panel.getByRole("listitem").filter({hasText:card.cardLocator}); await expect(row).toBeVisible();
    const confirmed = counter.waitForResponse(r => new URL(r.url()).pathname === `/api/cashier/tap/${request[0].id}/confirm`); await row.getByRole("button",{name:"Stempel bestätigen",exact:true}).click(); expect((await confirmed).status()).toBe(200);
    await page.goto(path); await expect(page.getByRole("heading",{name:"Stempel erhalten",exact:true})).toBeVisible(); await expect(page.locator(".customer-balance-line strong")).toHaveText(/^1\s*Stempel$/); await expect(page.getByText(card.cardLocator,{exact:true})).toBeVisible();
    expect((await pool.query('SELECT balance,closed_at FROM memberships WHERE id=$1',[member.id])).rows[0]).toMatchObject({balance:1,closed_at:null}); expect((await pool.query('SELECT count(*)::int AS n FROM memberships WHERE program_id=$1',[merchant.programId])).rows[0].n).toBe(width===375?1:2); expect((await pool.query('SELECT count(*)::int AS n FROM tap_requests WHERE membership_id=$1',[member.id])).rows[0].n).toBe(1); expect((await pool.query('SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id=$1',[member.id])).rows[0].n).toBe(1); expect((await pool.query('SELECT count(*)::int AS n FROM membership_contacts')).rows[0].n).toBe(0); expect((await pool.query('SELECT count(*)::int AS n FROM consent_events')).rows[0].n).toBe(0);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  } finally { await customer.close(); await owner.close(); }
});
