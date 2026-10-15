import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db, pool } from "@/db";
import { outboxJobs, staffRoles } from "@/db/schema";
import type { LocalSender } from "./email";
import { enforceRateLimit, RateLimitError } from "./rate-limit";
import { emailTransportMode, sendTransactional } from "./transactional-email";

export const SIGN_IN_LOCK_NOTICE = "email.signin_lock";
// One round of notices per account per day: a lock that is triggered again and again must not flood anyone's inbox.
const noticeLimit = { scope: "auth_signin_lock_notice", max: 1, windowSeconds: 24 * 60 * 60 };
const payload = z.object({ userId: z.string().min(1).max(64), recipientUserId: z.string().min(1).max(64), lockedAt: z.iso.datetime() }).strict();

/**
 * Queues the notices for an account that just hit the sign-in lock: one to the account itself and, for staff, one to
 * each active owner of the merchant. Accounts without an active merchant role get none. Jobs hold user ids only;
 * addresses are read when the mail is sent.
 */
export async function queueSignInLockNotice(email: string, lockedAt = new Date()): Promise<number> {
  try { await enforceRateLimit({ ...noticeLimit, identity: email }); }
  catch (error) { if (error instanceof RateLimitError) return 0; throw error; }
  const user = (await pool.query<{ id: string }>('SELECT id FROM "user" WHERE lower(email) = $1', [email])).rows[0];
  if (!user) return 0;
  const [role] = await db.select().from(staffRoles).where(and(eq(staffRoles.userId, user.id), eq(staffRoles.active, true))).limit(1);
  if (!role) return 0;
  const owners = role.role === "owner" ? [] : await db.select({ userId: staffRoles.userId }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, role.tenantId), eq(staffRoles.role, "owner"), eq(staffRoles.active, true), ne(staffRoles.userId, user.id)));
  const recipients = [user.id, ...owners.map(owner => owner.userId)];
  await db.insert(outboxJobs).values(recipients.map(recipientUserId => ({
    tenantId: role.tenantId, kind: SIGN_IN_LOCK_NOTICE, payload: { userId: user.id, recipientUserId, lockedAt: lockedAt.toISOString() },
  })));
  return recipients.length;
}

export async function deliverSignInLockNotice(job: { id: string; tenantId: string; payload: Record<string, unknown> }, send?: LocalSender) {
  if (emailTransportMode() === "disabled") return { status: "blocked" as const, reason: "Transactional email unavailable" };
  const parsed = payload.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked" as const, reason: "Invalid sign-in lock notice job" };
  const { userId, recipientUserId, lockedAt } = parsed.data;
  const users = await pool.query<{ id: string; email: string }>('SELECT id, email FROM "user" WHERE id = ANY($1::text[])', [[userId, recipientUserId]]);
  const account = users.rows.find(row => row.id === userId), recipient = users.rows.find(row => row.id === recipientUserId);
  if (!account || !recipient) return { status: "suppressed" as const, reason: "Account no longer exists" };
  // Recheck at send time: someone who lost access in the meantime is not told about this merchant's accounts.
  const [role] = await db.select({ role: staffRoles.role }).from(staffRoles)
    .where(and(eq(staffRoles.tenantId, job.tenantId), eq(staffRoles.userId, recipientUserId), eq(staffRoles.active, true))).limit(1);
  if (!role || (recipientUserId !== userId && role.role !== "owner")) return { status: "suppressed" as const, reason: "Recipient no longer has access" };
  const at = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date(lockedAt));
  const message = recipientUserId === userId ? {
    to: recipient.email,
    subject: "Anmeldung bei Loynara vorübergehend gesperrt",
    body: `Für dein Loynara-Konto wurde am ${at} UTC zu oft ein falsches Passwort eingegeben. Die Anmeldung ist deshalb für bis zu 15 Minuten gesperrt. Geräte, die schon angemeldet sind, bleiben angemeldet.\n\nWarst du das nicht, hat jemand versucht, dein Passwort zu erraten. Verwende ein langes Passwort, das du nirgends sonst nutzt, und schreib an support@getloynara.com, wenn das wieder passiert.`,
    jobId: job.id,
  } : {
    to: recipient.email,
    subject: "Anmeldung eines Teamzugangs vorübergehend gesperrt",
    body: `Für den Teamzugang ${account.email} wurde am ${at} UTC zu oft ein falsches Passwort eingegeben. Die Anmeldung für diesen Zugang ist für bis zu 15 Minuten gesperrt. Geräte, die schon angemeldet sind, bleiben angemeldet.\n\nWar das nicht deine Mitarbeiterin oder dein Mitarbeiter, kannst du den Zugang im Bereich Team entziehen. Bei Fragen schreib an support@getloynara.com.`,
    jobId: job.id,
  };
  if (send) await send(message);
  else {
    const result = await sendTransactional(message);
    if (result.status !== "complete") return result;
  }
  return { status: "complete" as const };
}
