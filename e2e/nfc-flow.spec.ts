import { randomBytes, randomUUID } from "node:crypto";
import { expect, request as apiRequest, test, type Browser, type BrowserContext } from "@playwright/test";
import pg from "pg";
import { DerivedTapKeyProvider, deriveVerificationKeys, parseMaster } from "../src/lib/nfc-keys";
import { sdmFor, tapUrl } from "../src/lib/nfc-test-support";

// Customer taps the counter tag -> pending request -> cashier confirms -> exactly one stamp -> customer, cashier and owner agree.
// Runs against a server started with NFC_KEY_PROVIDER=derived_v1 and NFC_VERIFY_MASTER_KEY=$E2E_NFC_VERIFY_MASTER (synthetic).
const MASTER = process.env.E2E_NFC_VERIFY_MASTER;
test.skip(!MASTER, "Run only against a server configured with the synthetic derived NFC provider (E2E_NFC_VERIFY_MASTER)");
void DerivedTapKeyProvider;

async function merchantWithTag(baseURL: string) {
  const origin = { Origin: new URL(baseURL).origin };
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "NFC owner", email: `nfc-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const onboard = await owner.post("/api/merchant/onboard", { data: { businessName: "NFC Café", locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "NFC card", programType: "stamp", rulesText: "Ein Stempel je Besuch.", rewardTitle: "Kaffee", rewardCost: 5 } });
  expect(onboard.status()).toBe(201);
  const me = await (await owner.get("/api/me")).json() as { programId: string; tenantId: string; locationId: string; programSlug: string };
  expect((await owner.post("/api/merchant/tap", { data: { action: "policy", programId: me.programId, mode: "staff_confirmed", cooldownSeconds: 1 } })).status()).toBe(200);

  // a cashier of this location
  const cashier = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  const email = `nfc-cashier-${randomUUID()}@example.test`;
  expect((await cashier.post("/api/auth/sign-up/email", { data: { name: "NFC cashier", email, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const invite = await (await owner.post("/api/staff/invite", { data: { locationId: me.locationId, email, role: "cashier" } })).json() as { token: string };
  expect((await cashier.post("/api/staff/accept", { data: { token: invite.token } })).status()).toBe(200);

  // a registered tag (what production registration records), inserted directly because the physical step is out of scope here
  const uid = `04${randomBytes(6).toString("hex")}`, keyRef = `dv1_${randomBytes(9).toString("base64url")}`, publicRef = randomBytes(18).toString("base64url");
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL }); await client.connect();
  await client.query("insert into secure_tags (public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, last_counter, status, activated_at) values ($1,$2,$3,$4,$5,$6,1,0,'active', now())", [publicRef, me.tenantId, me.locationId, me.programId, uid, keyRef]);
  const keys = deriveVerificationKeys(parseMaster(MASTER!), keyRef, uid);
  let counter = 1;
  const nextUrl = () => { counter += 1; return tapUrl(new URL(baseURL).origin, publicRef, sdmFor({ uid, counter, keys })); };
  return { owner, cashier, me, nextUrl, revoke: async () => { await client.query("update secure_tags set status = 'revoked', revoked_at = now() where public_ref = $1", [publicRef]); }, close: async () => { await client.end(); await owner.dispose(); await cashier.dispose(); } };
}

async function customerContext(browser: Browser, baseURL: string): Promise<BrowserContext> { return browser.newContext({ baseURL }); }

test("tap, enroll, wait, cashier confirms, exactly one stamp, calm reload, owner readiness, revoked tag", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url);
  try {
    // owner readiness before any customer
    const ownerCtx = await browser.newContext({ baseURL: url, storageState: await m.owner.storageState() });
    const ownerPage = await ownerCtx.newPage();
    await ownerPage.goto("/merchant/program");
    await expect(ownerPage.getByText("1 aktives NFC-Schild, noch nicht berührt.")).toBeVisible();

    // customer taps with no card: asked to create one, with the existing-card hint
    const customer = await customerContext(browser, url);
    const page = await customer.newPage();
    const tap = new URL(m.nextUrl());
    await page.goto(`${tap.pathname}${tap.search}`);
    await expect(page.getByRole("heading", { name: "Deine Karte erstellen" })).toBeVisible();
    await expect(page.getByText("Du hast schon eine Karte?")).toBeVisible();
    await page.getByRole("link", { name: "Karte erstellen" }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Meine Karte erstellen/ }).click();
    // enrollment returns to the same tap and waits for the cashier
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();

    // cashier sees the request without reloading, confirms once
    const cashierCtx = await browser.newContext({ baseURL: url, storageState: await m.cashier.storageState() });
    const cashierPage = await cashierCtx.newPage();
    await cashierPage.goto("/cashier");
    await expect(cashierPage.getByRole("heading", { name: /NFC-Anfragen/ })).toBeVisible();
    const confirm = cashierPage.getByRole("button", { name: "Einen Stempel bestätigen" });
    await expect(confirm).toBeVisible({ timeout: 15_000 });
    await confirm.dblclick();
    await expect(cashierPage.getByText(/Ein Stempel bestätigt\. Neuer Stand: 1|Diese Anfrage war bereits bestätigt/)).toBeVisible();

    // the waiting customer page updates itself, and a reload is calm
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible({ timeout: 15_000 });
    await page.reload();
    await expect(page.getByRole("heading", { name: "Stempel erhalten" })).toBeVisible();
    await expect(page.getByText("Aktueller Stand: 1 Stempel")).toBeVisible();
    await expect(page.locator("main [role=alert], [role=alert]:not(#__next-route-announcer__):not(:empty)")).toHaveCount(0);   // no error banner (Next's empty route announcer excluded)

    // owner view agrees: one confirmed award
    const stats = await (await m.owner.get("/api/me")).json() as { stats?: { awards: number } };
    expect(stats.stats?.awards).toBe(1);
    await ownerPage.reload();
    await expect(ownerPage.getByText("1 aktives NFC-Schild, bereits benutzt.")).toBeVisible();

    // a later tap inside the cooldown does not queue a second confirmation
    const again = new URL(m.nextUrl());
    await customer.pages()[0].goto(`${again.pathname}${again.search}`);

    // revoked tag: a calm explanation, nothing queued
    await m.revoke();
    const revoked = new URL(m.nextUrl());
    const stranger = await customerContext(browser, url);
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`${revoked.pathname}${revoked.search}`);
    await expect(strangerPage.getByRole("heading", { name: "Dieses Schild ist gerade nicht aktiv" })).toBeVisible();
    await expect(strangerPage.getByText("QR-Code an der Kasse").first()).toBeVisible();
    await expect.poll(async () => (await (await m.cashier.get("/api/cashier/tap/pending")).json() as unknown[]).length).toBe(0);
    await Promise.all([ownerCtx.close(), cashierCtx.close(), customer.close(), stranger.close()]);
  } finally { await m.close(); }
});

test("a returning customer whose browser lost the binding opens the saved card and the tap continues", async ({ baseURL, browser }) => {
  const url = baseURL ?? "http://localhost:3000";
  const m = await merchantWithTag(url);
  try {
    const guest = await apiRequest.newContext({ baseURL: url, extraHTTPHeaders: { Origin: new URL(url).origin } });
    const joined = await guest.post("/api/enroll", { data: { slug: m.me.programSlug, acceptedTerms: true, marketingOptIn: false } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };

    const fresh = await customerContext(browser, url);   // new browser profile: no cookie
    const page = await fresh.newPage();
    const tap = new URL(m.nextUrl());
    await page.goto(`${tap.pathname}${tap.search}`);
    await expect(page.getByRole("heading", { name: "Deine Karte erstellen" })).toBeVisible();
    await page.goto(`/card/${encodeURIComponent(cardToken)}`);                 // same tab, saved link
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible({ timeout: 20_000 });
    await expect.poll(async () => (await (await m.cashier.get("/api/cashier/tap/pending")).json() as unknown[]).length).toBe(1);
    await guest.dispose(); await fresh.close();
  } finally { await m.close(); }
});
