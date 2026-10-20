import { DomainError } from "./loyalty";

/** Session creation is the password-authenticated login time, never sliding updatedAt. */
export function requireRecentOwnerSession(session: { role: string; active: boolean; createdAt: Date; expiresAt: Date }, now = new Date()) {
  if (session.role !== "owner" || !session.active) throw new DomainError("FORBIDDEN", "Only the active owner can delete this business");
  const age = now.getTime() - session.createdAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > 600_000 || !(session.expiresAt > now)) {
    throw new DomainError("REAUTHENTICATION_REQUIRED", "Sign out and sign in again before deleting this business");
  }
}
