import { and, desc, eq, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminAuditEvents } from "@/db/schema";
import type { AdminRole } from "./capabilities";
import type { Transaction } from "./types";
export type AdminAction = "admin.session_started" | "admin.step_up" | "admin.role_granted" | "admin.role_revoked" | "admin.two_factor_reset";
export type AdminEventInput = { actor: "console" | "operator_cli"; adminUserId: string | null; roles: AdminRole[]; action: AdminAction; tenantId?: string | null; targetType?: string; targetId?: string; summary: string; reason?: string; ip?: string | null; userAgent?: string | null };
export async function recordAdminEvent(tx: Transaction, input: AdminEventInput): Promise<void> {
  await tx.insert(adminAuditEvents).values({ ...input, ip: input.ip?.slice(0,64), userAgent: input.userAgent?.slice(0,300) });
}
export async function listAdminEvents(input: { viewerUserId: string; viewAll: boolean; limit: number; before?: Date; beforeId?: string; action?: AdminAction }) {
  const limit = Number.isFinite(input.limit) ? Math.max(1, Math.min(200, Math.floor(input.limit))) : 50;
  return db.select({ id: adminAuditEvents.id, at: adminAuditEvents.at, actor: adminAuditEvents.actor, adminUserId: adminAuditEvents.adminUserId, action: adminAuditEvents.action, tenantId: adminAuditEvents.tenantId, targetType: adminAuditEvents.targetType, targetId: adminAuditEvents.targetId, summary: adminAuditEvents.summary, reason: adminAuditEvents.reason }).from(adminAuditEvents).where(and(
    input.viewAll ? undefined : eq(adminAuditEvents.adminUserId, input.viewerUserId),
    input.beforeId ? sql`(${adminAuditEvents.at}, ${adminAuditEvents.id}) < (SELECT at,id FROM admin_audit_events WHERE id=${input.beforeId} AND (${input.viewAll} OR admin_user_id=${input.viewerUserId}))` : input.before ? lt(adminAuditEvents.at, input.before) : undefined,
    input.action ? eq(adminAuditEvents.action, input.action) : undefined,
  )).orderBy(desc(adminAuditEvents.at), desc(adminAuditEvents.id)).limit(limit);
}
