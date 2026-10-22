import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { pool } from "../src/db";
import { award, reverseEntry } from "../src/lib/loyalty";
import { getMerchantAdvice } from "../src/lib/adviser";
const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) || database.port !== "55433" || database.pathname !== "/looplocal_browser_qr_089") throw new Error("Dedicated synthetic advice database required");
const origin = "http://localhost:3000";
test.afterAll(async () => { await pool.end(); });
test("actual adviser reflects duplicate, legitimate reversal and established 30/90-day windows", async ({ browser, baseURL }) => {
  expect(baseURL).toBe(origin); const owner = await browser.newContext({ baseURL }), foreign = await browser.newContext({ baseURL });
  try {
    const fixtures = [];
    for (const context of [owner, foreign]) {
      const id = randomUUID(); const signup = await context.request.post("/api/auth/sign-up/email", { headers: { Origin: origin }, data: { name: "Synthetic advice owner", email: `${id}@example.test`, password: "Synthetic-Advice-089-Only!" } }); expect(signup.ok()).toBe(true); const { user } = await signup.json();
      const setup = await context.request.post("/api/merchant/onboard", { headers: { Origin: origin }, data: { businessName: `Synthetic advice ${id}`, city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic advice card", programType: "stamp", rulesText: "One confirmed purchase", rewardTitle: "Coffee", rewardCost: 5 } }); expect(setup.status()).toBe(201); const merchant = await setup.json();
      const enrolled = await context.request.post("/api/enroll", { headers: { Origin: origin }, data: { slug: merchant.programSlug, acceptedTerms: true } }); expect(enrolled.status()).toBe(201); const { cardToken } = await enrolled.json(); const membership = (await pool.query("SELECT id FROM memberships WHERE tenant_id=$1 AND card_token=$2", [merchant.tenantId, cardToken])).rows[0].id;
      fixtures.push({ ...merchant, user: user.id, membership });
    }
    const [a, b] = fixtures;
    const read = async (context: typeof owner, days = 30) => { const response = await context.request.get(`/api/merchant/adviser?window=${days}`); expect(response.status()).toBe(200); return response.json(); };
    const page = await owner.newPage(); await page.goto("/merchant/adviser"); await expect(page.getByRole("heading", { name: "Erste Buchung testen", exact: true })).toBeVisible();
    const request = { userId: a.user, locationId: a.locationId, membershipId: a.membership, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() };
    const first = await award(request); expect((await award(request)).duplicate).toBe(true); let advice = await read(owner); expect(advice.metrics.qualifyingCheckouts).toBe(1); expect(advice.recommendations.map((r: { id: string }) => r.id)).not.toContain("checkout_flow"); await page.reload(); await expect(page.getByRole("heading", { name: "Erste Buchung testen", exact: true })).toHaveCount(0);
    const correction = { userId: a.user, locationId: a.locationId, entryId: first.entryId, reason: "Synthetic authorized correction", idempotencyKey: randomUUID(), requestId: randomUUID() }; await reverseEntry(correction); expect((await reverseEntry(correction)).duplicate).toBe(true);
    advice = await read(owner); expect(advice.metrics.qualifyingCheckouts).toBe(0); expect(advice.recommendations.map((r: { id: string }) => r.id)).toContain("checkout_flow"); await page.reload(); await expect(page.getByRole("heading", { name: "Erste Buchung testen", exact: true })).toBeVisible();
    await award({ ...request, idempotencyKey: randomUUID(), requestId: randomUUID() });
    // Read the same immutable ledger at an explicit future report time; never rewrite ledger timestamps.
    const future = new Date(Date.now() + 45 * 86_400_000);
    expect((await getMerchantAdvice(a.user, { windowDays: 30, asOf: future })).metrics.qualifyingCheckouts).toBe(0);
    expect((await getMerchantAdvice(a.user, { windowDays: 90, asOf: future })).metrics.qualifyingCheckouts).toBe(1);
    for (const days of ["90", "30"]) { await page.getByLabel("Zeitraum", { exact: true }).selectOption(days); await expect(page.getByRole("heading", { name: "Erste Buchung testen", exact: true })).toHaveCount(0); expect((await read(owner, Number(days))).metrics.qualifyingCheckouts).toBe(1); }
    const other = await read(foreign); expect(other.metrics).toMatchObject({ currentActiveCards: 1, qualifyingCheckouts: 0 }); expect(other.recommendations.map((r: { id: string }) => r.id)).toContain("checkout_flow"); expect(JSON.stringify(other)).not.toContain(a.membership); expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE tenant_id=$1", [b.tenantId])).rows[0].n).toBe(0);
    const anonymous = await browser.newContext({ baseURL }); try { expect((await anonymous.request.get("/api/merchant/adviser")).status()).toBe(401); } finally { await anonymous.close(); }
  } finally { await owner.close(); await foreign.close(); }
});
