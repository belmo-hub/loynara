import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db, pool } from "@/db";
import { campaignAttempts, campaignDailyUsage, campaignRecipients, campaigns, consentEvents, membershipContacts, outboxJobs, staffRoles } from "@/db/schema";
import { createMerchant, enroll } from "./product";
import { type LocalMessage } from "./email";
import { createDraftCampaign, dispatchCampaign, deliverCampaignRecipient, editDraftCampaign, getCampaign, pauseCampaign, previewCampaign, scheduleCampaign } from "./campaigns";
import { award } from "./loyalty";

if (!process.env.DATABASE_URL?.endsWith("/looplocal_test")) throw new Error("Campaign tests require looplocal_test");
const run = promisify(execFile);

beforeEach(async () => {
  process.env.SMTP_HOST = "localhost";
  process.env.PUBLIC_BASE_URL = "http://localhost:3000";
  process.env.EXTERNAL_EMAIL_ENABLED = "false";
  await pool.query('TRUNCATE TABLE tenants, "user", demo_requests CASCADE');
});
afterAll(async () => { await pool.end(); });

async function fixture() {
  const ownerId = randomUUID();
  await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [ownerId, "Synthetic owner", `${ownerId}@example.test`]);
  const merchant = await createMerchant({ userId: ownerId, businessName: "Synthetic Café", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName: "Synthetic Stamps", programType: "stamp", rulesText: "One stamp per confirmed purchase.", rewardTitle: "Coffee", rewardCost: 8 });
  return { ownerId, merchant };
}

async function member(slug: string, email: string | null, verified: boolean, consent: boolean) {
  const card = await enroll({ slug, acceptedTerms: true, ...(email ? { email, marketingOptIn: consent } : {}) });
  if (email && verified) await db.update(membershipContacts).set({ emailVerified: true }).where(eq(membershipContacts.membershipId, card.id));
  return card;
}

const audienceDefinition = { kind: "new" as const, withinDays: 7 };
const draftFields = { title: "Synthetic autumn note", subject: "Local test offer", body: "A short synthetic message for a local test.", audienceDefinition };

describe("local campaign core", () => {
  it("previews only verified, consented synthetic contacts and enforces owner scope", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, "eligible@example.test", true, true);
    await member(f.merchant.programSlug, "unverified@example.test", false, true);
    await member(f.merchant.programSlug, "no-consent@example.test", true, false);
    await member(f.merchant.programSlug, "real@example.com", true, true);
    const preview = await previewCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, audienceDefinition });
    expect(preview).toMatchObject({ total: 4, eligibleCount: 1, excludedCountsByReason: { unverified: 1, noConsent: 1, nonSynthetic: 1, closed: 0, quota: 0 }, localOnly: true, dailyQuota: 100 });
    expect(JSON.stringify(preview)).not.toContain("@example");
    const cashierId = randomUUID();
    await pool.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, false)', [cashierId, "Synthetic cashier", `${cashierId}@example.test`]);
    await db.insert(staffRoles).values({ tenantId: f.merchant.tenantId, userId: cashierId, role: "cashier", locationId: f.merchant.locationId });
    await expect(createDraftCampaign({ actorUserId: cashierId, programSlug: f.merchant.programSlug, ...draftFields })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("edits drafts, versions schedule jobs, and keeps paused jobs stale", async () => {
    const f = await fixture();
    const created = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const edited = await editDraftCampaign({ actorUserId: f.ownerId, campaignId: created.id, ...draftFields, title: "Synthetic edited note" });
    expect(edited.title).toBe("Synthetic edited note");
    const when = new Date(Date.now() + 60_000);
    const scheduled = await scheduleCampaign({ actorUserId: f.ownerId, campaignId: created.id, scheduledAt: when });
    expect(scheduled).toMatchObject({ campaignId: created.id, status: "scheduled", scheduledAt: when });
    const firstJobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(firstJobs).toHaveLength(1);
    expect(firstJobs[0].payload).toMatchObject({ campaignId: created.id, scheduleRevision: "1" });
    await expect(editDraftCampaign({ actorUserId: f.ownerId, campaignId: created.id, ...draftFields })).rejects.toMatchObject({ code: "CAMPAIGN_LOCKED" });
    expect(await pauseCampaign({ actorUserId: f.ownerId, campaignId: created.id })).toMatchObject({ campaignId: created.id, status: "paused" });
    expect(await dispatchCampaign({ id: firstJobs[0].id, tenantId: f.merchant.tenantId, payload: firstJobs[0].payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "suppressed" });
    const resumed = await scheduleCampaign({ actorUserId: f.ownerId, campaignId: created.id, scheduledAt: new Date(Date.now() + 120_000) });
    expect(resumed.status).toBe("scheduled");
    const jobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(jobs.map(job => job.payload.scheduleRevision)).toEqual(["1", "3"]);
  });

  it("reserves quota and queues one local outbox job per eligible member, then rechecks withdrawal", async () => {
    const f = await fixture();
    const first = await member(f.merchant.programSlug, "first@example.test", true, true);
    const second = await member(f.merchant.programSlug, "second@example.test", true, true);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    const [dispatchJob] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: dispatchJob.id, tenantId: f.merchant.tenantId, payload: dispatchJob.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "complete", queuedCount: 2 });
    expect(await db.select().from(campaignRecipients)).toHaveLength(2);
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    const emailJobs = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
    expect(emailJobs).toHaveLength(2);
    expect(JSON.stringify(emailJobs)).not.toContain("@example.test");
    await db.insert(consentEvents).values({ tenantId: f.merchant.tenantId, membershipId: second.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "test", source: "test" });
    for (const job of emailJobs) {
      await deliverCampaignRecipient({ id: job.id, tenantId: job.tenantId, payload: job.payload, attempts: 1 }, send);
    }
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ to: "first@example.test" });
    expect((await db.select().from(campaignRecipients)).map(row => row.status).sort()).toEqual(["complete", "suppressed"]);
    expect(await db.select().from(campaignAttempts)).toHaveLength(2);
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).summary).toMatchObject({ sent: 1, suppressed: 1, queued: 0 });
    expect((await db.select().from(campaignDailyUsage))[0].queued).toBe(2);
    expect([first.id, second.id].sort()).toEqual((await db.select().from(campaignRecipients)).map(row => row.membershipId).sort());
  });

  it("suppresses a queued message when the member leaves the selected audience before delivery", async () => {
    const f = await fixture();
    const card = await member(f.merchant.programSlug, "reward-gap@example.test", true, true);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields,
      audienceDefinition: { kind: "close_to_reward", maxRemaining: 8 } });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: dispatch.id, tenantId: dispatch.tenantId, payload: dispatch.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ queuedCount: 1 });
    await award({ userId: f.ownerId, locationId: f.merchant.locationId, membershipId: card.id, quantity: 8, idempotencyKey: randomUUID(), requestId: randomUUID() });
    const [delivery] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"));
    const send = vi.fn(async (message: LocalMessage) => { void message; });
    expect(await deliverCampaignRecipient({ id: delivery.id, tenantId: delivery.tenantId, payload: delivery.payload, attempts: 1 }, send)).toMatchObject({ status: "suppressed", reason: "No longer in selected audience" });
    expect(send).not.toHaveBeenCalled();
    expect((await getCampaign({ actorUserId: f.ownerId, campaignId: campaign.id })).summary).toMatchObject({ sent: 0, suppressed: 1, queued: 0 });
  });

  it("blocks an over-quota batch before any recipients are queued", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, "first@example.test", true, true);
    await member(f.merchant.programSlug, "second@example.test", true, true);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    const when = new Date(Date.now() + 1_000);
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: when });
    await db.insert(campaignDailyUsage).values({ tenantId: f.merchant.tenantId, day: new Date().toISOString().slice(0, 10), queued: 99 });
    const [job] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(await dispatchCampaign({ id: job.id, tenantId: job.tenantId, payload: job.payload }, new Date(when.getTime() + 1_000))).toMatchObject({ status: "blocked" });
    expect(await db.select().from(campaignRecipients)).toHaveLength(0);
    expect((await db.select().from(campaignDailyUsage))[0].queued).toBe(99);
    expect((await db.select().from(campaigns))[0].status).toBe("blocked");
  });

  it("dispatches a due contact-free campaign through the real worker without sending", async () => {
    const f = await fixture();
    await member(f.merchant.programSlug, null, false, false);
    const campaign = await createDraftCampaign({ actorUserId: f.ownerId, programSlug: f.merchant.programSlug, ...draftFields });
    await scheduleCampaign({ actorUserId: f.ownerId, campaignId: campaign.id, scheduledAt: new Date() });
    await run("./node_modules/.bin/tsx", ["scripts/worker.ts", "--once"], { cwd: process.cwd(), env: process.env, timeout: 10_000 });
    const [dispatch] = await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "campaign.dispatch"));
    expect(dispatch.status).toBe("complete");
    expect((await db.select().from(campaigns))[0]).toMatchObject({ status: "complete", audienceCount: 1, queuedCount: 0 });
    expect(await db.select().from(outboxJobs).where(eq(outboxJobs.kind, "email.campaign"))).toHaveLength(0);
  });
});
