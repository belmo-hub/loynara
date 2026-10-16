import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { adminSessionActivity } from "@/db/schema";
import { DomainError } from "@/lib/loyalty";
import { enforceRateLimit, refundRateLimit } from "@/lib/rate-limit";
import { recordAdminEvent } from "./audit";
import { verifyAdminPassword, verifyAdminSecondFactor } from "./second-factor";
import type { AdminRole } from "./capabilities";
export const ADMIN_IDLE_SECONDS = 1800;
export const ADMIN_MAX_SESSION_SECONDS = 43200;
export const ADMIN_STEP_UP_SECONDS = 300;
type SessionInput = { sessionId: string; userId: string; roles: AdminRole[]; ip: string | null; userAgent: string | null; now?: Date };
export async function touchAdminSession(input: SessionInput & { sessionCreatedAt: Date }): Promise<"ok" | "expired"> {
  const now = input.now ?? new Date();
  return db.transaction(async tx => {
    const sessions = await tx.execute<{ id: string }>(sql`SELECT id FROM "session" WHERE id=${input.sessionId} AND "userId"=${input.userId} FOR UPDATE`);
    if (!sessions.rows.length) return "expired";
    const [activity] = await tx.select().from(adminSessionActivity).where(eq(adminSessionActivity.sessionId, input.sessionId));
    if (now.getTime() - input.sessionCreatedAt.getTime() >= ADMIN_MAX_SESSION_SECONDS * 1000 || (activity && now.getTime() - activity.lastSeenAt.getTime() > ADMIN_IDLE_SECONDS * 1000)) {
      await tx.execute(sql`DELETE FROM "session" WHERE id=${input.sessionId}`);
      return "expired";
    }
    if (activity) await tx.update(adminSessionActivity).set({ lastSeenAt: now }).where(eq(adminSessionActivity.sessionId, input.sessionId));
    else {
      await tx.insert(adminSessionActivity).values({ sessionId: input.sessionId, userId: input.userId, startedAt: input.sessionCreatedAt, lastSeenAt: now });
      await recordAdminEvent(tx, { actor: "console", adminUserId: input.userId, roles: input.roles, action: "admin.session_started", summary: "Admin-Sitzung gestartet", ip: input.ip, userAgent: input.userAgent });
    }
    return "ok";
  });
}
export async function performStepUp(input: SessionInput & { password: string; code: string }): Promise<void> {
  const limits = [`user:${input.userId}`, `ip:${input.ip ?? "untrusted-peer"}`].map(identity => ({ scope: "admin_step_up", identity, max: 5, windowSeconds: 900 }));
  for (const limit of limits) await enforceRateLimit(limit);
  const [passwordValid, factorValid] = await Promise.all([verifyAdminPassword(input.userId, input.password), verifyAdminSecondFactor(input.userId, input.code)]);
  if (!passwordValid || !factorValid) throw new DomainError("FORBIDDEN", "Anmeldung nicht bestätigt");
  const now = input.now ?? new Date();
  await db.transaction(async tx => {
    const sessions = await tx.execute(sql`SELECT id FROM "session" WHERE id=${input.sessionId} AND "userId"=${input.userId} AND "expiresAt">${now} FOR UPDATE`);
    const [activity] = await tx.select().from(adminSessionActivity).where(and(eq(adminSessionActivity.sessionId, input.sessionId), eq(adminSessionActivity.userId, input.userId)));
    if (!sessions.rows.length || !activity || now.getTime() - activity.startedAt.getTime() >= ADMIN_MAX_SESSION_SECONDS * 1000 || now.getTime() - activity.lastSeenAt.getTime() > ADMIN_IDLE_SECONDS * 1000) throw new DomainError("UNAUTHENTICATED", "Sign in required");
    await tx.update(adminSessionActivity).set({ stepUpAt: now }).where(eq(adminSessionActivity.sessionId, input.sessionId));
    await recordAdminEvent(tx, { actor: "console", adminUserId: input.userId, roles: input.roles, action: "admin.step_up", summary: "Admin-Sitzung erneut bestätigt", ip: input.ip, userAgent: input.userAgent });
  });
  for (const limit of limits) await refundRateLimit(limit);
}
export async function hasFreshStepUp(sessionId: string, now = new Date()): Promise<boolean> {
  const [activity] = await db.select().from(adminSessionActivity).where(eq(adminSessionActivity.sessionId, sessionId));
  if (!activity?.stepUpAt) return false;
  const age = now.getTime() - activity.stepUpAt.getTime();
  return age >= 0 && age < ADMIN_STEP_UP_SECONDS * 1000 && now.getTime() - activity.lastSeenAt.getTime() <= ADMIN_IDLE_SECONDS * 1000 && now.getTime() - activity.startedAt.getTime() < ADMIN_MAX_SESSION_SECONDS * 1000;
}
