import webpush, { WebPushError, type PushSubscription, type RequestOptions, type SendResult } from "web-push";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { consentEvents, outboxJobs } from "@/db/schema";
import { formatDay, formatTime } from "@/components/booking/booking-format";
import { DomainError } from "@/lib/loyalty";
import type { OutboxJob, OutboxStatus } from "@/lib/outbox";
import { quietHoursDeferral } from "@/lib/promotion-policy";
import { pushCapability, subscriptionInput, vapidDetails, type PushEnv } from "@/lib/staff-push";
import { CAP_WINDOW_DAYS, CUSTOMER_WEEKLY_CAP, WALLET_QUIET_HOURS } from "@/lib/wallet-message-rules";
import { lock, rebookPushesWithin } from "@/lib/wallet-messages";
import { cardScope, type Reader, type Tx } from "./appointments";
import { addDays, instantToWall, wallToInstant } from "./time";

// Customer Web Push for bookings: reminders and shop changes (service messages, quiet hours hold) and the rebook push
// (marketing: own opt-in, shared cap with Wallet messages). Same VAPID keys and failure handling as staff-push.ts.

const HOUR = 3_600_000, MINUTE = 60_000;
const OFFSET = { "24h": 24 * HOUR, "2h": 2 * HOUR } as const;
type Which = keyof typeof OFFSET;
const MAX_FAILURES = 3;
const MAX_DEVICES_PER_CARD = 5;
const REBOOK_WINDOW_DAYS = 14;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Sender = (subscription: PushSubscription, payload: string, options: RequestOptions) => Promise<SendResult>;
export type Deps = { send?: Sender; env?: PushEnv; now?: Date };
export type Outcome = { status: OutboxStatus; reason?: string; delaySeconds?: number };
type Message = { title: string; body: string; url: string };

/** When a reminder goes out: start − 24 h / − 2 h; inside quiet hours it moves to the next 08:00 while that is still before the start, else null. */
export function reminderDue(start: Date, which: Which, timeZone: string): Date | null {
  const due = new Date(start.getTime() - OFFSET[which]);
  const moved = quietHoursDeferral(due, timeZone, WALLET_QUIET_HOURS) ?? due;
  return moved < start ? moved : null;
}

/** The rebook push goes out now between 08:00 and 20:00 local time, otherwise at the next 09:00. */
export function rebookDue(now: Date, timeZone: string): Date {
  const wall = instantToWall(now, timeZone), hour = Number(wall.time.slice(0, 2));
  if (hour >= 8 && hour < 20) return now;
  return wallToInstant(hour < 8 ? wall.date : addDays(wall.date, 1), "09:00", timeZone) ?? now;
}

// ---- Scheduling (inside the booking transactions) -------------------------------------------------------------------------

/**
 * Two reminder jobs for a confirmed appointment. Called again after a reschedule or move: the payload carries the start it
 * was planned for, so jobs of an older start deliver nothing.
 */
export async function scheduleReminders(tx: Tx, appointmentId: string, now = new Date()) {
  const { rows: [a] } = await tx.execute<{ tenant_id: string; start: Date | string; timezone: string }>(sql`
    SELECT a.tenant_id, lower(a.during) AS start, l.timezone FROM booking_appointments a
    JOIN locations l ON l.tenant_id = a.tenant_id AND l.id = a.location_id WHERE a.id = ${appointmentId}::uuid AND a.status = 'confirmed'`);
  if (!a) return;
  const start = new Date(a.start);
  for (const which of ["24h", "2h"] as const) {
    const due = reminderDue(start, which, a.timezone);
    if (!due || due <= now) continue;
    await tx.insert(outboxJobs).values({ tenantId: a.tenant_id, kind: "booking.reminder", payload: { appointmentId, which, start: start.toISOString(), at: now.toISOString() }, nextAttemptAt: due });
  }
}

/** One push about a shop cancellation or move; immediate, or at 08:00 when it happens at night. */
export async function notifyShopChange(tx: Tx, appointmentId: string, kind: "shop_cancel" | "moved", now = new Date()) {
  const { rows: [a] } = await tx.execute<{ tenant_id: string; timezone: string }>(sql`
    SELECT a.tenant_id, l.timezone FROM booking_appointments a JOIN locations l ON l.tenant_id = a.tenant_id AND l.id = a.location_id WHERE a.id = ${appointmentId}::uuid`);
  if (!a) return;
  await tx.insert(outboxJobs).values({ tenantId: a.tenant_id, kind: "booking.change", payload: { appointmentId, kind, at: now.toISOString() }, nextAttemptAt: quietHoursDeferral(now, a.timezone, WALLET_QUIET_HOURS) ?? now });
}

// ---- Sending ---------------------------------------------------------------------------------------------------------------

/** Sends to every device of the card. 404/410 removes a device; definitive refusals drop it after 3; outages count as transient. */
export async function sendCustomerPush(tenantId: string, membershipId: string, message: Message, deps: Deps = {}) {
  const details = vapidDetails(deps.env);
  const result = { recipients: 0, sent: 0, transient: 0 };
  if (!details) return result;
  const { rows } = await db.execute<{ id: string; endpoint: string; p256dh: string; auth: string }>(sql`
    SELECT id, endpoint, p256dh, auth FROM booking_push_subscriptions WHERE tenant_id = ${tenantId}::uuid AND membership_id = ${membershipId}::uuid`);
  result.recipients = rows.length;
  const send: Sender = deps.send ?? ((subscription, payload, options) => webpush.sendNotification(subscription, payload, options));
  for (const row of rows) {
    try {
      await send({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, JSON.stringify(message), { vapidDetails: details, TTL: 6 * 3600, urgency: "normal", timeout: 5_000 });
      result.sent += 1;
      await db.execute(sql`UPDATE booking_push_subscriptions SET failure_count = 0, last_success_at = now() WHERE id = ${row.id}::uuid`);
    } catch (error) {
      const status = error instanceof WebPushError ? error.statusCode : 0;
      if (status === 404 || status === 410) { await db.execute(sql`DELETE FROM booking_push_subscriptions WHERE id = ${row.id}::uuid`); continue; }
      if (!(status >= 400 && status < 500 && status !== 429)) { result.transient += 1; continue; }
      await db.execute(sql`DELETE FROM booking_push_subscriptions WHERE id = ${row.id}::uuid AND failure_count + 1 >= ${MAX_FAILURES}`);
      await db.execute(sql`UPDATE booking_push_subscriptions SET failure_count = failure_count + 1 WHERE id = ${row.id}::uuid`);
    }
  }
  return result;
}

type Loaded = { id: string; tenant_id: string; membership_id: string; location_id: string; status: string; start: Date; service_id: string; staff_id: string; timezone: string; shop: string; service: string; staff: string; token: string };

async function load(appointmentId: unknown): Promise<Loaded | null> {
  if (typeof appointmentId !== "string" || !uuid.test(appointmentId)) return null;
  const { rows: [a] } = await db.execute<Loaded>(sql`
    SELECT a.id, a.tenant_id, a.membership_id, a.location_id, a.status, lower(a.during) AS start, a.service_id, a.staff_id, l.timezone, t.name AS shop, s.name AS service, st.name AS staff, m.card_token AS token
    FROM booking_appointments a
    JOIN locations l ON l.tenant_id = a.tenant_id AND l.id = a.location_id
    JOIN tenants t ON t.id = a.tenant_id
    JOIN booking_services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
    JOIN booking_staff st ON st.tenant_id = a.tenant_id AND st.id = a.staff_id
    JOIN memberships m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id AND m.closed_at IS NULL
    WHERE a.id = ${appointmentId}::uuid`);
  return a ? { ...a, start: new Date(a.start) } : null;
}

const day = (a: Loaded) => formatDay(instantToWall(a.start, a.timezone).date);
const time = (a: Loaded) => formatTime(a.start.toISOString(), a.timezone);
const page = (a: Loaded) => `/card/${encodeURIComponent(a.token)}/termin`;

/**
 * Sends once per job: booking_push_log holds one row per appointment and kind, refreshed on each send, so a retry after a
 * send (log newer than the job) completes without a second push while a later job of the same kind (after a move) still sends.
 */
async function deliver(a: Loaded, kind: string, at: unknown, message: Message, deps: Deps): Promise<Outcome> {
  if (!vapidDetails(deps.env)) return { status: "suppressed", reason: "Push not configured" };
  const since = typeof at === "string" && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date(0);
  const { rows: [logged] } = await db.execute(sql`SELECT 1 FROM booking_push_log WHERE appointment_id = ${a.id}::uuid AND kind = ${kind} AND sent_at >= ${since}::timestamptz`);
  if (logged) return { status: "complete", reason: "already sent" };
  const result = await sendCustomerPush(a.tenant_id, a.membership_id, message, deps);
  if (!result.recipients) return { status: "complete", reason: "no subscription" };
  if (result.sent) {
    await db.execute(sql`INSERT INTO booking_push_log (tenant_id, membership_id, appointment_id, kind, sent_at) VALUES (${a.tenant_id}::uuid, ${a.membership_id}::uuid, ${a.id}::uuid, ${kind}, ${deps.now ?? new Date()}::timestamptz)
      ON CONFLICT (appointment_id, kind) DO UPDATE SET sent_at = EXCLUDED.sent_at`);
    return { status: "complete" };
  }
  if (result.transient) return { status: "retry", reason: `${result.transient} push send(s) failed temporarily`, delaySeconds: 60 };
  return { status: "complete", reason: "not delivered" };
}

export async function deliverReminder(job: Pick<OutboxJob, "payload">, deps: Deps = {}): Promise<Outcome> {
  const now = deps.now ?? new Date(), which = job.payload?.which;
  if (which !== "24h" && which !== "2h") return { status: "failed", reason: "Invalid reminder payload" };
  const a = await load(job.payload.appointmentId);
  if (!a || a.status !== "confirmed") return { status: "suppressed", reason: "Appointment not confirmed" };
  const due = reminderDue(a.start, which, a.timezone);
  // A job planned for another start (moved since) or delivered far too late says nothing.
  if (job.payload.start !== a.start.toISOString() || !due || now.getTime() - due.getTime() > 45 * MINUTE || now >= a.start) return { status: "suppressed", reason: "Reminder no longer due" };
  return deliver(a, which === "24h" ? "reminder_24h" : "reminder_2h", job.payload.at,
    { title: a.shop, body: `Dein Termin ${a.service} ist ${day(a)} um ${time(a)} bei ${a.staff}.`, url: page(a) }, deps);
}

export async function deliverShopChange(job: Pick<OutboxJob, "payload">, deps: Deps = {}): Promise<Outcome> {
  const kind = job.payload?.kind;
  if (kind !== "shop_cancel" && kind !== "moved") return { status: "failed", reason: "Invalid change payload" };
  const a = await load(job.payload.appointmentId);
  if (!a || (kind === "shop_cancel" ? a.status !== "cancelled_by_shop" : !["requested", "confirmed"].includes(a.status))) return { status: "suppressed", reason: "Appointment changed again" };
  const body = kind === "shop_cancel" ? `Dein Termin ${day(a)} ${time(a)} wurde abgesagt. Neuen Termin wählen.` : `Dein Termin ist jetzt ${day(a)} um ${time(a)}.`;
  return deliver(a, kind, job.payload.at, { title: a.shop, body, url: page(a) }, deps);
}

/** Newest consent event of the card for the rebook push; no event means no consent. */
const rebookConsent = (tenantId: SQL, membershipId: SQL) => sql`(SELECT c.granted FROM consent_events c WHERE c.tenant_id = ${tenantId} AND c.membership_id = ${membershipId}
  AND c.channel = 'push' AND c.purpose = 'booking_rebook' ORDER BY c.created_at DESC, c.id DESC LIMIT 1) IS TRUE`;
const noOpenAt = (now: Date) => sql`NOT EXISTS (SELECT 1 FROM booking_appointments o WHERE o.tenant_id = a.tenant_id AND o.location_id = a.location_id AND o.membership_id = a.membership_id
  AND o.status IN ('requested','confirmed') AND upper(o.during) > ${now}::timestamptz)`;

export async function deliverRebook(job: Pick<OutboxJob, "payload">, deps: Deps = {}): Promise<Outcome> {
  const now = deps.now ?? new Date();
  const a = await load(job.payload?.appointmentId);
  if (!a || a.status !== "done") return { status: "suppressed", reason: "Appointment not found" };
  // Consent can be withdrawn and a new booking made between the nightly scan and the send.
  const { rows: [still] } = await db.execute(sql`SELECT 1 FROM booking_appointments a WHERE a.id = ${a.id}::uuid
    AND ${rebookConsent(sql`a.tenant_id`, sql`a.membership_id`)} AND ${noOpenAt(now)}`);
  if (!still) return { status: "suppressed", reason: "No consent or already booked" };
  const query = new URLSearchParams({ service: a.service_id, staff: a.staff_id, rebook: a.id });
  return deliver(a, "rebook", job.payload.at,
    { title: a.shop, body: `Zeit für ${a.service}? Dein Slot bei ${a.staff}: Termin buchen.`, url: `${page(a)}?${query}` }, deps);
}

/** The worker's entry for booking.reminder, booking.change and booking.rebook. */
export function deliverBookingJob(job: Pick<OutboxJob, "kind" | "payload">, deps: Deps = {}): Promise<Outcome> {
  if (job.kind === "booking.reminder") return deliverReminder(job, deps);
  if (job.kind === "booking.change") return deliverShopChange(job, deps);
  return deliverRebook(job, deps);
}

// ---- Nightly rebook scan -----------------------------------------------------------------------------------------------------

/**
 * The newest done appointment per card and service whose rebook interval passed within the last 14 days, not pushed yet,
 * with no open appointment at that location, the opt-in, a device, and room under the cap shared with Wallet messages
 * (fewer than 2 in 7 days, none in the last 24 h).
 */
const candidates = (now: Date) => sql`
  FROM booking_appointments a
  JOIN booking_services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
  JOIN memberships m ON m.tenant_id = a.tenant_id AND m.id = a.membership_id AND m.closed_at IS NULL
  JOIN locations l ON l.tenant_id = a.tenant_id AND l.id = a.location_id
  WHERE a.status = 'done' AND a.rebook_sent_at IS NULL AND s.rebook_after_days > 0
    AND lower(a.during) <= ${now}::timestamptz - make_interval(days => s.rebook_after_days)
    AND lower(a.during) > ${now}::timestamptz - make_interval(days => s.rebook_after_days + ${REBOOK_WINDOW_DAYS})
    AND NOT EXISTS (SELECT 1 FROM booking_appointments n WHERE n.tenant_id = a.tenant_id AND n.membership_id = a.membership_id AND n.service_id = a.service_id
      AND n.status = 'done' AND lower(n.during) > lower(a.during))
    AND ${noOpenAt(now)}
    AND ${rebookConsent(sql`a.tenant_id`, sql`a.membership_id`)}
    AND EXISTS (SELECT 1 FROM booking_push_subscriptions p WHERE p.tenant_id = a.tenant_id AND p.membership_id = a.membership_id)
    AND (SELECT count(DISTINCT r.message_id) FROM wallet_message_recipients r WHERE r.tenant_id = m.tenant_id AND r.membership_id = m.id
      AND r.status IN ('queued','sending','sent') AND coalesce(r.sent_at, r.created_at) > ${now}::timestamptz - make_interval(days => ${CAP_WINDOW_DAYS}))
      + ${rebookPushesWithin(now, CAP_WINDOW_DAYS)} < ${CUSTOMER_WEEKLY_CAP}
    AND NOT EXISTS (SELECT 1 FROM wallet_message_recipients r WHERE r.tenant_id = m.tenant_id AND r.membership_id = m.id
      AND r.status IN ('queued','sending','sent') AND coalesce(r.sent_at, r.created_at) > ${now}::timestamptz - interval '1 day')
    AND ${rebookPushesWithin(now, 1)} = 0`;

/** Called by the worker with the win-back scan. Idempotent: each appointment is claimed once under the Wallet-message tenant lock. */
export async function queueRebookPushes(now = new Date()) {
  const { rows: found } = await db.execute<{ id: string; tenant_id: string }>(sql`
    SELECT DISTINCT ON (a.membership_id) a.id, a.tenant_id ${candidates(now)} ORDER BY a.membership_id, lower(a.during) DESC LIMIT 500`);
  let queued = 0;
  for (const candidate of found) {
    queued += await db.transaction(async tx => {
      // Same lock as Wallet sends, so the shared cap is re-checked and counted once.
      await lock(tx, candidate.tenant_id);
      const { rows: [claimed] } = await tx.execute<{ tenant_id: string; timezone: string }>(sql`
        UPDATE booking_appointments SET rebook_sent_at = ${now}::timestamptz
        FROM locations l WHERE booking_appointments.id = ${candidate.id}::uuid AND l.tenant_id = booking_appointments.tenant_id AND l.id = booking_appointments.location_id
          AND booking_appointments.id IN (SELECT a.id ${candidates(now)})
        RETURNING booking_appointments.tenant_id, l.timezone`);
      if (!claimed) return 0;
      await tx.insert(outboxJobs).values({ tenantId: claimed.tenant_id, kind: "booking.rebook", payload: { appointmentId: candidate.id, at: now.toISOString() }, nextAttemptAt: rebookDue(now, claimed.timezone) });
      return 1;
    });
  }
  return queued;
}

// ---- Card side (routes) --------------------------------------------------------------------------------------------------------

/** For GET …/booking: the key only where push is configured, whether any device of the card is subscribed, and the opt-in. */
export async function pushState(reader: Reader, card: { tenantId: string; membershipId: string }) {
  const { rows: [state] } = await reader.execute<{ subscribed: boolean; consent: boolean }>(sql`SELECT
    EXISTS (SELECT 1 FROM booking_push_subscriptions WHERE tenant_id = ${card.tenantId}::uuid AND membership_id = ${card.membershipId}::uuid) AS subscribed,
    ${rebookConsent(sql`${card.tenantId}::uuid`, sql`${card.membershipId}::uuid`)} AS consent`);
  return { publicKey: pushCapability().publicKey, subscribed: state.subscribed, rebookConsent: state.consent };
}

/** One endpoint is one browser: it now belongs to this card. Each card keeps its newest five devices. */
export async function saveCustomerPushSubscription(token: string, raw: unknown) {
  if (!pushCapability().available) throw new DomainError("PUSH_UNAVAILABLE", "Mitteilungen sind hier nicht eingerichtet.");
  const subscription = subscriptionInput.parse(raw);
  const card = await cardScope(db, token);
  await db.transaction(async tx => {
    // Another card may take an endpoint over only with the browser's own keys: knowing the URL alone proves nothing.
    const saved = await tx.execute(sql`INSERT INTO booking_push_subscriptions (tenant_id, membership_id, endpoint, p256dh, auth)
      VALUES (${card.tenantId}::uuid, ${card.membershipId}::uuid, ${subscription.endpoint}, ${subscription.keys.p256dh}, ${subscription.keys.auth})
      ON CONFLICT (endpoint) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, membership_id = EXCLUDED.membership_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, failure_count = 0, created_at = now()
      WHERE booking_push_subscriptions.membership_id = EXCLUDED.membership_id OR (booking_push_subscriptions.p256dh = EXCLUDED.p256dh AND booking_push_subscriptions.auth = EXCLUDED.auth)
      RETURNING id`);
    if (saved.rowCount !== 1) throw new DomainError("PUSH_DEVICE_IN_USE", "Dieses Gerät ist schon bei einer anderen Karte angemeldet.");
    await tx.execute(sql`DELETE FROM booking_push_subscriptions WHERE tenant_id = ${card.tenantId}::uuid AND membership_id = ${card.membershipId}::uuid AND id NOT IN (
      SELECT id FROM booking_push_subscriptions WHERE tenant_id = ${card.tenantId}::uuid AND membership_id = ${card.membershipId}::uuid ORDER BY created_at DESC, id DESC LIMIT ${MAX_DEVICES_PER_CARD})`);
  });
}

export async function deleteCustomerPushSubscription(token: string, endpoint: unknown) {
  const card = await cardScope(db, token);
  await db.execute(sql`DELETE FROM booking_push_subscriptions WHERE tenant_id = ${card.tenantId}::uuid AND membership_id = ${card.membershipId}::uuid AND endpoint = ${z.string().max(1000).parse(endpoint)}`);
}

export async function setRebookConsent(token: string, granted: boolean) {
  const card = await cardScope(db, token);
  await db.insert(consentEvents).values({ tenantId: card.tenantId, membershipId: card.membershipId, channel: "push", purpose: "booking_rebook", granted, noticeVersion: "booking-rebook-v1", source: "card" });
}
