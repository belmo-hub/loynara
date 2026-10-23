import { pool } from "@/db";
import { inviteTokenHash } from "./staff";

/**
 * Invite-gated staff sign-up (launch ledger O-043). Public registration stays closed; while this flag is on, an
 * account can be created only for the exact e-mail address of a pending, unexpired, unrevoked staff invitation, and
 * only by someone holding that invitation's secret token. Default off: enabling it on a real deployment is a separate
 * approval. Accepting the invitation (role, location, audit) is still the existing explicit step.
 */
export function inviteSignUpEnabled(env: Record<string, string | undefined> = process.env) {
  return env.STAFF_INVITE_SIGNUP_ENABLED === "true";
}

const tokenPattern = /^[A-Za-z0-9_-]{40,60}$/;

type PendingInvite = { email: string; role: "owner" | "cashier" | "manager"; businessName: string; locationName: string; expiresAt: Date };

export async function pendingInvite(token: string): Promise<PendingInvite | null> {
  if (!tokenPattern.test(token)) return null;
  const result = await pool.query<PendingInvite>(`
    SELECT i.invited_email AS email, i.role, t.name AS "businessName", l.name AS "locationName", i.expires_at AS "expiresAt"
    FROM staff_invites i JOIN tenants t ON t.id = i.tenant_id JOIN locations l ON l.id = i.location_id AND l.tenant_id = i.tenant_id
    WHERE i.token_hash = $1 AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  `, [inviteTokenHash(token)]);
  return result.rows[0] ?? null;
}

export async function inviteAllowsSignUp(token: string | null | undefined, email: unknown): Promise<boolean> {
  if (!token || typeof email !== "string") return false;
  const invite = await pendingInvite(token);
  return Boolean(invite && invite.email === email.trim().toLowerCase());
}
