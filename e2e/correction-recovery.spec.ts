import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || database.pathname !== "/looplocal_browser_correction_080") throw new Error("Owned synthetic correction database required");
const origin = "http://localhost:3000", originalReason = "Synthetic incorrect visit correction";
test.afterAll(async () => { await pool.end(); });

async function fixture(browser: Browser, baseURL: string | undefined, quantity = 1) {
  if (baseURL !== origin) throw new Error("Loopback application required");
  const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
  const owner = await auth.api.signUpEmail({ body: { name: "Synthetic correction operator", email, password } });
  const merchant = await createMerchant({ userId: owner.user.id, businessName: "Synthetic correction Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Correction test", programType: "stamp", rulesText: "One explicitly confirmed synthetic visit", rewardTitle: "Coffee", rewardCost: 3 });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin }, viewport: { width: 390, height: 844 } });
  const customer = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  expect((await context.request.post("/api/auth/sign-in/email", { data: { email, password } })).status()).toBe(200);
  const joined = await customer.request.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } });
  expect(joined.status()).toBe(201);
  const cardToken = (await joined.json()).cardToken as string;
  const member = (await pool.query("SELECT id,card_locator FROM memberships WHERE card_token=$1", [cardToken])).rows[0] as { id: string; card_locator: string };
  const credited = await context.request.post("/api/cashier/award", { data: { membershipId: member.id, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() } });
  expect(credited.status()).toBe(200);
  const entryId = (await credited.json()).entryId as string;
  const original = (await pool.query("SELECT * FROM ledger_entries WHERE id=$1", [entryId])).rows[0];
  const page = await context.newPage();
  async function open() {
    await page.goto("/merchant/customers");
    await page.getByRole("button", { name: new RegExp(`Karte K-${member.card_locator}`) }).click({ timeout: 10000 });
    await expect(page.getByRole("heading", { name: "Kartenverlauf", exact: true })).toBeVisible();
    await page.locator(".ow-feed > li").filter({ hasText: `+${quantity} Stempel` }).getByRole("button", { name: "Korrigieren", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Vorgang korrigieren", exact: true });
    const reason = dialog.getByLabel("Grund (Pflicht, mindestens 10 Zeichen)", { exact: true });
    await reason.fill(originalReason);
    return { dialog, reason };
  }
  return { owner, merchant, member, entryId, original, context, customer, page, open, async close() { await Promise.all([context.close(), customer.close()]); } };
}
async function state(member: string) {
  return Promise.all([
    pool.query("SELECT id,balance FROM memberships WHERE id=$1", [member]).then(r => r.rows),
    pool.query("SELECT * FROM ledger_entries WHERE membership_id=$1 ORDER BY id", [member]).then(r => r.rows),
    pool.query("SELECT * FROM redemptions WHERE membership_id=$1 ORDER BY id", [member]).then(r => r.rows),
    pool.query("SELECT * FROM outbox_jobs WHERE payload->>'membershipId'=$1 ORDER BY id", [member]).then(r => r.rows),
  ]);
}

test("a lost committed correction response keeps the original audit reason immutable during explicit retry", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL), sent: Array<Record<string, unknown>> = [];
  let committed!: () => void, release!: () => void;
  const committedSignal = new Promise<void>(resolve => { committed = resolve; });
  const responseSignal = new Promise<void>(resolve => { release = resolve; });
  try {
    const { dialog, reason } = await f.open();
    await f.page.route("**/api/transactions/reverse", async route => {
      sent.push(route.request().postDataJSON());
      const response = await route.fetch(); expect(response.status()).toBe(200);
      if (sent.length === 1) {
        expect(await response.json()).toMatchObject({ balance: 0, duplicate: false });
        committed(); await responseSignal;
        try { await route.abort("aborted"); } catch (error) { if (!f.page.isClosed()) throw error; }
      } else { expect(await response.json()).toMatchObject({ balance: 0, duplicate: true }); await route.fulfill({ response }); }
    });
    await dialog.getByRole("button", { name: "Korrektur buchen", exact: true }).click(); await committedSignal;
    // A real request has committed; changing its displayed reason now would misdescribe the audit entry.
    await expect(reason).not.toBeEditable(); release();
    await expect(dialog.getByRole("alert")).toContainText("Ergebnis unklar");
    await expect(reason).not.toBeEditable(); await expect(reason).toHaveValue(originalReason);
    const beforeRetry = await state(f.member.id);
    await dialog.getByRole("button", { name: "Erneut senden", exact: true }).click();
    await expect(f.page.getByText("Korrektur gebucht. Der Kontostand und der Verlauf sind aktualisiert.", { exact: true })).toBeVisible();
    expect(sent).toHaveLength(2); expect(sent[1]).toEqual(sent[0]);
    expect(sent[0]).toMatchObject({ entryId: f.entryId, reason: originalReason });
    expect(await state(f.member.id)).toEqual(beforeRetry);
    expect((await pool.query("SELECT * FROM ledger_entries WHERE id=$1", [f.entryId])).rows[0]).toEqual(f.original);
    expect((await pool.query("SELECT reason,actor_user_id FROM ledger_entries WHERE reversal_of_id=$1", [f.entryId])).rows).toEqual([{ reason: originalReason, actor_user_id: f.owner.user.id }]);
    await f.page.screenshot({ path: "/tmp/loy-080-correction-recovery-proof.png", fullPage: true });
  } finally { release(); await f.close(); }
});

test("a definitive insufficient-balance rejection permits editing and explicit recovery after the later redemption is corrected", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL, 5);
  try {
    const scan = (await f.customer.request.get(`/api/card/${(await pool.query("SELECT card_token FROM memberships WHERE id=$1", [f.member.id])).rows[0].card_token}`));
    expect(scan.status()).toBe(200);
    const lookup = await f.context.request.get(`/api/cashier/lookup?code=${encodeURIComponent((await scan.json()).scanCode)}`);
    expect(lookup.status()).toBe(200);
    const reward = (await lookup.json()).rewards[0].id;
    const spent = await f.context.request.post("/api/cashier/redeem", { data: { membershipId: f.member.id, rewardVersionId: reward, idempotencyKey: randomUUID(), requestId: randomUUID() } });
    expect(spent.status()).toBe(200); const redemptionId = (await spent.json()).entryId as string;
    const { dialog, reason } = await f.open(), before = await state(f.member.id), payloads: Array<Record<string, unknown>> = [];
    f.page.on("request", r => { if (new URL(r.url()).pathname === "/api/transactions/reverse") payloads.push(r.postDataJSON()); });
    const rejectedResponse = f.page.waitForResponse(r => new URL(r.url()).pathname === "/api/transactions/reverse");
    await dialog.getByRole("button", { name: "Korrektur buchen", exact: true }).click();
    const rejected = await rejectedResponse; expect(rejected.status()).toBe(409); expect(await rejected.json()).toMatchObject({ code: "INSUFFICIENT_BALANCE" });
    await expect(dialog.getByRole("alert")).toContainText("Kontostand unter null");
    await expect(reason).toBeEditable(); await expect(f.page.getByText("Korrektur gebucht.", { exact: true })).toHaveCount(0);
    expect(await state(f.member.id)).toEqual(before);
    const restored = await f.context.request.post("/api/transactions/reverse", { data: { locationId: f.merchant.locationId, entryId: redemptionId, reason: "Synthetic reward was not provided", idempotencyKey: randomUUID() } });
    expect(restored.status()).toBe(200);
    const revised = "Synthetic corrected reason after definite rejection"; await reason.fill(revised);
    await dialog.getByRole("button", { name: "Korrektur buchen", exact: true }).click();
    await expect(f.page.getByText("Korrektur gebucht. Der Kontostand und der Verlauf sind aktualisiert.", { exact: true })).toBeVisible();
    expect(payloads).toHaveLength(2); expect(payloads[1].idempotencyKey).toBe(payloads[0].idempotencyKey);
    expect(payloads[1].reason).toBe(revised);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member.id])).rows[0].balance).toBe(0);
    expect((await pool.query("SELECT reason FROM ledger_entries WHERE reversal_of_id=$1", [f.entryId])).rows).toEqual([{ reason: revised }]);
    expect((await pool.query("SELECT * FROM ledger_entries WHERE id=$1", [f.entryId])).rows[0]).toEqual(f.original);
  } finally { await f.close(); }
});
