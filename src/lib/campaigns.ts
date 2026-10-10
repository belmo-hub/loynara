import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { campaignAttempts, campaignDailyUsage, campaignRecipients, campaigns, consentEvents, emailDeliveries, emailSuppressions, membershipContacts, memberships, outboxJobs, programs, staffRoles, tenants } from "@/db/schema";
import { sendLocalMailpit, syntheticAddress, type LocalSender } from "./email";
import { DomainError } from "./loyalty";
import { audienceDefinitionSchema, databaseAudienceNow, selectAudience, type AudienceDefinition } from "./segments";
import { promotionalEmailMode, promotionalProvider, recipientHash, sendPromotional, type TransactionalEmailProvider } from "./transactional-email";
import { unsubscribeUrl } from "./unsubscribe";
import { hasRecentPromotion, monthlyLocationUsage, programTimezone, promotionalLimits, quietHoursDeferral } from "./promotion-policy";

const DAILY_QUOTA = 100;
const AUDIENCE_PAGE_SIZE = 500;
const MAX_ATTEMPTS = 5;
const contentSchema = z.object({
  title: z.string().trim().min(2).max(180),
  subject: z.string().trim().min(2).max(120).refine(value => !/[\r\n]/.test(value)),
  body: z.string().trim().min(5).max(3000),
  audienceDefinition: audienceDefinitionSchema,
});
type Query = Pick<typeof db, "select" | "execute">;
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Exclusions = { unverified: number; noConsent: number; unsubscribed: number; suppressed: number; frequency: number; closed: number; nonSynthetic: number; quota: number };
type DispatchJob = { id: string; tenantId: string; payload: Record<string, unknown> };
type DeliveryJob = DispatchJob & { attempts: number };

function requireCampaignMail() {
  if (promotionalEmailMode() === "disabled") throw new DomainError("EMAIL_DISABLED", "Promotional email delivery is disabled");
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

async function audience(actorUserId: string, programId: string, definition: AudienceDefinition, asOf?: Date) {
  const selection = await selectAudience({ actorUserId, programId, definition, ...(asOf ? { asOf } : {}), limit: AUDIENCE_PAGE_SIZE });
  // 500 is a database page size, not a count of contact-eligible recipients.
  // Keep one enrollment/activity cutoff and traverse the existing UUID cursor.
  const membershipIds = [...selection.membershipIds];
  let cursor = selection.nextCursor;
  while (cursor) {
    const page = await selectAudience({ actorUserId, programId, definition, asOf: new Date(selection.asOf), afterMembershipId: cursor, limit: AUDIENCE_PAGE_SIZE });
    membershipIds.push(...page.membershipIds);
    cursor = page.nextCursor;
  }
  return { ...selection, membershipIds, nextCursor: null };
}

async function classify(tenantId: string, programId: string, ids: string[], query: Query = db, now = new Date()): Promise<{ eligible: Array<{ membershipId: string; email: string }>; excluded: Exclusions }> {
  const excluded: Exclusions = { unverified: 0, noConsent: 0, unsubscribed: 0, suppressed: 0, frequency: 0, closed: 0, nonSynthetic: 0, quota: 0 };
  if (!ids.length) return { eligible: [], excluded };
  // Bound contact/consent/suppression SQL parameters independently of total
  // audience size. All existing exclusions and send quotas still apply.
  if (ids.length > AUDIENCE_PAGE_SIZE) {
    const eligible: Array<{ membershipId: string; email: string }> = [];
    for (let offset = 0; offset < ids.length; offset += AUDIENCE_PAGE_SIZE) {
      const batch = await classify(tenantId, programId, ids.slice(offset, offset + AUDIENCE_PAGE_SIZE), query, now);
      eligible.push(...batch.eligible);
      for (const reason of Object.keys(excluded) as Array<keyof Exclusions>) excluded[reason] += batch.excluded[reason];
    }
    return { eligible, excluded };
  }
  const rows = await query.select({ membershipId: memberships.id, closedAt: memberships.closedAt, email: membershipContacts.email, verified: membershipContacts.emailVerified })
    .from(memberships).leftJoin(membershipContacts, and(eq(membershipContacts.tenantId, memberships.tenantId), eq(membershipContacts.membershipId, memberships.id)))
    .where(and(eq(memberships.tenantId, tenantId), eq(memberships.programId, programId), inArray(memberships.id, ids)));
  const contacts = new Map(rows.map(row => [row.membershipId, row]));
  const events = await query.select({ membershipId: consentEvents.membershipId, granted: consentEvents.granted, source: consentEvents.source }).from(consentEvents)
    .where(and(eq(consentEvents.tenantId, tenantId), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing"), inArray(consentEvents.membershipId, ids)))
    .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id));
  const consent = new Map<string, { granted: boolean; source: string }>();
  for (const event of events) if (!consent.has(event.membershipId)) consent.set(event.membershipId, event);
  const hashes = rows.flatMap(row => row.email ? [recipientHash(row.email)] : []);
  const suppressions = hashes.length ? await query.select({ recipientHash: emailSuppressions.recipientHash, reason: emailSuppressions.reason }).from(emailSuppressions).where(inArray(emailSuppressions.recipientHash, hashes)) : [];
  const suppressed = new Map(suppressions.map(row => [row.recipientHash, row.reason]));
  const eligible: Array<{ membershipId: string; email: string }> = [];
  for (const id of ids) {
    const row = contacts.get(id);
    if (!row || row.closedAt) { excluded.closed++; continue; }
    if (!row.email || !row.verified) { excluded.unverified++; continue; }
    if (promotionalEmailMode() === "mailpit" && !syntheticAddress(row.email)) { excluded.nonSynthetic++; continue; }
    if (!consent.get(id)?.granted) { if (consent.get(id)?.source === "email_unsubscribe") excluded.unsubscribed++; else excluded.noConsent++; continue; }
    const suppression = suppressed.get(recipientHash(row.email));
    if (suppression) { if (suppression === "unsubscribed") excluded.unsubscribed++; else excluded.suppressed++; continue; }
    if (await hasRecentPromotion(query, tenantId, id, now)) { excluded.frequency++; continue; }
    eligible.push({ membershipId: id, email: row.email });
  }
  return { eligible, excluded };
}

export async function previewCampaign(raw: { actorUserId: string; programSlug: string; audienceDefinition: AudienceDefinition }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), audienceDefinition: audienceDefinitionSchema }).strict().parse(raw);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const now = await databaseAudienceNow();
  const selection = await audience(input.actorUserId, program.id, input.audienceDefinition, now);
  const classified = await classify(program.tenantId, program.id, selection.membershipIds, db, now);
  const monthlyRemaining = Math.max(0, promotionalLimits().monthly - await monthlyLocationUsage(db, program.tenantId, program.locationId, now));
  const quotaRemaining = Math.min(await remainingQuota(program.tenantId, now), monthlyRemaining);
  const excluded = { ...classified.excluded, quota: Math.max(0, classified.eligible.length - quotaRemaining) };
  return { total: selection.total, eligibleCount: Math.min(classified.eligible.length, quotaRemaining), excludedCountsByReason: excluded, asOf: selection.asOf, countingRule: selection.countingRule, deliveryMode: promotionalEmailMode(), localOnly: promotionalEmailMode() === "mailpit", dailyQuota: DAILY_QUOTA, monthlyLocationQuota: promotionalLimits().monthly, quotaRemaining };
}

export async function createDraftCampaign(raw: { actorUserId: string; programSlug: string; title: string; subject: string; body: string; audienceDefinition: AudienceDefinition }) {
  const input = contentSchema.extend({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).strict().parse(raw);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  return db.transaction(async tx => {
    // A double submit (slow network, second click) must not leave two identical drafts: an identical draft by the same
    // owner within two minutes is returned instead. Serialised per programme so two parallel requests cannot both miss it.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`campaign-draft:${program.id}`}))`);
    const [duplicate] = await tx.select().from(campaigns).where(and(eq(campaigns.tenantId, program.tenantId), eq(campaigns.programId, program.id),
      eq(campaigns.createdByUserId, input.actorUserId), eq(campaigns.status, "draft"), eq(campaigns.title, input.title), eq(campaigns.subject, input.subject),
      eq(campaigns.body, input.body), sql`${campaigns.audienceDefinition} = ${JSON.stringify(input.audienceDefinition)}::jsonb`, sql`${campaigns.createdAt} > now() - interval '2 minutes'`)).limit(1);
    if (duplicate) return duplicate;
    const [campaign] = await tx.insert(campaigns).values({ tenantId: program.tenantId, programId: program.id, createdByUserId: input.actorUserId, title: input.title, subject: input.subject, body: input.body, audienceDefinition: input.audienceDefinition }).returning();
    return campaign;
  });
}

export async function editDraftCampaign(raw: { actorUserId: string; campaignId: string; title: string; subject: string; body: string; audienceDefinition: AudienceDefinition }) {
  const input = contentSchema.extend({ actorUserId: z.string().min(1), campaignId: z.uuid() }).strict().parse(raw);
  return db.transaction(async tx => {
    const campaign = await ownerCampaign(input.actorUserId, input.campaignId, tx, true);
    if (campaign.status !== "draft") throw new DomainError("CAMPAIGN_LOCKED", "Only a draft campaign can be edited");
    const [updated] = await tx.update(campaigns).set({ title: input.title, subject: input.subject, body: input.body, audienceDefinition: input.audienceDefinition, updatedAt: new Date() }).where(eq(campaigns.id, campaign.id)).returning();
    return updated;
  });
}

export async function scheduleCampaign(raw: { actorUserId: string; campaignId: string; scheduledAt: Date }) {
  requireCampaignMail();
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
  return rows.map(({ id, title, subject, status, scheduledAt, audienceCount, queuedCount, createdAt, audienceDefinition }) => ({ id, title, subject, status, scheduledAt, audienceCount, queuedCount, createdAt, audienceDefinition }));
}

export async function getCampaign(raw: { actorUserId: string; campaignId: string }) {
  const input = z.object({ actorUserId: z.string().min(1), campaignId: z.uuid() }).strict().parse(raw);
  // Counts, provider states and observed outcomes describe one committed state.
  // Read-only MVCC does not lock delivery writers or call providers.
  return db.transaction(async tx => {
    await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
    await tx.execute(sql`SET LOCAL idle_in_transaction_session_timeout = '5s'`);
    const campaign = await ownerCampaign(input.actorUserId, input.campaignId, tx);
    const recipients = await tx.select({ id: campaignRecipients.id, status: campaignRecipients.status }).from(campaignRecipients).where(and(eq(campaignRecipients.tenantId, campaign.tenantId), eq(campaignRecipients.campaignId, campaign.id)));
    const summary = { queued: 0, sent: 0, delivered: 0, providerFailed: 0, suppressed: 0, failed: 0 };
    for (const recipient of recipients) {
      if (recipient.status === "complete") summary.sent++;
      else if (recipient.status === "suppressed") summary.suppressed++;
      else if (recipient.status === "failed") summary.failed++;
      else summary.queued++;
    }
    const ids = recipients.map(row => row.id);
    const attempts = ids.length ? await tx.select({ recipientId: campaignAttempts.recipientId, status: campaignAttempts.status, reason: campaignAttempts.reason, createdAt: campaignAttempts.createdAt, providerStatus: emailDeliveries.status }).from(campaignAttempts)
      .leftJoin(emailDeliveries, eq(emailDeliveries.jobId, campaignAttempts.outboxJobId))
      .where(and(eq(campaignAttempts.tenantId, campaign.tenantId), inArray(campaignAttempts.recipientId, ids))).orderBy(desc(campaignAttempts.createdAt)).limit(100) : [];
    const providerRows = ids.length ? await tx.select({ jobId: emailDeliveries.jobId, status: emailDeliveries.status }).from(emailDeliveries)
      .innerJoin(campaignAttempts, eq(campaignAttempts.outboxJobId, emailDeliveries.jobId))
      .where(and(eq(campaignAttempts.tenantId, campaign.tenantId), inArray(campaignAttempts.recipientId, ids))) : [];
    const providerStates = [...new Map(providerRows.map(row => [row.jobId, row.status])).values()];
    summary.delivered = providerStates.filter(status => status === "delivered").length;
    summary.providerFailed = providerStates.filter(status => ["permanent_failure", "complained", "unsubscribed"].includes(status)).length;
    // Outcome: of the cards that were sent the message, how many recorded a qualifying checkout afterwards. This is
    // observation, not attribution: they might have come anyway.
    const [outcome] = await tx.execute<{ sent: number; returned: number }>(sql`
      SELECT count(*)::int AS sent,
        count(*) FILTER (WHERE EXISTS (
          SELECT 1 FROM ledger_entries e
          WHERE e.tenant_id = r.tenant_id AND e.membership_id = r.membership_id AND e.created_at > r.sent_at
            AND e.kind = 'award' AND e.source in ('staff_online','staff_offline')
            AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)
        ))::int AS returned
      FROM campaign_recipients r
      WHERE r.tenant_id = ${campaign.tenantId} AND r.campaign_id = ${campaign.id} AND r.status = 'complete' AND r.sent_at IS NOT NULL
    `).then(result => result.rows);
    return { campaign, summary, attempts, outcome: { sent: outcome?.sent ?? 0, returnedAfterSend: outcome?.returned ?? 0 } };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function dispatchCampaign(job: DispatchJob, now?: Date): Promise<{ status: "complete" | "suppressed" | "blocked"; reason?: string; queuedCount?: number }> {
  now ??= await databaseAudienceNow();
  const parsed = z.object({ campaignId: z.uuid(), scheduleRevision: z.string().regex(/^\d{1,9}$/) }).strict().safeParse(job.payload);
  if (!parsed.success) return { status: "blocked", reason: "Invalid campaign dispatch payload" };
  const [initial] = await db.select().from(campaigns).where(and(eq(campaigns.id, parsed.data.campaignId), eq(campaigns.tenantId, job.tenantId))).limit(1);
  if (!initial || initial.status !== "scheduled" || initial.scheduleRevision !== Number(parsed.data.scheduleRevision)) return { status: "suppressed", reason: "Campaign schedule changed" };
  if (!initial.audienceAsOf || !initial.scheduledAt || initial.scheduledAt > now) return { status: "blocked", reason: "Campaign is not due" };
  if (promotionalEmailMode() === "disabled") {
    await db.update(campaigns).set({ status: "blocked", updatedAt: now }).where(and(eq(campaigns.id, initial.id), eq(campaigns.status, "scheduled"), eq(campaigns.scheduleRevision, initial.scheduleRevision)));
    return { status: "blocked", reason: "Promotional delivery unavailable" };
  }
  let selection: Awaited<ReturnType<typeof audience>>;
  try { selection = await audience(initial.createdByUserId, initial.programId, audienceDefinitionSchema.parse(initial.audienceDefinition), now); }
  catch {
    await db.update(campaigns).set({ status: "blocked", updatedAt: now }).where(and(eq(campaigns.id, initial.id), eq(campaigns.status, "scheduled"), eq(campaigns.scheduleRevision, initial.scheduleRevision)));
    return { status: "blocked", reason: "Audience selection unavailable or owner no longer authorized" };
  }
  return db.transaction(async tx => {
    const [campaign] = await tx.select().from(campaigns).where(and(eq(campaigns.id, initial.id), eq(campaigns.tenantId, job.tenantId))).for("update");
    if (!campaign || campaign.status !== "scheduled" || campaign.scheduleRevision !== Number(parsed.data.scheduleRevision)) return { status: "suppressed" as const, reason: "Campaign schedule changed" };
    const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, campaign.tenantId), eq(staffRoles.userId, campaign.createdByUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
    if (!owner) { await tx.update(campaigns).set({ status: "blocked", updatedAt: now }).where(eq(campaigns.id, campaign.id)); return { status: "blocked" as const, reason: "Queueing owner no longer authorized" }; }
    const [program] = await tx.select({ locationId: programs.locationId }).from(programs).where(and(eq(programs.id, campaign.programId), eq(programs.tenantId, campaign.tenantId), eq(programs.status, "active"))).limit(1);
    if (!program) return { status: "blocked" as const, reason: "Programme unavailable" };
    const monthlyUsed = await monthlyLocationUsage(tx, campaign.tenantId, program.locationId, now, true);
    const { eligible } = await classify(campaign.tenantId, campaign.programId, selection.membershipIds, tx, now);
    if (monthlyUsed + eligible.length > promotionalLimits().monthly) { await tx.update(campaigns).set({ status: "blocked", audienceCount: selection.total, updatedAt: now }).where(eq(campaigns.id, campaign.id)); return { status: "blocked" as const, reason: "Monthly location promotional quota exceeded" }; }
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

export async function deliverCampaignRecipient(job: DeliveryJob, send: LocalSender = sendLocalMailpit, provider: TransactionalEmailProvider | null = promotionalProvider(), now: Date = new Date()): Promise<{ status: "complete" | "suppressed" | "blocked" | "retry" | "failed"; reason?: string; retryAt?: Date } | { status: "deferred"; reason: string; until: Date }> {
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
    const mode = promotionalEmailMode();
    if (mode === "disabled") { await record("blocked", "Promotional email unavailable"); return { status: "blocked" as const, reason: "Promotional email unavailable" }; }
    const [owner] = await tx.select({ userId: staffRoles.userId }).from(staffRoles).where(and(eq(staffRoles.tenantId, campaign.tenantId), eq(staffRoles.userId, campaign.createdByUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
    if (!owner) return suppress("Queueing owner no longer authorized");
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, recipient.membershipId), eq(memberships.tenantId, campaign.tenantId))).for("update");
    if (!member || member.closedAt) return suppress("Membership unavailable");
    try {
      const currentAudience = await selectAudience({ actorUserId: campaign.createdByUserId, programId: campaign.programId,
        definition: audienceDefinitionSchema.parse(campaign.audienceDefinition), membershipId: member.id, limit: 1 });
      if (currentAudience.total !== 1) return suppress("No longer in selected audience");
    } catch { return suppress("Audience could not be rechecked"); }
    const classified = await classify(campaign.tenantId, campaign.programId, [member.id], tx);
    if (!classified.eligible.length) return suppress(classified.excluded.unsubscribed ? "Unsubscribed" : classified.excluded.suppressed ? "Address suppressed by provider" : classified.excluded.frequency ? "Customer frequency limit" : classified.excluded.noConsent ? "Marketing consent withdrawn" : classified.excluded.nonSynthetic ? "Recipient is not synthetic" : "Contact unavailable or unverified");
    const [tenant] = await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, campaign.tenantId)).limit(1);
    if (!tenant) return suppress("Merchant unavailable");
    const timezone = await programTimezone(tx, campaign.tenantId, campaign.programId);
    if (!timezone) return suppress("Location unavailable");
    const until = quietHoursDeferral(now, timezone);
    if (until) return { status: "deferred" as const, reason: "Quiet hours in the location's timezone", until };
    const link = unsubscribeUrl({ tenantId: campaign.tenantId, membershipId: member.id, email: classified.eligible[0].email });
    const message = { to: classified.eligible[0].email, subject: campaign.subject, body: `${campaign.body}\n\n${tenant.name}\nAngebote abbestellen: ${link}`, unsubscribeUrl: link, jobId: job.id };
    try {
      if (mode === "mailpit") await send(message);
      else {
        const result = await sendPromotional(message, provider);
        if (result.status === "suppressed") return suppress(result.reason);
        if (result.status === "blocked") { await record("blocked", result.reason); return { status: "blocked" as const, reason: result.reason }; }
        if (result.status === "retry") {
          const final = job.attempts >= MAX_ATTEMPTS;
          await record(final ? "failed" : "retry", result.reason);
          if (final) {
            await tx.update(campaignRecipients).set({ status: "failed", suppressReason: result.reason }).where(eq(campaignRecipients.id, recipient.id));
            await finishCampaignIfDone(tx, campaign.id, campaign.tenantId);
            return { status: "failed" as const, reason: result.reason };
          }
          return { status: "retry" as const, reason: result.reason, retryAt: result.retryAt };
        }
      }
    } catch {
      const final = job.attempts >= MAX_ATTEMPTS;
      await record(final ? "failed" : "retry", "Campaign delivery failed or is uncertain");
      if (final) {
        await tx.update(campaignRecipients).set({ status: "failed", suppressReason: "Campaign delivery failed or is uncertain" }).where(eq(campaignRecipients.id, recipient.id));
        await finishCampaignIfDone(tx, campaign.id, campaign.tenantId);
      }
      return { status: final ? "failed" as const : "retry" as const, reason: "Campaign delivery failed or is uncertain" };
    }
    await tx.update(campaignRecipients).set({ status: "complete", sentAt: new Date() }).where(eq(campaignRecipients.id, recipient.id));
    await record("complete");
    await finishCampaignIfDone(tx, campaign.id, campaign.tenantId);
    return { status: "complete" as const };
  });
}
