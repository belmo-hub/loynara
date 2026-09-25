import "dotenv/config";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, rename, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { chromium, request } from "@playwright/test";

// This demonstration is restricted to the local synthetic development instance.
const origin = "http://localhost:3000";
const mailpit = "http://127.0.0.1:8026";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.PUBLIC_BASE_URL !== origin || !["localhost", "127.0.0.1"].includes(database.hostname)
  || database.pathname !== "/looplocal" || !["localhost", "127.0.0.1"].includes(process.env.SMTP_HOST ?? "")
  || process.env.EXTERNAL_EMAIL_ENABLED === "true") throw new Error("Synthetic local demo configuration required");
const run = promisify(execFile);
const output = resolve(process.cwd(), "screenshots");
const videoDir = resolve(process.cwd(), "var/integrated-demo-video");
await mkdir(output, { recursive: true });
await mkdir(videoDir, { recursive: true });

const headers = { Origin: origin };
const owner = await request.newContext({ baseURL: origin, extraHTTPHeaders: headers });
const guest = await request.newContext({ baseURL: origin, extraHTTPHeaders: headers });
const inbox = await request.newContext({ baseURL: mailpit });
let browser;
let merchant;
try {
  assert.equal((await owner.get("/api/health")).status(), 200);
  const signup = await owner.post("/api/auth/sign-up/email", { data: {
    name: "Synthetic integrated-demo owner", email: `owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa`,
  } });
  assert.equal(signup.status(), 200);
  const setup = await owner.post("/api/merchant/onboard", { data: {
    businessName: "Abendrot Café (synthetisch)", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR",
    programName: "Abendrot Stempel", programType: "stamp", rulesText: "Ein Stempel je bestätigtem Kassenbesuch.", rewardTitle: "Kaffee", rewardCost: 5,
  } });
  assert.equal(setup.status(), 201);
  const { programSlug } = await setup.json();
  const enrollment = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true, marketingOptIn: false } });
  assert.equal(enrollment.status(), 201);
  const { cardToken } = await enrollment.json();
  const card = await guest.get(`/api/card/${encodeURIComponent(cardToken)}`);
  assert.equal(card.status(), 200);
  const { scanCode } = await card.json();
  const audienceDefinition = { kind: "recently_active", withinDays: 30 };
  const audience = () => owner.post("/api/merchant/campaigns/preview", { data: { programSlug, audienceDefinition } });
  let preview = await audience();
  assert.equal(preview.status(), 200);
  assert.deepEqual((await preview.json()).total, 0);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  merchant = await browser.newContext({ baseURL: origin, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1,
    storageState: await owner.storageState(), recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } } });
  const page = await merchant.newPage();
  await page.goto("/merchant/program");
  await page.getByRole("heading", { name: "Prämien verwalten" }).waitFor();
  await page.waitForTimeout(6000);
  await page.goto(`/card/${encodeURIComponent(cardToken)}`);
  await page.locator(".customer-balance-line strong").waitFor();
  await page.waitForTimeout(5000);

  const lookup = await owner.get(`/api/cashier/lookup?code=${encodeURIComponent(scanCode)}`);
  assert.equal(lookup.status(), 200);
  const { membershipId } = await lookup.json();
  const award = await owner.post("/api/cashier/award", { data: { membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() } });
  assert.equal(award.status(), 200);
  preview = await audience();
  assert.equal(preview.status(), 200);
  assert.deepEqual((await preview.json()).total, 1);
  await page.goto("/merchant/customers");
  await page.getByRole("heading", { name: "Kartenübersicht" }).waitFor();
  await page.getByRole("button", { name: new RegExp(membershipId.slice(0, 12)) }).waitFor();
  await page.waitForTimeout(5000);

  const address = `cardholder-${randomUUID()}@example.test`;
  await page.goto(`/card/${encodeURIComponent(cardToken)}`);
  await page.getByLabel("Test-E-Mail-Adresse (.test)").fill(address);
  await page.getByRole("button", { name: "Bestätigungslink senden" }).click();
  await page.getByText("Bestätigungslink an lokales Mailpit gesendet.").waitFor();
  await page.waitForTimeout(6000);
  await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { cwd: process.cwd(), timeout: 30_000 });
  const messages = await inbox.get("/api/v1/messages");
  assert.equal(messages.status(), 200);
  const verificationItem = (await messages.json()).messages.find(message => message.Subject?.includes("bestätigen") && message.To?.some(to => to.Address === address));
  assert.ok(verificationItem, "Mailpit must capture the synthetic verification message");
  const verificationMessage = await inbox.get(`/api/v1/message/${verificationItem.ID}`);
  assert.equal(verificationMessage.status(), 200);
  const verificationText = (await verificationMessage.json()).Text;
  const verificationUrl = verificationText.match(/http:\/\/localhost:3000\/verify-email#token=v_[A-Za-z0-9_-]{43}/)?.[0];
  assert.ok(verificationUrl, "Mailpit must contain a fragment-only verification link");
  await page.goto(verificationUrl);
  await page.getByRole("heading", { name: "E-Mail bestätigt." }).waitFor();
  assert.equal(new URL(page.url()).hash, "");
  await page.waitForTimeout(4000);
  await page.goto(`/card/${encodeURIComponent(cardToken)}`);
  await page.getByText("Adresse bestätigt.").waitFor();
  await page.getByRole("button", { name: "Test-E-Mail-Marketing aktivieren" }).click();
  await page.getByText("Lokale Test-Marketing-E-Mails aktiviert.", { exact: false }).waitFor();
  const contactStatus = await guest.get(`/api/card/${encodeURIComponent(cardToken)}/contact`);
  assert.equal(contactStatus.status(), 200);
  assert.equal((await contactStatus.json()).marketingEmail, true);
  await page.waitForTimeout(6000);

  preview = await audience();
  assert.equal(preview.status(), 200);
  assert.deepEqual((await preview.json()).eligibleCount, 1);
  const draftResponse = await owner.post("/api/merchant/campaigns", { data: {
    action: "create", programSlug, title: "Synthetischer Dank", subject: "Lokaler Test nach einem Besuch",
    body: "Danke für deinen Besuch. Dies ist ausschließlich eine lokale Testnachricht.", audienceDefinition,
  } });
  assert.equal(draftResponse.status(), 201);
  const { campaign } = await draftResponse.json();
  await page.goto("/merchant/campaigns");
  await page.getByRole("heading", { name: "Kampagnen" }).waitFor();
  await page.getByText("Synthetischer Dank").waitFor();
  await page.screenshot({ path: resolve(output, "platform-after-campaign-draft.png"), fullPage: true });
  await page.waitForTimeout(8000);

  const schedule = await owner.post("/api/merchant/campaigns", { data: { action: "schedule", campaignId: campaign.id, scheduledAt: new Date().toISOString() } });
  assert.equal(schedule.status(), 200);
  await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { cwd: process.cwd(), timeout: 30_000 });
  const detail = await owner.get(`/api/merchant/campaigns/${campaign.id}`);
  assert.equal(detail.status(), 200);
  const result = await detail.json();
  assert.equal(result.campaign.status, "complete");
  assert.equal(result.summary.sent, 1);
  assert.equal(result.summary.suppressed, 0);
  const delivered = await inbox.get("/api/v1/messages");
  const campaignItem = (await delivered.json()).messages.find(message => message.Subject?.includes("Lokaler Test nach einem Besuch") && message.To?.some(to => to.Address === address));
  assert.ok(campaignItem, "Mailpit must capture the scheduled synthetic campaign");
  await page.reload();
  await page.getByText("Synthetischer Dank").waitFor();
  await page.getByRole("button", { name: "Details" }).click();
  await page.getByText("Gesendet", { exact: true }).first().waitFor();
  await page.screenshot({ path: resolve(output, "platform-after-campaign-delivery.png"), fullPage: true });
  await page.waitForTimeout(8000);
  await page.goto(mailpit);
  await page.getByText("Lokaler Test nach einem Besuch").first().waitFor();
  await page.screenshot({ path: resolve(output, "platform-after-mailpit-capture.png"), fullPage: true });
  await page.waitForTimeout(7000);
  const video = page.video();
  await merchant.close();
  merchant = null;
  if (video) {
    const rawVideo = resolve(process.cwd(), "demo/platform-integrated-local.webm");
    await rename(await video.path(), rawVideo);
    await run("ffmpeg", ["-loglevel", "error", "-y", "-i", rawVideo, "-c:v", "libx264", "-preset", "medium", "-crf", "25", "-pix_fmt", "yuv420p", "-movflags", "+faststart", resolve(process.cwd(), "demo/platform-integrated-local.mp4")], { timeout: 60_000 });
    await unlink(rawVideo);
  }
  console.log(JSON.stringify({ result: "PASS", checkoutChangesAudience: true, verifiedSyntheticOptIn: true, mailpitCampaignCaptured: true, screenshots: 3, video: "demo/platform-integrated-local.mp4" }));
} finally {
  if (merchant) await merchant.close();
  if (browser) await browser.close();
  await Promise.all([owner.dispose(), guest.dispose(), inbox.dispose()]);
}
