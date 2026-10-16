import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Identity = { id: string; email: string; password: string };
type Merchant = { tenantId: string; locationId: string; programSlug: string; programId: string };
type Booking = { membershipId: string; requestId: string; idempotencyKey: string; quantity?: number; rewardVersionId?: string };
type Journey = { cardPath: string; cardToken: string; membershipId: string; campaignId: string; award: Booking; redemption: Booking };
const origin = "http://localhost:3000";
const folder = process.env.REHEARSAL_DIRECTORY ?? "";
const phase = process.env.REHEARSAL_PHASE;

test(`compiled website/application/worker journey ${phase}`, async ({ browser }) => {
  test.setTimeout(90_000);
  expect(folder.startsWith("/tmp/loy-110-")).toBe(true);
  expect(["before", "after"]).toContain(phase);
  const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
  expect(database.hostname).toBe("localhost");
  expect(database.port).toBe("55433");
  expect(database.pathname).toMatch(/^\/looplocal_rehearsal_[a-f0-9]{12}$/);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const f = JSON.parse(readFileSync(process.env.REHEARSAL_FIXTURE!, "utf8")) as { owners: Identity[]; cashier: Identity; merchants: Merchant[] };
  const width = phase === "before" ? 375 : 1280;
  const contexts: BrowserContext[] = [];
  const context = async (role: string) => {
    const ctx = await browser.newContext({ baseURL: origin, viewport: { width, height: 900 }, ...(phase === "after" ? { storageState: join(folder, `${role}-state.json`) } : {}) });
    // Block non-loopback browser requests: no hosted login, provider or marketing contact.
    await ctx.route("**/*", route => {
      const url = new URL(route.request().url());
      return ["localhost", "127.0.0.1"].includes(url.hostname) || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    contexts.push(ctx);
    return { ctx, page: await ctx.newPage() };
  };
  const login = async (page: Page, identity: Identity, path: string) => {
    await page.goto("/login");
    await page.getByLabel("E-Mail-Adresse").fill(identity.email);
    await page.getByLabel("Passwort").fill(identity.password);
    const submit = async () => {
      const signed = page.waitForResponse(r => r.url().endsWith("/api/auth/sign-in/email") && r.request().method() === "POST");
      await page.getByRole("button", { name: "Anmelden" }).click();
      return signed;
    };
    let signed = await submit();
    if (signed.status() === 429) {
      await expect(page.locator("form").getByRole("alert")).toContainText("Zu viele Anmeldeversuche");
      const delay = Number(signed.headers()["x-retry-after"]);
      expect(delay).toBeGreaterThanOrEqual(0); expect(delay).toBeLessThanOrEqual(30);
      console.log(`Expected production sign-in rate limit; honor Retry-After ${delay}s, resubmit once`);
      await new Promise(resolve => setTimeout(resolve, (delay + 1) * 1000));
      signed = await submit();
    }
    expect(signed.status()).toBe(200);
    await expect.poll(() => new URL(page.url()).pathname).toBe(path);
  };
  const post = (page: Page, path: string, data: unknown) => page.request.post(path, { headers: { origin }, data });
  try {
    expect((await pool.query("SHOW data_directory")).rows[0].data_directory).toBe("/private/tmp/loynara-goal-133-pg");
    expect((await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations")).rows[0].n).toBe(25);
    const customer = await context("customer"), cashier = await context("cashier"), owner = await context("owner");
    await customer.page.goto("http://127.0.0.1:8795/");
    await customer.page.getByRole("link", { name: "Demo anfragen", exact: true }).first().click();
    await expect(customer.page.locator("#anfrage")).toBeVisible();
    await expect(customer.page.locator("#anfrage")).toContainText("E-Mail");
    const appHref = await customer.page.getByRole("link", { name: "Anmelden", exact: true }).first().getAttribute("href");
    expect(new URL(appHref!).hostname).toBe("app.getloynara.com");
    expect(new URL(appHref!).pathname).toBe("/login");
    // Public production hostname stays unchanged. The supported app path is exercised on this local host.
    await owner.page.goto(new URL(appHref!).pathname);
    expect((await post(owner.page, "/api/auth/sign-up/email", { name: "Forbidden public signup", email: `${randomUUID()}@example.test`, password: "synthetic-forbidden-local-only" })).status()).toBe(403);
    let journey: Journey;
    if (phase === "before") {
      await login(owner.page, f.owners[0], "/merchant");
      await login(cashier.page, f.cashier, "/cashier");
      await customer.page.goto(`/join/${f.merchants[0].programSlug}`);
      await customer.page.getByRole("checkbox").first().check();
      await customer.page.getByRole("button", { name: "Meine Karte erstellen" }).click();
      await expect.poll(() => new URL(customer.page.url()).pathname.startsWith("/card/")).toBe(true);
      const cardPath = new URL(customer.page.url()).pathname, cardToken = cardPath.split("/").pop()!;
      await customer.page.reload(); // Same real membership cookie recognizes returning customer.
      expect(new URL(customer.page.url()).pathname).toBe(cardPath);
      await expect(customer.page.locator(".customer-balance-line strong")).toHaveText("0 Stempel");
      const member = (await pool.query("SELECT id,scan_code FROM memberships WHERE card_token=$1", [cardToken])).rows[0] as { id: string; scan_code: string };
      await cashier.page.getByLabel("Kartennummer oder Kartencode").fill(member.scan_code);
      await cashier.page.getByRole("button", { name: "Prüfen", exact: true }).click();
      await cashier.page.getByRole("button", { name: "Menge erhöhen" }).click();
      await cashier.page.getByRole("button", { name: "Menge erhöhen" }).click();
      await cashier.page.locator(".cashier-award-now").click();
      await expect(cashier.page.getByRole("dialog", { name: "Vergabe bestätigen?" })).toBeVisible();
      const awardRequest = cashier.page.waitForRequest(request => request.url().endsWith("/api/cashier/award") && request.method() === "POST");
      await cashier.page.getByRole("button", { name: "Ja, vergeben" }).click();
      const award = (await awardRequest).postDataJSON() as Booking;
      await expect(cashier.page.locator(".cashier-booked")).toContainText("Neuer Stand: 3 Stempel");
      const replay = await post(cashier.page, "/api/cashier/award", award);
      expect(replay.status()).toBe(200); expect((await replay.json()).duplicate).toBe(true);
      await cashier.page.getByRole("button", { name: "Andere Karte" }).click();
      await cashier.page.getByLabel("Kartennummer oder Kartencode").fill(member.scan_code);
      await cashier.page.getByRole("button", { name: "Prüfen", exact: true }).click();
      const redeemRequest = cashier.page.waitForRequest(request => request.url().endsWith("/api/cashier/redeem") && request.method() === "POST");
      await cashier.page.locator(".reward-action-list button").first().click();
      await cashier.page.getByRole("button", { name: "Ja, einlösen" }).click();
      const redemption = (await redeemRequest).postDataJSON() as Booking;
      await expect(cashier.page.locator(".cashier-booked")).toContainText("Neuer Stand: 0 Stempel");
      const withdraw = await post(customer.page, `/api/card/${cardToken}/contact/marketing`, { granted: false });
      expect(withdraw.status()).toBe(200); expect(await withdraw.json()).toEqual({ marketingEmail: false });
      const grant = await post(customer.page, `/api/card/${cardToken}/contact/marketing`, { granted: true });
      expect(grant.status()).toBe(400);
      const created = await post(owner.page, "/api/merchant/campaigns", { action: "create", programSlug: f.merchants[0].programSlug, title: "Rehearsal draft", subject: "Synthetic only", body: "No external customer communication", audienceDefinition: { kind: "all" } });
      expect(created.status()).toBe(201);
      const campaignId = (await created.json()).campaign.id as string;
      const schedule = await post(owner.page, "/api/merchant/campaigns", { action: "schedule", campaignId, scheduledAt: new Date(Date.now() + 1000).toISOString() });
      expect(schedule.status()).toBe(400);
      journey = { cardPath, cardToken, membershipId: member.id, campaignId, award, redemption };
      writeFileSync(join(folder, "journey.json"), JSON.stringify(journey), { mode: 0o600 });
      for (const [role, item] of [["customer", customer], ["cashier", cashier], ["owner", owner]] as const) {
        const path = join(folder, `${role}-state.json`); await item.ctx.storageState({ path }); chmodSync(path, 0o600);
      }
    } else {
      journey = JSON.parse(readFileSync(join(folder, "journey.json"), "utf8")) as Journey;
      await cashier.page.goto("/cashier");
      await expect(cashier.page.getByRole("heading", { name: "Karte scannen. Dann entscheiden." })).toBeVisible();
      await owner.page.goto("/merchant");
      await expect(owner.page.getByRole("heading", { name: "Übersicht", exact: true })).toBeVisible();
      for (const [path, booking] of [["award", journey.award], ["redeem", journey.redemption]] as const) {
        const replay = await post(cashier.page, `/api/cashier/${path}`, booking);
        expect(replay.status()).toBe(200); expect((await replay.json()).duplicate).toBe(true);
      }
    }
    await customer.page.goto(journey.cardPath);
    await expect(customer.page.locator(".customer-balance-line strong")).toHaveText("0 Stempel");
    await expect(customer.page.locator(".customer-activity-list")).toContainText("+3 Stempel");
    await expect(customer.page.locator(".customer-activity-list")).toContainText("-3 Stempel");
    const ledger = (await pool.query("SELECT delta FROM ledger_entries WHERE membership_id=$1 ORDER BY created_at,id", [journey.membershipId])).rows;
    expect(ledger.map(r => Number(r.delta)).sort((a, b) => a - b)).toEqual([-3, 3]);
    expect((await pool.query("SELECT balance FROM memberships WHERE id=$1", [journey.membershipId])).rows[0].balance).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM redemptions WHERE membership_id=$1", [journey.membershipId])).rows[0].n).toBe(1);
    const report = await owner.page.request.get("/api/merchant/analytics?window=30"); expect(report.status()).toBe(200);
    expect(await report.json()).toMatchObject({ currentActiveCards: 1, qualifyingCheckouts: 1, issued: { awardActions: 1, stampUnits: 3 }, rewards: { redemptions: 1 } });
    expect((await cashier.page.request.get("/api/merchant/analytics")).status()).toBe(403);
    const preview = await post(owner.page, "/api/merchant/campaigns/preview", { programSlug: f.merchants[0].programSlug, audienceDefinition: { kind: "all" } });
    expect(preview.status()).toBe(200); expect(await preview.json()).toMatchObject({ total: 1, eligibleCount: 0 });
    const foreign = await browser.newContext({ baseURL: origin }); contexts.push(foreign); const foreignPage = await foreign.newPage();
    await login(foreignPage, f.owners[1], "/merchant");
    expect((await post(foreignPage, "/api/cashier/award", { ...journey.award, idempotencyKey: randomUUID(), requestId: randomUUID() })).status()).toBe(404);
    expect((await foreignPage.request.get(`/api/merchant/campaigns?programSlug=${f.merchants[0].programSlug}`)).status()).toBe(404);
    expect((await pool.query("SELECT count(*)::int AS n FROM campaign_recipients WHERE campaign_id=$1", [journey.campaignId])).rows[0].n).toBe(0);
    expect((await pool.query("SELECT status FROM campaigns WHERE id=$1", [journey.campaignId])).rows[0].status).toBe("draft");
    expect((await pool.query("SELECT granted FROM consent_events WHERE membership_id=$1 AND purpose='marketing' ORDER BY created_at DESC,id DESC LIMIT 1", [journey.membershipId])).rows[0].granted).toBe(false);
    await owner.page.screenshot({ path: `/tmp/loy-110-owner-${width}.png` });
    console.log(`PASS ${phase}: ${width}px compiled app/static website/worker coexist; signupOFF, returning membership, approved award/redeem, exact2ledger/1redemption, analytics, consentOFF/draft0recipients, tenant404; ${phase === "after" ? "saved sessions and replay survived restart" : "state saved for actual restart"}`);
  } finally { for (const ctx of contexts) await ctx.close(); await pool.end(); }
});
