import webpush, { WebPushError, type PushSubscription, type RequestOptions, type SendResult } from "web-push";
import { z } from "zod";
import { db, pool } from "@/db";
import { outboxJobs } from "@/db/schema";
import { DomainError } from "./loyalty";
import type { OutboxJob, OutboxStatus } from "./outbox";

/**
 * Web Push wake-ups for cashier phones: when an NFC tap waits for staff confirmation, every signed-in staff device of
 * that location gets a notification, also with a locked screen. The push only wakes the phone; the cashier screen
 * then reads the pending requests from the server and the cashier confirms there. Pushes never carry customer data
 * (no card number, balance, name or credential), and the server only ever posts to known browser push services.
 */

const PUSH_JOB_KIND = "push.tap_pending";
/** A wake-up is worthless once the request could have expired; push services drop it after this many seconds. */
const PUSH_TTL_SECONDS = 120;
const MAX_DEVICES_PER_USER = 10;
const MAX_FAILURES = 5;
const RETRY_DELAY_SECONDS = 15;

/**
 * Browser push services only. The endpoint comes from the browser, so without this list the server could be made to
 * POST to any URL (SSRF). Hosts: Chrome/Edge/Android (FCM), Firefox (Mozilla autopush), Safari/iOS (Apple), Windows.
 */
const PUSH_SERVICES: Array<{ host: RegExp; path: RegExp; query: RegExp }> = [
  { host: /^fcm\.googleapis\.com$/, path: /^\/(fcm\/send|wp)\/[A-Za-z0-9_:%-]{16,}$/, query: /^$/ },
  { host: /^android\.googleapis\.com$/, path: /^\/gcm\/send\/[A-Za-z0-9_:%-]{16,}$/, query: /^$/ },
  { host: /^updates\.push\.services\.mozilla\.com$/, path: /^\/wpush\/v[12]\/[A-Za-z0-9_=%-]{16,}$/, query: /^$/ },
  { host: /^(web|[a-z0-9-]+)\.push\.apple\.com$/, path: /^\/[A-Za-z0-9_-]{16,}$/, query: /^$/ },
  { host: /^[a-z0-9-]+\.notify\.windows\.com$/, path: /^\/w\/$/, query: /^\?token=[A-Za-z0-9%_.=-]{16,}$/ },
];

export function validPushEndpoint(raw: string): boolean {
  if (raw.length > 1000) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || (url.port !== "" && url.port !== "443") || url.hash) return false;
    // Each service's own endpoint shape, so the server never posts to other paths on these hosts. Only WNS uses a query.
    const service = PUSH_SERVICES.find(entry => entry.host.test(url.hostname));
    return Boolean(service && service.path.test(url.pathname) && service.query.test(url.search));
  } catch { return false; }
}

type PushEnv = { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string; [name: string]: string | undefined };
type VapidDetails = { subject: string; publicKey: string; privateKey: string };

/** Push is available only where VAPID keys are configured (not on production today); without them nothing is offered or sent. */
function vapidDetails(env: PushEnv = process.env): VapidDetails | null {
  const publicKey = env.VAPID_PUBLIC_KEY ?? "", privateKey = env.VAPID_PRIVATE_KEY ?? "", subject = env.VAPID_SUBJECT ?? "";
  if (!/^[A-Za-z0-9_-]{87}$/.test(publicKey) || !/^[A-Za-z0-9_-]{43}$/.test(privateKey) || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(subject)) return null;
  return { subject, publicKey, privateKey };
}

export function pushCapability(env: PushEnv = process.env): { available: boolean; publicKey?: string } {
  const details = vapidDetails(env);
  return details ? { available: true, publicKey: details.publicKey } : { available: false };
}

const base64url = (min: number, max: number) => z.string().regex(/^[A-Za-z0-9_-]+$/).min(min).max(max);
export const subscriptionInput = z.object({
  endpoint: z.string().max(1000).refine(validPushEndpoint, "Unsupported push endpoint"),
  expirationTime: z.number().nullable().optional(),
  // P-256 public key (65 bytes uncompressed) and 16-byte auth secret, base64url as PushSubscription.toJSON() returns them.
  keys: z.object({ p256dh: base64url(86, 88), auth: base64url(21, 24) }).strict(),
  locale: z.enum(["de", "fr"]).default("de"),
}).strict();

/** The device of a signed-in staff member subscribes for the location it works at (resolved by the caller from the session). */
export async function saveStaffPushSubscription(input: { userId: string; sessionId: string; tenantId: string; locationId: string; subscription: unknown }) {
  if (!pushCapability().available) throw new DomainError("PUSH_UNAVAILABLE", "Benachrichtigungen sind hier nicht eingerichtet.");
  const subscription = subscriptionInput.parse(input.subscription);
  await assertLocationStaff(input.userId, input.tenantId, input.locationId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // One endpoint is one browser: when another person of the same business signs in on the phone, the device now belongs
    // to them. A device of ANOTHER business is taken over only once its old login is gone (signed out or expired), so
    // knowing someone's endpoint is not enough to redirect their wake-ups. Re-registering also refreshes the device's
    // place in the per-user cap (created_at), so a phone in daily use is not the one evicted.
    const saved = await client.query(`
      INSERT INTO staff_push_subscriptions (tenant_id, location_id, user_id, session_id, endpoint, p256dh, auth, locale)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (endpoint) DO UPDATE SET tenant_id = EXCLUDED.tenant_id, location_id = EXCLUDED.location_id, user_id = EXCLUDED.user_id,
        session_id = EXCLUDED.session_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth, locale = EXCLUDED.locale, failure_count = 0, created_at = now()
      WHERE staff_push_subscriptions.tenant_id = EXCLUDED.tenant_id
        OR NOT EXISTS (SELECT 1 FROM "session" se WHERE se.id = staff_push_subscriptions.session_id AND se."expiresAt" > now())
      RETURNING id`,
    [input.tenantId, input.locationId, input.userId, input.sessionId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, subscription.locale]);
    if (saved.rowCount !== 1) throw new DomainError("PUSH_DEVICE_IN_USE", "Dieses Gerät ist noch bei einem anderen Geschäft angemeldet.");
    await client.query(`
      DELETE FROM staff_push_subscriptions WHERE user_id = $1 AND id NOT IN (
        SELECT id FROM staff_push_subscriptions WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT ${MAX_DEVICES_PER_USER})`, [input.userId]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  return { subscribed: true as const };
}

/** Only the owner of a subscription can remove it; an unknown endpoint is simply already gone. */
export async function deleteStaffPushSubscription(input: { userId: string; endpoint: unknown }) {
  const endpoint = z.string().max(1000).parse(input.endpoint);
  await pool.query("DELETE FROM staff_push_subscriptions WHERE endpoint = $1 AND user_id = $2", [endpoint, input.userId]);
  return { subscribed: false as const };
}

async function assertLocationStaff(userId: string, tenantId: string, locationId: string) {
  const { rows } = await pool.query<{ role: string; location_id: string | null }>(
    "SELECT role, location_id FROM staff_roles WHERE user_id = $1 AND tenant_id = $2 AND active", [userId, tenantId]);
  const role = rows[0];
  if (!role || (role.role !== "owner" && role.location_id !== locationId)) throw new DomainError("FORBIDDEN", "Checkout access required");
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Called inside the transaction that creates a pending NFC request, so the wake-up cannot be lost if the process dies
 * after commit (the worker sends it). Returns the job id for an immediate send after commit, or null when push is not
 * configured here.
 */
export async function enqueueTapPush(tx: Transaction, request: { tenantId: string; tapRequestId: string }): Promise<string | null> {
  if (!pushCapability().available) return null;
  const [job] = await tx.insert(outboxJobs).values({ tenantId: request.tenantId, kind: PUSH_JOB_KIND, payload: { tapRequestId: request.tapRequestId } }).returning({ id: outboxJobs.id });
  return job?.id ?? null;
}

type Sender = (subscription: PushSubscription, payload: string, options: RequestOptions) => Promise<SendResult>;
type Recipient = { id: string; endpoint: string; p256dh: string; auth: string; locale: string };
export type TapPushOutcome = { status: OutboxStatus; reason?: string; delaySeconds?: number; sent: number };

/**
 * Sends one wake-up to every current staff device of the request's location. Recipients are re-checked at send time:
 * the role must still be active and cover the location, and the login session that subscribed must still be valid.
 * Nothing is sent once the request is no longer waiting. Gone endpoints are removed; repeated failures drop a device.
 */
export async function deliverTapPush(job: Pick<OutboxJob, "payload">, deps: { send?: Sender; env?: PushEnv } = {}): Promise<TapPushOutcome> {
  const details = vapidDetails(deps.env);
  if (!details) return { status: "suppressed", reason: "Push not configured", sent: 0 };
  const tapRequestId = job.payload?.tapRequestId;
  if (typeof tapRequestId !== "string" || !/^[0-9a-f-]{36}$/.test(tapRequestId)) return { status: "failed", reason: "Invalid push job payload", sent: 0 };
  const { rows: requests } = await pool.query<{ tenant_id: string; location_id: string; created_at: Date; waiting: boolean }>(
    "SELECT tenant_id, location_id, created_at, (status = 'pending_staff' AND expires_at > now()) AS waiting FROM tap_requests WHERE id = $1", [tapRequestId]);
  const request = requests[0];
  if (!request?.waiting) return { status: "suppressed", reason: "Request no longer waiting", sent: 0 };
  const { rows: recipients } = await pool.query<Recipient>(`
    SELECT s.id, s.endpoint, s.p256dh, s.auth, s.locale FROM staff_push_subscriptions s
    JOIN staff_roles r ON r.user_id = s.user_id AND r.tenant_id = s.tenant_id AND r.active
    JOIN "session" se ON se.id = s.session_id AND se."userId" = s.user_id AND se."expiresAt" > now()
    WHERE s.tenant_id = $1 AND s.location_id = $2 AND (r.role = 'owner' OR r.location_id = $2)
      -- A device woken since this request exists already shows it when opened: a retry does not ring it again.
      AND (s.last_success_at IS NULL OR s.last_success_at < $3)`, [request.tenant_id, request.location_id, request.created_at]);
  const send: Sender = deps.send ?? ((subscription, payload, options) => webpush.sendNotification(subscription, payload, options));
  let sent = 0, transient = 0;
  for (const recipient of recipients) {
    if (!validPushEndpoint(recipient.endpoint)) { await pool.query("DELETE FROM staff_push_subscriptions WHERE id = $1", [recipient.id]); continue; }
    const payload = JSON.stringify({ v: 1, kind: "tap_pending", locale: recipient.locale === "fr" ? "fr" : "de" });
    try {
      await send({ endpoint: recipient.endpoint, keys: { p256dh: recipient.p256dh, auth: recipient.auth } }, payload,
        { vapidDetails: details, TTL: PUSH_TTL_SECONDS, urgency: "high", topic: "loynara-tap", timeout: 5_000 });
      sent += 1;
      await pool.query("UPDATE staff_push_subscriptions SET failure_count = 0, last_success_at = now() WHERE id = $1", [recipient.id]);
    } catch (error) {
      const status = error instanceof WebPushError ? error.statusCode : 0;
      if (status === 404 || status === 410) { await pool.query("DELETE FROM staff_push_subscriptions WHERE id = $1", [recipient.id]); continue; }
      // Only definitive refusals of this device count towards dropping it; an outage or rate limit at the push service
      // (timeouts, 429, 5xx) is retried and never removes a location's phones.
      const definitive = status >= 400 && status < 500 && status !== 429;
      if (!definitive) { transient += 1; continue; }
      await pool.query(`DELETE FROM staff_push_subscriptions WHERE id = $1 AND failure_count + 1 >= ${MAX_FAILURES}`, [recipient.id]);
      await pool.query("UPDATE staff_push_subscriptions SET failure_count = failure_count + 1 WHERE id = $1", [recipient.id]);
    }
  }
  if (transient > 0) return { status: "retry", reason: `${transient} push send(s) failed temporarily`, delaySeconds: RETRY_DELAY_SECONDS, sent };
  return { status: "complete", sent };
}

/**
 * Sends the wake-up right after the tap committed, without waiting for the worker's next poll. Claims exactly this job
 * the same way the worker does (pending → processing, one attempt), so the worker can never send it a second time;
 * whatever fails here is retried by the worker. Never throws.
 */
export async function dispatchTapPushNow(jobId: string, deps: { send?: Sender; env?: PushEnv } = {}): Promise<void> {
  let job: { id: string; attempts: number; payload: Record<string, unknown> } | undefined;
  try {
    const { rows } = await pool.query<{ id: string; attempts: number; payload: Record<string, unknown> }>(`
      UPDATE outbox_jobs SET status = 'processing', attempts = attempts + 1, next_attempt_at = now() + interval '5 minutes', last_error = NULL
      WHERE id = $1 AND kind = $2 AND status = 'pending' RETURNING id, attempts, payload`, [jobId, PUSH_JOB_KIND]);
    job = rows[0];
    if (!job) return;
    const outcome = await deliverTapPush(job, deps);
    await pool.query("UPDATE outbox_jobs SET status = $2, last_error = $3, next_attempt_at = now() + $4::int * interval '1 second' WHERE id = $1 AND status = 'processing' AND attempts = $5",
      [job.id, outcome.status, outcome.reason?.slice(0, 300) ?? null, outcome.delaySeconds ?? 0, job.attempts]);
  } catch (error) {
    console.error(`Immediate NFC push failed (${error instanceof Error ? error.name : "error"}); the worker retries it`);
    // Give the claimed job back for a prompt retry: its 5-minute lease would outlive the request it is meant to announce.
    if (job) await pool.query("UPDATE outbox_jobs SET status = 'retry', last_error = 'Immediate send failed', next_attempt_at = now() + $3::int * interval '1 second' WHERE id = $1 AND status = 'processing' AND attempts = $2",
      [job.id, job.attempts, RETRY_DELAY_SECONDS]).catch(() => undefined);
  }
}

export { PUSH_JOB_KIND };
