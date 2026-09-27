import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contactVerificationChallenges, membershipContacts, memberships, outboxJobs } from "@/db/schema";
import { verificationTokenForChallenge, verificationTokenHash } from "./contact-token";
import { syntheticAddress, type LocalSender } from "./email";
import { emailTransportMode, sendTransactional } from "./transactional-email";

const payloadSchema = z.object({ membershipId: z.uuid(), challengeId: z.uuid() }).strict();

/** The outbox stores only IDs, never the link token or address. */
export async function deliverVerificationEmail(
  job: { id: string; tenantId: string; payload: Record<string, unknown> },
  send?: LocalSender,
): Promise<{ status: "complete" | "suppressed" | "blocked"; reason?: string }> {
  const mode = emailTransportMode();
  if (mode === "disabled") return { status: "blocked", reason: "Transactional verification unavailable" };
  const parsed = payloadSchema.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked", reason: "Invalid verification job payload" };
  const origin = new URL(process.env.PUBLIC_BASE_URL!);
  const token = verificationTokenForChallenge(parsed.data.challengeId);
  return db.transaction(async tx => {
    const [member] = await tx.select().from(memberships)
      .where(and(eq(memberships.id, parsed.data.membershipId), eq(memberships.tenantId, job.tenantId))).for("update");
    const finish = async (status: "complete" | "suppressed", reason?: string) => {
      await tx.update(outboxJobs).set({ payload: { membershipId: parsed.data.membershipId } })
        .where(and(eq(outboxJobs.id, job.id), eq(outboxJobs.tenantId, job.tenantId)));
      return { status, reason };
    };
    if (!member || member.closedAt) return finish("suppressed", "Membership unavailable");
    const [challenge] = await tx.select().from(contactVerificationChallenges)
      .where(and(eq(contactVerificationChallenges.id, parsed.data.challengeId), eq(contactVerificationChallenges.tenantId, job.tenantId), eq(contactVerificationChallenges.membershipId, member.id))).for("update");
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.tokenHash !== verificationTokenHash(token)) return finish("suppressed", "Verification challenge unavailable");
    const [contact] = await tx.select().from(membershipContacts)
      .where(and(eq(membershipContacts.tenantId, job.tenantId), eq(membershipContacts.membershipId, member.id))).limit(1);
    if (!contact || contact.email !== challenge.email || contact.emailVerified) return finish("suppressed", "Contact changed or already verified");
    if (mode === "mailpit" && !syntheticAddress(challenge.email)) return finish("suppressed", "Recipient is not synthetic");
    const link = new URL("/verify-email", origin);
    link.hash = `token=${token}`;
    const message = {
      to: challenge.email,
      subject: "E-Mail-Adresse für Loynara bestätigen",
      body: `Öffne diesen Link, um deine E-Mail-Adresse als Wiederherstellungsmethode für deine Loynara-Karte zu bestätigen:\n${link.toString()}\n\nDer Link ist einmalig und läuft nach 30 Minuten ab. Falls du das nicht angefordert hast, ignoriere diese Nachricht. Mit der Bestätigung abonnierst du keine Werbung.`,
      jobId: job.id,
    };
    if (send) await send(message);
    else {
      const delivered = await sendTransactional(message);
      if (delivered.status !== "complete") return delivered;
    }
    return finish("complete");
  });
}
