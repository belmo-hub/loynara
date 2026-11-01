import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { automationRuns, campaignAttempts, campaignRecipients, campaigns, consentEvents, emailSuppressions, membershipContacts, outboxJobs } from "@/db/schema";
import { deliverAutomationRun, processAutomationEvent, upsertAutomationRule } from "./automations";
import { cancelCampaign, createDraftCampaign, deliverCampaignRecipient, dispatchCampaign, scheduleCampaign } from "./campaigns";
import { claimOutboxJob, deferOutboxJob, markOutboxJob } from "./outbox";
import { hasRecentPromotion, quietHoursDeferral } from "./promotion-policy";
import { recipientHash } from "./transactional-email";
import { award } from "./loyalty";
import { updateLocationAddress } from "./locations";
import { createMerchant, enroll } from "./product";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Quiet-hours tests require looplocal_test");

beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  process.env.PROMOTIONAL_EXTERNAL_EMAIL_ENABLED = "false";
  process.env.BETTER_AUTH_SECRET = "synthetic-quiet-hours-secret-long-enough-for-tests";
  delete process.env.PROMOTIONAL_MONTHLY_LOCATION_LIMIT;
  delete process.env.PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS;
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, email_suppressions CASCADE');
});
afterAll(async () => { await pool.end(); });

async function queuedRun(timezone: string) {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Quiet Café", city: "Kassel", country: timezone === "Africa/Casablanca" ? "MA" : "DE", timezone, locale: "de", currency: timezone === "Africa/Casablanca" ? "MAD" : "EUR", programName: "Stamps", programType: "stamp", rulesText: "One stamp for a confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  await updateLocationAddress(ownerId, { locationId: merchant.locationId, street: "Teststraße 1", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactPhone: "0561 123456" });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "quiet@example.test", marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  await upsertAutomationRule({ actorUserId: ownerId, programSlug: merchant.programSlug, triggerKind: "first_checkout", enabled: true, subject: "Willkommen", body: "Danke für deinen ersten bestätigten Einkauf.", cooldownDays: 7, dailyCap: 20 });
  await award({ userId: ownerId, locationId: merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
  const [event] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "automation.event"));
  expect((await processAutomationEvent({ id: event.id, tenantId: event.tenantId, payload: event.payload })).queuedCount).toBe(1);
  const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.automation"));
  return { card, merchant, job: { id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 } };
}

describe("quiet hours at delivery", () => {
  it("defers a late-evening send to 09:00 local time without sending or finalising the run", async () => {
    const { job } = await queuedRun("Europe/Berlin");
    const send = vi.fn(async () => {});
    const evening = new Date("2026-10-05T20:30:00Z"); // 22:30 CEST
    expect(await deliverAutomationRun(job, send, evening)).toEqual({ status: "deferred", reason: "Quiet hours in the location's timezone", until: new Date("2026-10-06T07:00:00Z") });
    expect(send).not.toHaveBeenCalled();
    const [run] = await db.select().from(automationRuns);
    expect(run.status).toBe("queued");

    expect((await deliverAutomationRun({ ...job, attempts: 2 }, send, new Date("2026-10-06T07:00:30Z"))).status).toBe("complete");
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("re-checks eligibility when the deferred send wakes up", async () => {
    const { job, card, merchant } = await queuedRun("Europe/Berlin");
    const send = vi.fn(async () => {});
    expect((await deliverAutomationRun(job, send, new Date("2026-10-05T21:00:00Z"))).status).toBe("deferred");
    await db.insert(consentEvents).values({ tenantId: merchant.tenantId, membershipId: card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "2026-09", source: "card" });
    expect(await deliverAutomationRun({ ...job, attempts: 2 }, send, new Date("2026-10-06T07:05:00Z"))).toMatchObject({ status: "suppressed", reason: "Marketing consent absent or withdrawn" });
    expect(send).not.toHaveBeenCalled();
  });

  it("follows the location's timezone", async () => {
    const { job } = await queuedRun("Africa/Casablanca");
    const send = vi.fn(async () => {});
    // 19:30Z is 20:30 in Casablanca (allowed) but 21:30 in Berlin.
    expect((await deliverAutomationRun(job, send, new Date("2026-10-05T19:30:00Z"))).status).toBe("complete");
  });
});

async function queuedCampaign(timezone = "Europe/Berlin") {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Quiet Campaign Café", city: "Kassel", country: timezone === "Africa/Casablanca" ? "MA" : "DE", timezone, locale: "de", currency: timezone === "Africa/Casablanca" ? "MAD" : "EUR", programName: "Stamps", programType: "stamp", rulesText: "One stamp for a confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  await updateLocationAddress(ownerId, { locationId: merchant.locationId, street: "Teststraße 1", postalCode: "34117", city: "Kassel", representative: "Erika Muster", contactPhone: "0561 123456" });
  const card = await enroll({ slug: merchant.programSlug, acceptedTerms: true, email: "campaign-quiet@example.test", marketingOptIn: true });
  await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  const draft = await createDraftCampaign({ actorUserId: ownerId, programSlug: merchant.programSlug, title: "Quiet hours note", subject: "Local test offer", body: "A short synthetic message for a local test.", audienceDefinition: { kind: "new", withinDays: 7 } });
  const when = new Date(Date.now() + 1_000);
  await scheduleCampaign({ actorUserId: ownerId, campaignId: draft.id, scheduledAt: when });
  const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
  await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000));
  const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
  return { ownerId, merchant, card, campaignId: draft.id, job: { id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 } };
}
const recipientStatus = async () => (await db.select().from(campaignRecipients))[0];
const noProvider = null;

describe("quiet hours for campaigns follow the same rule as automations", () => {
  it("defers a late send, records no attempt, then sends at 09:00 local time", async () => {
    const { job, campaignId } = await queuedCampaign();
    const send = vi.fn(async () => {});
    const night = new Date("2026-10-05T20:45:00Z"); // 22:45 CEST
    const outcome = await deliverCampaignRecipient(job, send, noProvider, night);
    expect(outcome).toEqual({ status: "deferred", reason: "Quiet hours in the location's timezone", until: new Date("2026-10-06T07:00:00Z") });
    expect(outcome.status === "deferred" && outcome.until).toEqual(quietHoursDeferral(night, "Europe/Berlin"));
    expect(send).not.toHaveBeenCalled();
    expect((await recipientStatus()).status).toBe("queued");
    expect(await db.select().from(campaignAttempts)).toHaveLength(0);
    expect((await db.select().from(campaigns).where(eq(campaigns.id, campaignId)))[0].status).toBe("dispatching");

    expect((await deliverCampaignRecipient({ ...job, attempts: 2 }, send, noProvider, new Date("2026-10-06T07:00:05Z"))).status).toBe("complete");
    expect(send).toHaveBeenCalledTimes(1);
    expect((await recipientStatus()).status).toBe("complete");
  });

  it("respects cancellation, withdrawn consent and suppression that happen while a message waits", async () => {
    const night = new Date("2026-10-05T21:30:00Z");
    const morning = new Date("2026-10-06T07:30:00Z");
    for (const scenario of ["cancel", "opt-out", "suppress"] as const) {
      await pool.query('TRUNCATE TABLE tenants, "user", demo_requests, email_suppressions CASCADE');
      const { job, ownerId, campaignId, merchant, card } = await queuedCampaign();
      const send = vi.fn(async () => {});
      expect((await deliverCampaignRecipient(job, send, noProvider, night)).status, scenario).toBe("deferred");
      if (scenario === "cancel") await cancelCampaign({ actorUserId: ownerId, campaignId });
      if (scenario === "opt-out") await db.insert(consentEvents).values({ tenantId: merchant.tenantId, membershipId: card.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "2026-09", source: "card" });
      if (scenario === "suppress") await db.insert(emailSuppressions).values({ recipientHash: recipientHash("campaign-quiet@example.test"), reason: "unsubscribed" });
      const result = await deliverCampaignRecipient({ ...job, attempts: 2 }, send, noProvider, morning);
      expect(result.status, scenario).toBe("suppressed");
      expect(send, scenario).not.toHaveBeenCalled();
      expect((await recipientStatus()).status, scenario).toBe("suppressed");
    }
  });

  it("does not use up the customer's frequency allowance or the location's monthly allowance by waiting", async () => {
    const { job, merchant, card } = await queuedCampaign();
    const send = vi.fn(async () => {});
    expect((await deliverCampaignRecipient(job, send, noProvider, new Date("2026-10-05T22:00:00Z"))).status).toBe("deferred");
    expect(await hasRecentPromotion(db, merchant.tenantId, card.id, new Date("2026-10-05T22:00:00Z"))).toBe(false);
    expect((await deliverCampaignRecipient({ ...job, attempts: 2 }, send, noProvider, new Date("2026-10-06T07:00:30Z"))).status).toBe("complete");
    // Only a delivered message starts the cooldown (delivery stamps sent_at with the real clock, so ask with the real clock).
    expect(await hasRecentPromotion(db, merchant.tenantId, card.id, new Date())).toBe(true);
  });

  it("uses the location's timezone, not the server's", async () => {
    const { job } = await queuedCampaign("Africa/Casablanca");
    const send = vi.fn(async () => {});
    expect((await deliverCampaignRecipient(job, send, noProvider, new Date("2026-10-05T19:30:00Z"))).status).toBe("complete"); // 20:30 in Casablanca
  });
});

describe("a deferral never spends retry budget on the real queue", () => {
  const limits = { maxAttempts: 5, leaseMinutes: 5 };
  async function enqueue() {
    const ownerId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
    const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Queue Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Stamps", programType: "stamp", rulesText: "One stamp for a confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
    await pool.query("DELETE FROM outbox_jobs");
    const [job] = await db.insert(outboxJobs).values({ tenantId: merchant.tenantId, kind: "email.campaign", payload: {} }).returning();
    return job.id;
  }
  const row = async (id: string) => (await pool.query<{ status: string; attempts: number; next_attempt_at: Date; last_error: string | null }>("SELECT status, attempts, next_attempt_at, last_error FROM outbox_jobs WHERE id = $1", [id])).rows[0];

  it("gives the claimed attempt back, sleeps until the allowed time and is not claimable earlier", async () => {
    const id = await enqueue();
    for (let night = 1; night <= 8; night++) {
      const claimed = await claimOutboxJob(pool, limits);
      expect(claimed, `claim ${night}`).toMatchObject({ id, attempts: 1 });
      const until = new Date(Date.now() + 3_600_000);
      await deferOutboxJob(pool, claimed!, "Quiet hours in the location's timezone", until);
      expect(await row(id)).toMatchObject({ status: "retry", attempts: 0, last_error: "Quiet hours in the location's timezone" });
      expect((await row(id)).next_attempt_at.getTime()).toBe(until.getTime());
      expect(await claimOutboxJob(pool, limits)).toBeNull(); // still asleep
      await pool.query("UPDATE outbox_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [id]);
    }
    const last = await claimOutboxJob(pool, limits);
    await markOutboxJob(pool, last!, "complete");
    expect(await row(id)).toMatchObject({ status: "complete", attempts: 1 });
  });

  it("still counts genuine failures toward the limit, and ignores a deferral from a lost lease", async () => {
    const failing = await enqueue();
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claimed = await claimOutboxJob(pool, limits);
      expect(claimed).toMatchObject({ id: failing, attempts: attempt });
      await markOutboxJob(pool, claimed!, "retry", "Provider unavailable");
      await pool.query("UPDATE outbox_jobs SET next_attempt_at = now() - interval '1 second' WHERE id = $1", [failing]);
    }
    expect(await claimOutboxJob(pool, limits)).toBeNull(); // five real attempts are the limit

    await pool.query("DELETE FROM outbox_jobs");
    const id = await enqueue();
    const stale = await claimOutboxJob(pool, limits);
    await pool.query("UPDATE outbox_jobs SET attempts = 2 WHERE id = $1", [id]); // another worker took the lease over
    await deferOutboxJob(pool, stale!, "Quiet hours", new Date(Date.now() + 3_600_000));
    expect(await row(id)).toMatchObject({ status: "processing", attempts: 2 });
  });
});
