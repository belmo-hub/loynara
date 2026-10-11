import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext } from "@playwright/test";
import { db, pool } from "../src/db";
import { membershipContacts } from "../src/db/schema";
import { nfcFixture } from "../src/lib/nfc-test-db";
import { award } from "../src/lib/loyalty";
import { getCard } from "../src/lib/product";
import { recoveryTokenForChallenge } from "../src/lib/contact-token";

const database = new URL(process.env.DATABASE_URL ?? "http://invalid");
if (process.env.NODE_ENV === "production" || !["localhost", "127.0.0.1"].includes(database.hostname) ||
    database.port !== "55433" || !["/looplocal_browser_confirm_066a", "/looplocal_browser_confirm_066b", "/looplocal_browser_confirm_066c"].includes(database.pathname)) throw new Error("Dedicated synthetic confirmation database required");
test.afterAll(async () => { await pool.end(); });

async function fixture(context: BrowserContext, baseURL: string | undefined) {
  if (baseURL !== "http://localhost:3000") throw new Error("Synthetic loopback application required");
  const own = await nfcFixture({ tapMode: "disabled" });
  const foreign = await nfcFixture({ tapMode: "disabled" });
  for (const [f, quantity] of [[own, 2], [foreign, 3]] as const) await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const email = `confirm-${randomUUID()}@example.test`;
  await db.insert(membershipContacts).values({ tenantId: own.tenant.id, membershipId: own.member.id, email, emailVerified: true });
  const requested = await context.request.post("/api/recover", { headers: { Origin: baseURL }, data: { email } });
  expect(requested.status()).toBe(200);
  const challenge = (await pool.query("SELECT id FROM card_recovery_challenges WHERE email=$1", [email])).rows[0];
  return { own, foreign, email, proof: recoveryTokenForChallenge(challenge.id), challengeId: challenge.id };
}
async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
  const ids = [f.own.member.id, f.foreign.member.id];
  return {
    members: (await pool.query("SELECT * FROM memberships WHERE id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
    ledger: (await pool.query("SELECT * FROM ledger_entries WHERE membership_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
    contacts: (await pool.query("SELECT * FROM membership_contacts WHERE membership_id=ANY($1::uuid[]) ORDER BY membership_id", [ids])).rows,
    consent: (await pool.query("SELECT * FROM consent_events WHERE membership_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
    challenges: (await pool.query("SELECT * FROM card_recovery_challenges WHERE id=$1", [f.challengeId])).rows,
    notices: (await pool.query("SELECT * FROM outbox_jobs WHERE tenant_id=ANY($1::uuid[]) AND kind='email.recovery_notice' ORDER BY id", [[f.own.tenant.id, f.foreign.tenant.id]])).rows,
    events: (await pool.query("SELECT * FROM card_security_events WHERE membership_id=ANY($1::uuid[]) ORDER BY id", [ids])).rows,
  };
}

async function open(context: BrowserContext, f: Awaited<ReturnType<typeof fixture>>, baseURL: string | undefined) {
  const page = await context.newPage(); const actions: string[] = []; let leaked = false;
  page.on("request", request => {
    if (request.url().includes(f.proof) || (request.headers().referer ?? "").includes(f.proof)) leaked = true;
    if (new URL(request.url()).pathname === "/api/recover/confirm") actions.push(request.postDataJSON().action);
  });
  await page.goto(`/recover/confirm#token=${f.proof}`);
  await expect(page).toHaveURL(`${baseURL}/recover/confirm`);
  expect(actions).toEqual([]);
  return { page, actions, leaked: () => leaked };
}
async function list(p: Awaited<ReturnType<typeof open>>, f: Awaited<ReturnType<typeof fixture>>) {
  const response = p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover/confirm");
  await p.page.getByRole("button", { name: "Meine Karten anzeigen", exact: true }).click();
  const result = await response; expect(result.status()).toBe(200);
  expect((await result.json()).cards.map((card: { membershipId: string }) => card.membershipId)).toEqual([f.own.member.id]);
  await expect(p.page.getByRole("button", { name: "Diese Karte wiederherstellen", exact: true })).toBeEnabled();
}
async function rotate(p: Awaited<ReturnType<typeof open>>) {
  const response = p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover/confirm");
  await p.page.getByRole("button", { name: "Diese Karte wiederherstellen", exact: true }).click();
  const result = await response; expect(result.status()).toBe(200);
  // Successful navigation disposes the response body in Chrome. The delivered
  // private destination and its persisted credential are the authoritative result.
  await expect.poll(() => new URL(p.page.url()).pathname.startsWith("/card/")).toBe(true);
  const privateLink = new URL(p.page.url());
  const credential = decodeURIComponent(privateLink.pathname.slice("/card/".length));
  expect(/^card_[A-Za-z0-9_-]{43}$/.test(credential)).toBe(true); expect(privateLink.hash).toBe(""); expect(privateLink.search).toBe("");
  return credential;
}
async function committed(f: Awaited<ReturnType<typeof fixture>>, before: Awaited<ReturnType<typeof snapshot>>, cardToken: string) {
  const after = await snapshot(f);
  const withoutBearer = (rows: typeof after.members) => rows.map(({ card_token: _privateBearer, ...rest }) => rest);
  expect(withoutBearer(after.members)).toEqual(withoutBearer(before.members));
  expect(after.members.find(m => m.id === f.foreign.member.id)).toEqual(before.members.find(m => m.id === f.foreign.member.id));
  expect(after.members.find(m => m.id === f.own.member.id)?.card_token === cardToken).toBe(true);
  expect(cardToken !== before.members.find(m => m.id === f.own.member.id)?.card_token).toBe(true);
  for (const key of ["ledger", "contacts", "consent"] as const) expect(after[key]).toEqual(before[key]);
  expect(after.challenges).toEqual([]);
  expect(after.notices.map(n => [n.tenant_id, n.kind])).toEqual([[f.own.tenant.id, "email.recovery_notice"]]);
  expect(after.events.map(e => [e.tenant_id, e.membership_id, e.action])).toEqual([[f.own.tenant.id, f.own.member.id, "card_credential_rotated"]]);
  expect((await getCard(cardToken)).balance).toBe(2);
  expect((await getCard(f.foreign.member.cardToken)).balance).toBe(3);
  return after;
}

for (const width of [375, 1280]) {
  for (const failure of ["server", "network"] as const) test(`temporary list ${failure} failure is not classified as invalid recovery proof (${width}px)`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } }); let renamed = false;
    try {
      const f = await fixture(context, baseURL); const before = await snapshot(f); const p = await open(context, f, baseURL);
      if (failure === "server") {
        // Actual lookup failure confined to the owned disposable database.
        await pool.query("ALTER TABLE card_recovery_challenges RENAME TO test_recovery_066_unavailable"); renamed = true;
      } else await p.page.route("**/api/recover/confirm", route => route.abort("connectionreset"));
      const response = failure === "server" ? p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover/confirm") : null;
      await p.page.getByRole("button", { name: "Meine Karten anzeigen", exact: true }).click();
      if (response) { const result = await response; expect(result.status()).toBe(500); expect(await result.json()).toMatchObject({ error: "Internal error" }); }
      const feedback = p.page.locator(".card-state-page p[role=alert]");
      await expect(feedback).toContainText("nicht bestätigt");
      expect(await feedback.innerText()).not.toMatch(/ungültig|abgelaufen|bereits verwendet|Internal error|r_/);
      await expect(p.page.getByRole("button", { name: "Meine Karten anzeigen", exact: true })).toBeEnabled();
      expect(p.actions).toEqual(["list"]);
      if (renamed) { await pool.query("ALTER TABLE test_recovery_066_unavailable RENAME TO card_recovery_challenges"); renamed = false; }
      else await p.page.unroute("**/api/recover/confirm");
      expect(await snapshot(f)).toEqual(before);
      if (width === 375 && failure === "server") await p.page.screenshot({ path: "/tmp/loy-066-list-error-mobile.png" });
      expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await list(p, f); await committed(f, before, await rotate(p));
      expect(p.actions).toEqual(["list", "list", "rotate"]); expect(p.leaked()).toBe(false);
    } finally {
      if (renamed) await pool.query("ALTER TABLE test_recovery_066_unavailable RENAME TO card_recovery_challenges");
      await context.close();
    }
  });

  test(`rotation database abort keeps explicit retry possible (${width}px)`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } }); let trigger = false;
    try {
      const f = await fixture(context, baseURL); const before = await snapshot(f); const p = await open(context, f, baseURL); await list(p, f);
      // Abort after the real transaction has updated the credential/deleted proof:
      // atomic rollback must restore both before the UI offers an explicit retry.
      await pool.query("CREATE FUNCTION test_recovery_066_notice_abort() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.kind='email.recovery_notice' THEN RAISE EXCEPTION 'Synthetic private notice abort'; END IF; RETURN NEW; END; $$");
      await pool.query("CREATE TRIGGER test_recovery_066_notice_abort BEFORE INSERT ON outbox_jobs FOR EACH ROW EXECUTE FUNCTION test_recovery_066_notice_abort()"); trigger = true;
      const response = p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover/confirm");
      await p.page.getByRole("button", { name: "Diese Karte wiederherstellen", exact: true }).click();
      const result = await response; expect(result.status()).toBe(500); expect(await result.json()).toMatchObject({ error: "Internal error" });
      const feedback = p.page.locator(".card-state-page p[role=alert]"); await expect(feedback).toContainText("nicht bestätigt");
      expect(await feedback.innerText()).not.toMatch(/konnte nicht wiederhergestellt|ungültig|Internal error|Synthetic private/);
      expect(await snapshot(f)).toEqual(before); expect(p.actions).toEqual(["list", "rotate"]);
      await pool.query("DROP TRIGGER test_recovery_066_notice_abort ON outbox_jobs"); await pool.query("DROP FUNCTION test_recovery_066_notice_abort()"); trigger = false;
      await committed(f, before, await rotate(p)); expect(p.actions).toEqual(["list", "rotate", "rotate"]); expect(p.leaked()).toBe(false);
    } finally {
      if (trigger) { await pool.query("DROP TRIGGER test_recovery_066_notice_abort ON outbox_jobs"); await pool.query("DROP FUNCTION test_recovery_066_notice_abort()"); }
      await context.close();
    }
  });

  test(`lost committed rotation response stays uncertain and never replays automatically (${width}px)`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } });
    try {
      const f = await fixture(context, baseURL); const before = await snapshot(f); const p = await open(context, f, baseURL); await list(p, f); let cardToken = "";
      await p.page.route("**/api/recover/confirm", async route => {
        const actual = await route.fetch(); expect(actual.status()).toBe(200); cardToken = (await actual.json()).cardToken;
        await route.abort("connectionreset");
      });
      await p.page.getByRole("button", { name: "Diese Karte wiederherstellen", exact: true }).click();
      const feedback = p.page.locator(".card-state-page p[role=alert]"); await expect(feedback).toContainText("Ob deine Karte wiederhergestellt wurde, konnte nicht bestätigt werden");
      expect(p.actions).toEqual(["list", "rotate"]); const after = await committed(f, before, cardToken);
      expect(new URL(p.page.url()).pathname).toBe("/recover/confirm"); expect(await p.page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await p.page.unroute("**/api/recover/confirm");
      const replay = p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover/confirm");
      await p.page.getByRole("button", { name: "Diese Karte wiederherstellen", exact: true }).click();
      const rejected = await replay; expect(rejected.status()).toBe(400); expect(await rejected.json()).toMatchObject({ code: "INVALID_RECOVERY" });
      await expect(feedback).toContainText("bereits verwendet");
      expect(await snapshot(f)).toEqual(after); expect(p.actions).toEqual(["list", "rotate", "rotate"]); expect(p.leaked()).toBe(false);
      await expect(p.page.getByRole("link", { name: "Neuen Link anfordern", exact: true })).toBeVisible();
    } finally { await context.close(); }
  });

  for (const failure of ["invalid", "expired"] as const) test(`definitive ${failure} proof retains established feedback (${width}px)`, async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width, height: 812 } });
    try {
      const f = await fixture(context, baseURL);
      if (failure === "invalid") f.proof += "tampered";
      else await pool.query("UPDATE card_recovery_challenges SET expires_at=now()-interval '1 second' WHERE id=$1", [f.challengeId]);
      const before = await snapshot(f); const p = await open(context, f, baseURL);
      const response = p.page.waitForResponse(r => new URL(r.url()).pathname === "/api/recover/confirm");
      await p.page.getByRole("button", { name: "Meine Karten anzeigen", exact: true }).click();
      const result = await response; expect(result.status()).toBe(400); expect(await result.json()).toMatchObject({ code: "INVALID_RECOVERY" });
      await expect(p.page.locator(".card-state-page p[role=alert]")).toHaveText("Der Link ist ungültig, abgelaufen oder wurde bereits verwendet.");
      expect(await snapshot(f)).toEqual(before); expect(p.actions).toEqual(["list"]); expect(p.leaked()).toBe(false);
    } finally { await context.close(); }
  });
}
