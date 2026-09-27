import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { cardRecoveryChallenges, membershipContacts, memberships, outboxJobs } from "@/db/schema";
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
  const message = { to: contact.email, subject: "Loynara-Kartenlink wurde ersetzt", body: "Der private Link zu einer deiner Loynara-Karten wurde ersetzt. Der bisherige Link funktioniert nicht mehr. Falls du das nicht selbst getan hast, kontaktiere den zuständigen Händler über einen bekannten Kontaktweg. Diese Nachricht enthält keinen Kartenlink und keine Kontostände.", jobId: job.id };
  if (send) await send(message);
  else {
    const result = await sendTransactional(message);
    if (result.status !== "complete") return result;
  }
  await db.update(outboxJobs).set({ payload: { membershipId: parsed.data.membershipId } }).where(eq(outboxJobs.id, job.id));
  return { status: "complete" as const };
}
