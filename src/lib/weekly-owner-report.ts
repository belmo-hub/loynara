import type { Pool } from "pg";
import { z } from "zod";
import { pool } from "@/db";
import { DomainError } from "./loyalty";
import { getTenantWindowAnalytics } from "./merchant-analytics";
import { emailTransportMode, sendTransactional, type TransactionalEmailProvider } from "./transactional-email";

export const WEEKLY_OWNER_REPORT = "email.weekly_report";
const payload = z.object({ weekStart: z.iso.date(), recipientUserId: z.string().min(1).max(64) }).strict();

/**
 * From Monday 07:00 Europe/Berlin, queues one report per active owner for every shop that has the report switched on,
 * about the Berlin calendar week (Monday to Sunday) that just ended. The weekly_owner_reports row and the jobs are
 * written by one statement, and its key (shop, week) lets that happen once: running this again, from any process,
 * queues nothing. Each job then sends at most once through the transactional reservation keyed by the job id.
 */
export async function queueWeeklyOwnerReports(database: Pick<Pool, "query"> = pool, now = new Date()): Promise<number> {
  if (emailTransportMode() === "disabled") return 0;
  const result = await database.query(`
    WITH berlin AS (SELECT date_trunc('week', $1::timestamptz AT TIME ZONE 'Europe/Berlin') AS monday),
    week AS (
      SELECT (monday - interval '7 days')::date AS start, monday AT TIME ZONE 'Europe/Berlin' AS ends,
        $1::timestamptz >= (monday + interval '7 hours') AT TIME ZONE 'Europe/Berlin' AS due
      FROM berlin
    ), reserved AS (
      INSERT INTO weekly_owner_reports (tenant_id, week_start)
      SELECT t.id, week.start FROM tenants t, week
      WHERE week.due AND t.weekly_report_enabled AND t.created_at < week.ends
      ON CONFLICT DO NOTHING
      RETURNING tenant_id, week_start
    )
    INSERT INTO outbox_jobs (tenant_id, kind, payload)
    SELECT r.tenant_id, $2, jsonb_build_object('weekStart', r.week_start::text, 'recipientUserId', s.user_id)
    FROM reserved r JOIN staff_roles s ON s.tenant_id = r.tenant_id AND s.role = 'owner' AND s.active
  `, [now, WEEKLY_OWNER_REPORT]);
  return result.rowCount ?? 0;
}

export async function deliverWeeklyOwnerReport(job: { id: string; tenantId: string; payload: Record<string, unknown> }, provider?: TransactionalEmailProvider) {
  if (emailTransportMode() === "disabled") return { status: "blocked" as const, reason: "Transactional email unavailable" };
  const parsed = payload.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked" as const, reason: "Invalid weekly report job" };
  // Rechecked at send time: someone who lost owner access, or a shop that switched the report off, gets nothing.
  const [row] = (await pool.query<{ email: string; shop: string; enabled: boolean; from: Date; to: Date }>(`
    SELECT u.email, t.name AS shop, t.weekly_report_enabled AS enabled,
      $3::date::timestamp AT TIME ZONE 'Europe/Berlin' AS "from",
      ($3::date + 7)::timestamp AT TIME ZONE 'Europe/Berlin' AS "to"
    FROM staff_roles s JOIN "user" u ON u.id = s.user_id JOIN tenants t ON t.id = s.tenant_id
    WHERE s.tenant_id = $1 AND s.user_id = $2 AND s.role = 'owner' AND s.active
  `, [job.tenantId, parsed.data.recipientUserId, parsed.data.weekStart])).rows;
  if (!row) return { status: "suppressed" as const, reason: "Recipient no longer has owner access" };
  if (!row.enabled) return { status: "suppressed" as const, reason: "Weekly report switched off" };
  const figures = await getTenantWindowAnalytics(job.tenantId, row.from, row.to);
  const message = { to: row.email, jobId: job.id, ...weeklyReportText(row.shop, row.from, row.to, {
    visits: figures.qualifyingCheckouts, newCards: figures.newCards, repeatCards: figures.repeatCards,
    wonBack: figures.wonBack, redemptions: figures.rewards.redemptions,
  }) };
  // Reserved by job id before the provider is called: a retried or replayed job never sends a second mail.
  return sendTransactional(message, provider);
}

type Figures = { visits: number; newCards: number; repeatCards: number; wonBack: number; redemptions: number };

export function weeklyReportText(shop: string, from: Date, to: Date, figures: Figures) {
  const day = (value: Date) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Berlin" }).format(value);
  const range = `${day(from)} bis ${day(new Date(to.getTime() - 1))}`;
  const name = shop.replace(/\s+/g, " ").trim();
  const base = process.env.PUBLIC_BASE_URL;
  const quiet = Object.values(figures).every(value => value === 0);
  return {
    subject: `Deine Woche bei ${name}: ${range}`,
    body: [
      `So lief die Woche vom ${range} bei ${name}:`,
      "",
      `Besuche: ${figures.visits}`,
      `Neue Kunden: ${figures.newCards}`,
      `Stammkunden: ${figures.repeatCards}`,
      `Zurückgewonnen: ${figures.wonBack}`,
      `Eingelöste Prämien: ${figures.redemptions}`,
      ...(quiet ? ["", "Diese Woche war ruhig. Zeig deinen Gästen an der Kasse die Karte: Jeder Besuch zählt, und der erste Stempel ist schnell gesetzt."] : []),
      "",
      `Mehr Zahlen im Dashboard: ${new URL("/merchant", base)}`,
      "",
      `Diese Übersicht kommt jeden Montag. Abschalten kannst du sie in den Einstellungen: ${new URL("/merchant/settings", base)}`,
    ].join("\n"),
  };
}

async function ownerTenant(actorUserId: string) {
  const [owner] = (await pool.query<{ tenantId: string }>(
    `SELECT tenant_id AS "tenantId" FROM staff_roles WHERE user_id = $1 AND role = 'owner' AND active = true`, [actorUserId])).rows;
  if (!owner) throw new DomainError("FORBIDDEN", "Owner access required");
  return owner.tenantId;
}

export async function getWeeklyReportSetting(actorUserId: string) {
  const tenantId = await ownerTenant(actorUserId);
  const { rows } = await pool.query<{ enabled: boolean }>("SELECT weekly_report_enabled AS enabled FROM tenants WHERE id = $1", [tenantId]);
  return { enabled: rows[0].enabled };
}

export async function setWeeklyReportSetting(actorUserId: string, enabled: boolean) {
  const tenantId = await ownerTenant(actorUserId);
  await pool.query("UPDATE tenants SET weekly_report_enabled = $2 WHERE id = $1", [tenantId, enabled]);
  return { enabled };
}
