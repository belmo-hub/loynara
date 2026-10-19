import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { automationRules, automationRuns, consentEvents, ledgerEntries, locations, membershipContacts, outboxJobs, staffRoles } from "@/db/schema";
import { award } from "./loyalty";
import type { LocalMessage } from "./email";
import { updateLocationAddress } from "./locations";
import { createMerchant, enroll } from "./product";
import { deliverAutomationRun, listAutomations, processAutomationEvent, processAutomationScan, upsertAutomationRule } from "./automations";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Automation tests require looplocal_test");
// Delivery here runs on the wall clock; quiet hours have their own deterministic tests (quiet-hours*.test.ts).
vi.mock("./promotion-policy", async importOriginal => ({ ...(await importOriginal<typeof import("./promotion-policy")>()), quietHoursDeferral: () => null }));

const run = promisify(execFile);

beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "false";
  process.env.MAILGUN_PROMOTIONAL_SEND_APPROVED = "false";
  process.env.BETTER_AUTH_SECRET = "synthetic-automation-secret-long-enough-for-tests";
  delete process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT;
  delete process.env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS;
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN;
  delete process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET;
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture(withAddress = true) {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Automation Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Stamps", programType: "stamp", rulesText: "One stamp for a confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  if (withAddress) await updateLocationAddress(ownerId, { locationId: merchant.locationId, street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel" });
  return { ownerId, merchant };
}

async function member(slug: string, email = "member@example.test") {
  const card = await enroll({ slug, acceptedTerms: true, email, marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  return card;
}

const firstRule = { triggerKind: "first_checkout" as const, enabled: true, subject: "Willkommen", body: "Danke für deinen ersten bestätigten Einkauf.", cooldownDays: 7, dailyCap: 20 };
const inactiveRule = { triggerKind: "inactive" as const, enabled: true, subject: "Wir vermissen dich", body: "Deine digitale Karte ist weiter verfügbar.", inactivityDays: 30, cooldownDays: 7, dailyCap: 20 };

describe("bounded local automations", () => {
  it("sends one consented external automation fixture with a scoped unsubscribe link", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug, "owner-controlled@example.test");
    process.env.PUBLIC_BASE_URL = "https://test.example.test";
    process.env.EXTERNAL_EMAIL_ENABLED = "true";
    process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "true";
    process.env.MAILGUN_PROMOTIONAL_SEND_APPROVED = "true";
    process.env.MAILGUN_SEND_APPROVED = "true";
    process.env.MAILGUN_EU_DOMAIN = "mail.example.test";
    process.env.MAILGUN_FROM_EMAIL = "service@mail.example.test";
    process.env.MAILGUN_EU_API_KEY = "synthetic-key";
    process.env.MAILGUN_EU_WEBHOOK_SIGNING_KEY = "synthetic-signing-key-long-enough";
    process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT = "100";
    process.env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS = "24";
    process.env.PROMOTIONAL_UNSUBSCRIBE_ORIGIN = "https://unsubscribe.example.test";
    process.env.PROMOTIONAL_UNSUBSCRIBE_SECRET = "synthetic-dedicated-unsubscribe-secret-long-enough";
    const provider = { name: "mailgun_eu" as const, send: vi.fn(async (message: LocalMessage) => {
      expect(message.unsubscribeUrl).toContain("/unsubscribe#token=");
      expect(message.fromName).toBe("Synthetic Automation Café via Loynara");
      expect(message.body).toBe(`${firstRule.body}\n\nSynthetic Automation Café · Friedrich-Ebert-Straße 12, 34117 Kassel\nAngebote abbestellen: ${message.unsubscribeUrl} · Datenschutz: https://test.example.test/datenschutz`);
      expect(message.body).not.toContain(card.cardToken);
      return { state: "accepted" as const, messageId: "<automation@example.test>" };
    }) };
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    expect((await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload })).queuedCount).toBe(1);
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
    expect((await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, undefined, undefined, provider)).status).toBe("complete");
    expect((await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 2 }, undefined, undefined, provider)).status).toBe("complete");
    expect(provider.send).toHaveBeenCalledTimes(1);
  });
  it("without a shop address no rule can be switched on and nothing promotional is sent", async () => {
    const f = await fixture(false);
    const card = await member(f.merchant.programSlug);
    await expect(upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule })).rejects.toMatchObject({ code: "ADDRESS_REQUIRED" });
    expect(await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule, enabled: false })).toMatchObject({ enabled: false });
    expect(await listAutomations({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug })).toMatchObject({ addressMissing: true });
    await updateLocationAddress(f.ownerId, { locationId: f.merchant.locationId, street: "Friedrich-Ebert-Straße 12", postalCode: "34117", city: "Kassel" });
    expect(await listAutomations({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug })).toMatchObject({ addressMissing: false });
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload });
    // An address lost after queueing (e.g. a rule enabled before this check existed) still blocks the send.
    await db.update(locations).set({ street: null }).where(eq(locations.id, f.merchant.locationId));
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, send)).toEqual({ status: "suppressed", reason: "Shop address missing" });
    expect(send).not.toHaveBeenCalled();
  });

  it("allows only the active owner to configure rules and exposes aggregate run history", async () => {
    const f = await fixture();
    const cashier = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [cashier, "Synthetic cashier", `${cashier}@example.test`]);
    await db.insert(staffRoles).values({ tenantId: f.merchant.tenantId, userId: cashier, role: "cashier", locationId: f.merchant.locationId });
    await expect(upsertAutomationRule({ actorUserId: cashier, programSlug: f.merchant.programSlug, ...firstRule })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const created = await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule });
    expect(created).toMatchObject({ triggerKind: "first_checkout", enabled: true, revision: 1, channel: "email" });
    const listed = await listAutomations({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug });
    expect(listed).toMatchObject({ localOnly: true, rules: [{ id: created.id }], runs: [] });
    expect(JSON.stringify(listed)).not.toContain("@example.test");
  });

  it("queues the first checkout once, rechecks consent at delivery, and rejects a stale rule revision", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug);
    const rule = await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule });
    const first = await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    expect(event.payload).toMatchObject({ ruleId: rule.id, membershipId: card.id, ledgerEntryId: first.entryId, ruleRevision: "1" });
    const eventOutcome = await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload });
    expect(eventOutcome).toEqual({ status: "complete", queuedCount: 1 });
    expect(await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload })).toMatchObject({ status: "complete" });
    expect(await db.select().from(automationRuns)).toHaveLength(1);
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    await db.insert(consentEvents).values({ tenantId: f.merchant.tenantId, membershipId: card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "test", source: "test" });
    expect(await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, send)).toMatchObject({ status: "suppressed" });
    expect(send).not.toHaveBeenCalled();
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule, subject: "Updated" });
    expect((await db.select().from(automationRules))[0].revision).toBe(2);
    expect((await db.select().from(automationRuns))[0].status).toBe("suppressed");
  });

  it("delivers one local first-checkout message and does not resend a completed run", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug);
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    expect((await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload })).status).toBe("complete");
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect((await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, send)).status).toBe("complete");
    expect((await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 2 }, send)).status).toBe("complete");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: "member@example.test", subject: firstRule.subject });
    expect(send.mock.calls[0][0].body).toContain("Angebote abbestellen:");
    expect((await db.select().from(automationRuns))[0]).toMatchObject({ status: "complete", attempts: 1 });
  });

  it("suppresses queued content when its rule is edited before delivery", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug);
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload });
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule, subject: "Changed after queueing" });
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect((await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, send)).status).toBe("suppressed");
    expect(send).not.toHaveBeenCalled();
    expect((await db.select().from(automationRuns))[0]).toMatchObject({ status: "suppressed", reason: "Rule disabled or changed" });
  });

  it("queues at most one inactive run per day and does not notify cards without an earlier checkout", async () => {
    const f = await fixture();
    const old = await member(f.merchant.programSlug, "old@example.test");
    const anotherOld = await member(f.merchant.programSlug, "another@example.test");
    await member(f.merchant.programSlug, "never@example.test");
    await db.insert(ledgerEntries).values([old, anotherOld].map(card => ({ tenantId: f.merchant.tenantId, locationId: f.merchant.locationId, membershipId: card.id, delta: 1, kind: "award", source: "staff_online", actorUserId: f.ownerId, requestId: randomUUID(), idempotencyKey: randomUUID(), createdAt: new Date(Date.now() - 45 * 86_400_000) })));
    const rule = await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...inactiveRule, dailyCap: 1 });
    const [scan] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.scan"));
    expect(scan.payload).toMatchObject({ ruleId: rule.id, ruleRevision: "1" });
    expect(await processAutomationScan({ id: scan.id, tenantId: scan.tenantId, payload: scan.payload })).toMatchObject({ status: "complete", queuedCount: 1 });
    const runs = await db.select().from(automationRuns);
    expect(runs).toHaveLength(1);
    expect([old.id, anotherOld.id]).toContain(runs[0].membershipId);
    expect((await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"))).length).toBe(1);
    const listedRuns = (await listAutomations({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug })).runs;
    expect(listedRuns).toEqual([expect.objectContaining({ membershipId: runs[0].membershipId, cardLocator: expect.stringMatching(/^K-[0-9A-Z]{6}$/) })]);
    expect(await processAutomationScan({ id: scan.id, tenantId: scan.tenantId, payload: scan.payload })).toMatchObject({ status: "suppressed" });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: runs[0].membershipId, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect((await deliverAutomationRun({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, send)).status).toBe("suppressed");
    expect(send).not.toHaveBeenCalled();
  });

  it("enforces a member cooldown across first-checkout and inactive rules", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug);
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule, cooldownDays: 14 });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload });
    const future = new Date(Date.now() + 8 * 86_400_000);
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...inactiveRule, inactivityDays: 7, cooldownDays: 14 }, future);
    const [scan] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.scan"));
    expect(await processAutomationScan({ id: scan.id, tenantId: scan.tenantId, payload: scan.payload }, future)).toMatchObject({ status: "complete", queuedCount: 0 });
    expect(await db.select().from(automationRuns)).toHaveLength(1);
  });

  it("processes a contact-free checkout through the real worker without creating a delivery job", async () => {
    const f = await fixture();
    const card = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true });
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...firstRule });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { cwd: process.cwd(), env: process.env, timeout: 10_000 });
    const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
    expect(event.status).toBe("complete");
    expect((await db.select().from(automationRuns))[0]).toMatchObject({ status: "suppressed", reason: "Contact unavailable or unverified" });
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"))).toHaveLength(0);
  });
});
