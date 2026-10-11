import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { db, pool } from "../src/db";
import { membershipContacts } from "../src/db/schema";
import { nfcFixture } from "../src/lib/nfc-test-db";
import { award } from "../src/lib/loyalty";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.port !== "55433" || !["/looplocal_browser_recovery_065a", "/looplocal_browser_recovery_065b"].includes(database.pathname)) throw new Error("Dedicated synthetic recovery database required");
test.afterAll(async () => { await pool.end(); });

for (const width of [375, 1280]) for (const failure of ["input", "server", "network"] as const) {
  test(`recovery request retains private retry state after ${failure} failure (${width}px)`, async ({ browser, baseURL }) => {
    if (baseURL !== "http://localhost:3000") throw new Error("Synthetic loopback application required");
    const own = await nfcFixture({ tapMode: "disabled" });
    const foreign = await nfcFixture({ tapMode: "disabled" });
    await award({ userId: own.userId, locationId: own.location.id, membershipId: own.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await award({ userId: foreign.userId, locationId: foreign.location.id, membershipId: foreign.member.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const email = `recover-${randomUUID()}@example.test`;
    await db.insert(membershipContacts).values({ tenantId: own.tenant.id, membershipId: own.member.id, email, emailVerified: true });
    const snapshot = async () => ({
      members: (await pool.query("SELECT id,card_token,scan_code,closed_at FROM memberships WHERE id=ANY($1::uuid[]) ORDER BY id", [[own.member.id, foreign.member.id]])).rows,
      ledger: (await pool.query("SELECT membership_id,kind,delta FROM ledger_entries WHERE membership_id=ANY($1::uuid[]) ORDER BY membership_id,id", [[own.member.id, foreign.member.id]])).rows,
      consent: (await pool.query("SELECT * FROM consent_events WHERE membership_id=ANY($1::uuid[]) ORDER BY id", [[own.member.id, foreign.member.id]])).rows,
    });
    const before = await snapshot();
    const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } });
    let trigger = false;
    try {
      const page = await context.newPage(); let requests = 0;
      page.on("request", request => { if (new URL(request.url()).pathname === "/api/recover") requests++; });
      await page.goto("/recover");
      const field = page.getByRole("textbox", { name: "Bestätigte E-Mail-Adresse" });
      const attempted = failure === "input" ? `recover-${randomUUID()}@invalid` : email;
      await field.fill(attempted);
      if (failure === "server") {
        // Fault injection only in this disposable database: actual route receives a
        // late PostgreSQL rejection and must return its real safe HTTP500 response.
        await pool.query("CREATE FUNCTION test_recovery_065_unavailable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic private unavailable diagnostic'; END; $$");
        await pool.query("CREATE TRIGGER test_recovery_065_unavailable BEFORE INSERT ON card_recovery_challenges FOR EACH ROW EXECUTE FUNCTION test_recovery_065_unavailable()");
        trigger = true;
      }
      if (failure === "network") await page.route("**/api/recover", route => route.abort("connectionreset"));
      const response = failure === "network" ? null : page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover");
      await page.getByRole("button", { name: "Link anfordern", exact: true }).click();
      if (response) {
        const rejection = await response;
        expect(rejection.status()).toBe(failure === "input" ? 400 : 500);
        expect(await rejection.json()).toMatchObject({ error: failure === "input" ? "Invalid input" : "Internal error" });
      }
      const feedback = page.locator(".card-state-page p[role=alert]");
      await expect(feedback).toContainText(failure === "input" ? "gültige E-Mail-Adresse" : "nicht bestätigt");
      if (failure === "network") await expect(feedback).toContainText("Postfach");
      await expect(page.getByRole("status")).toHaveCount(0);
      await expect(field).toHaveValue(attempted);
      await expect(page.getByRole("button", { name: "Link anfordern", exact: true })).toBeEnabled();
      expect(await feedback.innerText()).not.toMatch(/Internal error|Invalid input|Synthetic private|card_/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      expect(requests).toBe(1);
      expect(await snapshot()).toEqual(before);
      expect((await pool.query("SELECT count(*)::int AS n FROM card_recovery_challenges WHERE email=$1", [email])).rows[0].n).toBe(0);
      if (trigger) {
        await pool.query("DROP TRIGGER test_recovery_065_unavailable ON card_recovery_challenges");
        await pool.query("DROP FUNCTION test_recovery_065_unavailable()"); trigger = false;
      }
      if (failure === "network") await page.unroute("**/api/recover");
      await field.fill(email);
      const retry = page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover");
      await page.getByRole("button", { name: "Link anfordern", exact: true }).click();
      const accepted = await retry; expect(accepted.status()).toBe(200);
      const body = await accepted.json();
      await expect(page.getByRole("status")).toHaveText(body.message);
      await expect(feedback).toHaveCount(0); await expect(field).toHaveValue("");
      expect(requests).toBe(2);
      expect((await pool.query("SELECT count(*)::int AS n FROM card_recovery_challenges WHERE email=$1", [email])).rows[0].n).toBe(1);
      expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE tenant_id=$1 AND kind='email.recover'", [own.tenant.id])).rows[0].n).toBe(1);
      expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE tenant_id=$1 AND kind='email.recover'", [foreign.tenant.id])).rows[0].n).toBe(0);
      expect(await snapshot()).toEqual(before);
      if (width === 375 && failure === "input") {
        const unknown = await context.request.post("/api/recover", { headers: { Origin: baseURL }, data: { email: `unknown-${randomUUID()}@example.test` } });
        expect(unknown.status()).toBe(200); expect(await unknown.json()).toEqual(body);
      }
    } finally {
      if (trigger) { await pool.query("DROP TRIGGER test_recovery_065_unavailable ON card_recovery_challenges"); await pool.query("DROP FUNCTION test_recovery_065_unavailable()"); }
      await context.close();
    }
  });
}
