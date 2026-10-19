import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, expect, test } from "@playwright/test";
import { MASTER, merchantWithTag, pathOf, resetPeerLimits, sql, customerCardNumber, pendingOf } from "./nfc-support";

test.skip(!MASTER, "Synthetic derived NFC server required");
test.beforeEach(resetPeerLimits);

test("first enrollment then restarted browser returns to the original membership, K-number and exactly one later award", async ({ baseURL }) => {
  const m = await merchantWithTag(baseURL!);
  const profile = await mkdtemp(join(tmpdir(), "loynara-returning-"));
  let context = await chromium.launchPersistentContext(profile, { baseURL, channel: "chrome", headless: true });
  try {
    let page = await context.newPage();
    const first = pathOf(m.nextUrl());
    await page.goto(first);
    await expect(page.getByRole("heading", { name: "Deine Karte erstellen" })).toBeVisible();
    await page.getByRole("link", { name: "Karte erstellen", exact: true }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: /Meine Karte erstellen/ }).click();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const number = await customerCardNumber(page);
    const [original] = await sql<{ id: string; card_locator: string }>("SELECT id, card_locator FROM memberships WHERE program_id=$1", [m.me.programId]);
    expect(number).toBe(`K-${original.card_locator}`);
    const pending = await pendingOf(m.cashier);
    expect((await m.cashier.post(`/api/cashier/tap/${pending[0].id}/confirm`)).status()).toBe(200);
    await expect(page.locator(".customer-balance-line strong")).toHaveText(/^1\s*Stempel$/);
    const state = await context.storageState();
    expect(state.cookies.filter(c => c.name.startsWith("loynara_member_")).every(c => c.httpOnly && c.sameSite === "Lax" && c.path === "/api/tap" && c.expires > Date.now()/1000)).toBe(true);
    await context.close();
    context = await chromium.launchPersistentContext(profile, { baseURL, channel: "chrome", headless: true });
    page = await context.newPage();
    // Reusing the old URL after restart never awards again.
    await page.goto(first);
    await expect(page.locator(".customer-balance-line strong")).toHaveText(/^1\s*Stempel$/);
    expect(await pendingOf(m.cashier)).toHaveLength(0);
    const second = pathOf(m.nextUrl());
    await page.goto(second);
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(page)).toBe(number);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const returning = await pendingOf(m.cashier);
    expect(returning).toHaveLength(1);
    expect(returning[0].cardLocator).toBe(number);
    const requests = await sql("SELECT DISTINCT membership_id FROM tap_requests WHERE program_id=$1", [m.me.programId]);
    expect(requests).toEqual([{ membership_id: original.id }]);
    const approvals = await Promise.all([m.cashier.post(`/api/cashier/tap/${returning[0].id}/confirm`), m.owner.post(`/api/cashier/tap/${returning[0].id}/confirm`)]);
    expect(approvals.some(r=>r.status()===200)).toBe(true);
    await expect(page.locator(".customer-balance-line strong")).toHaveText(/^2\s*Stempel$/);
    const rows = await sql("SELECT id, card_locator, balance FROM memberships WHERE program_id=$1", [m.me.programId]);
    expect(rows).toEqual([{ id: original.id, card_locator: original.card_locator, balance: 2 }]);
    expect(await sql("SELECT delta FROM ledger_entries WHERE membership_id=$1 AND kind='award' ORDER BY created_at", [original.id])).toEqual([{ delta: 1 }, { delta: 1 }]);
  } finally { await context.close(); await rm(profile, { recursive: true, force: true }); await m.close(); }
});


test("one browser isolates two merchants and explicitly selects identity after a shared-device account switch", async ({ browser, baseURL }) => {
  test.setTimeout(120_000);
  const a = await merchantWithTag(baseURL!, "Returning A"), b = await merchantWithTag(baseURL!, "Returning B");
  const customer = await browser.newContext({ baseURL });
  const other = await browser.newContext({ baseURL });
  const fresh = await browser.newContext({ baseURL });
  const origin = { Origin: new URL(baseURL!).origin };
  try {
    const enroll = async (context: typeof customer, slug: string) => {
      const response = await context.request.post("/api/enroll", { headers: origin, data: { slug, acceptedTerms: true } });
      expect(response.status()).toBe(201);
      const { cardToken } = await response.json();
      const card = await (await context.request.get(`/api/card/${cardToken}`)).json();
      return { cardToken, cardLocator: card.cardLocator };
    };
    const ca = await enroll(customer, a.me.programSlug), cb = await enroll(customer, b.me.programSlug);
    const secondA = await enroll(other, a.me.programSlug);
    const page = await customer.newPage();
    await page.goto(pathOf(a.nextUrl()));
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(page)).toBe(ca.cardLocator);
    expect(await pendingOf(b.cashier)).toHaveLength(0);
    const pa = await pendingOf(a.cashier);
    expect((await a.cashier.post(`/api/cashier/tap/${pa[0].id}/cancel`)).status()).toBe(200);
    await page.goto(pathOf(b.nextUrl()));
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(page)).toBe(cb.cardLocator);
    expect(await pendingOf(a.cashier)).toHaveLength(0);
    const pb = await pendingOf(b.cashier);
    expect((await b.cashier.post(`/api/cashier/tap/${pb[0].id}/cancel`)).status()).toBe(200);

    // A temporary automatic-binding failure must still lead to the explicit account-switch prompt.
    let failSwitch = true;
    await page.route(`**/api/tap/card/${secondA.cardToken}/session`, async route => {
      const body = route.request().postData();
      if (!body || (body.includes("switchAccount") && failSwitch)) {
        if (body) failSwitch = false;
        await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Browserzugang vorübergehend nicht erreichbar.", code: "UNAVAILABLE" }) });
      } else await route.continue();
    });
    await page.goto(`/card/${secondA.cardToken}`);
    await expect(page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" })).toBeVisible();
    await page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" }).click();
    await expect(page.getByRole("button", { name: "Diese Karte für NFC verwenden" })).toBeVisible();
    const remembered = await (await customer.request.get(`/api/enroll/existing?slug=${a.me.programSlug}`)).json();
    expect(remembered.cardLocator).toBe(ca.cardLocator);
    const binding = page.waitForResponse(r => r.url().includes("/session") && r.status() === 200);
    await page.getByRole("button", { name: "Diese Karte für NFC verwenden" }).click();
    await expect(page.getByText("Browserzugang vorübergehend nicht erreichbar.", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Diese Karte für NFC verwenden" }).click();
    await binding;
    await page.unroute(`**/api/tap/card/${secondA.cardToken}/session`);
    const sharedTap = pathOf(a.nextUrl());
    // A direct API GET/link preview creates no pending request and books no stamp.
    expect((await customer.request.get(sharedTap.replace("/tap/", "/api/tap/"))).status()).toBe(200);
    expect(await pendingOf(a.cashier)).toHaveLength(0);
    expect((await customer.request.post(sharedTap.replace("/tap/", "/api/tap/"), { headers: origin })).status()).toBe(409);
    await page.goto(sharedTap);
    await expect(page.getByRole("heading", { name: "Welche Karte gehört zu diesem Besuch?" })).toBeVisible();
    await expect(page.getByRole("link", { name: `Gespeicherte Karte ${secondA.cardLocator} ansehen` })).toBeVisible();
    expect(await pendingOf(a.cashier)).toHaveLength(0);
    // A second tab/account switch cannot make confirmation of displayed B submit A.
    expect((await customer.request.post(`/api/card/${ca.cardToken}/tap-session`, { headers: origin, data: { switchAccount: true } })).status()).toBe(200);
    await page.getByRole("button", { name: "Mit meiner gespeicherten Karte fortfahren" }).click();
    await expect(page.getByRole("link", { name: `Gespeicherte Karte ${ca.cardLocator} ansehen` })).toBeVisible();
    expect(await pendingOf(a.cashier)).toHaveLength(0);
    // Present the desired private link from the shared prompt: explicit switch resumes the original tap.
    await page.goto(`/card/${secondA.cardToken}`);
    await expect(page.getByRole("button", { name: "Diese Karte für NFC verwenden" })).toBeVisible();
    await page.getByRole("button", { name: "Diese Karte für NFC verwenden" }).click();
    await expect(page.getByRole("heading", { name: "Welche Karte gehört zu diesem Besuch?" })).toBeVisible();
    await expect(page.getByRole("link", { name: `Gespeicherte Karte ${secondA.cardLocator} ansehen` })).toBeVisible();
    await page.getByRole("button", { name: "Mit meiner gespeicherten Karte fortfahren" }).click();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    const shared = await pendingOf(a.cashier);
    expect(shared).toHaveLength(1); expect(shared[0].cardLocator).toBe(secondA.cardLocator);
    expect((await a.cashier.post(`/api/cashier/tap/${shared[0].id}/confirm`)).status()).toBe(200);
    await expect(page.locator(".customer-balance-line strong")).toHaveText(/^1\s*Stempel$/);
    expect((await (await customer.request.get(`/api/card/${ca.cardToken}`)).json()).balance).toBe(0);
    expect((await (await customer.request.get(`/api/card/${cb.cardToken}`)).json()).balance).toBe(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Welche Karte gehört zu diesem Besuch?" })).toBeVisible();
    expect(await pendingOf(a.cashier)).toHaveLength(0);

    // A new phone/browser has no proof until the original private card link is presented.
    const newPhone = await fresh.newPage();
    await newPhone.goto(pathOf(a.nextUrl()));
    await expect(newPhone.getByRole("link", { name: "Karte sicher wiederherstellen" })).toBeVisible();
    expect(await pendingOf(a.cashier)).toHaveLength(0);
    expect((await fresh.request.post(`/api/card/${ca.cardLocator}/tap-session`, { headers: origin })).status()).toBe(404);
    await newPhone.goto(`/card/${ca.cardToken}`);
    await expect(newPhone.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" })).toBeVisible();
    expect(await pendingOf(a.cashier)).toHaveLength(0);
    await newPhone.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" }).click();
    await expect(newPhone.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(newPhone)).toBe(ca.cardLocator);
    expect((await sql("SELECT count(*)::int AS n FROM memberships WHERE program_id=$1", [a.me.programId]))[0].n).toBe(2);
  } finally { await Promise.all([customer.close(), other.close(), fresh.close(), a.close(), b.close()]); }
});


test("expired and cleared browser credentials require recovery and the private link restores the original card", async ({ browser, baseURL }) => {
  const merchant = await merchantWithTag(baseURL!);
  const customer = await browser.newContext({ baseURL });
  const origin = { Origin: new URL(baseURL!).origin };
  try {
    const enrollment = await customer.request.post("/api/enroll", { headers: origin, data: { slug: merchant.me.programSlug, acceptedTerms: true } });
    expect(enrollment.status()).toBe(201);
    const { cardToken } = await enrollment.json();
    const original = (await sql<{ id: string; card_locator: string }>("SELECT id, card_locator FROM memberships WHERE program_id=$1", [merchant.me.programId]))[0];
    const state = await customer.storageState();
    // Keep the browser cookie present but expire its authentic server-issued credential.
    const payload = Buffer.from(JSON.stringify({ token: cardToken, issued: Math.floor(Date.now()/1000) - 91 * 86400, shared: false })).toString("base64url");
    const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!).update("loynara-customer-session-v1\0").update(merchant.me.programId).update("\0").update(payload).digest("base64url");
    await customer.addCookies(state.cookies.filter(c => c.name.startsWith("loynara_")).map(c => ({ ...c, value: `v1.${payload}.${signature}` })));
    const page = await customer.newPage();
    await page.goto(pathOf(merchant.nextUrl()));
    await expect(page.getByRole("heading", { name: "Deine Karte wiederfinden" })).toBeVisible();
    expect(await pendingOf(merchant.cashier)).toHaveLength(0);
    expect((await customer.request.post("/api/enroll", { headers: origin, data: { slug: merchant.me.programSlug, acceptedTerms: true } })).status()).toBe(400);
    await page.goto(`/card/${cardToken}`);
    await expect(page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" })).toBeVisible();
    expect(await pendingOf(merchant.cashier)).toHaveLength(0);
    await page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" }).click();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(page)).toBe(`K-${original.card_locator}`);
    const pending = await pendingOf(merchant.cashier);
    expect(pending).toHaveLength(1);
    expect((await merchant.cashier.post(`/api/cashier/tap/${pending[0].id}/cancel`)).status()).toBe(200);
    await customer.clearCookies();
    await page.goto(pathOf(merchant.nextUrl()));
    await expect(page.getByRole("link", { name: "Karte sicher wiederherstellen" })).toBeVisible();
    expect(await pendingOf(merchant.cashier)).toHaveLength(0);
    await page.goto(`/card/${cardToken}`);
    await expect(page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" })).toBeVisible();
    expect(await pendingOf(merchant.cashier)).toHaveLength(0);
    await page.getByRole("button", { name: "Mit meinem privaten Kartenlink anmelden" }).click();
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(page)).toBe(`K-${original.card_locator}`);
    expect(await sql("SELECT id, card_locator, balance FROM memberships WHERE program_id=$1", [merchant.me.programId])).toEqual([{ id: original.id, card_locator: original.card_locator, balance: 0 }]);
  } finally { await customer.close(); await merchant.close(); }
});


test("legacy path-scoped cookies preserve identity before another private card is opened", async ({ browser, baseURL }) => {
  const m = await merchantWithTag(baseURL!);
  const customer = await browser.newContext({ baseURL });
  const other = await browser.newContext({ baseURL });
  const origin = { Origin: new URL(baseURL!).origin };
  try {
    const join = async (context: typeof customer) => {
      const response = await context.request.post("/api/enroll", { headers: origin, data: { slug: m.me.programSlug, acceptedTerms: true } });
      expect(response.status()).toBe(201);
      return (await response.json()).cardToken as string;
    };
    const a = await join(customer), b = await join(other);
    const aCard = await (await customer.request.get(`/api/card/${a}`)).json();
    await customer.clearCookies();
    const suffix = m.me.programId.replaceAll("-", "");
    await customer.addCookies([
      { name: `loynara_card_${suffix}`, value: a, domain: "localhost", path: "/api/enroll", httpOnly: true, sameSite: "Lax", secure: false, expires: Date.now()/1000 + 86400 },
      { name: `loynara_member_${suffix}`, value: a, domain: "localhost", path: "/api/tap", httpOnly: true, sameSite: "Lax", secure: false, expires: Date.now()/1000 + 86400 },
    ]);
    const page = await customer.newPage();
    await page.goto(`/card/${b}`);
    await expect(page.getByRole("button", { name: "Diese Karte für NFC verwenden" })).toBeVisible();
    expect((await (await customer.request.get(`/api/enroll/existing?slug=${m.me.programSlug}`)).json()).cardLocator).toBe(aCard.cardLocator);
    await page.goto(pathOf(m.nextUrl()));
    await expect(page.getByRole("heading", { name: "Warte auf das Team" })).toBeVisible();
    expect(await customerCardNumber(page)).toBe(aCard.cardLocator);
    expect((await customer.storageState()).cookies.filter(c => c.name === `loynara_card_${suffix}`).map(c=>c.path)).toEqual(["/api"]);
  } finally { await Promise.all([customer.close(), other.close(), m.close()]); }
});
