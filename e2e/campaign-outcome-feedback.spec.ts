import { createHash, randomUUID } from "node:crypto";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { db, pool } from "../src/db";
import { campaignAttempts, campaignRecipients, emailDeliveries, memberships, outboxJobs } from "../src/db/schema";
import { auth } from "../src/lib/auth";
import { nfcFixture } from "../src/lib/nfc-test-db";
import { createDraftCampaign } from "../src/lib/campaigns";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" ||
    !["/looplocal_browser_campaign_067a", "/looplocal_browser_campaign_067b"].includes(database.pathname)) throw new Error("Dedicated synthetic campaign database required");
let storage: Awaited<ReturnType<BrowserContext["storageState"]>>;
let positiveId: string, emptyId: string, foreignId: string, jobId: string;
const positiveTitle = "Synthetic persisted outcomes";
const emptyTitle = "Synthetic zero outcomes";

test.beforeAll(async ({ browser, baseURL }) => {
  if (baseURL !== "http://localhost:3000") throw new Error("Loopback application required");
  const own = await nfcFixture({ tapMode: "disabled" }); const foreign = await nfcFixture({ tapMode: "disabled" });
  // Disposable identity receives a real credential account; authenticate via the
  // application's actual sign-in. No signup/limiter/session override is used.
  const password = `Local!${randomUUID()}Aa`; const ctx = await auth.$context;
  await ctx.internalAdapter.linkAccount({ userId: own.userId, accountId: own.userId, providerId: "credential", password: await ctx.password.hash(password) });
  const context = await browser.newContext({ baseURL, extraHTTPHeaders: { Origin: baseURL } });
  try {
    expect((await context.request.post("/api/auth/sign-in/email", { data: { email: `${own.userId}@example.test`, password } })).status()).toBe(200);
    storage = await context.storageState();
  } finally { await context.close(); }
  const draft = (f: typeof own, title: string) => createDraftCampaign({ actorUserId: f.userId, programSlug: f.program.slug, title, subject: "Synthetic subject", body: "Synthetic reporting fixture, never sent", audienceDefinition: { kind: "all" } });
  positiveId = (await draft(own, positiveTitle)).id; emptyId = (await draft(own, emptyTitle)).id; foreignId = (await draft(foreign, "Foreign private report")).id;
  const [queuedMember] = await db.insert(memberships).values({ tenantId: own.tenant.id, programId: own.program.id, scanCode: `sc_${randomUUID()}`, cardToken: `card_${randomUUID()}` }).returning();
  const [recipient] = await db.insert(campaignRecipients).values({ tenantId: own.tenant.id, campaignId: positiveId, membershipId: own.member.id, status: "complete", sentAt: new Date() }).returning();
  await db.insert(campaignRecipients).values({ tenantId: own.tenant.id, campaignId: positiveId, membershipId: queuedMember.id, status: "queued" });
  const [job] = await db.insert(outboxJobs).values({ tenantId: own.tenant.id, kind: "email.campaign", payload: {}, status: "complete", attempts: 1 }).returning(); jobId = job.id;
  await db.insert(campaignAttempts).values({ tenantId: own.tenant.id, recipientId: recipient.id, outboxJobId: job.id, attempt: 1, status: "complete" });
  await db.insert(emailDeliveries).values({ jobId: job.id, provider: "mailgun", recipientHash: createHash("sha256").update("synthetic@example.test").digest("hex"), status: "accepted" });
});
test.afterAll(async () => { await pool.end(); });
async function pageFor(browser: Browser, baseURL: string | undefined, width: number) {
  const context = await browser.newContext({ baseURL, storageState: storage, viewport: { width, height: 812 } });
  const page = await context.newPage(); await page.goto("/merchant/campaigns");
  await expect(page.getByRole("heading", { name: "Deine Kampagnen", exact: true })).toBeVisible();
  return { context, page, details: (title: string) => page.locator("li.ow-reward").filter({ has: page.getByText(title, { exact: true }) }).getByRole("button", { name: "Details", exact: true }), panel: (title: string) => page.getByRole("region", { name: title, exact: true }) };
}
async function persistedSnapshot() {
  const result: Record<string, unknown> = {};
  for (const table of ["campaigns", "campaign_recipients", "campaign_attempts", "email_deliveries", "outbox_jobs", "ledger_entries", "consent_events", "email_suppressions", "campaign_daily_usage"]) {
    // Fixed synthetic tables only; no private values are emitted as evidence.
    result[table] = (await pool.query(`SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) AS data FROM ${table} t`)).rows[0].data;
  }
  return result;
}
for (const width of [375, 1280]) {
  for (const failure of ["server", "network"] as const) test(`failed detail refresh hides previously verified figures and explicit retry restores current outcomes (${failure}, ${width}px)`, async ({ browser, baseURL }) => {
    const p = await pageFor(browser, baseURL, width); let renamed = false;
    try {
      await pool.query("UPDATE email_deliveries SET status='accepted' WHERE job_id=$1", [jobId]);
      const read = p.page.waitForResponse(r => new URL(r.url()).pathname === `/api/merchant/campaigns/${positiveId}`);
      await p.details(positiveTitle).click(); const actual = await read; expect(actual.status()).toBe(200);
      expect(await actual.json()).toMatchObject({ summary: { queued: 1, sent: 1, delivered: 0 }, outcome: { sent: 1, returnedAfterSend: 0 } });
      await expect(p.panel(positiveTitle)).toBeVisible();
      const before = await persistedSnapshot();
      await expect(p.panel(positiveTitle).locator("dt").filter({ hasText: "Zugestellt laut Anbieter" }).locator("+ dd")).toHaveText("0");
      if (failure === "server") { await pool.query("ALTER TABLE campaign_recipients RENAME TO test_campaign_067_unavailable"); renamed = true; }
      else await p.page.route(`**/api/merchant/campaigns/${positiveId}`, route => route.abort("connectionreset"));
      const failed = failure === "server" ? p.page.waitForResponse(r => new URL(r.url()).pathname === `/api/merchant/campaigns/${positiveId}`) : null;
      await p.details(positiveTitle).click();
      if (failed) expect((await failed).status()).toBe(500);
      await expect(p.page.locator(".ow-page .ow-notice[role=alert]")).toBeVisible();
      await expect(p.panel(positiveTitle)).toHaveCount(0);
      await expect(p.details(positiveTitle)).toBeEnabled();
      if (renamed) { await pool.query("ALTER TABLE test_campaign_067_unavailable RENAME TO campaign_recipients"); renamed = false; }
      else await p.page.unroute(`**/api/merchant/campaigns/${positiveId}`);
      expect(await persistedSnapshot()).toEqual(before);
      await pool.query("UPDATE email_deliveries SET status='delivered' WHERE job_id=$1", [jobId]);
      const retried = p.page.waitForResponse(r => new URL(r.url()).pathname === `/api/merchant/campaigns/${positiveId}`);
      await p.details(positiveTitle).click(); const current = await retried; expect(current.status()).toBe(200); expect(await current.json()).toMatchObject({ summary: { queued: 1, sent: 1, delivered: 1 } });
      await expect(p.panel(positiveTitle).locator("dt").filter({ hasText: "Zugestellt laut Anbieter" }).locator("+ dd")).toHaveText("1");
      await expect(p.page.locator(".ow-page .ow-notice[role=alert]")).toHaveCount(0);
      await expect(p.panel(positiveTitle).getByText("„Angenommen“ heißt nicht „zugestellt“.", { exact: false })).toBeVisible();
      expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      if (width === 375 && failure === "server") {
        await p.panel(positiveTitle).scrollIntoViewIfNeeded();
        await p.page.screenshot({ path: "/tmp/loy-067-current-outcomes-mobile.png" });
      }
    } finally { if (renamed) await pool.query("ALTER TABLE test_campaign_067_unavailable RENAME TO campaign_recipients"); await p.context.close(); }
  });
}

for (const width of [375, 1280]) {
  test(`genuine zero report remains empty and foreign report is inaccessible (${width}px)`, async ({ browser, baseURL }) => {
    const p = await pageFor(browser, baseURL, width);
    try {
      expect((await p.context.request.get(`/api/merchant/campaigns/${foreignId}`)).status()).toBe(404);
      const actual = p.page.waitForResponse(r => new URL(r.url()).pathname === `/api/merchant/campaigns/${emptyId}`);
      await p.details(emptyTitle).click(); const result = await actual; expect(result.status()).toBe(200);
      expect(await result.json()).toMatchObject({ summary: { queued: 0, sent: 0, delivered: 0, suppressed: 0, failed: 0, providerFailed: 0 }, attempts: [], outcome: { sent: 0, returnedAfterSend: 0 } });
      await expect(p.panel(emptyTitle).getByText("Noch keine Zustellversuche.", { exact: true })).toBeVisible();
      await expect(p.page.getByText("Foreign private report", { exact: true })).toHaveCount(0);
      expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { await p.context.close(); }
  });
  for (const failOld of [false, true]) test(`abandoned ${failOld ? "error" : "success"} cannot replace the new campaign selection (${width}px)`, async ({ browser, baseURL }) => {
    const p = await pageFor(browser, baseURL, width); let release!: () => void; let started!: () => void;
    const hold = new Promise<void>(r => { release = r; }); const waiting = new Promise<void>(r => { started = r; });
    try {
      await p.details(positiveTitle).click(); await expect(p.panel(positiveTitle)).toBeVisible();
      await p.page.route(`**/api/merchant/campaigns/${positiveId}`, async route => {
        // Preserve real authorized response/data, delay only its browser delivery.
        const actual = await route.fetch(); expect(actual.status()).toBe(200); started(); await hold;
        if (failOld) await route.abort("connectionreset"); else await route.fulfill({ response: actual });
      });
      await p.details(positiveTitle).click(); await waiting;
      await expect(p.page.getByRole("status").filter({ hasText: "Kampagnendaten werden geladen" })).toBeVisible();
      await expect(p.panel(positiveTitle)).toHaveCount(0);
      await p.page.getByRole("button", { name: "Eigene Kampagne", exact: true }).click();
      await p.page.getByRole("button", { name: "Abbrechen", exact: true }).click();
      await p.details(emptyTitle).click(); await expect(p.panel(emptyTitle)).toBeVisible();
      const settled = failOld ? p.page.waitForEvent("requestfailed", { predicate: r => new URL(r.url()).pathname === `/api/merchant/campaigns/${positiveId}` }) : p.page.waitForResponse(r => new URL(r.url()).pathname === `/api/merchant/campaigns/${positiveId}`);
      release(); const observed = await settled; if (!failOld) await (observed as import("@playwright/test").Response).finished();
      await p.page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(p.panel(emptyTitle)).toBeVisible(); await expect(p.panel(positiveTitle)).toHaveCount(0);
      await expect(p.page.locator(".ow-page .ow-notice[role=alert]")).toHaveCount(0);
      await expect(p.details(emptyTitle)).toBeEnabled();
      expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    } finally { release?.(); await p.context.close(); }
  });
}

for (const width of [375, 1280]) test(`successful detail edit opens existing draft and releases controls (${width}px)`, async ({ browser, baseURL }) => {
  const p = await pageFor(browser, baseURL, width);
  try {
    await p.page.locator("li.ow-reward").filter({ has: p.page.getByText(emptyTitle, { exact: true }) }).getByRole("button", { name: "Bearbeiten", exact: true }).click();
    await expect(p.page.getByRole("heading", { name: "Prüfen & speichern", exact: true })).toBeVisible();
    await expect(p.page.getByRole("button", { name: "Entwurf aktualisieren", exact: true })).toBeEnabled();
    await p.page.getByRole("button", { name: "Zurück", exact: true }).click();
    await expect(p.page.getByLabel("Interner Titel", { exact: true })).toHaveValue(emptyTitle);
    await p.page.getByRole("button", { name: "Zurück", exact: true }).click();
    await p.page.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(p.details(emptyTitle)).toBeEnabled();
  } finally { await p.context.close(); }
});
