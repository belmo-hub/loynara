import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { award } from "../src/lib/loyalty";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { db, pool } from "../src/db";
import { campaigns as campaignRows, campaignAttempts, campaignRecipients, outboxJobs } from "../src/db/schema";
import { createMerchant, enroll } from "../src/lib/product";
import { createDraftCampaign, scheduleCampaign } from "../src/lib/campaigns";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || target.hostname !== "localhost" || target.port !== "55433" || target.pathname !== "/looplocal_test") throw new Error("Owned disposable local database required");
const origin = "http://localhost:3000";
const password = `Synthetic!${randomUUID()}Aa`;
let ownerEmail: string;
let cards: Array<Awaited<ReturnType<typeof enroll>>>;
let campaigns: Array<{ id: string; title: string }>;
let foreignCampaign: { id: string; title: string };
let storage: Awaited<ReturnType<import("@playwright/test").BrowserContext["storageState"]>>;
test.beforeAll(async ({ browser, baseURL }) => {
  expect(baseURL).toBe(origin);
  expect((await pool.query("SHOW data_directory")).rows[0].data_directory).toBe("/private/tmp/loynara-goal-133-pg");
  const fixtures: Array<{ email: string; user: { id: string }; merchant: Awaited<ReturnType<typeof createMerchant>> }> = [];
  for (let index = 0; index < 2; index++) {
    const email = `report-${randomUUID()}@example.test`;
    const user = (await auth.api.signUpEmail({ body: { name: "Synthetic report owner", email, password } })).user;
    const merchant = await createMerchant({ userId: user.id, businessName: `Report merchant ${index}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: `Report programme ${index}`, programType: "stamp", rulesText: "Synthetic approved checkout", rewardTitle: "Synthetic reward", rewardCost: 3 });
    fixtures.push({ email, user, merchant });
  }
  ownerEmail = fixtures[0].email;
  const draft = (index: number, title: string) => createDraftCampaign({ actorUserId: fixtures[index].user.id, programSlug: fixtures[index].merchant.programSlug, title, subject: "Synthetic report only", body: "No messages are sent", audienceDefinition: { kind: "all" } });
  campaigns = [await draft(0, "Empty draft"), await draft(0, "Scheduled without delivery"), await draft(0, "Failed attempt, no delivery")];
  foreignCampaign = await draft(1, "Foreign campaign hidden");
  // Enable only the existing local channel while scheduling; no worker or send is run.
  const smtp = process.env.SMTP_HOST;
  try { process.env.SMTP_HOST = "localhost"; await scheduleCampaign({ actorUserId: fixtures[0].user.id, campaignId: campaigns[1].id, scheduledAt: new Date(Date.now() + 60_000) }); }
  finally { if (smtp === undefined) delete process.env.SMTP_HOST; else process.env.SMTP_HOST = smtp; }
  const member = await enroll({ slug: fixtures[0].merchant.programSlug, acceptedTerms: true });
  const foreignMember = await enroll({ slug: fixtures[1].merchant.programSlug, acceptedTerms: true });
  cards = [member, foreignMember];
  for (const [index, card] of cards.entries()) await award({ userId: fixtures[index].user.id, locationId: fixtures[index].merchant.locationId, membershipId: card.id, quantity: index + 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
  // Historical synthetic events use the established reporting fixture pattern; no provider is contacted.
  const [recipient] = await db.insert(campaignRecipients).values({ tenantId: fixtures[0].merchant.tenantId, campaignId: campaigns[2].id, membershipId: member.id, status: "failed" }).returning();
  const [job] = await db.insert(outboxJobs).values({ tenantId: fixtures[0].merchant.tenantId, kind: "email.campaign", payload: {}, status: "failed" }).returning();
  await db.insert(campaignAttempts).values({ tenantId: fixtures[0].merchant.tenantId, recipientId: recipient.id, outboxJobId: job.id, attempt: 1, status: "failed", reason: "Synthetic transport failure" });
  await db.update(campaignRows).set({ status: "complete", audienceCount: 1, queuedCount: 1 }).where(eq(campaignRows.id, campaigns[2].id));
  const context = await browser.newContext({ baseURL });
  try {
    expect((await context.request.post("/api/auth/sign-in/email", { headers: { Origin: origin }, data: { email: ownerEmail, password } })).status()).toBe(200);
    storage = await context.storageState();
  } finally { await context.close(); }
});
test.afterAll(async () => { await pool.end(); });
for (const width of [375, 1280]) test(`owner sees honest empty, scheduled and failed campaign outcomes (${width}px)`, async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, storageState: storage, viewport: { width, height: 900 } });
  const page = await context.newPage();
  const panel = page.locator("section").filter({ has: page.getByRole("heading", { name: campaigns[0].title, exact: true }) });
  async function open(index: number) {
    await page.locator("li.ow-reward").filter({ has: page.getByText(campaigns[index].title, { exact: true }) }).getByRole("button", { name: "Details", exact: true }).click();
    return page.locator("section").filter({ has: page.getByRole("heading", { name: campaigns[index].title, exact: true }) });
  }
  try {
    await page.goto("/merchant/campaigns");
    await expect(page.getByRole("heading", { name: "Kampagnen", level: 1 })).toBeVisible();
    await expect(page.getByText(foreignCampaign.title, { exact: true })).toHaveCount(0);
    expect((await context.request.get(`/api/merchant/campaigns/${foreignCampaign.id}`)).status()).toBe(404);
    await expect(page.locator("li.ow-reward").filter({ has: page.getByText(campaigns[1].title, { exact: true }) }).getByText("Geplant", { exact: true })).toBeVisible();
    await expect(page.locator("li.ow-reward").filter({ has: page.getByText(campaigns[2].title, { exact: true }) }).getByText("Abgeschlossen", { exact: true })).toBeVisible();
    await open(0);
    await expect(panel.getByText("Noch keine Zustellversuche.", { exact: true })).toBeVisible();
    await expect(panel.locator("dd")).toHaveText(["0", "0", "0", "0", "0", "0"]);
    await expect(panel).toContainText("„Angenommen“ heißt nicht „zugestellt“.");
    const scheduled = await open(1);
    await expect(scheduled.locator("dd")).toHaveText(["0", "0", "0", "0", "0", "0"]);
    await expect(scheduled.getByText("Noch keine Zustellversuche.", { exact: true })).toBeVisible();
    const failed = await open(2);
    await expect(failed.locator("dd")).toHaveText(["0", "0", "0", "0", "0", "1"]);
    await expect(failed.locator(".ow-feed")).toContainText("Fehlgeschlagen");
    await expect(failed.locator(".ow-feed")).toContainText("Synthetic transport failure");
    // Failed refresh must remove the old snapshot, not present it as current or as delivery success.
    const endpoint = `**/api/merchant/campaigns/${campaigns[2].id}`;
    await page.route(endpoint, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic temporary report failure" }) }));
    await open(2);
    await expect(page.getByText(/Kampagnendaten konnten nicht geladen werden/)).toBeVisible();
    await expect(failed).toHaveCount(0);
    await page.unroute(endpoint);
    const recovered = await open(2);
    await expect(recovered.locator("dd")).toHaveText(["0", "0", "0", "0", "0", "1"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/loy-107-campaign-${width}.png` });
  } finally { await context.close(); }
});

test("card export download describes its narrow scope, isolates records and retries a failed transport", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const endpoint = `/api/card/${cards[0].cardToken}/export`;
  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  try {
    await page.goto(`/card/${cards[0].cardToken}`);
    const link = page.getByRole("link", { name: "Meine Kartendaten exportieren", exact: true });
    await expect(link).toBeVisible();
    await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic private export failure" }) }));
    await link.click();
    await expect(page.getByRole("alert").filter({ hasText: "Der Export ist gerade nicht verfügbar" })).toBeVisible();
    expect(downloads).toEqual([]);
    await expect(link).not.toHaveAttribute("aria-disabled", "true");
    await page.unroute(`**${endpoint}`);
    const event = page.waitForEvent("download"); await link.click(); const download = await event;
    expect(download.suggestedFilename()).toBe("loynara-card-export.json");
    const exported = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(exported).toMatchObject({ formatVersion: 1, scope: "pseudonymous-card-activity-without-contact-records", membership: { id: cards[0].id, balance: 2 }, ledger: [{ delta: 2 }], redemptions: [], consentEvents: [] });
    const serialized = JSON.stringify(exported);
    for (const excluded of [cards[1].id, cards[0].cardToken, cards[0].scanCode, cards[1].cardToken, ownerEmail]) expect(serialized).not.toContain(excluded);
    expect(downloads).toEqual(["loynara-card-export.json"]);
    const foreign = await context.request.get(`/api/card/${cards[1].cardToken}/export`);
    expect(foreign.status()).toBe(200);
    expect((await foreign.json()).membership).toMatchObject({ id: cards[1].id, balance: 3 });
    expect((await context.request.get(`/api/card/${randomUUID()}/export`)).status()).toBe(404);
    await expect(page.getByRole("alert").filter({ hasText: "Der Export" })).toHaveCount(0);
  } finally { await context.close(); }
});
