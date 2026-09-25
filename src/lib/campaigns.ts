import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campaignAttempts, campaignDailyUsage, campaignRecipients, campaigns, consentEvents, membershipContacts, memberships, outboxJobs, programs, staffRoles } from "@/db/schema";
import { localMailAllowed, sendLocalMailpit, syntheticAddress, type LocalSender } from "./email";
import { DomainError } from "./loyalty";
import { audienceDefinitionSchema, selectAudience, type AudienceDefinition } from "./segments";

const DAILY_QUOTA = 100;
const MAX_AUDIENCE = 500;
const MAX_ATTEMPTS = 5;
const contentSchema = z.object({
  title: z.string().trim().min(2).max(180),
  subject: z.string().trim().min(2).max(120).refine(value => !/[\r\n]/.test(value)),
  body: z.string().trim().min(5).max(3000),
  audienceDefinition: audienceDefinitionSchema,
});
type Query = Pick<typeof db, "select">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exclusions = { unverified: number; noConsent: number; closed: number; nonSynthetic: number; quota: number };
type DispatchJob = { id: string; tenantId: string; payload: Record<string, unknown> };
type DeliveryJob = DispatchJob & { attempts: number };

function requireLocalMail() {
  if (!localMailAllowed()) throw new DomainError("EMAIL_DISABLED", "Campaigns are limited to local Mailpit and synthetic .test contacts");
}

async function ownerRole(actorUserId: string, query: Query = db) {
  const [role] = await query.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", "Only an active owner can manage campaigns");
  return role;
}

async function ownerProgram(actorUserId: string, programSlug: string, query: Query = db) {
  const role = await ownerRole(actorUserId, query);
  const [program] = await query.select().from(programs)
    .where(and(eq(programs.slug, programSlug), eq(programs.tenantId, role.tenantId), eq(programs.status, "active"))).limit(1);
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found in this merchant");
  return program;
}

async function ownerCampaign(actorUserId: string, campaignId: string, query: Query = db, lock = false) {
  const role = await ownerRole(actorUserId, query);
  const selection = query.select().from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.tenantId, role.tenantId)));
  const [campaign] = lock ? await selection.for("update").limit(1) : await selection.limit(1);
  if (!campaign) throw new DomainError("NOT_FOUND", "Campaign not found in this merchant");
  return campaign;
}

function utcDay(at: Date) { return at.toISOString().slice(0, 10); }

async function remainingQuota(tenantId: string, at: Date, query: Query = db) {
  const [usage] = await query.select({ queued: campaignDailyUsage.queued }).from(campaignDailyUsage)
    .where(and(eq(campaignDailyUsage.tenantId, tenantId), eq(campaignDailyUsage.day, utcDay(at)))).limit(1);
  return Math.max(0, DAILY_QUOTA - (usage?.queued ?? 0));
}

async function audience(actorUserId: string, programId: string, definition: AudienceDefinition, asOf: Date) {
  const selection = await selectAudience({ actorUserId, programId, definition, asOf, limit: MAX_AUDIENCE });
  if (selection.total > MAX_AUDIENCE) throw new DomainError("AUDIENCE_TOO_LARGE", `Local campaign audiences are limited to ${MAX_AUDIENCE} cards`);
  return selection;
}

async function classify(tenantId: string, ids: string[], query: Query = db): Promise<{ eligible: Array<{ membershipId: string; email: string }>; excluded: Exclusions }> {
  const excluded: Exclusions = { unverified: 0, noConsent: 0, closed: 0, nonSynthetic: 0, quota: 0 };
  if (!ids.length) return { eligible: [], excluded };
  const rows = await query.select({ membershipId: memberships.id, closedAt: memberships.closedAt, email: membershipContacts.email, verified: membershipContacts.emailVerified })
    .from(memberships).leftJoin(membershipContacts, and(eq(membershipContacts.tenantId, memberships.tenantId), eq(membershipContacts.membershipId, memberships.id)))
    .where(and(eq(memberships.tenantId, tenantId), inArray(memberships.id, ids)));
  const contacts = new Map(rows.map(row => [row.membershipId, row]));
  const events = await query.select({ membershipId: consentEvents.membershipId, granted: consentEvents.granted }).from(consentEvents)
    .where(and(eq(consentEvents.tenantId, tenantId), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing"), inArray(consentEvents.membershipId, ids)))
    .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id));
  const consent = new Map<string, boolean>();
  for (const event of events) if (!consent.has(event.membershipId)) consent.set(event.membershipId, event.granted);
  const eligible: Array<{ membershipId: string; email: string }> = [];
  for (const id of ids) {
    const row = contacts.get(id);
    if (!row || row.closedAt) { excluded.closed++; continue; }
    if (!row.email || !row.verified) { excluded.unverified++; continue; }
    if (!syntheticAddress(row.email)) { excluded.nonSynthetic++; continue; }
    if (!consent.get(id)) { excluded.noConsent++; continue; }
    eligible.push({ membershipId: id, email: row.email });
  }
  return { eligible, excluded };
}

export async function previewCampaign(raw: { actorUserId: string; programSlug: string; audienceDefinition: AudienceDefinition }) {
  requireLocalMail();
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), audienceDefinition: audienceDefinitionSchema }).strict().parse(raw);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const now = new Date();
  const selection = await audience(input.actorUserId, program.id, input.audienceDefinition, now);
  const classified = await classify(program.tenantId, selection.membershipIds);
  const quotaRemaining = await remainingQuota(program.tenantId, now);
  const excluded = { ...classified.excluded, quota: Math.max(0, classified.eligible.length - quotaRemaining) };
  return { total: selection.total, eligibleCount: Math.min(classified.eligible.length, quotaRemaining), excludedCountsByReason: excluded, asOf: selection.asOf, countingRule: selection.countingRule, localOnly: true as const, dailyQuota: DAILY_QUOTA, quotaRemaining };
}

export async function createDraftCampaign(raw: { actorUserId: string; programSlug: string; title: string; subject: string; body: string; audienceDefinition: AudienceDefinition }) {
  requireLocalMail();
  const input = contentSchema.extend({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).strict().parse(raw);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const [campaign] = await db.insert(campaigns).values({ tenantId: program.tenantId, programId: program.id, createdByUserId: input.actorUserId, title: input.title, subject: input.subject, body: input.body, audienceDefinition: input.audienceDefinition }).returning();
  return campaign;
}

export async function editDraftCampaign(raw: { actorUserId: string; campaignId: string; title: string; subject: string; body: string; audienceDefinition: AudienceDefinition }) {
  requireLocalMail();
  const input = contentSchema.extend({ actorUserId: z.string().min(1), campaignId: z.uuid() }).strict().parse(raw);
  return db.transaction(async tx => {
    const campaign = await ownerCampaign(input.actorUserId, input.campaignId, tx, true);
    if (campaign.status !== "draft") throw new DomainError("CAMPAIGN_LOCKED", "Only a draft campaign can be edited");
    const [updated] = await tx.update(campaigns).set({ title: input.title, subject: input.subject, body: input.body, audienceDefinition: input.audienceDefinition, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id)).returning();
    return updated;
  });
}

export async function scheduleCampaign(raw: { actorUserId: string; campaignId: string; scheduledAt: Date }) {
  requireLocalMail();
  const input = z.object({ actorUserId: z.string().min(1), campaignId: z.uuid(), scheduledAt: z.date() }).strict().parse(raw);
  const now = new Date();
  if (input.scheduledAt.getTime() < now.getTime() - 60_000 || input.scheduledAt.getTime() > now.getTime() + 30 * 86_400_000) throw new DomainError("INVALID_SCHEDULE", "Schedule must be within the next 30 days");
  return db.transaction(async tx => {
    const campaign = await ownerCampaign(input.actorUserId, input.campaignId, tx, true);
    if (campaign.status !== "draft" && campaign.status !== "paused") throw new DomainError("CAMPAIGN_LOCKED", "Only draft or paused campaigns can be scheduled");
    const revision = campaign.scheduleRevision + 1;
    await tx.update(campaigns).set({ status: "scheduled", scheduledAt: input.scheduledAt, audienceAsOf: input.scheduledAt, scheduleRevision: revision, updatedAt: now }).where(eq(campaigns.id, campaign.id));
    await tx.insert(outboxJobs).values({ tenantId: campaign.tenantId, kind: "campaign.dispatch", payload: { campaignId: campaign.id, scheduleRevision: String(revision) }, nextAttemptAt: input.scheduledAt });
    return { campaignId: campaign.id, status: "scheduled" as const, scheduledAt: input.scheduledAt };
  });
}

export async function pauseCampaign(raw: { actorUserId: string; campaignId: string }) {
  const input = z.object({ actorUserId: z.string().min(1), campaignId: z.uuid() }).strict().parse(raw);
  return db.transaction(async tx => {
    const campaign = await ownerCampaign(input.actorUserId, input.campaignId, tx, true);
    if (campaign.status !== "scheduled") throw new DomainError("CAMPAIGN_LOCKED", "Only a scheduled campaign can be paused");
    await tx.update(campaigns).set({ status: "paused", scheduleRevision: campaign.scheduleRevision + 1, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    return { campaignId: campaign.id, status: "paused" as const };
  });
}

export async function cancelCampaign(raw: { actorUserId: string; campaignId: string }) {
  const input = z.object({ actorUserId: z.string().min(1), campaignId: z.uuid() }).strict().parse(raw);
  return db.transaction(async tx => {
    const campaign = await ownerCampaign(input.actorUserId, input.campaignId, tx, true);
    if (campaign.status === "complete" || campaign.status === "cancelled") throw new DomainError("CAMPAIGN_LOCKED", "Campaign is already final");
    await tx.update(campaigns).set({ status: "cancelled", scheduleRevision: campaign.scheduleRevision + 1, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id));
    return { campaignId: campaign.id, status: "cancelled" as const };
  });
}

export async function listCampaigns(raw: { actorUserId: string; programSlug: string }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).strict().parse(raw);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const rows = await db.select().from(campaigns).where(and(eq(campaigns.tenantId, program.tenantId), eq(campaigns.programId, program.id))).orderBy(desc(campaigns.createdAt)).limit(100);
  return rows.map(({ id, title, subject, status, scheduledAt, audienceCount, queuedCount, createdAt }) => ({ id, title, subject, status, scheduledAt, audienceCount, queuedCount, createdAt }));
}

export async function getCampaign(raw: { actorUserId: string; campaignId: string }) {
  const input = z.object({ actorUserId: z.string().min(1), campaignId: z.uuid() }).strict().parse(raw);
  const campaign = await ownerCampaign(input.actorUserId, input.campaignId);
  const recipients = await db.select({ id: campaignRecipients.id, status: campaignRecipients.status }).from(campaignRecipients).where(and(eq(campaignRecipients.tenantId, campaign.tenantId), eq(campaignRecipients.campaignId, campaign.id)));
  const summary = { queued: 0, sent: 0, suppressed: 0, failed: 0 };
  for (const recipient of recipients) {
    if (recipient.status === "complete") summary.sent++;
    else if (recipient.status === "suppressed") summary.suppressed++;
    else if (recipient.status === "failed") summary.failed++;
    else summary.queued++;
  }
  const ids = recipients.map(row => row.id);
  const attempts = ids.length ? await db.select({ recipientId: campaignAttempts.recipientId, status: campaignAttempts.status, reason: campaignAttempts.reason, createdAt: campaignAttempts.createdAt }).from(campaignAttempts)
    .where(and(eq(campaignAttempts.tenantId, campaign.tenantId), inArray(campaignAttempts.recipientId, ids))).orderBy(desc(campaignAttempts.createdAt)).limit(100) : [];
  return { campaign, summary, attempts };
}

export async function dispatchCampaign(job: DispatchJob, now = new Date()): Promise<{ status: "complete" | "suppressed" | "blocked"; reason?: string; queuedCount?: number }> {
  const parsed = z.object({ campaignId: z.uuid(), scheduleRevision: z.string().regex(/^\d{1,9}$/) }).strict().safeParse(job.payload);
  if (!parsed.success) return { status: "blocked", reason: "Invalid campaign dispatch payload" };
  const [initial] = await db.select().from(campaigns).where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.tenantId, job.tenantId))).limit(1);
  if (!initial || initial.status !== "scheduled" || initial.scheduleRevision !== Number(parsed.data.scheduleRevision)) return { status: "suppressed", reason: "Campaign schedule changed" };
  if (!initial.audienceAsOf || !initial.scheduledAt || initial.scheduledAt > now) return { status: "blocked", reason: "Campaign is not due" };
  if (!localMailAllowed()) {
    await db.update(campaigns).set({ status: "blocked", updatedAt: now }).where(and(eq(campaigns.id, initial.id), eq(campaigns.status, "scheduled"), eq(campaigns.scheduleRevision, initial.scheduleRevision)));
    return { status: "blocked", reason: "Local Mailpit delivery unavailable" };
  }
  let selection: Awaited<ReturnType<typeof audience>>;
  try { selection = await audience(initial.createdByUserId, initial.programId, audienceDefinitionSchema.parse(initial.audienceDefinition), initial.audienceAsOf); }
  catch {
    await db.update(campaigns).set({ status: "blocked", updatedAt: now }).where(and(eq(campaigns.id, initial.id), eq(campaigns.status, "scheduled"), eq(campaigns.scheduleRevision, initial.scheduleRevision)));
    return { status: "blocked", reason: "Audience selection unavailable or owner no longer authorized" };
  }
  return db.transaction(async tx => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, initial.id), eq(campaigns.tenantId, job.tenantId))).for("update");
    if (!campaign || campaign.status !== "scheduled" || campaign.scheduleRevision !== Number(parsed.data.scheduleRevision)) return { status: "suppressed" as const, reason: "Campaign schedule changed" };
    const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, campaign.tenantId), eq(staffRoles.userId, campaign.createdByUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
    if (!owner) { await tx.update(campaigns).set({ status: "blocked", updatedAt: now }).where(eq(campaigns.id, campaign.id)); return { status: "blocked" as const, reason: "Queueing owner no longer authorized" }; }
    const { eligible } = await classify(campaign.tenantId, selection.membershipIds, tx);
    if (eligible.length > DAILY_QUOTA) { await tx.update(campaigns).set({ status: "blocked", audienceCount: selection.total, updatedAt: now }).where(eq(campaigns.id, campaign.id)); return { status: "blocked" as const, reason: "Daily local campaign quota exceeded" }; }
    if (eligible.length) {
      const reservation = await tx.execute(sql`
        INSERT INTO campaign_daily_usage (tenant_id, day, queued)
        VALUES (${campaign.tenantId}::uuid, ${utcDay(now)}::date, ${eligible.length})
        ON CONFLICT (tenant_id, day) DO UPDATE
          SET queued = campaign_daily_usage.queued + EXCLUDED.queued
        WHERE campaign_daily_usage.queued + EXCLUDED.queued <= ${DAILY_QUOTA}
        RETURNING queued
      `);
      if (!reservation.rows.length) { await tx.update(campaigns).set({ status: "blocked", audienceCount: selection.total, updatedAt: now }).where(eq(campaigns.id, campaign.id)); return { status: "blocked" as const, reason: "Daily local campaign quota exceeded" }; }
      const recipients = await tx.insert(campaignRecipients).values(eligible.map(row => ({ tenantId: campaign.tenantId, campaignId: campaign.id, membershipId: row.membershipId }))).returning({ id: campaignRecipients.id, membershipId: campaignRecipients.membershipId });
      await tx.insert(outboxJobs).values(recipients.map(row => ({ tenantId: campaign.tenantId, kind: "email.campaign", payload: { campaignId: campaign.id, recipientId: row.id, membershipId: row.membershipId } })));
    }
    await tx.update(campaigns).set({ status: eligible.length ? "dispatching" : "complete", audienceCount: selection.total, queuedCount: eligible.length, updatedAt: now }).where(eq(campaigns.id, campaign.id));
    return { status: "complete" as const, queuedCount: eligible.length };
  });
}

async function finishCampaignIfDone(tx: Transaction, campaignId: string, tenantId: string) {
  const [remaining] = await tx.select({ count: sql<number>`count(*)::int` }).from(campaignRecipients)
    .where(and(eq(campaignRecipients.tenantId, tenantId), eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "queued")));
  if (remaining.count !== 0) return;
  const [failed] = await tx.select({ count: sql<number>`count(*)::int` }).from(campaignRecipients)
    .where(and(eq(campaignRecipients.tenantId, tenantId), eq(campaignRecipients.campaignId, campaignId), eq(campaignRecipients.status, "failed")));
  await tx.update(campaigns).set({ status: failed.count ? "blocked" : "complete", updatedAt: new Date() }).where(and(eq(campaigns.id, campaignId), eq(campaigns.status, "dispatching")));
}

export async function deliverCampaignRecipient(job: DeliveryJob, send: LocalSender = sendLocalMailpit): Promise<{ status: "complete" | "suppressed" | "blocked" | "retry" | "failed"; reason?: string }> {
  const parsed = z.object({ campaignId: z.uuid(), recipientId: z.uuid(), membershipId: z.uuid() }).strict().safeParse(job.payload);
  if (!parsed.success || !Number.isInteger(job.attempts) || job.attempts < 1) return { status: "blocked", reason: "Invalid campaign recipient payload" };
  return db.transaction(async tx => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.tenantId, job.tenantId))).for("update");
    if (!campaign) return { status: "suppressed" as const, reason: "Campaign unavailable" };
    const [recipient] = await tx.select().from(campaignRecipients).where(and(eq(campaignRecipients.id, parsed.data.recipientId), eq(campaignRecipients.tenantId, job.tenantId), eq(campaignRecipients.campaignId, campaign.id), eq(campaignRecipients.membershipId, parsed.data.membershipId))).for("update");
    if (!recipient) return { status: "suppressed" as const, reason: "Recipient unavailable" };
    if (recipient.status !== "queued") return { status: recipient.status === "complete" ? "complete" as const : "suppressed" as const, reason: "Recipient already final" };
    const record = async (status: "complete" | "suppressed" | "retry" | "failed" | "blocked", reason?: string) => {
      await tx.insert(campaignAttempts).values({ tenantId: campaign.tenantId, recipientId: recipient.id, outboxJobId: job.id, attempt: job.attempts, status, reason });
    };
    const suppress = async (reason: string) => {
      await tx.update(campaignRecipients).set({ status: "suppressed", suppressReason: reason }).where(eq(campaignRecipients.id, recipient.id));
      await record("suppressed", reason);
      await finishCampaignIfDone(tx, campaign.id, campaign.tenantId);
      return { status: "suppressed" as const, reason };
    };
    if (campaign.status !== "dispatching") return suppress("Campaign no longer active");
    if (!localMailAllowed()) { await record("blocked", "Local Mailpit delivery unavailable"); return { status: "blocked" as const, reason: "Local Mailpit delivery unavailable" }; }
    const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, campaign.tenantId), eq(staffRoles.userId, campaign.createdByUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
    if (!owner) return suppress("Queueing owner no longer authorized");
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, recipient.membershipId), eq(memberships.tenantId, campaign.tenantId))).for("update");
    if (!member || member.closedAt) return suppress("Membership unavailable");
    const classified = await classify(campaign.tenantId, [member.id], tx);
    if (!classified.eligible.length) return suppress(classified.excluded.noConsent ? "Marketing consent withdrawn" : classified.excluded.nonSynthetic ? "Recipient is not synthetic" : "Contact unavailable or unverified");
    try {
      // Mailpit can capture a message before this transaction commits. A crash
      // in that interval can duplicate the local test on retry; never enable
      // an external sender without a provider idempotency design.
      await send({ to: classified.eligible[0].email, subject: campaign.subject, body: campaign.body, jobId: job.id });
    } catch {
      const final = job.attempts >= MAX_ATTEMPTS;
      await record(final ? "failed" : "retry", "Local Mailpit delivery failed");
      if (final) {
        await tx.update(campaignRecipients).set({ status: "failed", suppressReason: "Local Mailpit delivery failed" }).where(eq(campaignRecipients.id, recipient.id));
        await finishCampaignIfDone(tx, campaign.id, campaign.tenantId);
      }
      return { status: final ? "failed" as const : "retry" as const, reason: "Local Mailpit delivery failed" };
    }
    await tx.update(campaignRecipients).set({ status: "complete", sentAt: new Date() }).where(eq(campaignRecipients.id, recipient.id));
    await record("complete");
    await finishCampaignIfDone(tx, campaign.id, campaign.tenantId);
    return { status: "complete" as const };
  });
}
