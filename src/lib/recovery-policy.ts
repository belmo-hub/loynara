import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { ledgerEntries, membershipContacts, memberships } from "@/db/schema";

/** Legacy opt-in; selected release keeps this off so recovery email is optional. */
export function verifiedRecoveryBeforeFirstAward(env: Record<string, string | undefined> = process.env) {
  return env.VERIFIED_RECOVERY_BEFORE_FIRST_AWARD === "true";
}

/** Call under the membership row lock when authorizing a write. Contact edits use that same lock.
 * Existing awards are historical evidence, not a balance check; redemption/correction never resets eligibility.
 */
export async function recoveryVerificationRequired(query: Pick<typeof db, "select">, tenantId: string, membershipId: string) {
  if (!verifiedRecoveryBeforeFirstAward()) return false;
  const [prior] = await query.select({ id: ledgerEntries.id }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.tenantId, tenantId), eq(ledgerEntries.membershipId, membershipId), eq(ledgerEntries.kind, "award"))).limit(1);
  if (prior) return false;
  const [contact] = await query.select({ email: membershipContacts.email, verified: membershipContacts.emailVerified }).from(membershipContacts)
    .where(and(eq(membershipContacts.tenantId, tenantId), eq(membershipContacts.membershipId, membershipId))).limit(1);
  return !contact?.email || !contact.verified;
}

/** A bearer card resolves its own tenant/membership; callers cannot supply another merchant's identity. */
export async function cardRecoveryVerificationRequired(cardToken: string) {
  if (!verifiedRecoveryBeforeFirstAward()) return false;
  const [member] = await db.select({ id: memberships.id, tenantId: memberships.tenantId }).from(memberships).where(eq(memberships.cardToken, cardToken));
  return !member || await recoveryVerificationRequired(db, member.tenantId, member.id);
}
