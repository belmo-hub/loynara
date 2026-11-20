import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { contactVerificationChallenges, membershipContacts, memberships, outboxJobs, tenants } from "@/db/schema";
import { verificationTokenForChallenge, verificationTokenHash } from "./contact-token";
import { syntheticAddress, type LocalSender } from "./email";
import { operatorIdentity } from "./operator-identity";
import { RateLimitError, enforceRateLimit } from "./rate-limit";
import { unsafeShopName } from "./sender-details";
import { emailTransportMode, sendTransactional } from "./transactional-email";

// ENG-285: anyone can register a shop, name it anything and ask for these mails to any address, so each shop sends at most
// this many a day (the route keeps the per-address caps). A pizzeria enrolling a busy day of guests stays well under it.
export const SHOP_CONTACT_MAIL_DAY_LIMIT = { scope: "contact_mail_shop_day", max: 50, windowSeconds: 24 * 60 * 60 };

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
  // Legal (1 Nov): every confirmation mail names its sender, the operator, from configuration (the founder's G0, never
  // hard-coded). Without it no confirmation mail goes out, and the card offers none either (contactStatus).
  const operator = operatorIdentity()?.name;
  if (!operator) return { status: "blocked", reason: "Operator name not configured" };
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
    if (!contact || contact.email !== challenge.email || (contact.emailVerified && !challenge.marketing)) return finish("suppressed", "Contact changed or already verified");
    if (mode === "mailpit" && !syntheticAddress(challenge.email)) return finish("suppressed", "Recipient is not synthetic");
    const link = new URL("/verify-email", origin);
    link.hash = `token=${token}`;
    // Variant A (copy v0.5) names the shop and the marketing consent the click confirms; variant C is recovery only.
    // Neither carries the card link: it is a bearer credential.
    // The shop is the controller; the operator sends on its behalf (Legal, 1 Nov), in both variants.
    const shop = (await tx.select({ name: tenants.name }).from(tenants).where(eq(tenants.id, job.tenantId)))[0]?.name;
    if (!shop) return finish("suppressed", "Shop unavailable");
    // ENG-285: only a shop whose owner confirmed an address mails strangers. An owner who accepted the operator's
    // invitation at that address proved the inbox too (accounts from before acceptance confirmed it, no migration).
    const confirmed = await tx.execute(sql`SELECT 1 FROM staff_roles o JOIN "user" u ON u.id = o.user_id
      WHERE o.tenant_id = ${job.tenantId} AND o.role = 'owner' AND o.active AND (u."emailVerified" OR EXISTS (
        SELECT 1 FROM staff_invites i WHERE i.tenant_id = o.tenant_id AND i.role = 'owner' AND i.accepted_at IS NOT NULL AND i.invited_email = lower(u.email)))
      LIMIT 1`);
    if (!confirmed.rows.length) return finish("suppressed", "Owner email not confirmed");
    // The shop's own text, so only ever a quoted name in the body: the sender is always Loynara. A name from before the
    // rule that carries a link or number reads as „dein Geschäft“ instead (named: nominative, of: dative).
    const quoted = unsafeShopName(shop) ? null : `„${shop}“`;
    const named = quoted ?? "dein Geschäft", of = quoted ?? "deinem Geschäft";
    const footer = `\n\n--\nDiese E-Mail verschickt ${operator} im Auftrag von ${of}.\nDatenschutzhinweise: ${new URL("/datenschutz", origin).toString()}`;
    const message = challenge.marketing ? {
      to: challenge.email,
      fromName: "Loynara",
      subject: "Bitte bestätige: E-Mails zu deiner Karte",
      body: `Hallo,\n\nschön, dass du die Karte von ${of} nutzt! Du hast diese E-Mail-Adresse eingetragen, damit du deine Karte wiederfindest und damit ${named} dir Angebote, Neuigkeiten und Erinnerungen schicken darf.\n\nEin Klick, und du bist dabei:\nJa, ich möchte E-Mails von ${of}\n${link.toString()}\n\nDer Link gilt 30 Minuten.\n\nWarst du das nicht? Dann ignorier diese E-Mail einfach. Ohne Klick bekommst du keine Nachrichten.${footer}`,
      jobId: job.id,
    } : {
      to: challenge.email,
      fromName: "Loynara",
      subject: "E-Mail-Adresse für Loynara bestätigen",
      body: `Öffne diesen Link, um deine E-Mail-Adresse als Wiederherstellungsmethode für deine Loynara-Karte zu bestätigen:\n${link.toString()}\n\nDer Link ist einmalig und läuft nach 30 Minuten ab. Falls du das nicht angefordert hast, ignoriere diese Nachricht. Mit der Bestätigung abonnierst du keine Werbung.${footer}`,
      jobId: job.id,
    };
    // Over the cap the guest already had the usual answer; the job ends quietly and nothing is sent.
    try { await enforceRateLimit({ ...SHOP_CONTACT_MAIL_DAY_LIMIT, identity: job.tenantId }); }
    catch (error) { if (error instanceof RateLimitError) return finish("suppressed", "Shop's daily contact mail cap reached"); throw error; }
    if (send) await send(message);
    else {
      const delivered = await sendTransactional(message);
      if (delivered.status !== "complete") return delivered;
    }
    return finish("complete");
  });
}
