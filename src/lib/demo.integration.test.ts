import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { ledgerEntries, memberships, plateLinkEvents, programs, purchaseAwards, secureTags, staffPushSubscriptions, staffRoles, tapRequests, tenants } from "@/db/schema";
import { DerivedTapKeyProvider, deriveTagKeys, parseMaster } from "./nfc-keys";
import { sdmFor, tapUrl } from "./nfc-test-support";
import { buildRegistrationBundle } from "./nfc-provision/production";
import { registerTag } from "../../scripts/nfc-register";
import { assertDisposableDatabase } from "./disposable-test-database";

const session = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: async () => session.userId ? { user: { id: session.userId } } : null } } }));

import { activeDemo, createDemo, demoPlateLive, demoStatus, endDemos } from "./demo";
import { eraseDemoShop } from "./shop-erasure";
import { createMerchant, enroll } from "./product";
import { acknowledgeWalletGuidance, queueCardWalletMessage, sendWalletMessage, setWalletConsent } from "./wallet-messages";
import { queueWinbackMessages } from "./winback";
import { queueBirthdayMessages } from "./birthday";
import { queueAlmostMessages } from "./almost-there";
import { getLocationAnalytics, getMerchantAnalytics } from "./merchant-analytics";
import { getRetentionSummary } from "./retention";
import { POST as demoRoute } from "@/app/api/operator/demo/route";
import { GET as tapGet } from "@/app/api/tap/[ref]/route";
import TapPage from "@/app/tap/[ref]/page";
import { DemoSampleCard } from "@/components/customer/demo-sample-card";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const ORIGIN = "https://demo.example-pilot.test";
const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const HOUR = 60 * 60_000;
const code = async (fn: () => Promise<unknown>) => { try { await fn(); } catch (error) { return (error as { code?: string }).code ?? "OTHER"; } return "NONE"; };
const ENV_KEYS = ["DEMO_ENVIRONMENT", "PRODUCTION_ENVIRONMENT", "PLATE_OPERATOR_USER_IDS", "PUBLIC_BASE_URL", "NFC_KEY_PROVIDER", "NFC_VERIFY_MASTER_KEY"] as const;
const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

let operator: string;
let env: Record<string, string | undefined>;
const user = async (id = randomUUID()) => { await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [id, "Synthetic", `${id}@example.test`]); return id; };
const start = (key: string = randomUUID(), patch: Record<string, unknown> = {}, actorUserId = operator, e = env) => createDemo({ actorUserId, env: e, key, templateId: "barber", businessName: "Salon Aziz", ...patch });

beforeEach(async () => {
  await assertDisposableDatabase(pool);
  await pool.query('TRUNCATE TABLE tenants, "user", secure_tags, plate_link_events CASCADE');
  operator = await user();
  env = { DEMO_ENVIRONMENT: "true", PLATE_OPERATOR_USER_IDS: operator, PUBLIC_BASE_URL: `${ORIGIN}/` };
  Object.assign(process.env, { DEMO_ENVIRONMENT: "true", PLATE_OPERATOR_USER_IDS: operator, PUBLIC_BASE_URL: `${ORIGIN}/`, NFC_KEY_PROVIDER: "derived_v1", NFC_VERIFY_MASTER_KEY: VERIFY.toString("hex") });
  delete process.env.PRODUCTION_ENVIRONMENT;
  session.userId = operator;
});
afterEach(() => { for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } });
afterAll(async () => { await pool.end(); });

/** An unlinked plate registered through the real path, and a signed tap for any counter. */
async function plate(label = "D-001", UID = "04de5f1eacc042") {
  const keyRef = `dv1_${randomBytes(9).toString("base64url")}`;
  const publicRef = randomBytes(18).toString("base64url");
  const keys = deriveTagKeys({ verifyMaster: VERIFY, adminMaster: ADMIN, ref: keyRef, uid: UID });
  const bundle = buildRegistrationBundle({ plateLabel: label, origin: ORIGIN, uid: UID, publicRef, keyRef, sampleUrl: tapUrl(ORIGIN, publicRef, sdmFor({ uid: UID, counter: 3, keys })), firstCounter: 2, secondCounter: 3 });
  await registerTag({ bundleText: JSON.stringify(bundle), actorUserId: operator, execute: true, env, provider: new DerivedTapKeyProvider(VERIFY), guard: () => undefined });
  const get = (counter: number) => { const f = sdmFor({ uid: UID, counter, keys }); return tapGet(new Request(`${ORIGIN}/api/tap/${publicRef}?e=${f.encrypted}&c=${f.mac}`), { params: Promise.resolve({ ref: publicRef }) }); };
  const page = () => TapPage({ params: Promise.resolve({ ref: publicRef }) });
  return { publicRef, get, page };
}
const post = (body: unknown, origin = ORIGIN) => demoRoute(new Request(`${ORIGIN}/api/operator/demo`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify(body) }));

describe("Demo-Modus (design v3)", () => {
  it("creates one demo per key with the operator as owner, its push subscription moved, the plate linked and six sample cards", async () => {
    const old = (await pool.query("INSERT INTO tenants (name, slug) VALUES ('Alt', 'alt') RETURNING id")).rows[0].id as string;
    const oldLocation = (await pool.query("INSERT INTO locations (tenant_id, name, city, country, timezone) VALUES ($1, 'Alt', 'Kassel', 'DE', 'Europe/Berlin') RETURNING id", [old])).rows[0].id as string;
    await db.insert(staffRoles).values({ tenantId: old, userId: operator, role: "owner" });
    await pool.query(`INSERT INTO "session" (id, "expiresAt", token, "updatedAt", "userId") VALUES ('s', now() + interval '1 day', 's', now(), $1)`, [operator]);
    await db.insert(staffPushSubscriptions).values({ tenantId: old, locationId: oldLocation, userId: operator, sessionId: "s", endpoint: "https://push.example.test/1", p256dh: "p", auth: "a" });
    await plate();
    const key = randomUUID();
    expect(await start(key)).toEqual({ name: "Salon Aziz", hoursLeft: 24 });
    expect(await start(key, { businessName: "Anders" })).toEqual({ name: "Salon Aziz", hoursLeft: 24 }); // retry: the same demo
    const shops = await db.select().from(tenants).where(eq(tenants.slug, `demo-${key}`));
    expect(shops).toHaveLength(1);
    const demo = (await activeDemo())!;
    expect(demo).toMatchObject({ tenantId: shops[0].id, name: "Salon Aziz" });
    expect(await db.select().from(staffRoles)).toEqual([expect.objectContaining({ tenantId: demo.tenantId, userId: operator, role: "owner", active: true })]);
    expect(await db.select().from(staffPushSubscriptions)).toEqual([expect.objectContaining({ tenantId: demo.tenantId, locationId: demo.locationId })]);
    const [program] = await db.select().from(programs).where(eq(programs.id, demo.programId));
    expect(program).toMatchObject({ type: "stamp", tapMode: "staff_confirmed" });
    expect(await db.select().from(secureTags)).toEqual([expect.objectContaining({ status: "active", programId: demo.programId })]);
    expect(await db.select().from(plateLinkEvents)).toEqual([expect.objectContaining({ action: "link", newProgramId: demo.programId })]);
    const cards = await db.select().from(memberships).where(eq(memberships.tenantId, demo.tenantId));
    expect(cards).toHaveLength(6);
    expect(cards.every(card => card.balance > 0 && card.balance < 8)).toBe(true);
    const entries = await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, demo.tenantId));
    expect(entries.length).toBe(cards.reduce((sum, card) => sum + card.balance, 0));
    expect(entries.every(entry => entry.source === "synthetic_seed" && entry.createdAt.getTime() < Date.now() - HOUR)).toBe(true);
    expect(Math.min(...entries.map(entry => entry.createdAt.getTime()))).toBeLessThan(Date.now() - 14 * 24 * HOUR);
    expect(await db.select().from(purchaseAwards)).toHaveLength(0);
    expect(await demoStatus(env)).toEqual({ name: "Salon Aziz", hoursLeft: 24 });
  });

  it("Neu starten: a new key gives a new demo; the role and the plate move to it, a points card books no amounts", async () => {
    await plate();
    await start();
    const first = (await activeDemo())!;
    await new Promise(resolve => setTimeout(resolve, 5));
    await start(randomUUID(), { templateId: "pizzeria", businessName: "Pizzeria Roma" });
    const second = (await activeDemo())!;
    expect(second.tenantId).not.toBe(first.tenantId);
    expect(second.name).toBe("Pizzeria Roma");
    expect(await db.select({ tenantId: staffRoles.tenantId }).from(staffRoles)).toEqual([{ tenantId: second.tenantId }]);
    expect((await db.select().from(secureTags))[0].programId).toBe(second.programId);
    expect((await db.select().from(plateLinkEvents)).map(event => event.action).sort()).toEqual(["link", "relink"]);
    const points = await db.select().from(ledgerEntries).where(eq(ledgerEntries.tenantId, second.tenantId));
    expect(points.length).toBeGreaterThan(0);
    expect(await db.select().from(purchaseAwards)).toHaveLength(0);
  });

  it("refuses outside the demo environment, in production, and for anyone not on the operator list", async () => {
    const owner = await user();
    expect(await code(() => start(randomUUID(), {}, operator, { ...env, DEMO_ENVIRONMENT: undefined }))).toBe("FORBIDDEN");
    expect(await code(() => start(randomUUID(), {}, operator, { ...env, PRODUCTION_ENVIRONMENT: "loynara-production" }))).toBe("FORBIDDEN");
    expect(await code(() => start(randomUUID(), {}, owner))).toBe("FORBIDDEN");
    expect(await code(() => start("not-a-key"))).toBe("INVALID_INPUT");
    expect(await code(() => start(randomUUID(), { businessName: " " }))).toBe("INVALID_INPUT");
    expect(await db.select().from(tenants)).toHaveLength(0);
    expect(await code(() => eraseDemoShop(randomUUID(), { DEMO_ENVIRONMENT: "true", PRODUCTION_ENVIRONMENT: "loynara-production" }))).toBe("FORBIDDEN");
    expect(await endDemos({})).toEqual({ voided: 0, erased: 0 });
    expect(await demoStatus({})).toBeNull();
  });

  it("the route answers 404 to a non-operator, outside the demo environment and in production, and starts a demo for the operator", async () => {
    const body = { key: randomUUID(), templateId: "barber", businessName: "Salon Aziz" };
    session.userId = await user();
    expect((await post(body)).status).toBe(404);
    session.userId = null;
    expect((await post(body)).status).toBe(404);
    session.userId = operator;
    delete process.env.DEMO_ENVIRONMENT;
    expect((await post(body)).status).toBe(404);
    process.env.DEMO_ENVIRONMENT = "true"; process.env.PRODUCTION_ENVIRONMENT = "loynara-production";
    expect((await post(body)).status).toBe(404);
    delete process.env.PRODUCTION_ENVIRONMENT;
    expect(await db.select().from(tenants)).toHaveLength(0);
    const refused = await post({ ...body, businessName: "" });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "INVALID_INPUT", error: "Bitte gib den Namen des Geschäfts ein." });
    const ok = await post(body);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ name: "Salon Aziz", hoursLeft: 24 });
    expect((await post(body)).status).toBe(200);
    expect(await db.select().from(tenants)).toHaveLength(1);
  });

  it("the plate opens the active demo; with none it shows the sample card and writes nothing; outside the demo environment it is a normal plate", async () => {
    const p = await plate();
    expect((await p.page()).type).toBe(DemoSampleCard);
    const none = await p.get(9);
    expect(none.status).toBe(400);
    expect(await none.json()).toMatchObject({ code: "NO_DEMO", error: "Gerade läuft keine Demo." });
    expect((await db.select().from(secureTags))[0].lastCounter).toBe(3);
    await start();
    expect((await p.page()).type).not.toBe(DemoSampleCard);
    const open = await p.get(10);
    expect(open.status).toBe(200);
    expect(await open.json()).toMatchObject({ merchantName: "Salon Aziz", mode: "staff_confirmed", hasMembership: false });
    // After 24 hours the plate is back to the sample card, though still linked until the erasure.
    expect(await demoPlateLive(p.publicRef, new Date(Date.now() + 24 * HOUR + 60_000))).toBe(false);
    delete process.env.DEMO_ENVIRONMENT;
    await db.update(secureTags).set({ tenantId: null, locationId: null, programId: null, status: "unlinked" });
    expect((await p.page()).type).not.toBe(DemoSampleCard);
    const unlinked = await p.get(11);
    expect(unlinked.status).toBe(404);
    expect(await unlinked.json()).toMatchObject({ code: "PLATE_UNLINKED" });
    expect(await db.select().from(tapRequests)).toHaveLength(0);
  });

  it("after 24 hours voids the demo's passes and queues their push; after 25 hours, once delivered, erases the shop and keeps the plate and the operator", async () => {
    await plate();
    await start();
    const demo = (await activeDemo())!;
    const [card] = await db.select().from(memberships).where(eq(memberships.tenantId, demo.tenantId)).limit(1);
    await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, 'apple', $3, 'active')", [demo.tenantId, card.id, `synthetic-${randomUUID()}`]);
    const at = (hours: number) => new Date(Date.now() + hours * HOUR);
    expect(await endDemos(env, at(23))).toEqual({ voided: 0, erased: 0 });
    expect(await endDemos(env, at(24.1))).toEqual({ voided: 1, erased: 0 });
    expect((await pool.query("SELECT status, revoke_reason FROM wallet_passes")).rows).toEqual([{ status: "revocation_pending", revoke_reason: "closed" }]);
    expect((await pool.query("SELECT count(*)::int AS n FROM outbox_jobs WHERE kind = 'wallet.refresh' AND payload ->> 'membershipId' = $1", [card.id])).rows[0].n).toBe(1);
    expect(await activeDemo(db, at(24.1))).toBeNull();
    // Not while the voided pass still waits for its push.
    expect(await endDemos(env, at(25.1))).toEqual({ voided: 0, erased: 0 });
    await pool.query("UPDATE wallet_passes SET status = 'revoked'");
    expect(await endDemos(env, at(25.1))).toEqual({ voided: 0, erased: 1 });
    expect(await db.select().from(tenants)).toHaveLength(0);
    expect(await db.select().from(memberships)).toHaveLength(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries")).rows[0].n).toBe(0);
    expect((await pool.query("SELECT count(*)::int AS n FROM shop_erasures")).rows[0].n).toBe(0);
    expect(await db.select().from(secureTags)).toEqual([expect.objectContaining({ status: "unlinked", programId: null })]);
    expect((await pool.query('SELECT count(*)::int AS n FROM "user" WHERE id = $1', [operator])).rows[0].n).toBe(1);
    expect(await db.select().from(staffRoles)).toHaveLength(0);
  });

  it("erases a demo whose push never got through a day later anyway", async () => {
    await start();
    const demo = (await activeDemo())!;
    const [card] = await db.select().from(memberships).where(eq(memberships.tenantId, demo.tenantId)).limit(1);
    await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, 'apple', $3, 'active')", [demo.tenantId, card.id, `synthetic-${randomUUID()}`]);
    expect(await endDemos(env, new Date(Date.now() + 48.1 * HOUR))).toEqual({ voided: 1, erased: 1 });
    expect(await db.select().from(tenants)).toHaveLength(0);
  });
});

/** A shop made by the real setup, not a demo, though its name starts with Demo (slug demo-bar-xxxxx): an owner, a card with a live pass, a linked plate, 30 days old. */
async function realShop() {
  const owner = await user();
  const merchant = await createMerchant({ userId: owner, businessName: "Demo Bar", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Kaffeekarte", programType: "stamp", rulesText: "Ein Stempel pro Kaffee.", rewardTitle: "Kaffee gratis", rewardCost: 10 });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true });
  await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, 'apple', $3, 'created')", [merchant.tenantId, card.id, `passfast:${randomUUID()}`]);
  const p = await plate("R-001", "04de5f1eacc0aa");
  await pool.query("UPDATE secure_tags SET tenant_id = $1, location_id = $2, program_id = $3, status = 'active' WHERE public_ref = $4", [merchant.tenantId, merchant.locationId, merchant.programId, p.publicRef]);
  await pool.query("UPDATE tenants SET created_at = now() - interval '30 days' WHERE id = $1", [merchant.tenantId]);
  return { owner, ...merchant, card, publicRef: p.publicRef };
}
const age = (tenantId: string, hours: number) => pool.query(`UPDATE tenants SET created_at = now() - make_interval(hours => $2) WHERE id = $1`, [tenantId, hours]);
/** A card of the shop with a live pass that can carry a message, with or without the customer's consent. */
async function messageCard(slug: string, tenantId: string, consent: boolean) {
  const card = await enroll({ slug, acceptedTerms: true });
  const passId = randomUUID();
  await pool.query("INSERT INTO wallet_passes (id, tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, $3, 'apple', $4, 'created')", [passId, tenantId, card.id, `passfast:${passId}`]);
  if (consent) await setWalletConsent(card.cardToken, true);
  return passId;
}
// Daytime in Berlin, so quiet hours never refuse a send.
const daytime = () => { const at = new Date(); at.setUTCHours(11, 0, 0, 0); return at; };

describe("Demo-Modus review round (R-1 to R-4, Design 3)", () => {
  it("only demo shops count: a real shop's plate, card, pass and owner are left alone by start, end and erase", async () => {
    const real = await realShop();
    await plate();
    await start();
    const demo = (await activeDemo())!;
    expect((await db.select().from(secureTags).where(eq(secureTags.publicRef, real.publicRef)))[0]).toMatchObject({ tenantId: real.tenantId, programId: real.programId });
    expect(await db.select({ tenantId: plateLinkEvents.newTenantId }).from(plateLinkEvents)).toEqual([{ tenantId: demo.tenantId }]);
    await age(demo.tenantId, 50);
    expect(await endDemos(env, new Date(Date.now() + HOUR))).toEqual({ voided: 0, erased: 1 });
    expect(await db.select().from(tenants).where(eq(tenants.id, real.tenantId))).toHaveLength(1);
    expect((await pool.query("SELECT status, revoked_at FROM wallet_passes WHERE tenant_id = $1", [real.tenantId])).rows).toEqual([{ status: "created", revoked_at: null }]);
    expect(await db.select().from(staffRoles).where(eq(staffRoles.userId, real.owner))).toHaveLength(1);
    expect(await code(() => eraseDemoShop(real.tenantId, env))).toBe("FORBIDDEN");
    expect(await db.select().from(memberships).where(eq(memberships.tenantId, real.tenantId))).toHaveLength(1);
    // A real shop made a minute ago is still never the active demo.
    await age(real.tenantId, 0);
    expect(await activeDemo()).toBeNull();
  });

  it("outside the demo environment the hourly end does nothing, even to a 50-hour-old demo with a live pass", async () => {
    await start();
    const demo = (await activeDemo())!;
    const [card] = await db.select().from(memberships).where(eq(memberships.tenantId, demo.tenantId)).limit(1);
    await pool.query("INSERT INTO wallet_passes (tenant_id, membership_id, provider, provider_object_id, status) VALUES ($1, $2, 'apple', $3, 'active')", [demo.tenantId, card.id, `synthetic-${randomUUID()}`]);
    expect(await demoStatus({})).toBeNull(); // a running demo is not shown outside the demo environment
    await age(demo.tenantId, 50);
    for (const outside of [{}, { DEMO_ENVIRONMENT: "false" }, { DEMO_ENVIRONMENT: "true", PRODUCTION_ENVIRONMENT: "loynara-production" }]) {
      expect(await endDemos(outside)).toEqual({ voided: 0, erased: 0 });
      expect(await demoStatus(outside)).toBeNull();
    }
    expect((await pool.query("SELECT status FROM wallet_passes")).rows).toEqual([{ status: "active" }]);
    expect(await db.select().from(tenants)).toHaveLength(1);
    // The same shop in the demo environment: proves the data would have gone.
    expect(await endDemos(env)).toEqual({ voided: 1, erased: 1 });
  });

  it("checks the operator before the input, clamps sample cards below the reward, and a revoked plate shows the sample card", async () => {
    expect(await code(async () => start(randomUUID(), { businessName: "" }, await user()))).toBe("FORBIDDEN");
    const p = await plate();
    await start(randomUUID(), { templateId: "nails" });
    const demo = (await activeDemo())!;
    const cards = await db.select().from(memberships).where(eq(memberships.tenantId, demo.tenantId));
    expect(Math.max(...cards.map(card => card.balance))).toBe(5); // nails: 6 stamps, the sample's 6 visits capped at 5
    expect(await demoPlateLive(p.publicRef)).toBe(true);
    await db.update(secureTags).set({ status: "revoked", revokedAt: new Date() });
    expect(await demoPlateLive(p.publicRef)).toBe(false);
    // A retry hours later reports the time actually left.
    const key = randomUUID();
    await start(key);
    await age((await activeDemo())!.tenantId, 5);
    expect(await start(key)).toMatchObject({ hoursLeft: 19 });
  });

  it("an owner message goes out only from the running demo, and only to its consenting passes", async () => {
    const real = await realShop();
    await acknowledgeWalletGuidance({ actorUserId: real.owner, programSlug: real.programSlug });
    await messageCard(real.programSlug, real.tenantId, true);
    await start();
    const demo = (await activeDemo())!;
    const [program] = await db.select().from(programs).where(eq(programs.id, demo.programId));
    await acknowledgeWalletGuidance({ actorUserId: operator, programSlug: program.slug });
    const consenting = await messageCard(program.slug, demo.tenantId, true);
    await messageCard(program.slug, demo.tenantId, false);
    const sent = await sendWalletMessage({ actorUserId: operator, programSlug: program.slug, text: "Heute Kaffee aufs Haus, nur bis 17 Uhr." }, daytime());
    expect(sent.audience).toBe(1);
    expect((await pool.query("SELECT pass_id FROM wallet_message_recipients")).rows).toEqual([{ pass_id: consenting }]);
    expect(await code(() => sendWalletMessage({ actorUserId: real.owner, programSlug: real.programSlug, text: "Heute Kaffee aufs Haus, nur bis 17 Uhr." }, daytime()))).toBe("DEMO_ENDED");
    await age(demo.tenantId, 40); // ended, also measured from today's 11:00 the test sends at
    expect(await code(() => sendWalletMessage({ actorUserId: operator, programSlug: program.slug, text: "Morgen wieder offen ab 8 Uhr, bis bald." }, daytime()))).toBe("DEMO_ENDED");
    expect((await pool.query("SELECT count(*)::int AS n FROM wallet_messages")).rows[0].n).toBe(1);
    // Outside the demo environment the real shop sends as before.
    delete process.env.DEMO_ENVIRONMENT;
    expect((await sendWalletMessage({ actorUserId: real.owner, programSlug: real.programSlug, text: "Heute Kaffee aufs Haus, nur bis 17 Uhr." }, daytime())).audience).toBe(1);
  });

  it("the automatic reminders (win-back, birthday, Fast geschafft, expiry) queue nothing in the demo environment and run as before outside it", async () => {
    const spy = vi.spyOn(db, "execute"), transactions = vi.spyOn(db, "transaction");
    const expiry = () => queueCardWalletMessage({ tenantId: randomUUID(), programId: randomUUID(), membershipId: randomUUID(), kind: "expiry", text: "Deine Punkte verfallen bald.", onceWithinDays: 30 }).catch(() => "ran");
    expect([await queueWinbackMessages(), await queueBirthdayMessages(), await queueAlmostMessages(), await expiry()]).toEqual([0, 0, 0, false]);
    expect(spy).not.toHaveBeenCalled();
    expect(transactions).not.toHaveBeenCalled();
    delete process.env.DEMO_ENVIRONMENT;
    await queueWinbackMessages(); await queueBirthdayMessages(); await queueAlmostMessages(); await expiry();
    expect(spy).toHaveBeenCalled();
    expect(transactions).toHaveBeenCalled();
    spy.mockRestore(); transactions.mockRestore();
  });

  it("Ergebnisse: the totals count the sample visits in the demo environment, the Team rows never do", async () => {
    await start();
    const report = await getMerchantAnalytics(operator, { windowDays: 30 });
    expect(report.qualifyingCheckouts).toBeGreaterThan(0);
    expect(report.staffActivity).toEqual([]);
    delete process.env.DEMO_ENVIRONMENT;
    expect((await getMerchantAnalytics(operator, { windowDays: 30 })).qualifyingCheckouts).toBe(0);
  });

  it("the owner board counts the sample visits in the demo environment, and only there", async () => {
    await start();
    const demo = (await activeDemo())!;
    const board = await getLocationAnalytics(operator, { locationId: demo.locationId });
    const retention = await getRetentionSummary(operator, { locationId: demo.locationId });
    expect(board.current.qualifyingCheckouts).toBeGreaterThan(0);
    expect(board.days.some(day => day.bookings > 0)).toBe(true);
    expect(retention.never).toBe(0);
    delete process.env.DEMO_ENVIRONMENT;
    expect((await getLocationAnalytics(operator, { locationId: demo.locationId })).current.qualifyingCheckouts).toBe(0);
    expect((await getRetentionSummary(operator, { locationId: demo.locationId })).never).toBe(6);
  });
});
