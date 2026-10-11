import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { auth } from "../src/lib/auth";
import { db, pool } from "../src/db";
import { membershipContacts } from "../src/db/schema";
import { createMerchant, enroll } from "../src/lib/product";
import { award } from "../src/lib/loyalty";

const target = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || target.hostname !== "localhost" || target.port !== "55433"
  || !/^\/looplocal_contact_export_112_[a-f0-9]{12}$/.test(target.pathname)) throw new Error("Unique owned disposable database required");
const origin = "http://localhost:3000";
let cards: Array<Awaited<ReturnType<typeof enroll>>>;
const canaries = [0, 1].map(index => ({ email: `contact-canary-${index}-${randomUUID()}@example.test`, hash: randomUUID().replaceAll("-", "").repeat(2) }));
test.beforeAll(async ({ baseURL }) => {
  expect(baseURL).toBe(origin);
  expect((await pool.query("SHOW data_directory")).rows[0].data_directory).toBe("/private/tmp/loynara-goal-133-pg");
  expect((await pool.query("SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations")).rows[0].count).toBe(25);
  cards = [];
  for (let index = 0; index < 2; index++) {
    const user = (await auth.api.signUpEmail({ body: { name: "Synthetic export owner", email: `export-owner-${randomUUID()}@example.test`, password: `Synthetic!${randomUUID()}Aa` } })).user;
    const merchant = await createMerchant({ userId: user.id, businessName: `Synthetic export merchant ${index}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic card", programType: "stamp", rulesText: "Synthetic approved checkout", rewardTitle: "Synthetic reward", rewardCost: 5 });
    const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
    cards.push(card);
    await award({ userId: user.id, locationId: merchant.locationId, membershipId: card.id, quantity: index + 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    // Established contact schema, synthetic fixture only; no delivery, verification or recovery request is executed.
    await db.insert(membershipContacts).values({ tenantId: merchant.tenantId, membershipId: card.id, email: canaries[index].email, emailVerified: true, recoveryTokenHash: canaries[index].hash });
    const persisted = (await pool.query("SELECT email,email_verified,recovery_token_hash FROM membership_contacts WHERE tenant_id=$1 AND membership_id=$2", [merchant.tenantId, card.id])).rows[0];
    expect(persisted).toEqual({ email: canaries[index].email, email_verified: true, recovery_token_hash: canaries[index].hash });
  }
});
test.afterAll(async () => { await pool.end(); });
function checkArtifact(exported: unknown, index: number) {
  expect(exported).toMatchObject({ formatVersion: 1, scope: "pseudonymous-card-activity-without-contact-records", membership: { id: cards[index].id, balance: index + 2 }, ledger: [{ delta: index + 2 }], redemptions: [], consentEvents: [] });
  expect(Object.keys(exported as object).sort()).toEqual(["formatVersion", "exportedAt", "scope", "membership", "program", "ledger", "redemptions", "consentEvents"].sort());
  const text = JSON.stringify(exported);
  for (const canary of canaries) { expect(text).not.toContain(canary.email); expect(text).not.toContain(canary.hash); }
  for (const excluded of [cards[1 - index].id, ...cards.flatMap(card => [card.cardToken, card.scanCode])]) expect(text).not.toContain(excluded);
  function checkFields(value: unknown) {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      expect(["email", "emailVerified", "email_verified", "recoveryTokenHash", "recovery_token_hash", "membershipContacts", "membership_contacts"]).not.toContain(key);
      checkFields(child);
    }
  }
  checkFields(exported);
}
test("actual narrow download excludes populated contact records and isolates a foreign bearer after failure/retry", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 900 }, acceptDownloads: true });
  const page = await context.newPage();
  const endpoint = `/api/card/${cards[0].cardToken}/export`;
  const downloads: string[] = [];
  page.on("download", download => downloads.push(download.suggestedFilename()));
  try {
    await page.goto(`/card/${cards[0].cardToken}`);
    const link = page.getByRole("link", { name: "Meine Kartendaten exportieren", exact: true });
    await expect(link).toBeVisible();
    await page.route(`**${endpoint}`, route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Synthetic temporary export failure" }) }));
    await link.click();
    await expect(page.getByRole("alert").filter({ hasText: "Der Export ist gerade nicht verfügbar" })).toBeVisible();
    expect(downloads).toEqual([]);
    await expect(link).not.toHaveAttribute("aria-disabled", "true");
    await page.unroute(`**${endpoint}`);
    const event = page.waitForEvent("download");
    await link.click();
    const download = await event;
    expect(download.suggestedFilename()).toBe("loynara-card-export.json");
    checkArtifact(JSON.parse(await readFile((await download.path())!, "utf8")), 0);
    expect(downloads).toEqual(["loynara-card-export.json"]);
    const foreign = await context.request.get(`/api/card/${cards[1].cardToken}/export`);
    expect(foreign.status()).toBe(200);
    checkArtifact(await foreign.json(), 1);
    expect((await context.request.get(`/api/card/${randomUUID()}/export`)).status()).toBe(404);
    await expect(page.getByRole("alert").filter({ hasText: "Der Export" })).toHaveCount(0);
    // Only generic success/status UI; do not retain screenshots containing contact canaries or private links.
  } finally { await context.close(); }
});
