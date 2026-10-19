import { sql } from "drizzle-orm";
import { db } from "@/db";
import { DomainError } from "@/lib/loyalty";
import { can, type AdminRole } from "./capabilities";
import type { AdminContext } from "./guard";
import type { Transaction } from "./types";
import { recordAdminEvent } from "./audit";
import { withAdminIdempotency } from "./idempotency";
import { resetSecondFactor } from "./second-factor";
import { ADMIN_IDLE_SECONDS, ADMIN_MAX_SESSION_SECONDS, ADMIN_STEP_UP_SECONDS } from "./session";
const roleNames: Record<AdminRole,string> = { founder: "Gründer", support: "Support", sales: "Vertrieb" };
const rolesLock = (tx: Transaction) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('platform_admin_roles', 0))`);
function operatorLabel(operator: string) {
  if (!operator.startsWith("operator_cli:") || operator.length > 120) throw new DomainError("INVALID_REQUEST", "Invalid operator label");
  return operator;
}
async function userByEmail(tx: Transaction, email: string) {
  const result = await tx.execute<{ id: string }>(sql`SELECT id FROM "user" WHERE lower(email)=${email.trim().toLowerCase()}`);
  if (!result.rows[0]) throw new DomainError("NOT_FOUND", "Not found");
  return result.rows[0].id;
}
export async function grantAdminRole(input: { email: string; role: AdminRole; operator: string }): Promise<"granted" | "already"> {
  const operator = operatorLabel(input.operator);
  return db.transaction(async tx => {
    await rolesLock(tx); const userId = await userByEmail(tx, input.email);
    const staff = await tx.execute(sql`SELECT 1 FROM staff_roles WHERE user_id=${userId}
      UNION ALL SELECT 1 FROM staff_invites WHERE lower(invited_email)=${input.email.trim().toLowerCase()}
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>now() LIMIT 1`);
    if (staff.rows.length) throw new DomainError("INVALID_REQUEST", "Dieses Konto gehört zu einem Händlerteam oder hat eine offene Teameinladung. Verwende ein separates Konsolenkonto, das mit operator:provision-identity erstellt wurde.");
    const result = await tx.execute(sql`INSERT INTO platform_admins(user_id,role,granted_by) VALUES(${userId},${input.role},${operator}) ON CONFLICT DO NOTHING RETURNING user_id`);
    if (!result.rows.length) return "already";
    await recordAdminEvent(tx, { actor: "operator_cli", adminUserId: null, roles: [], action: "admin.role_granted", targetType: "admin", targetId: userId, summary: `Rolle ${roleNames[input.role]} vergeben (${operator})` });
    return "granted";
  });
}
export async function revokeAdminRole(input: { email: string; role: AdminRole; operator: string }): Promise<"revoked" | "absent"> {
  const operator = operatorLabel(input.operator);
  return db.transaction(async tx => {
    await rolesLock(tx); const userId = await userByEmail(tx, input.email);
    const held = await tx.execute(sql`SELECT user_id FROM platform_admins WHERE user_id=${userId} AND role=${input.role}`);
    if (!held.rows.length) return "absent";
    if (input.role === "founder") {
      const founders = await tx.execute(sql`SELECT user_id FROM platform_admins WHERE role='founder'`);
      if (founders.rows.length <= 1) throw new DomainError("INVALID_REQUEST", "The last founder must remain");
    }
    await tx.execute(sql`DELETE FROM platform_admins WHERE user_id=${userId} AND role=${input.role}`);
    await recordAdminEvent(tx, { actor: "operator_cli", adminUserId: null, roles: [], action: "admin.role_revoked", targetType: "admin", targetId: userId, summary: `Rolle ${roleNames[input.role]} entzogen (${operator})` });
    return "revoked";
  });
}
export async function listAdmins(): Promise<Array<{ userId: string; email: string; roles: AdminRole[]; hasSecondFactor: boolean; lastSeenAt: Date | null }>> {
  const result = await db.execute<{ userId: string; email: string; roles: AdminRole[]; hasSecondFactor: boolean; lastSeenAt: Date | string | null }>(sql`
    SELECT u.id AS "userId",u.email,array_agg(p.role ORDER BY p.role) AS roles,
      coalesce(u."twoFactorEnabled",false) AND EXISTS(SELECT 1 FROM "twoFactor" f WHERE f."userId"=u.id AND f.verified=true) AS "hasSecondFactor",
      (SELECT max(last_seen_at) FROM admin_session_activity WHERE user_id=u.id) AS "lastSeenAt"
    FROM platform_admins p JOIN "user" u ON u.id=p.user_id GROUP BY u.id,u.email,u."twoFactorEnabled" ORDER BY u.email`);
  return result.rows.map(row => ({ ...row, lastSeenAt: row.lastSeenAt ? new Date(row.lastSeenAt) : null }));
}
export async function resetAdminSecondFactor(input: { targetUserId: string; by: { actor: "console"; ctx: AdminContext; idempotencyKey: string } | { actor: "operator_cli"; operator: string } }): Promise<void> {
  const by = input.by;
  if (by.actor === "console" && by.ctx.userId === input.targetUserId) throw new DomainError("INVALID_REQUEST", "Use the operator recovery command for your own account");
  await db.transaction(async tx => {
    await rolesLock(tx);
    let roles: AdminRole[] = [];
    if (by.actor === "console") {
      const live = await tx.execute<{ role: AdminRole }>(sql`SELECT role FROM platform_admins WHERE user_id=${by.ctx.userId}`);
      roles = live.rows.map(row => row.role);
      if (!can(roles, "admins.reset_2fa")) throw new DomainError("NOT_FOUND", "Not found");
      const now = new Date();
      const fresh = await tx.execute(sql`SELECT a.session_id FROM admin_session_activity a JOIN "session" s ON s.id=a.session_id
        JOIN verification v ON v.id='admin-mfa:'||s.id AND v.value=s."userId" AND v."expiresAt">${now}
        WHERE s.id=${by.ctx.sessionId} AND s."userId"=${by.ctx.userId} AND s."expiresAt">${now}
          AND a.started_at>${new Date(now.getTime()-ADMIN_MAX_SESSION_SECONDS*1000)} AND a.last_seen_at>=${new Date(now.getTime()-ADMIN_IDLE_SECONDS*1000)}
          AND a.step_up_at>${new Date(now.getTime()-ADMIN_STEP_UP_SECONDS*1000)} AND a.step_up_at<=${now} FOR UPDATE OF s,a`);
      if (!fresh.rows.length) throw new DomainError("STEP_UP_REQUIRED", "Anmeldung erneut bestätigen");
    } else operatorLabel(by.operator);
    const run = async () => {
      const target = await tx.execute(sql`SELECT user_id FROM platform_admins WHERE user_id=${input.targetUserId}`);
      if (!target.rows.length) throw new DomainError("NOT_FOUND", "Not found");
      await resetSecondFactor(tx, input.targetUserId);
      await recordAdminEvent(tx, { actor: by.actor, adminUserId: by.actor === "console" ? by.ctx.userId : null, roles, action: "admin.two_factor_reset", targetType: "admin", targetId: input.targetUserId, summary: by.actor === "console" ? "Zweiten Faktor zurückgesetzt" : `Zweiten Faktor zurückgesetzt (${by.operator})` });
    };
    if (by.actor === "console") await withAdminIdempotency(tx, { adminUserId: by.ctx.userId, key: by.idempotencyKey, action: "admin.two_factor_reset" }, run);
    else await run();
  });
}
