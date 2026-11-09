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
import { POST as demoRoute } from "@/app/api/operator/demo/route";
import { GET as tapGet } from "@/app/api/tap/[ref]/route";
import TapPage from "@/app/tap/[ref]/page";
import { DemoSampleCard } from "@/components/customer/demo-sample-card";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Dedicated synthetic database required");

const ORIGIN = "https://demo.example-pilot.test";
const VERIFY = parseMaster("7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a");
const ADMIN = parseMaster("c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e");
const UID = "04de5f1eacc042";
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
async function plate(label = "D-001") {
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
