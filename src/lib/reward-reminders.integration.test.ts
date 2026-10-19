import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { automationRuns, consentEvents, emailSuppressions, membershipContacts, outboxJobs, rewards, rewardVersions, staffRoles } from "@/db/schema";
import { updateLocationAddress } from "./locations";
import { createMerchant, enroll } from "./product";
import { award, redeem, reverseEntry } from "./loyalty";
import { deliverAutomationRun, processAutomationScan, upsertAutomationRule } from "./automations";
import { mailgunEuProvider, recipientHash } from "./transactional-email";
import type { LocalMessage } from "./email";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Reward reminder tests require looplocal_test");
const DAY = 86_400_000;
const ruleInput = { triggerKind: "reward_ready" as const, enabled: true, subject: "Deine Prämie wartet", body: "Eine Prämie ist mit deinem Guthaben verfügbar.", cooldownDays: 7, dailyCap: 20 };
beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "false";
  process.env.BETTER_AUTH_SECRET = "synthetic-reward-reminder-secret-long-enough";
  delete process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT;
  delete process.env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS;
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, email_suppressions CASCADE');
});
afterAll(async () => { await pool.end(); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function fixture(quantity = 8, email = "reward@example.test", rewardTitle = "Coffee") {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Reward Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Stamps", programType: "stamp", rulesText: "One stamp per purchase.", rewardTitle, rewardCost: 8 });
  await updateLocationAddress(ownerId, { locationId: merchant.locationId, street: "Teststraße 1", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactPhone: "0561 123456" });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email, marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  const entry = quantity ? await award({ userId: ownerId, locationId: merchant.locationId, membershipId: card.id, quantity, idempotencyKey: randomUUID(), requestId: randomUUID() }) : null;
  const now = new Date((await pool.query("SELECT clock_timestamp() AS now")).rows[0].now.getTime() + 1000);
  now.setUTCHours(10, 0, 0, 0);
  now.setUTCDate(now.getUTCDate() + 1); // daylight in Berlin; all fixture rows predate the scan
  return { ownerId, merchant, card, entry, now };
}
async function queue(f: Awaited<ReturnType<typeof fixture>>) {
  const rule = await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...ruleInput }, f.now);
  const [scan] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.scan"));
  const outcome = await processAutomationScan(scan, f.now);
  return { rule, scan, outcome };
}
async function delivery() {
  const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
  return { ...job, attempts: 1 };
}

describe("LOY-133 catalogue reward reminders", () => {
  it("queues only ready cards in the owning programme and sends one logical notification under concurrent replay", async () => {
    const f = await fixture();
    await fixture(8, "other@example.test");
    const below = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true, email: "below@example.test", marketingOptIn: true });
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, below.id));
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: below.id, quantity: 7, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const { scan, outcome } = await queue(f);
    expect(outcome).toMatchObject({ status: "complete", queuedCount: 1 });
    expect(await processAutomationScan(scan, f.now)).toMatchObject({ status: "suppressed" });
    expect(await db.select().from(automationRuns)).toEqual([expect.objectContaining({ membershipId: f.card.id, tenantId: f.merchant.tenantId })]);
    const job = await delivery();
    const sent: LocalMessage[] = [];
    const send = async (message: LocalMessage) => { sent.push(message); };
    const results = await Promise.all([deliverAutomationRun(job, send, f.now), deliverAutomationRun(job, send, f.now)]);
    expect(results.map(x => x.status)).toEqual(["complete", "complete"]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ to: "reward@example.test", subject: ruleInput.subject });
    expect(sent[0].body).toContain("Abmelden:");
    expect((await db.select().from(automationRuns))[0]).toMatchObject({ status: "complete", attempts: 1 });
    const nextScan = (await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.scan"))).find(x => x.id !== scan.id)!;
    expect(await processAutomationScan(nextScan, new Date(f.now.getTime() + DAY))).toMatchObject({ queuedCount: 0 });
    expect(await db.select().from(automationRuns)).toHaveLength(1);
  });

  it("inserts {prämie} as the ready reward's title exactly as the owner typed it, at send time, with no card link", async () => {
    const f = await fixture(8, "reward@example.test", "Gratis-Haarschnitt (Herren) & Bart");
    const subject = "Deine Prämie ist bereit: {prämie}";
    const body = "Hallo,\n\nauf deiner Karte bei Synthetic Reward Café ist deine Prämie bereit: {prämie}. Hol sie bei deinem nächsten Besuch ab.";
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...ruleInput, subject, body }, f.now);
    const [scan] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.scan"));
    expect(await processAutomationScan(scan, f.now)).toMatchObject({ queuedCount: 1 });
    // The stored rule keeps the placeholder; only the sent copy carries the title.
    const sent: LocalMessage[] = [];
    expect(await deliverAutomationRun(await delivery(), async message => { sent.push(message); }, f.now)).toMatchObject({ status: "complete" });
    expect(sent[0].subject).toBe("Deine Prämie ist bereit: Gratis-Haarschnitt (Herren) & Bart");
    expect(sent[0].body.startsWith("Hallo,\n\nauf deiner Karte bei Synthetic Reward Café ist deine Prämie bereit: Gratis-Haarschnitt (Herren) & Bart. Hol sie")).toBe(true);
    expect(sent[0].body).not.toContain("{prämie}");
    expect(sent[0].body).not.toContain(f.card.cardToken);
    expect(sent[0].body).not.toContain("/card/");
    // Only "Prämie bereit" knows a reward: elsewhere the placeholder would go out as typed, so it is refused.
    await expect(upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, triggerKind: "inactive", enabled: false, subject: "Wir vermissen dich", body: "Deine {prämie} wartet.", inactivityDays: 30, cooldownDays: 7, dailyCap: 20 }, f.now)).rejects.toThrow();
  });

  it("requires owner authorization and rejects a forged tenant scan", async () => {
    const f = await fixture();
    const other = await fixture(8, "other@example.test");
    await expect(upsertAutomationRule({ actorUserId: other.ownerId, programSlug: f.merchant.programSlug, ...ruleInput }, f.now)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const { scan } = await queue(f);
    expect(await processAutomationScan({ ...scan, tenantId: other.merchant.tenantId }, f.now)).toMatchObject({ status: "suppressed" });
    expect(await deliverAutomationRun({ ...await delivery(), tenantId: other.merchant.tenantId }, async () => { throw new Error("Must not send"); }, f.now)).toMatchObject({ status: "suppressed" });
  });

  it.each(["withdrawn", "unverified", "suppressed"] as const)("excludes %s contacts at scheduling", async condition => {
    const f = await fixture();
    if (condition === "withdrawn") await db.insert(consentEvents).values({ tenantId: f.merchant.tenantId, membershipId: f.card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "test", source: "test" });
    if (condition === "unverified") await db.update(membershipContacts).set({ emailVerified: false }).where(eq(membershipContacts.membershipId, f.card.id));
    if (condition === "suppressed") await db.insert(emailSuppressions).values({ recipientHash: recipientHash("reward@example.test"), reason: "permanent_fail" });
    expect((await queue(f)).outcome).toMatchObject({ queuedCount: 0 });
    expect(await db.select().from(automationRuns)).toHaveLength(0);
  });

  it.each(["consent", "suppression", "redemption", "reversal", "catalogue", "disabled", "owner"] as const)("rechecks %s immediately before dispatch", async condition => {
    const f = await fixture();
    await queue(f);
    if (condition === "consent") await db.insert(consentEvents).values({ tenantId: f.merchant.tenantId, membershipId: f.card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "test", source: "test" });
    if (condition === "suppression") await db.insert(emailSuppressions).values({ recipientHash: recipientHash("reward@example.test"), reason: "permanent_fail" });
    if (condition === "redemption") {
      const [version] = await db.select().from(rewardVersions);
      await redeem({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: f.card.id, rewardVersionId: version.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
    }
    if (condition === "reversal") await reverseEntry({ userId: f.ownerId, locationId: f.merchant.locationId, entryId: f.entry!.entryId, reason: "Synthetic correction", idempotencyKey: randomUUID(), requestId: randomUUID() });
    if (condition === "catalogue") await db.update(rewards).set({ active: false });
    if (condition === "disabled") await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...ruleInput, enabled: false }, f.now);
    if (condition === "owner") await db.update(staffRoles).set({ active: false }).where(eq(staffRoles.userId, f.ownerId));
    const sent: LocalMessage[] = [];
    expect(await deliverAutomationRun(await delivery(), async message => { sent.push(message); }, f.now)).toMatchObject({ status: "suppressed" });
    expect(sent).toHaveLength(0);
    expect((await db.select().from(automationRuns))[0].status).toBe("suppressed");
  });

  it("defers quiet-hours delivery and rechecks readiness after the waiting period", async () => {
    const f = await fixture();
    await queue(f);
    const quiet = new Date(f.now); quiet.setUTCHours(22);
    const sent: LocalMessage[] = [];
    const send = async (message: LocalMessage) => { sent.push(message); };
    const result = await deliverAutomationRun(await delivery(), send, quiet);
    expect(result).toMatchObject({ status: "deferred" });
    expect(sent).toHaveLength(0);
    if (result.status !== "deferred") throw new Error("Expected deferred result");
    await db.update(rewards).set({ active: false });
    expect(await deliverAutomationRun(await delivery(), send, result.until)).toMatchObject({ status: "suppressed" });
    expect(sent).toHaveLength(0);
  });

  it("uses the latest effective catalogue cost rather than a stale cheap version", async () => {
    const f = await fixture();
    const [reward] = await db.select().from(rewards);
    await db.insert(rewardVersions).values({ tenantId: f.merchant.tenantId, rewardId: reward.id, version: 2, title: "Updated coffee", cost: 9, effectiveAt: f.now });
    expect((await queue(f)).outcome).toMatchObject({ queuedCount: 0 });
  });

  it("ignores a future catalogue version until it becomes effective", async () => {
    const f = await fixture();
    const [reward] = await db.select().from(rewards);
    await db.insert(rewardVersions).values({ tenantId: f.merchant.tenantId, rewardId: reward.id, version: 2, title: "Future coffee", cost: 9, effectiveAt: new Date(f.now.getTime() + DAY) });
    expect((await queue(f)).outcome).toMatchObject({ queuedCount: 1 });
    const sent: LocalMessage[] = [];
    expect(await deliverAutomationRun(await delivery(), async message => { sent.push(message); }, new Date(f.now.getTime() + DAY))).toMatchObject({ status: "suppressed" });
    expect(sent).toHaveLength(0);
  });

  it("serializes duplicate scans and respects the rule's daily cap", async () => {
    const f = await fixture();
    const another = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true, email: "another@example.test", marketingOptIn: true });
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, another.id));
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: another.id, quantity: 8, idempotencyKey: randomUUID(), requestId: randomUUID() });
    await upsertAutomationRule({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...ruleInput, dailyCap: 1 }, f.now);
    const [scan] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.scan"));
    const results = await Promise.all([processAutomationScan(scan, f.now), processAutomationScan(scan, f.now)]);
    expect(results.map(x => x.status).sort()).toEqual(["complete", "suppressed"]);
    expect(await db.select().from(automationRuns)).toHaveLength(1);
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"))).toHaveLength(1);
  });

  it("respects the shared location monthly cap before creating a reward delivery", async () => {
    const f = await fixture();
    await queue(f);
    const another = await enroll({ slug: f.merchant.programSlug, acceptedTerms: true, email: "later@example.test", marketingOptIn: true });
    await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, another.id));
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: another.id, quantity: 8, idempotencyKey: randomUUID(), requestId: randomUUID() });
    process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT = "1";
    const next = (await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.scan"))).find(x => new Date(String(x.payload.scanAt)) > f.now)!;
    expect(await processAutomationScan(next, new Date(f.now.getTime() + DAY))).toMatchObject({ queuedCount: 0 });
    expect(await db.select().from(automationRuns)).toHaveLength(1);
  });

  it.each(["accept", "withdraw", "redeem"] as const)("rechecks eligibility after HTTP 429 before %s retry", async action => {
    const f = await fixture();
    await queue(f);
    const config = {
      PUBLIC_BASE_URL: "https://app.example.test", SMTP_HOST: "disabled", EXTERNAL_EMAIL_ENABLED: "true",
      PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "true", MAILGUN_SEND_APPROVED: "true", MAILGUN_PROMOTIONAL_SEND_APPROVED: "true",
      PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "100", PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "24",
      MAILGUN_EU_DOMAIN: "mail.example.test", MAILGUN_FROM_EMAIL: "service@mail.example.test", MAILGUN_EU_API_KEY: "synthetic-key",
      MAILGUN_EU_WEBHOOK_SIGNING_KEY: "synthetic-signing-key-over-32-characters",
      PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "https://unsubscribe.example.test", PROMOTIONAL_UNSUBSCRIBE_SECRET: "synthetic-unsubscribe-secret-over-32-characters",
    };
    for (const [key, value] of Object.entries(config)) vi.stubEnv(key, value);
    vi.stubGlobal("fetch", async () => { throw new Error("Uncontrolled HTTP forbidden"); });
    let calls = 0;
    const provider = mailgunEuProvider(process.env, (async () => {
      calls++;
      return calls === 1 ? new Response(null, { status: 429 }) : Response.json({ id: "<reward-synthetic@example.test>" });
    }) as typeof fetch, "promotional")!;
    const job = await delivery();
    expect(await deliverAutomationRun(job, undefined, f.now, provider)).toEqual({ status: "retry", reason: "Provider rate limit", retryAt: expect.any(Date) });
    expect((await db.select().from(automationRuns))[0]).toMatchObject({ status: "queued", attempts: 1 });
    await pool.query("UPDATE email_deliveries SET retry_at=clock_timestamp()-interval '1 second' WHERE job_id=$1", [job.id]);
    if (action === "withdraw") await db.insert(consentEvents).values({ tenantId: f.merchant.tenantId, membershipId: f.card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "test", source: "test" });
    if (action === "redeem") {
      const [version] = await db.select().from(rewardVersions);
      await redeem({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: f.card.id, rewardVersionId: version.id, idempotencyKey: randomUUID(), requestId: randomUUID() });
    }
    const result = await deliverAutomationRun({ ...job, attempts: 2 }, undefined, f.now, provider);
    expect(result.status).toBe(action === "accept" ? "complete" : "suppressed");
    expect(calls).toBe(action === "accept" ? 2 : 1);
    expect(await deliverAutomationRun({ ...job, attempts: 3 }, undefined, f.now, provider)).toMatchObject({ status: action === "accept" ? "complete" : "suppressed" });
    expect(calls).toBe(action === "accept" ? 2 : 1);
  });
});
