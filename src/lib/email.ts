import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { consentEvents, membershipContacts, memberships, outboxJobs, staffRoles } from "@/db/schema";
import { DomainError } from "./loyalty";

const messageInput = z.object({
  userId: z.string().min(1),
  membershipId: z.uuid(),
  subject: z.string().trim().min(2).max(120).refine((value) => !/[\r\n]/.test(value)),
  body: z.string().trim().min(5).max(3000),
});
const payloadInput = messageInput.pick({ membershipId: true, subject: true, body: true }).extend({ actorUserId: z.string().min(1) });
type LocalMessage = { to: string; subject: string; body: string; jobId: string };
type LocalSender = (message: LocalMessage) => Promise<void>;

function localMailAllowed() {
  if (process.env.NODE_ENV === "production" || process.env.EXTERNAL_EMAIL_ENABLED === "true") return false;
  if (!["localhost", "127.0.0.1"].includes(process.env.SMTP_HOST ?? "")) return false;
  try {
    const database = new URL(process.env.DATABASE_URL ?? "");
    const application = new URL(process.env.PUBLIC_BASE_URL ?? "");
    return ["localhost", "127.0.0.1"].includes(database.hostname) && ["localhost", "127.0.0.1"].includes(application.hostname) && application.protocol === "http:";
  } catch { return false; }
}

function syntheticAddress(email: string) {
  return email.toLowerCase().endsWith(".test");
}

async function latestMarketingConsent(tenantId: string, membershipId: string, query: Pick<typeof db, "select"> = db) {
  const [event] = await query.select().from(consentEvents)
    .where(and(eq(consentEvents.tenantId, tenantId), eq(consentEvents.membershipId, membershipId), eq(consentEvents.channel, "email"), eq(consentEvents.purpose, "marketing")))
    .orderBy(desc(consentEvents.createdAt)).limit(1);
  return event?.granted === true;
}

export async function queueMarketingEmail(raw: z.input<typeof messageInput>): Promise<{ id: string; status: "pending" }> {
  if (!localMailAllowed()) throw new DomainError("EMAIL_DISABLED", "Only local Mailpit email tests are available");
  const input = messageInput.parse(raw);
  const [member] = await db.select().from(memberships).where(eq(memberships.id, input.membershipId)).limit(1);
  if (!member) throw new DomainError("NOT_FOUND", "Membership not found");
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, input.userId), eq(staffRoles.active, true), eq(staffRoles.role, "owner"))).limit(1);
  if (!role) throw new DomainError("FORBIDDEN", "Only this merchant's owner can queue a local email test");
  const [contact] = await db.select().from(membershipContacts).where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id))).limit(1);
  if (!contact?.email || !contact.emailVerified) throw new DomainError("EMAIL_UNVERIFIED", "A verified email is required");
  if (!syntheticAddress(contact.email)) throw new DomainError("EMAIL_TEST_ONLY", "Only synthetic .test recipients are allowed");
  if (!await latestMarketingConsent(member.tenantId, member.id)) throw new DomainError("CONSENT_REQUIRED", "Current marketing consent is required");

  const [job] = await db.insert(outboxJobs).values({ tenantId: member.tenantId, kind: "email.marketing", payload: { membershipId: member.id, subject: input.subject, body: input.body, actorUserId: input.userId } }).returning({ id: outboxJobs.id });
  return { id: job.id, status: "pending" };
}

export async function withdrawMarketingConsent(cardToken: string): Promise<void> {
  if (!cardToken.startsWith("card_") || cardToken.length > 100) throw new DomainError("NOT_FOUND", "Card not found");
  await db.transaction(async (tx) => {
    const [member] = await tx.select().from(memberships).where(eq(memberships.cardToken, cardToken)).for("update");
    if (!member) throw new DomainError("NOT_FOUND", "Card not found");
    await tx.insert(consentEvents).values({ tenantId: member.tenantId, membershipId: member.id, channel: "email", purpose: "marketing", granted: false, noticeVersion: "2026-09", source: "card_preferences" });
  });
}

export async function getMarketingPreference(cardToken: string): Promise<{ marketingEmail: boolean }> {
  if (!cardToken.startsWith("card_") || cardToken.length > 100) throw new DomainError("NOT_FOUND", "Card not found");
  const [member] = await db.select().from(memberships).where(eq(memberships.cardToken, cardToken)).limit(1);
  if (!member) throw new DomainError("NOT_FOUND", "Card not found");
  return { marketingEmail: await latestMarketingConsent(member.tenantId, member.id) };
}

async function sendLocalMailpit(message: LocalMessage) {
  const response = await fetch("http://127.0.0.1:8026/api/v1/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      From: { Email: "looplocal@local.test", Name: "LoopLocal Local Test" },
      To: [{ Email: message.to }],
      Subject: `[LOCAL TEST] ${message.subject}`,
      Text: `${message.body}\n\nLokale Testnachricht. Keine externe Zustellung.`,
      Headers: { "X-LoopLocal-Job": message.jobId },
      Tags: ["looplocal-local-test"],
    }),
    signal: AbortSignal.timeout(5000),
  });
  if (!response.ok) throw new Error(`Local Mailpit rejected the message (${response.status})`);
}

export async function deliverMarketingEmail(
  job: { id: string; tenantId: string; payload: Record<string, unknown> },
  send: LocalSender = sendLocalMailpit,
): Promise<{ status: "suppressed" | "complete" | "blocked"; reason?: string }> {
  if (!localMailAllowed()) return { status: "blocked", reason: "Only local Mailpit email tests are available" };
  const parsed = payloadInput.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked", reason: "Invalid queued marketing payload" };

  return db.transaction(async (tx) => {
    const [member] = await tx.select().from(memberships).where(and(eq(memberships.id, parsed.data.membershipId), eq(memberships.tenantId, job.tenantId))).for("update");
    if (!member) return { status: "suppressed" as const, reason: "Membership unavailable" };
    const [actor] = await tx.select().from(staffRoles).where(and(eq(staffRoles.tenantId, member.tenantId), eq(staffRoles.userId, parsed.data.actorUserId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true))).for("update").limit(1);
    if (!actor) return { status: "suppressed" as const, reason: "Queueing owner no longer authorized" };
    const [contact] = await tx.select().from(membershipContacts).where(and(eq(membershipContacts.tenantId, member.tenantId), eq(membershipContacts.membershipId, member.id))).limit(1);
    if (!contact?.email || !contact.emailVerified) return { status: "suppressed" as const, reason: "Contact unverified or absent" };
    if (!syntheticAddress(contact.email)) return { status: "blocked" as const, reason: "Recipient is not a synthetic .test address" };
    if (!await latestMarketingConsent(member.tenantId, member.id, tx)) return { status: "suppressed" as const, reason: "Marketing consent withdrawn" };

    // The membership lock serializes this final consent check with withdrawals.
    await send({ to: contact.email, subject: parsed.data.subject, body: parsed.data.body, jobId: job.id });
    return { status: "complete" as const };
  });
}
