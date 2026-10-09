import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, request as apiRequest, type APIRequestContext, type Browser, type BrowserContext, type Page } from "@playwright/test";
import dotenv from "dotenv";
import pg from "pg";
import QRCode from "qrcode";
import { deriveVerificationKeys, parseMaster, type TapKeys } from "../src/lib/nfc-keys";
import { sdmFor, tapUrl } from "../src/lib/nfc-test-support";

/** Shared helpers for the NFC browser specs. Synthetic data only; every database call stays on the isolated test database. */

export const MASTER = process.env.E2E_NFC_VERIFY_MASTER;
export const K_NUMBER = /K-[A-Z2-9]{6}/;

const DATABASE_URL = process.env.DATABASE_URL ?? "";

function assertIsolatedDatabase() {
  // The NFC specs write and rewrite rows directly (expiry, rate-limit reset). Refuse anything but the isolated worktree database.
  const url = new URL(DATABASE_URL);
  if (!["localhost", "127.0.0.1"].includes(url.hostname) || !["54395", "54429", "54439"].includes(url.port) || url.pathname !== "/looplocal" || url.username !== "looplocal") throw new Error("Refusing database work outside the isolated NFC test database");
}

/** One short-lived client per statement: the specs only need a handful of assertions and updates. */
export async function sql<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  assertIsolatedDatabase();
  const client = new pg.Client({ connectionString: DATABASE_URL });
  await client.connect();
  try { return (await client.query<T>(text, params)).rows; }
  finally { await client.end(); }
}

// Every request reaches the server through one peer bucket ("untrusted-peer" in local runs), so the tap and enrolment
// limits are shared by all tests in a file. This is the same reset the per-file runner (.review/e2e-files.mjs) performs,
// applied before each test so a long file does not exhaust the bucket on its own.
const PEER_SCOPES = ["auth_signup_peer", "auth_signin_peer", "enroll_peer", "card_read_peer", "card_contact_peer", "tap_bind_peer", "card_export_peer", "merchant_locations_read_peer", "merchant_locations_create_peer", "enroll_existing_peer", "enroll_open_peer", "tap_peer", "push_subscribe_user", "cashier_lookup_peer", "qr_render_peer"];

export async function resetPeerLimits() {
  const secret = process.env.BETTER_AUTH_SECRET ?? dotenv.parse(readFileSync(path.resolve(process.cwd(), ".env"))).BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is needed to reset the peer rate limits");
  const hashes = PEER_SCOPES.map(scope => createHmac("sha256", secret).update(scope).update("\0").update("untrusted-peer").digest("hex"));
  await sql("DELETE FROM rate_limits WHERE key_hash = ANY($1::text[])", [hashes]);
}

/** A merchant with an owner, one invited cashier of its only location, and one registered counter tag (staff-confirmed taps). */
export async function merchantWithTag(baseURL: string, businessName = "NFC Café") {
  // Compiled apps retain Better Auth's rolling 3-signup/10s limit. Optional local harness pacing respects it,
  // including tests that construct two merchants; it never changes application limits or trusts an invented peer.
  if (process.env.E2E_AUTH_SETUP_GAP_MS === "11000") await new Promise(resolve => setTimeout(resolve, 11_000));
  const origin = { Origin: new URL(baseURL).origin };
  const owner = await apiRequest.newContext({ baseURL, extraHTTPHeaders: origin });
  expect((await owner.post("/api/auth/sign-up/email", { data: { name: "NFC owner", email: `nfc-owner-${randomUUID()}@example.test`, password: `Local!${randomUUID()}Aa` } })).status()).toBe(200);
  const onboard = await owner.post("/api/merchant/onboard", { data: { businessName, locationName: "Erster Standort", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "NFC card", programType: "stamp", rulesText: "Ein Stempel je Besuch.", rewardTitle: "Kaffee", rewardCost: 5 } });
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
  await sql("insert into secure_tags (public_ref, tenant_id, location_id, program_id, uid, key_ref, config_version, last_counter, status, activated_at) values ($1,$2,$3,$4,$5,$6,1,0,'active', now())", [publicRef, me.tenantId, me.locationId, me.programId, uid, keyRef]);
  const keys: TapKeys = deriveVerificationKeys(parseMaster(MASTER!), keyRef, uid);
  let counter = 1;
  /** A fresh signed tap URL: each call is a new physical tap with the next counter. */
  const nextUrl = () => { counter += 1; return tapUrl(new URL(baseURL).origin, publicRef, sdmFor({ uid, counter, keys })); };
  return {
    owner, cashier, me, publicRef,
    nextUrl,
    revoke: async () => { await sql("update secure_tags set status = 'revoked', revoked_at = now() where public_ref = $1", [publicRef]); },
    /** Every tap request this programme ever created, oldest first. */
    requests: () => sql<{ id: string; status: string; expires_at: Date }>("select id, status, expires_at from tap_requests where program_id = $1 order by created_at", [me.programId]),
    close: async () => { await owner.dispose(); await cashier.dispose(); },
  };
}

/** The tap URL as a path the browser can open. */
export function pathOf(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

/**
 * A guest card enrolled through the API, with its browser context already bound to the programme's tap cookie
 * (the same cookie a real enrolment sets), so a tap on the counter continues on that card without any form.
 */
export async function customerWithCard(browser: Browser, baseURL: string, programSlug: string) {
  const guest = await apiRequest.newContext({ baseURL, extraHTTPHeaders: { Origin: new URL(baseURL).origin } });
  try {
    const joined = await guest.post("/api/enroll", { data: { slug: programSlug, acceptedTerms: true } });
    expect(joined.status()).toBe(201);
    const { cardToken } = await joined.json() as { cardToken: string };
    const card = await (await guest.get(`/api/card/${encodeURIComponent(cardToken)}`)).json() as { scanCode: string; cardLocator: string };
    const cardLocator = K_NUMBER.exec(card.cardLocator)?.[0];
    if (!cardLocator) throw new Error("card API returned no K-number");
    const context = await browser.newContext({ baseURL, storageState: await guest.storageState() });
    return { context, cardToken, scanCode: card.scanCode, cardLocator };
  } finally { await guest.dispose(); }
}

/** A signed-in staff member in a browser of their own (separate cookie jar per person). */
export async function staffContext(browser: Browser, baseURL: string, api: APIRequestContext): Promise<BrowserContext> {
  return browser.newContext({ baseURL, storageState: await api.storageState() });
}

/** The K-number on the customer's waiting screen. */
export async function customerCardNumber(page: Page): Promise<string> {
  const line = page.locator("p", { hasText: "Deine Kartennummer" });
  await expect(line).toContainText(K_NUMBER);
  return (await line.innerText()).match(K_NUMBER)![0];
}

export async function balanceOf(baseURL: string, cardToken: string) {
  const reader = await apiRequest.newContext({ baseURL });
  try { return ((await (await reader.get(`/api/card/${encodeURIComponent(cardToken)}`)).json()) as { balance: number }).balance; }
  finally { await reader.dispose(); }
}

/** Ledger rows written for one card, read straight from the database. */
export async function ledgerRowsFor(cardToken: string) {
  const rows = await sql<{ n: number }>("select count(*)::int as n from ledger_entries le join memberships m on m.id = le.membership_id where m.card_token = $1", [cardToken]);
  return rows[0].n;
}

/** The cashier's open NFC list as the API returns it. */
export async function pendingOf(api: APIRequestContext) {
  const response = await api.get("/api/cashier/tap/pending");
  expect(response.status()).toBe(200);
  return await response.json() as Array<{ id: string; createdAt: string; expiresAt: string; balance: number; cardLocator: string }>;
}

/** Fails if the page shows a credential-looking value (scan code or card token), by pattern or by the card's exact values. */
export async function expectNoCredentials(page: Page, card: { scanCode: string; cardToken: string }) {
  const html = await page.content();
  expect(html).not.toContain(card.scanCode);
  expect(html).not.toContain(card.cardToken);
  const text = await page.locator("body").innerText();
  expect(text).not.toMatch(/(^|[^A-Za-z0-9])(sc|card)_/);
}

/** Replaces the camera with a canvas stream; window.__showQr(dataUrl) puts a code in view, window.__showQr(null) clears it. */
export async function fakeCamera(context: BrowserContext) {
  await context.addInitScript(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext("2d")!;
    let image: HTMLImageElement | null = null;
    const draw = () => {
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (image) ctx.drawImage(image, 170, 90, 300, 300);
    };
    setInterval(draw, 80);
    const fake = { getUserMedia: async () => canvas.captureStream(15) };
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: fake });
    (window as unknown as { __showQr: (url: string | null) => Promise<void> }).__showQr = url => new Promise(resolve => {
      if (!url) { image = null; draw(); resolve(); return; }
      const next = new Image();
      next.onload = () => { image = next; draw(); resolve(); };
      next.src = url;
    });
  });
}

export async function showQr(page: Page, value: string | null) {
  const url = value ? await QRCode.toDataURL(value, { margin: 2, width: 300 }) : null;
  await page.evaluate(next => (window as unknown as { __showQr: (url: string | null) => Promise<void> }).__showQr(next), url);
}
