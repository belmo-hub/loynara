import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardRecoveryChallenges, cardSecurityEvents, membershipContacts, memberships, outboxJobs } from "@/db/schema";
import { recoveryTokenForChallenge, recoveryTokenHash } from "./contact-token";
import { emailTransportMode, sendTransactional } from "./transactional-email";
import type { LocalSender } from "./email";

const payload = z.object({ challengeId: z.uuid() }).strict();

export async function deliverRecoveryEmail(job: { id: string; tenantId: string; payload: Record<string, unknown> }, send?: LocalSender) {
  if (emailTransportMode() === "disabled") return { status: "blocked" as const, reason: "Transactional recovery unavailable" };
  const parsed = payload.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked" as const, reason: "Invalid recovery job payload" };
  const [challenge] = await db.select().from(cardRecoveryChallenges).where(eq(cardRecoveryChallenges.id, parsed.data.challengeId));
  if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date()) return { status: "suppressed" as const, reason: "Recovery challenge unavailable" };
  const [eligible] = await db.select({ id: memberships.id }).from(membershipContacts)
    .innerJoin(memberships, and(eq(memberships.id, membershipContacts.membershipId), eq(memberships.tenantId, membershipContacts.tenantId)))
    .where(and(eq(membershipContacts.email, challenge.email), eq(membershipContacts.emailVerified, true), isNull(memberships.closedAt))).limit(1);
  if (!eligible) return { status: "suppressed" as const, reason: "Recovery method unavailable" };
  const token = recoveryTokenForChallenge(challenge.id);
  if (challenge.tokenHash !== recoveryTokenHash(token)) return { status: "blocked" as const, reason: "Recovery token mismatch" };
  const link = new URL("/recover/confirm", process.env.PUBLIC_BASE_URL);
  link.hash = `token=${token}`;
  const message = { to: challenge.email, subject: "Loynara-Karte wiederfinden", body: `Du hast einen Link angefordert, um deine Loynara-Karte wiederzufinden:\n${link.toString()}\n\nDer Link ist einmalig und läuft nach 20 Minuten ab. Die Karte wird erst ersetzt, wenn du sie auf der Seite ausdrücklich auswählst. Falls du das nicht angefordert hast, ignoriere diese Nachricht.`, jobId: job.id };
  if (send) await send(message);
  else {
    const result = await sendTransactional(message);
    if (result.status !== "complete") return result;
  }
  await db.update(outboxJobs).set({ payload: {} }).where(eq(outboxJobs.id, job.id));
  return { status: "complete" as const };
}

export async function deliverRecoveryNotice(job: { id: string; tenantId: string; payload: Record<string, unknown> }, send?: LocalSender) {
  if (emailTransportMode() === "disabled") return { status: "blocked" as const, reason: "Transactional recovery unavailable" };
  const parsed = z.object({ membershipId: z.uuid() }).strict().safeParse(job.payload);
  if (!parsed.success) return { status: "blocked" as const, reason: "Invalid security notice job" };
  const [contact] = await db.select({ email: membershipContacts.email, emailVerified: membershipContacts.emailVerified, closedAt: memberships.closedAt })
    .from(memberships).innerJoin(membershipContacts, and(eq(membershipContacts.tenantId, memberships.tenantId), eq(membershipContacts.membershipId, memberships.id)))
    .where(and(eq(memberships.tenantId, job.tenantId), eq(memberships.id, parsed.data.membershipId))).limit(1);
  if (!contact?.email || !contact.emailVerified || contact.closedAt) return { status: "suppressed" as const, reason: "Recovery method unavailable" };
  const [rotation] = await db.select({ createdAt: cardSecurityEvents.createdAt }).from(cardSecurityEvents)
    .where(and(eq(cardSecurityEvents.tenantId, job.tenantId), eq(cardSecurityEvents.membershipId, parsed.data.membershipId), eq(cardSecurityEvents.action, "card_credential_rotated")))
    .orderBy(desc(cardSecurityEvents.createdAt)).limit(1);
  if (!rotation) return { status: "suppressed" as const, reason: "Recovery rotation unavailable" };
  const occurredAt = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(rotation.createdAt);
  const message = { to: contact.email, subject: "Deine Loynara-Karte wurde wiederhergestellt", body: `Der Zugang zu deiner Loynara-Karte wurde am ${occurredAt} UTC wiederhergestellt.\nDer bisherige private Kartenlink ist nicht mehr gültig.\n\nFalls du das nicht selbst veranlasst hast, kläre den Vorgang direkt mit dem Geschäft.`, jobId: job.id };
  if (send) await send(message);
  else {
    const result = await sendTransactional(message);
    if (result.status !== "complete") return result;
  }
  await db.update(outboxJobs).set({ payload: { membershipId: parsed.data.membershipId } }).where(eq(outboxJobs.id, job.id));
  return { status: "complete" as const };
}
