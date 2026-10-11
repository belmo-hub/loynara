import { randomUUID } from "node:crypto";
import { expect, test, type Browser } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { createMerchant } from "../src/lib/product";
import { acceptStaffInvite, createStaffInvite } from "../src/lib/staff";
import { pool } from "../src/db";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || database.hostname !== "localhost" || database.port !== "55433" || !["/looplocal_browser_offline_079a", "/looplocal_browser_offline_079b"].includes(database.pathname)) throw new Error("Owned synthetic interruption database required");
const origin = "http://localhost:3000", eventKey = "looplocal.offline.events.v1", deviceKey = "looplocal.offline.device.v1";
test.afterAll(async () => { await pool.end(); });
async function fixture(browser: Browser, baseURL: string | undefined) {
  if (baseURL !== origin) throw new Error("Loopback application required");
  async function identity() {
    const email = `${randomUUID()}@example.test`, password = `Local!${randomUUID()}Aa`;
    const result = await auth.api.signUpEmail({ body: { name: "Synthetic interruption operator", email, password } });
    return { id: result.user.id, email, password };
  }
  const owner = await identity(), cashier = await identity();
  const merchant = await createMerchant({ userId: owner.id, businessName: "Synthetic interruption Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Interruption test", programType: "stamp", rulesText: "One explicitly confirmed synthetic visit", rewardTitle: "Coffee", rewardCost: 5 });
  const invitation = await createStaffInvite({ actorUserId: owner.id, locationId: merchant.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.id, token: invitation.token });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin }, viewport: { width: 390, height: 844 } });
  const ownerContext = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  const customer = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: origin } });
  for (const [ctx, actor] of [[context, cashier], [ownerContext, owner]] as const) expect((await ctx.request.post("/api/auth/sign-in/email", { data: { email: actor.email, password: actor.password } })).status()).toBe(200);
  const joined = await customer.request.post("/api/enroll", { data: { slug: merchant.programSlug, acceptedTerms: true, marketingOptIn: false } });
  expect(joined.status()).toBe(201);
  const token = (await joined.json()).cardToken as string;
  const card = await (await customer.request.get(`/api/card/${token}`)).json() as { scanCode: string; balance: number };
  const member = (await pool.query("SELECT id FROM memberships WHERE card_token=$1", [token])).rows[0].id as string;
  const page = await context.newPage(); await page.goto("/cashier");
  await page.getByLabel("Kartennummer oder Kartencode").fill(card.scanCode);
  const leased = page.waitForResponse(r => r.url().includes("/api/cashier/offline/lease") && r.ok());
  await page.getByRole("button", { name: "Prüfen", exact: true }).click(); await leased;
  await context.setOffline(true);
  await page.locator(".cashier-award-now").click();
  await page.getByRole("button", { name: "Offline-Vergabe vormerken", exact: true }).click();
  await expect(page.getByText("1 ausstehend", { exact: false })).toBeVisible();
  const queued = await page.evaluate(keys => ({ event: JSON.parse(localStorage.getItem(keys.event) ?? "[]")[0], deviceId: localStorage.getItem(keys.device) }), { event: eventKey, device: deviceKey });
  expect(queued.event.state).toBe("pending"); expect(queued.event.actorUserId).toBe(cashier.id);
  expect(JSON.stringify(queued)).not.toMatch(/sc_[A-Za-z0-9_-]{32}|card_[A-Za-z0-9_-]{32}/);
  await context.setOffline(false);
  return { context, ownerContext, customer, cashier, member, page, queued, async close() { await Promise.all([context.close(), ownerContext.close(), customer.close()]); } };
}
function payload(f: Awaited<ReturnType<typeof fixture>>) {
  const e = f.queued.event;
  return { leaseId: e.leaseId, deviceId: f.queued.deviceId, eventId: e.eventId, eventAt: e.eventAt, award: e.award };
}
async function bookingCount(member: string) {
  return Number((await pool.query("SELECT count(*) FROM ledger_entries WHERE membership_id=$1", [member])).rows[0].count);
}
async function recover(f: Awaited<ReturnType<typeof fixture>>) {
  const page = await f.context.newPage(); let automaticSyncs = 0;
  page.on("request", r => { if (new URL(r.url()).pathname === "/api/cashier/offline/sync") automaticSyncs++; });
  await page.goto("/cashier"); await expect(page.getByText("1 ausstehend", { exact: false })).toBeVisible();
  expect(automaticSyncs).toBe(0);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]")[0], eventKey)).toEqual(f.queued.event);
  expect(await page.evaluate(key => localStorage.getItem(key), deviceKey)).toBe(f.queued.deviceId);
  const sent = page.waitForRequest(r => new URL(r.url()).pathname === "/api/cashier/offline/sync");
  await page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true }).click();
  expect((await sent).postDataJSON()).toEqual(payload(f));
  await expect(page.getByText("Vom Server angenommen", { exact: false })).toBeVisible();
  expect(await bookingCount(f.member)).toBe(1);
  expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member])).rows[0].balance).toBe(1);
  expect((await pool.query("SELECT count(*)::int AS n FROM offline_award_events WHERE id=$1 AND status='accepted'", [f.queued.event.eventId])).rows[0].n).toBe(1);
  await expect.poll(async () => (await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]")[0], eventKey)).state).toBe("accepted");
  return page;
}

test("closing before a real committed sync acknowledgement preserves the pending event and explicit recovery key", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL);
  let committed!: () => void, release!: () => void;
  const committedSignal = new Promise<void>(resolve => { committed = resolve; });
  const interruptedSignal = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.page.route("**/api/cashier/offline/sync", async route => {
      expect(route.request().postDataJSON()).toEqual(payload(f));
      const response = await route.fetch(); expect(response.status()).toBe(200); expect(await response.json()).toMatchObject({ status: "accepted", balance: 1 });
      committed(); await interruptedSignal;
      try { await route.abort("aborted"); } catch (error) { if (!f.page.isClosed()) throw error; }
    });
    await f.page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true }).click(); await committedSignal;
    expect(await bookingCount(f.member)).toBe(1);
    expect((await f.page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]")[0], eventKey)).state).toBe("pending");
    await f.page.close(); release();
    const recovered = await recover(f);
    await recovered.screenshot({ path: "/tmp/loy-079-offline-recovery-proof.png", fullPage: true });
  } finally { release(); await f.close(); }
});

test("a local result-write failure after the real sync commit survives page restart without creating a second award", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL);
  try {
    await f.page.evaluate(key => {
      const original = Storage.prototype.setItem; let once = true;
      Storage.prototype.setItem = function (name, value) {
        if (once && name === key && JSON.parse(value).some((item: { state: string }) => item.state === "accepted")) { once = false; throw new DOMException("Synthetic result write unavailable", "QuotaExceededError"); }
        return original.call(this, name, value);
      };
    }, eventKey);
    await f.page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true }).click();
    await expect(f.page.getByText("Synthetic result write unavailable", { exact: false })).toBeVisible();
    expect(await bookingCount(f.member)).toBe(1);
    expect((await f.page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]")[0], eventKey)).state).toBe("pending");
    await f.page.close(); await recover(f);
  } finally { await f.close(); }
});

test("revocation before recovery blocks the restarted cashier and rejects the durable event without credit", async ({ browser, baseURL }) => {
  const f = await fixture(browser, baseURL);
  try {
    await f.page.close();
    expect((await f.ownerContext.request.post("/api/staff/revoke", { data: { userId: f.cashier.id } })).status()).toBe(200);
    const page = await f.context.newPage();
    const deniedMe = page.waitForResponse(r => new URL(r.url()).pathname === "/api/me");
    await page.goto("/cashier");
    const meResponse = await deniedMe;
    console.log("synthetic revoked cashier me status", meResponse.status());
    expect(meResponse.status()).toBe(403);
    await expect(page.getByRole("heading", { name: "Zugang gesperrt oder nicht eingerichtet", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Ausstehende Vergaben synchronisieren", exact: true })).toHaveCount(0);
    expect((await page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? "[]")[0], eventKey)).state).toBe("pending");
    const rejected = await f.context.request.post("/api/cashier/offline/sync", { data: payload(f) });
    expect(rejected.status()).toBe(200); expect(await rejected.json()).toMatchObject({ status: "rejected", reason: "STAFF_REVOKED" });
    expect(await bookingCount(f.member)).toBe(0);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [f.member])).rows[0].balance).toBe(0);
  } finally { await f.close(); }
});
