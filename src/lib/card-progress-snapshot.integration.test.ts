import { afterAll, beforeEach, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { Client } from "pg";
import { eq } from "drizzle-orm";
import { rewardVersions } from "@/db/schema";
import { chromium } from "@playwright/test";
import { db, pool } from "@/db";
import { GET } from "@/app/api/card/[token]/route";
import { editReward, getCard } from "./product";
import { award, redeem, reverseEntry } from "./loyalty";
import { closeCard } from "./card-lifecycle";
import { nfcFixture } from "./nfc-test-db";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");
beforeEach(async () => { await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE'); });
afterAll(async () => { await pool.end(); });
function signal() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }

it.each(["award", "redemption", "reversal", "catalogue"] as const)("returns one coherent progress/history snapshot to the browser during concurrent %s", async operation => {
  const f = await nfcFixture();
  const other = await nfcFixture();
  await award({ userId: other.userId, locationId: other.location.id, membershipId: other.member.id, quantity: 5, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const [version] = await db.select().from(rewardVersions).where(eq(rewardVersions.tenantId, f.tenant.id));
  if (operation === "redemption" || operation === "reversal") await award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 8, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const redeemInput = { userId: f.userId, locationId: f.location.id, membershipId: f.member.id, rewardVersionId: version.id, idempotencyKey: randomUUID(), requestId: randomUUID() };
  const prior = operation === "reversal" ? await redeem(redeemInput) : null;
  const read = signal(); const resume = signal();
  const original = Client.prototype.query;
  let paused = false;
  // Hold the real PostgreSQL result after the card read; never fabricate rows.
  // Preserve both pg-pool callback and transaction-client Promise contracts.
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0];
    const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (paused || !text?.startsWith("select") || !text.includes('from "memberships"') || !text.includes('"card_token"') || !text.includes('"closed_at"')) return Reflect.apply(original, this, args);
    paused = true;
    const callback = args.at(-1);
    if (typeof callback === "function") {
      args[args.length - 1] = (...results: unknown[]) => {
        if (results[0]) { Reflect.apply(callback, undefined, results); return; }
        read.resolve();
        void resume.promise.then(() => { Reflect.apply(callback, undefined, results); });
      };
      return Reflect.apply(original, this, args);
    }
    const result = Reflect.apply(original, this, args);
    return (result as Promise<unknown>).then(async rows => { read.resolve(); await resume.promise; return rows; });
  }) as typeof original);
  // Actual installed Chrome requests the actual production route over owned
  // loopback HTTP. This is API correctness evidence, not physical-phone UX.
  const server = createServer((incoming, outgoing) => {
    void (async () => {
      const match = /^\/api\/card\/([^/]+)$/.exec(incoming.url ?? "");
      if (!match) { outgoing.writeHead(404); outgoing.end("Missing route"); return; }
      const response = await GET(new Request(`http://127.0.0.1${incoming.url}`), { params: Promise.resolve({ token: decodeURIComponent(match[1]) }) });
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(Buffer.from(await response.arrayBuffer()));
    })().catch(() => { outgoing.writeHead(500); outgoing.end("Synthetic route failed"); });
  });
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let pending: Promise<unknown> | undefined;
  let gateTimeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("Owned HTTP listener absent");
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    pending = page.goto(`http://127.0.0.1:${address.port}/api/card/${f.member.cardToken}`, { waitUntil: "domcontentloaded" });
    await Promise.race([read.promise, new Promise<never>((_, reject) => { gateTimeout = setTimeout(() => reject(new Error("Actual card read gate not reached")), 3000); })]);
    if (operation === "award") await expect(award({ userId: f.userId, locationId: f.location.id, membershipId: f.member.id, quantity: 2, idempotencyKey: randomUUID(), requestId: randomUUID() })).resolves.toMatchObject({ balance: 2 });
    else if (operation === "redemption") await expect(redeem(redeemInput)).resolves.toMatchObject({ balance: 0 });
    else if (operation === "reversal" && prior) await expect(reverseEntry({ userId: f.userId, locationId: f.location.id, entryId: prior.entryId, reason: "Synthetic customer history correction", idempotencyKey: randomUUID(), requestId: randomUUID() })).resolves.toMatchObject({ balance: 8 });
    else if (operation === "catalogue") await editReward({ actorUserId: f.userId, programSlug: f.program.slug, rewardId: version.rewardId, title: "Updated coffee", cost: 1, termsText: "" });
    resume.resolve(); await pending;
    const snapshot = JSON.parse(await page.locator("body").innerText());
    expect(snapshot.balance).toBe(operation === "redemption" ? 8 : 0);
    const oldDeltas = operation === "redemption" ? [8] : operation === "reversal" ? [8, -8] : [];
    expect(snapshot.activity).toHaveLength(oldDeltas.length);
    expect(snapshot.activity).toEqual(expect.arrayContaining(oldDeltas.map(delta => expect.objectContaining({ delta }))));
    expect(snapshot.cardLocator).toMatch(/^K-/);
    expect(snapshot.rewards).toEqual([expect.objectContaining({ title: "Coffee", cost: 8 })]);
    expect(JSON.stringify(snapshot)).not.toContain(other.member.scanCode);
    const fresh = await getCard(f.member.cardToken);
    expect(fresh.balance).toBe(operation === "award" ? 2 : operation === "reversal" ? 8 : 0);
    const freshDeltas = operation === "award" ? [2] : operation === "redemption" ? [-8, 8] : operation === "reversal" ? [-8, 8, 8] : [];
    expect(fresh.activity.map(entry => entry.delta).sort((a, b) => a - b)).toEqual(freshDeltas);
    expect(fresh.rewards).toEqual([expect.objectContaining({ title: operation === "catalogue" ? "Updated coffee" : "Coffee", cost: operation === "catalogue" ? 1 : 8 })]);
    expect((await getCard(other.member.cardToken)).balance).toBe(5);
  } finally {
    if (gateTimeout) clearTimeout(gateTimeout);
    resume.resolve();
    try { await pending; } finally {
      spy.mockRestore();
      try { await browser?.close(); } finally { await new Promise<void>(done => server.close(() => done())); }
    }
  }
});


it("rejects retired or non-bearer credentials without leaking another tenant's history", async () => {
  const first = await nfcFixture(); const other = await nfcFixture();
  await award({ userId: other.userId, locationId: other.location.id, membershipId: other.member.id, quantity: 3, idempotencyKey: randomUUID(), requestId: randomUUID() });
  for (const token of [first.member.scanCode, `card_${"x".repeat(40)}`]) await expect(getCard(token)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await closeCard(first.member.cardToken);
  await expect(getCard(first.member.cardToken)).rejects.toMatchObject({ code: "NOT_FOUND" });
  const untouched = await getCard(other.member.cardToken);
  expect(untouched.balance).toBe(3); expect(untouched.activity).toEqual([expect.objectContaining({ delta: 3 })]);
  expect(pool.waitingCount).toBe(0);
});

it("fails closed on an actual card-history SQL failure and permits a fresh independent retry", async () => {
  const f = await nfcFixture();
  const original = Client.prototype.query;
  let failed = false;
  const spy = vi.spyOn(Client.prototype, "query").mockImplementation((function (this: Client, ...args: unknown[]) {
    const config = args[0];
    const text = typeof config === "string" ? config : (config as { text?: string } | undefined)?.text;
    if (!failed && text?.startsWith("select") && text.includes('from "ledger_entries"')) {
      failed = true;
      // PostgreSQL produces the real error; no fabricated rows or successful fallback.
      args[0] = typeof config === "string" ? "SELECT 1 / 0" : { ...(config as object), text: "SELECT 1 / 0", values: [] };
    }
    return Reflect.apply(original, this, args);
  }) as typeof original);
  try {
    const response = await GET(new Request(`http://localhost/api/card/${f.member.cardToken}`), { params: Promise.resolve({ token: f.member.cardToken }) });
    expect(response.status).toBe(500);
    const body = await response.text();
    expect(body).not.toContain(f.member.scanCode); expect(body).not.toContain(f.member.cardToken);
    expect(failed).toBe(true);
  } finally { spy.mockRestore(); }
  const fresh = await GET(new Request(`http://localhost/api/card/${f.member.cardToken}`), { params: Promise.resolve({ token: f.member.cardToken }) });
  expect(fresh.status).toBe(200); expect(fresh.headers.get("cache-control")).toBe("no-store");
  expect(await fresh.json()).toMatchObject({ balance: 0, activity: [] });
  expect((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction' AND pid<>pg_backend_pid()")).rows[0].n).toBe(0);
});
