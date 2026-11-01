import type { Pool } from "pg";
import { z } from "zod";
import { pool } from "@/db";
import { operatorIdentity } from "./billing-stripe";
import { surfaceHidden } from "./pilot-surfaces";
import { vatMode } from "./stripe-config";
import { emailTransportMode, sendTransactional, type TransactionalEmailProvider } from "./transactional-email";

/**
 * ENG-123 (D-021, Pilotvereinbarung § 2): the reminder in text form, 7 days before a shop's free first month ends, one per
 * business (Legal: its free-month locations share the start day, and cancelling ends the whole contract). The
 * free_month_reminders row and the jobs are written by one statement, and its key (shop, free month) lets that happen once;
 * each job then sends at most once through the transactional reservation keyed by the job id. While the email lane is off
 * nothing is queued, and /operator shows the reminder as not sent.
 */
export const FREE_MONTH_REMINDER = "email.free_month";
const payload = z.object({ freeUntil: z.iso.datetime({ offset: true }), recipientUserId: z.string().min(1).max(64) }).strict();
const DAY_MS = 86_400_000;
// The free-month locations are the ones that started with the shop; a later location gets no free month (K-09).
const FREE_LOCATIONS = "JOIN billing_location_plans p ON p.tenant_id = s.tenant_id AND p.created_at <= s.started_at";
const STILL_FREE = "s.status IN ('active', 'past_due') AND NOT s.cancel_at_period_end";

export async function queueFreeMonthReminders(database: Pick<Pool, "query"> = pool, now = new Date()): Promise<number> {
  if (emailTransportMode() === "disabled") return 0;
  const result = await database.query(`
    WITH reserved AS (
      INSERT INTO free_month_reminders (tenant_id, free_until)
      SELECT s.tenant_id, s.free_until FROM subscriptions s
      WHERE s.free_until > $1 AND s.free_until <= $1::timestamptz + interval '7 days' AND ${STILL_FREE}
      ON CONFLICT DO NOTHING
      RETURNING tenant_id, free_until
    )
    INSERT INTO outbox_jobs (tenant_id, kind, payload)
    SELECT r.tenant_id, $2, jsonb_build_object('freeUntil', to_char(r.free_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), 'recipientUserId', o.user_id)
    FROM reserved r JOIN staff_roles o ON o.tenant_id = r.tenant_id AND o.role = 'owner' AND o.active
  `, [now, FREE_MONTH_REMINDER]);
  return result.rowCount ?? 0;
}

export async function deliverFreeMonthReminder(job: { id: string; tenantId: string; payload: Record<string, unknown> }, provider?: TransactionalEmailProvider) {
  if (emailTransportMode() === "disabled") return { status: "blocked" as const, reason: "Transactional email unavailable" };
  const parsed = payload.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked" as const, reason: "Invalid free-month reminder job" };
  // Legal: the price must read as on the invoice, so no mail goes out before the VAT mode is set.
  const mode = vatMode();
  if (mode === "none") return { status: "blocked" as const, reason: "No VAT mode set" };
  // Rechecked at send time: an owner who lost access, a shop that cancelled, or a changed free month gets nothing.
  const [row] = (await pool.query<{ email: string; shop: string; current: boolean }>(`
    SELECT u.email, t.name AS shop, (s.free_until = $3::timestamptz AND ${STILL_FREE}) AS current
    FROM staff_roles o JOIN "user" u ON u.id = o.user_id JOIN tenants t ON t.id = o.tenant_id JOIN subscriptions s ON s.tenant_id = o.tenant_id
    WHERE o.tenant_id = $1 AND o.user_id = $2 AND o.role = 'owner' AND o.active
  `, [job.tenantId, parsed.data.recipientUserId, parsed.data.freeUntil])).rows;
  if (!row) return { status: "suppressed" as const, reason: "Recipient no longer has owner access" };
  if (!row.current) return { status: "suppressed" as const, reason: "Free month no longer ends then" };
  // Each location's stored price, the one the invoice charges (applyPlan writes it); never a literal amount.
  const { rows: locations } = await pool.query<{ name: string; priceMinor: number }>(`
    SELECT l.name, p.price_minor AS "priceMinor" FROM subscriptions s ${FREE_LOCATIONS}
    JOIN locations l ON l.tenant_id = p.tenant_id AND l.id = p.location_id
    WHERE s.tenant_id = $1 ORDER BY l.name, l.id
  `, [job.tenantId]);
  if (!locations.length) return { status: "suppressed" as const, reason: "No free-month location" };
  const operator = await operatorIdentity();
  if (!operator) return { status: "blocked" as const, reason: "Operator name or address missing in Stripe's public details" };
  // Reserved by job id before the provider is called: a retried or replayed job never sends a second mail.
  return sendTransactional({ to: row.email, jobId: job.id, ...freeMonthReminderText({ shop: row.shop, locations, freeUntil: new Date(parsed.data.freeUntil), vat: mode, operator, inApp: !surfaceHidden("cancellation") }) }, provider);
}

const ownerDay = (value: Date) => new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", timeZone: "Europe/Berlin" }).format(value);
const euros = (minor: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", minimumFractionDigits: minor % 100 === 0 ? 0 : 2 }).format(minor / 100);
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

/**
 * Marketing's text, passed by Legal (28 Oct) for Q-90 "continues unless cancelled". Dates in owner format without the year:
 * the last free day (the day before the first billing date) and the first billing day. Prices as on the invoice: plain for a
 * Kleinunternehmer, with „zzgl. USt“ in standard mode. The footer names the operator as the invoice does.
 */
export function freeMonthReminderText(input: { shop: string; locations: Array<{ name: string; priceMinor: number }>; freeUntil: Date; vat: "kleinunternehmer" | "standard"; operator: { name: string; address: string }; inApp: boolean }) {
  const lastFree = ownerDay(new Date(input.freeUntil.getTime() - DAY_MS));
  const firstBilling = ownerDay(input.freeUntil);
  const price = (minor: number) => `${euros(minor)}${input.vat === "standard" ? " zzgl. USt" : ""}`;
  const shop = clean(input.shop);
  const total = input.locations.reduce((sum, location) => sum + location.priceMinor, 0);
  const priceLines = input.locations.length === 1
    ? [`Ab dem ${firstBilling} kostet Loynara ${price(total)} im Monat für ${clean(input.locations[0].name)}.`]
    : [`Ab dem ${firstBilling} kostet Loynara ${price(total)} im Monat für deine ${input.locations.length} Standorte:`, ...input.locations.map(location => `${clean(location.name)}: ${price(location.priceMinor)}`)];
  return {
    subject: `Dein kostenloser Monat für ${shop} endet am ${lastFree}`,
    body: [
      "Hallo,",
      "",
      `dein kostenloser Monat bei Loynara für ${shop} endet am ${lastFree}.`,
      "",
      "Möchtest du weitermachen, musst du nichts tun.",
      ...priceLines,
      "Die erste Rechnung kommt am selben Tag per E-Mail. Eine Zahlungsart kannst du vorher in deinem Inhaberbereich unter „Abrechnung“ hinterlegen.",
      "",
      // ENG-167 (Marketing R1/R2, Legal 1 Nov): the in-app path only while the cancellation surface is on.
      input.inApp
        ? `Möchtest du aufhören, kündige bis zum ${lastFree} in deinem Inhaberbereich unter Mehr › Geschäft › Programm beenden oder per E-Mail an support@getloynara.com. Es kostet dich nichts. Dein Programm endet frühestens 14 Tage nach deiner Kündigung, damit deine Kunden das Ende rechtzeitig sehen. Das genaue Datum bekommst du mit der Bestätigung.`
        : `Möchtest du aufhören, schreibe bis zum ${lastFree} eine kurze E-Mail an support@getloynara.com. Es kostet dich nichts. Dein Programm endet frühestens 14 Tage nach deiner Kündigung, damit deine Kunden das Ende rechtzeitig sehen. Das genaue Datum bekommst du mit der Bestätigung.`,
      "",
      "Viele Grüße",
      "Loynara",
      "",
      `${clean(input.operator.name)} · ${clean(input.operator.address)}`,
    ].join("\n"),
  };
}

/** /operator: free months ending within 7 days, per business with its free-month locations, and whether the reminder went out. */
export async function freeMonthsEndingSoon(database: Pick<Pool, "query"> = pool, now = new Date()) {
  const { rows } = await database.query<{ tenantId: string; shop: string; locations: string[]; freeUntil: Date; status: string | null }>(`
    SELECT s.tenant_id AS "tenantId", t.name AS shop, s.free_until AS "freeUntil",
      (SELECT array_agg(l.name ORDER BY l.name, l.id) FROM billing_location_plans p JOIN locations l ON l.tenant_id = p.tenant_id AND l.id = p.location_id
        WHERE p.tenant_id = s.tenant_id AND p.created_at <= s.started_at) AS locations,
      (SELECT j.status FROM outbox_jobs j WHERE j.tenant_id = s.tenant_id AND j.kind = $2
        AND (j.payload ->> 'freeUntil')::timestamptz = s.free_until ORDER BY j.created_at DESC LIMIT 1) AS status
    FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id
    WHERE s.free_until > $1 AND s.free_until <= $1::timestamptz + interval '7 days' AND ${STILL_FREE}
    ORDER BY s.free_until, t.name
  `, [now, FREE_MONTH_REMINDER]);
  return rows.map(({ status, freeUntil, locations, ...row }) => ({ ...row, locations: locations ?? [], lastFreeDay: ownerDay(new Date(new Date(freeUntil).getTime() - DAY_MS)), sent: status === "complete" }));
}
