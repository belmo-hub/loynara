import { and, desc, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { automationRules, automationRuns, consentEvents, membershipContacts, memberships, outboxJobs, programs, staffRoles } from "@/db/schema";
import { localMailAllowed, sendLocalMailpit, syntheticAddress, type LocalSender } from "./email";
import { DomainError } from "./loyalty";
import { selectAudience } from "./segments";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Job = { id: string; tenantId: string; payload: Record<string, unknown> };
type DeliveryJob = Job & { attempts: number };
type Outcome = { status: "complete" | "suppressed" | "blocked" | "retry" | "failed"; reason?: string; queuedCount?: number };
type Rule = typeof automationRules.$inferSelect;
const DAY = 86_400_000;
const MAX_ATTEMPTS = 5;
const ruleInput = z.object({
  actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120),
  triggerKind: z.enum(["first_checkout", "inactive"]), enabled: z.boolean(),
  subject: z.string().trim().min(2).max(120).refine(value => !/[\r\n]/.test(value)),
  body: z.string().trim().min(5).max(3000),
  inactivityDays: z.number().int().min(7).max(365).optional(),
  cooldownDays: z.number().int().min(7).max(365), dailyCap: z.number().int().min(1).max(20),
}).strict().refine(value => value.triggerKind === "inactive" ? value.inactivityDays !== undefined : value.inactivityDays === undefined, { path: ["inactivityDays"] });
const eventPayload = z.object({ ruleId: z.uuid(), ruleRevision: z.string().regex(/^\d+$/), membershipId: z.uuid(), ledgerEntryId: z.uuid() }).strict();
const scanPayload = z.object({ ruleId: z.uuid(), ruleRevision: z.string().regex(/^\d+$/), scanAt: z.iso.datetime() }).strict();
const deliveryPayload = z.object({ ruleId: z.uuid(), runId: z.uuid(), membershipId: z.uuid() }).strict();

async function ownerProgram(actorUserId: string, programSlug: string, query: Pick<typeof db, "select"> = db) {
  const [role] = await query.select({ tenantId: staffRoles.tenantId }).from(staffRoles)
    .where(and(eq(staffRoles.userId, actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", "Only an active owner can manage automations");
  const [program] = await query.select().from(programs)
    .where(and(eq(programs.slug, programSlug), eq(programs.tenantId, role.tenantId), eq(programs.status, "active"))).limit(1);
  if (!program) throw new DomainError("NOT_FOUND", "Programme not found in this merchant");
  return program;
}

async function activeOwner(rule: Rule, query: Pick<typeof db, "select">) {
  const [owner] = await query.select({ id: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, rule.tenantId), eq(staffRoles.userId, rule.createdByUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).limit(1);
  const [program] = await query.select({ id: programs.id }).from(programs)
    .where(and(eq(programs.tenantId, rule.tenantId), eq(programs.id, rule.programId), eq(programs.status, "active"))).limit(1);
  return Boolean(owner && program);
}

export async function upsertAutomationRule(raw: z.input<typeof ruleInput>, now = new Date()) {
  const input = ruleInput.parse(raw);
  if (input.enabled && !localMailAllowed()) throw new DomainError("EMAIL_DISABLED", "Automations require local Mailpit and synthetic .test contacts");
  return db.transaction(async tx => {
    const program = await ownerProgram(input.actorUserId, input.programSlug, tx);
    const [existing] = await tx.select().from(automationRules)
      .where(and(eq(automationRules.tenantId, program.tenantId), eq(automationRules.programId, program.id), eq(automationRules.triggerKind, input.triggerKind))).for("update").limit(1);
    const fields = { enabled: input.enabled, subject: input.subject, body: input.body, inactivityDays: input.triggerKind === "inactive" ? input.inactivityDays! : null, cooldownDays: input.cooldownDays, dailyCap: input.dailyCap, nextScanAt: input.triggerKind === "inactive" && input.enabled ? now : null, updatedAt: now };
    const [rule] = existing
      ? await tx.update(automationRules).set({ ...fields, createdByUserId: input.actorUserId, revision: existing.revision + 1 }).where(eq(automationRules.id, existing.id)).returning()
      : await tx.insert(automationRules).values({ ...fields, tenantId: program.tenantId, programId: program.id, createdByUserId: input.actorUserId, triggerKind: input.triggerKind, createdAt: now }).returning();
    if (rule.triggerKind === "inactive" && rule.enabled) {
      await tx.insert(outboxJobs).values({ tenantId: rule.tenantId, kind: "automation.scan", payload: { ruleId: rule.id, ruleRevision: String(rule.revision), scanAt: now.toISOString() }, nextAttemptAt: now });
    }
    return rule;
  });
}

export async function listAutomations(raw: { actorUserId: string; programSlug: string }) {
  const input = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120) }).strict().parse(raw);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const rows = await db.select().from(automationRules).where(and(eq(automationRules.tenantId, program.tenantId), eq(automationRules.programId, program.id))).orderBy(automationRules.triggerKind);
  const ids = rows.map(row => row.id);
  const runs = ids.length ? await db.select({ id: automationRuns.id, ruleId: automationRuns.ruleId, membershipId: automationRuns.membershipId, triggerKey: automationRuns.triggerKey, status: automationRuns.status, reason: automationRuns.reason, attempts: automationRuns.attempts, createdAt: automationRuns.createdAt, sentAt: automationRuns.sentAt })
    .from(automationRuns).where(and(eq(automationRuns.tenantId, program.tenantId), inArray(automationRuns.ruleId, ids))).orderBy(desc(automationRuns.createdAt)).limit(100) : [];
  return { rules: rows, runs, localOnly: true as const };
}

async function latestConsent(tx: Transaction, tenantId: string, membershipId: string) {
  const [event] = await tx.select({ granted: consentEvents.granted }).from(consentEvents)
    .where(and(eq(consentEvents.tenantId, tenantId), eq(consentEvents.membershipId, membershipId), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing")))
    .orderBy(desc(consentEvents.createdAt), desc(consentEvents.id)).limit(1);
  return event?.granted === true;
}

async function eligibleContact(tx: Transaction, rule: Rule, membershipId: string) {
  const [member] = await tx.select().from(memberships)
    .where(and(eq(memberships.tenantId, rule.tenantId), eq(memberships.id, membershipId), eq(memberships.programId, rule.programId))).for("update").limit(1);
  if (!member || member.closedAt) return { reason: "Membership unavailable" };
  const [contact] = await tx.select().from(membershipContacts)
    .where(and(eq(membershipContacts.tenantId, rule.tenantId), eq(membershipContacts.membershipId, member.id))).limit(1);
  if (!contact?.email || !contact.emailVerified) return { reason: "Contact unavailable or unverified" };
  if (!syntheticAddress(contact.email)) return { reason: "Recipient is not synthetic" };
  if (!await latestConsent(tx, rule.tenantId, member.id)) return { reason: "Marketing consent absent or withdrawn" };
  return { email: contact.email };
}

async function firstCheckout(tx: Transaction, rule: Rule, membershipId: string) {
  const result = await tx.execute(sql`
    SELECT e.id, e.created_at FROM ledger_entries e
    WHERE e.tenant_id = ${rule.tenantId}::uuid AND e.membership_id = ${membershipId}::uuid
      AND e.kind = 'award' AND e.source = 'staff_online'
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id)
    ORDER BY e.created_at, e.id LIMIT 1
  `);
  return result.rows[0] as { id: string; created_at: string | Date } | undefined;
}

async function inactiveNow(tx: Transaction, rule: Rule, membershipId: string, now: Date) {
  const result = await tx.execute(sql`
    SELECT max(e.created_at) AS last_at FROM ledger_entries e
    WHERE e.tenant_id = ${rule.tenantId}::uuid AND e.membership_id = ${membershipId}::uuid
      AND e.kind = 'award' AND e.source = 'staff_online' AND e.created_at <= ${now}
      AND NOT EXISTS (SELECT 1 FROM ledger_entries undo WHERE undo.tenant_id = e.tenant_id AND undo.reversal_of_id = e.id AND undo.created_at <= ${now})
  `);
  const last = (result.rows[0] as { last_at: string | Date | null } | undefined)?.last_at;
  return Boolean(last && new Date(last).getTime() < now.getTime() - rule.inactivityDays! * DAY);
}

async function queueRun(tx: Transaction, rule: Rule, membershipId: string, triggerKey: string, sourceEntryId: string | null, now: Date, recordIneligible: boolean): Promise<"queued" | "suppressed" | "duplicate" | "quota"> {
  const [prior] = await tx.select({ id: automationRuns.id }).from(automationRuns)
    .where(and(eq(automationRuns.ruleId, rule.id), eq(automationRuns.membershipId, membershipId), eq(automationRuns.triggerKey, triggerKey))).limit(1);
  if (prior) return "duplicate";
  const contact = await eligibleContact(tx, rule, membershipId);
  let reason = contact.reason;
  if (!reason) {
    const [recent] = await tx.select({ id: automationRuns.id }).from(automationRuns)
      .where(and(eq(automationRuns.tenantId, rule.tenantId), eq(automationRuns.membershipId, membershipId), inArray(automationRuns.status, ["queued", "complete"]), gte(automationRuns.createdAt, new Date(now.getTime() - rule.cooldownDays * DAY)))).limit(1);
    if (recent) reason = "Member frequency limit";
  }
  if (!reason) {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const end = new Date(start.getTime() + DAY);
    const [usage] = await tx.select({ count: sql<number>`count(*)::int` }).from(automationRuns)
      .where(and(eq(automationRuns.ruleId, rule.id), inArray(automationRuns.status, ["queued", "complete"]), gte(automationRuns.createdAt, start), lt(automationRuns.createdAt, end)));
    if (usage.count >= rule.dailyCap) return "quota";
  }
  if (reason && !recordIneligible) return "suppressed";
  const [run] = await tx.insert(automationRuns).values({ tenantId: rule.tenantId, ruleId: rule.id, membershipId, ruleRevision: rule.revision, triggerKey, sourceEntryId, status: reason ? "suppressed" : "queued", reason, createdAt: now }).returning();
  if (!reason) await tx.insert(outboxJobs).values({ tenantId: rule.tenantId, kind: "email.automation", payload: { ruleId: rule.id, runId: run.id, membershipId } });
  return reason ? "suppressed" : "queued";
}

export async function processAutomationEvent(job: Job, now = new Date()): Promise<Outcome> {
  const payload = eventPayload.safeParse(job.payload);
  if (!payload.success) return { status: "blocked", reason: "Invalid automation event payload" };
  return db.transaction(async tx => {
    const [rule] = await tx.select().from(automationRules).where(and(eq(automationRules.id, payload.data.ruleId), eq(automationRules.tenantId, job.tenantId))).for("update").limit(1);
    if (!rule || !rule.enabled || rule.triggerKind !== "first_checkout" || rule.revision !== Number(payload.data.ruleRevision)) return { status: "suppressed", reason: "Rule disabled or changed" };
    if (!localMailAllowed()) return { status: "blocked", reason: "Local Mailpit unavailable" };
    if (!await activeOwner(rule, tx)) return { status: "suppressed", reason: "Owner or programme unavailable" };
    const first = await firstCheckout(tx, rule, payload.data.membershipId);
    // The checkout transaction writes this pointer only for the enabled rule
    // revision. The first qualifying ledger entry is checked again here, so
    // enabling a rule later cannot backfill older checkouts.
    if (!first || first.id !== payload.data.ledgerEntryId || new Date(first.created_at) > now) return { status: "suppressed", reason: "Not the first qualifying checkout" };
    const result = await queueRun(tx, rule, payload.data.membershipId, "first_checkout", first.id, now, true);
    if (result === "quota") return { status: "suppressed", reason: "Daily rule cap reached" };
    return { status: "complete", queuedCount: result === "queued" ? 1 : 0 };
  });
}

export async function processAutomationScan(job: Job, now = new Date()): Promise<Outcome> {
  const payload = scanPayload.safeParse(job.payload);
  if (!payload.success) return { status: "blocked", reason: "Invalid automation scan payload" };
  const [initial] = await db.select().from(automationRules).where(and(eq(automationRules.id, payload.data.ruleId), eq(automationRules.tenantId, job.tenantId))).limit(1);
  if (!initial || !initial.enabled || initial.triggerKind !== "inactive" || initial.revision !== Number(payload.data.ruleRevision) || initial.nextScanAt?.toISOString() !== payload.data.scanAt) return { status: "suppressed", reason: "Scan changed" };
  if (initial.nextScanAt > now) return { status: "blocked", reason: "Scan not due" };
  if (!localMailAllowed()) return { status: "blocked", reason: "Local Mailpit unavailable" };
  let selection: Awaited<ReturnType<typeof selectAudience>>;
  try { selection = await selectAudience({ actorUserId: initial.createdByUserId, programId: initial.programId, definition: { kind: "inactive", daysSinceLast: initial.inactivityDays! }, asOf: now, limit: 500 }); }
  catch { return { status: "blocked", reason: "Audience selection unavailable" }; }
  if (selection.total > 500) return { status: "blocked", reason: "Local inactive audience exceeds 500 cards" };
  return db.transaction(async tx => {
    const [rule] = await tx.select().from(automationRules).where(and(eq(automationRules.id, initial.id), eq(automationRules.tenantId, job.tenantId))).for("update").limit(1);
    if (!rule || !rule.enabled || rule.revision !== Number(payload.data.ruleRevision) || rule.nextScanAt?.toISOString() !== payload.data.scanAt) return { status: "suppressed", reason: "Scan changed" };
    if (!await activeOwner(rule, tx)) return { status: "blocked", reason: "Owner or programme unavailable" };
    let queuedCount = 0;
    const triggerKey = `inactive:${now.toISOString().slice(0, 10)}`;
    for (const membershipId of selection.membershipIds) {
      if (!await inactiveNow(tx, rule, membershipId, now)) continue;
      const result = await queueRun(tx, rule, membershipId, triggerKey, null, now, false);
      if (result === "quota") break;
      if (result === "queued") queuedCount++;
    }
    const next = new Date(now.getTime() + DAY);
    await tx.update(automationRules).set({ nextScanAt: next, updatedAt: now }).where(eq(automationRules.id, rule.id));
    await tx.insert(outboxJobs).values({ tenantId: rule.tenantId, kind: "automation.scan", payload: { ruleId: rule.id, ruleRevision: String(rule.revision), scanAt: next.toISOString() }, nextAttemptAt: next });
    return { status: "complete", queuedCount };
  });
}

export async function deliverAutomationRun(job: DeliveryJob, send: LocalSender = sendLocalMailpit, now = new Date()): Promise<Outcome> {
  const payload = deliveryPayload.safeParse(job.payload);
  if (!payload.success || !Number.isInteger(job.attempts) || job.attempts < 1) return { status: "blocked", reason: "Invalid automation delivery payload" };
  return db.transaction(async tx => {
    const [rule] = await tx.select().from(automationRules).where(and(eq(automationRules.id, payload.data.ruleId), eq(automationRules.tenantId, job.tenantId))).for("update").limit(1);
    if (!rule) return { status: "suppressed", reason: "Rule unavailable" };
    const runWhere = and(eq(automationRuns.id, payload.data.runId), eq(automationRuns.tenantId, job.tenantId), eq(automationRuns.ruleId, rule.id), eq(automationRuns.membershipId, payload.data.membershipId));
    const [snapshot] = await tx.select().from(automationRuns).where(runWhere).limit(1);
    if (!snapshot) return { status: "suppressed", reason: "Run unavailable" };
    if (snapshot.status !== "queued") return { status: snapshot.status === "complete" ? "complete" : "suppressed", reason: "Run already final" };
    // Card closure takes the membership lock before updating queued runs.
    // Match that order to avoid a delivery/closure deadlock.
    const contact = await eligibleContact(tx, rule, snapshot.membershipId);
    const [run] = await tx.select().from(automationRuns).where(runWhere).for("update").limit(1);
    if (!run || run.status !== "queued") return { status: run?.status === "complete" ? "complete" : "suppressed", reason: "Run already final" };
    const suppress = async (reason: string): Promise<Outcome> => {
      await tx.update(automationRuns).set({ status: "suppressed", reason, attempts: job.attempts }).where(eq(automationRuns.id, run.id));
      return { status: "suppressed", reason };
    };
    if (!rule.enabled || rule.revision !== run.ruleRevision) return suppress("Rule disabled or changed");
    if (!localMailAllowed()) return { status: "blocked", reason: "Local Mailpit unavailable" };
    if (!await activeOwner(rule, tx)) return suppress("Owner or programme unavailable");
    if (!contact.email) return suppress(contact.reason ?? "Contact ineligible");
    if (rule.triggerKind === "first_checkout") {
      const first = await firstCheckout(tx, rule, run.membershipId);
      if (!first || first.id !== run.sourceEntryId) return suppress("First checkout changed");
    } else if (!await inactiveNow(tx, rule, run.membershipId, now)) return suppress("Member no longer inactive");
    try {
      // Mailpit can accept a message before the transaction commits. A crash in
      // that interval may duplicate a local test on retry; no external sender is enabled.
      await send({ to: contact.email, subject: rule.subject, body: rule.body, jobId: job.id });
    } catch {
      const final = job.attempts >= MAX_ATTEMPTS;
      await tx.update(automationRuns).set({ status: final ? "failed" : "queued", reason: "Local Mailpit delivery failed", attempts: job.attempts }).where(eq(automationRuns.id, run.id));
      return { status: final ? "failed" : "retry", reason: "Local Mailpit delivery failed" };
    }
    await tx.update(automationRuns).set({ status: "complete", reason: null, attempts: job.attempts, sentAt: now }).where(eq(automationRuns.id, run.id));
    return { status: "complete" };
  });
}
