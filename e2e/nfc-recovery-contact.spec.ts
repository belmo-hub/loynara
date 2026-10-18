import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { MASTER, merchantWithTag, pathOf, resetPeerLimits, sql, customerCardNumber, pendingOf } from "./nfc-support";
const execute = promisify(execFile);
const recoveryOrigin = process.env.PUBLIC_BASE_URL ?? "http://localhost:3049";
const capture = process.env.E2E_RECOVERY_MAILPIT;
test.skip(!MASTER || !["http://127.0.0.1:18149", "http://127.0.0.1:18159"].includes(capture ?? ""), "Explicit isolated NFC/Mailpit server required");
test.use({ actionTimeout: 10_000 });
test.beforeEach(resetPeerLimits);
async function worker() {
  await execute("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { timeout: 30_000, env: { ...process.env, NODE_ENV: "development", SMTP_HOST: "localhost", MAILPIT_HTTP_ORIGIN: capture!, PUBLIC_BASE_URL: recoveryOrigin, EXTERNAL_EMAIL_ENABLED: "false", TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false", PASSFAST_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false", APPLE_WALLET_ENABLED: "false" } });
}
async function deliveredLink(recipient: string, path: string) {
  await worker();
  const listing = await (await fetch(`${capture}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`)).json();
  for (const mail of listing.messages) {
    const body = await (await fetch(`${capture}/api/v1/message/${mail.ID}`)).json();
    if (!body.To.some((to: { Address: string }) => to.Address === recipient)) continue;
    const link = body.Text.match(new RegExp(`${recoveryOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${path}#token=[A-Za-z0-9_-]+`));
    if (link) return link[0] as string;
  }
  throw new Error("Expected synthetic recovery message missing from isolated Mailpit capture");
}

test("real isolated email delivery verifies recovery contact and restores original cards on cleared and new devices", async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  const a = await merchantWithTag(baseURL!, "Recovery A"), b = await merchantWithTag(baseURL!, "Recovery B");
  const customer = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
  const verifier = await browser.newContext({ baseURL });
  const newDevice = await browser.newContext({ baseURL, viewport: { width: 375, height: 667 } });
  const origin = { Origin: new URL(baseURL!).origin };
  const email = `holder-${randomUUID()}@example.test`;
  try {
    const page = await customer.newPage();
    await page.goto(pathOf(a.nextUrl()));
    await page.getByRole("link", { name: "Karte erstellen", exact: true }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Meine Karte erstellen/ }).click();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const number = await customerCardNumber(page);
    const [original] = await sql<{ id: string; card_token: string; scan_code: string; card_locator: string }>("SELECT id,card_token,scan_code,card_locator FROM memberships WHERE program_id=$1", [a.me.programId]);
    // Setup is offered after enrollment; the cashier request already exists and earning is not gated.
    const setup = page.getByRole("region", { name: "Karte sichern" });
    await expect(setup).toBeVisible();
    await expect(setup.getByText(/Ohne bestätigte Wiederherstellungsadresse/)).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await setup.getByRole("button", { name: "Später", exact: true }).click();
    await expect(setup.getByRole("textbox", { name: "E-Mail-Adresse" })).toHaveCount(0);
    await expect(setup.getByText(/Ohne bestätigte Wiederherstellungsadresse/)).toBeVisible();
    await setup.getByRole("button", { name: "Wiederherstellung einrichten", exact: true }).click();
    await setup.getByRole("textbox", { name: "E-Mail-Adresse" }).fill(email);
    await setup.getByRole("button", { name: "Bestätigungslink senden" }).click();
    await expect(setup.getByText(/Bestätigungslink angefordert/)).toBeVisible();
    const verification = await deliveredLink(email, "/verify-email");
    const verificationPage = await verifier.newPage();
    await verificationPage.goto(verification);
    expect((await sql("SELECT email_verified FROM membership_contacts WHERE membership_id=$1", [original.id]))[0].email_verified).toBe(false);
    await verificationPage.getByRole("button", { name: "E-Mail-Adresse bestätigen", exact: true }).click();
    await expect(verificationPage.getByRole("heading", { name: "E-Mail bestätigt." })).toBeVisible();
    const verifyToken = new URLSearchParams(new URL(verification).hash.slice(1)).get("token");
    expect((await verifier.request.post("/api/contact/verify", { headers: origin, data: { token: verifyToken } })).status()).toBe(400);
    const pending = await pendingOf(a.cashier);
    expect(pending).toHaveLength(1);
    expect((await a.cashier.post(`/api/cashier/tap/${pending[0].id}/confirm`)).status()).toBe(200);
    await expect(page.locator(".customer-balance-line strong")).toHaveText(/^1\s*Stempel$/);
    const before = await (await customer.request.get(`/api/card/${original.card_token}`)).json();
    const passId = randomUUID(), passObject = `passfast:synthetic_recovery_${passId}`;
    await sql("INSERT INTO wallet_passes (id,tenant_id,membership_id,provider,provider_object_id,status,credential_hash) VALUES ($1,$2,$3,'apple',$4,'active',$5)", [passId,a.me.tenantId,original.id,passObject,createHash("sha256").update(original.scan_code).digest("hex")]);
    // Cleared cookies: the actual delivered link is the independent proof. A K-number cannot recover.
    await customer.clearCookies();
    await page.goto("/recover");
    await page.getByRole("textbox", { name: "Bestätigte E-Mail-Adresse" }).fill(email);
    await page.getByRole("button", { name: "Link anfordern" }).click();
    await expect(page.getByRole("status")).toHaveText(/Wenn zu dieser Adresse/);
    const recoveredLink = await deliveredLink(email, "/recover/confirm");
    await page.goto(recoveredLink);
    await page.getByRole("button", { name: "Meine Karten anzeigen" }).click();
    let bindingFailed = false;
    await page.route("**/api/tap/card/*/session", async route => {
      if (!bindingFailed) { bindingFailed = true; await route.abort("failed"); }
      else await route.continue();
    });
    await page.getByRole("button", { name: "Diese Karte wiederherstellen" }).click();
    await expect(page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" })).toBeVisible();
    await page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" }).click();
    expect(bindingFailed).toBe(true);
    await expect(page.locator(".customer-card-number strong")).toHaveText(number);
    expect((await customer.request.get(`/api/card/${original.card_token}`)).status()).toBe(404);
    const restoredToken = new URL(page.url()).pathname.split("/").pop()!;
    const restored = await (await customer.request.get(`/api/card/${restoredToken}`)).json();
    expect(restored.balance).toBe(1); expect(restored.rewards).toEqual(before.rewards); expect(restored.activity).toEqual(before.activity);
    expect((await sql("SELECT id,card_locator,scan_code FROM memberships WHERE program_id=$1", [a.me.programId]))).toEqual([{ id: original.id,card_locator:original.card_locator,scan_code:original.scan_code }]);
    expect(await sql("SELECT id,provider_object_id,revoked_at FROM wallet_passes WHERE membership_id=$1", [original.id])).toEqual([{ id:passId,provider_object_id:passObject,revoked_at:null }]);
    // The same verified inbox can recover separate merchant memberships only through explicit selection.
    const second = await customer.request.post("/api/enroll", { headers: origin, data: { slug:b.me.programSlug,acceptedTerms:true } });
    expect(second.status()).toBe(201);
    const { cardToken: secondToken } = await second.json();
    await page.goto(`/card/${secondToken}`);
    const secondSetup = page.getByRole("region", { name: "Karte sichern" });
    await secondSetup.getByRole("textbox", { name:"E-Mail-Adresse" }).fill(email);
    await secondSetup.getByRole("button", { name:"Bestätigungslink senden" }).click();
    await expect(secondSetup.getByText(/Bestätigungslink angefordert/)).toBeVisible();
    await verificationPage.goto(await deliveredLink(email,"/verify-email"));
    await verificationPage.getByRole("button", { name:"E-Mail-Adresse bestätigen",exact:true }).click();
    await expect(verificationPage.getByRole("heading", { name:"E-Mail bestätigt." })).toBeVisible();
    const fresh = await newDevice.newPage();
    await fresh.goto("/recover");
    await fresh.getByRole("textbox", { name:"Bestätigte E-Mail-Adresse" }).fill(email);
    await fresh.getByRole("button", { name:"Link anfordern" }).click();
    await expect(fresh.getByRole("status")).toHaveText(/Wenn zu dieser Adresse/);
    const newLink = await deliveredLink(email,"/recover/confirm");
    const recoveryToken = new URLSearchParams(new URL(newLink).hash.slice(1)).get("token");
    expect((await newDevice.request.post("/api/recover/confirm", { headers:origin,data:{action:"rotate",token:number,membershipId:original.id} })).status()).toBe(400);
    expect((await newDevice.request.post("/api/recover/confirm", { headers:origin,data:{action:"rotate",token:recoveryToken,membershipId:randomUUID()} })).status()).toBe(400);
    await fresh.goto(newLink);
    await fresh.getByRole("button", { name:"Meine Karten anzeigen" }).click();
    await expect(fresh.getByRole("button", { name:"Diese Karte wiederherstellen" })).toHaveCount(2);
    await fresh.locator(".recovery-options > div").filter({hasText:"Recovery A"}).getByRole("button").click();
    await expect(fresh.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" })).toBeVisible();
    await fresh.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" }).click();
    await expect(fresh.locator(".customer-card-number strong")).toHaveText(number);
    expect((await newDevice.request.post("/api/recover/confirm", { headers:origin,data:{action:"rotate",token:recoveryToken,membershipId:original.id} })).status()).toBe(400);
    await fresh.goto(pathOf(a.nextUrl()));
    await expect(fresh.getByRole("heading", { name:"Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(fresh)).toBe(number);
    const returning=await pendingOf(a.cashier);
    const approvals=await Promise.all([a.cashier.post(`/api/cashier/tap/${returning[0].id}/confirm`),a.owner.post(`/api/cashier/tap/${returning[0].id}/confirm`)]);
    expect(approvals.every(r=>r.status()===200)).toBe(true);
    await expect(fresh.locator(".customer-balance-line strong")).toHaveText(/^2\s*Stempel$/);
    expect(await sql("SELECT delta FROM ledger_entries WHERE membership_id=$1 AND kind='award' ORDER BY created_at",[original.id])).toEqual([{delta:1},{delta:1}]);
    expect(await sql("SELECT id,provider_object_id,revoked_at FROM wallet_passes WHERE membership_id=$1",[original.id])).toEqual([{id:passId,provider_object_id:passObject,revoked_at:null}]);
    expect((await sql("SELECT count(*)::int AS n FROM memberships WHERE program_id=ANY($1::uuid[])",[[a.me.programId,b.me.programId]]))[0].n).toBe(2);
    expect((await sql("SELECT count(*)::int AS n FROM consent_events WHERE membership_id=ANY($1::uuid[]) AND purpose='marketing' AND granted=true",[[original.id,(await sql("SELECT id FROM memberships WHERE program_id=$1",[b.me.programId]))[0].id]]))[0].n).toBe(0);
    const unknown=await newDevice.request.post("/api/recover",{headers:origin,data:{email:`unknown-${randomUUID()}@example.test`}});
    const known=await newDevice.request.post("/api/recover",{headers:origin,data:{email}});
    expect(await known.json()).toEqual(await unknown.json());
    expect((await newDevice.request.post("/api/recover",{headers:origin,data:{email}})).status()).toBe(429);
  } finally {await Promise.all([customer.close(),verifier.close(),newDevice.close(),a.close(),b.close()]);}
});
