import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { ownerProgram } from "./automations";
import { DomainError } from "./loyalty";
import { surfaceHidden } from "./pilot-surfaces";
import { quietHoursDeferral } from "./promotion-policy";
import { assertPassFastBinding, PassFastClient, passFastConfig, passFastData, passFastSerial } from "./wallet/passfast";
import { walletCardSnapshot } from "./wallet/data";
import {
  CAP_WINDOW_DAYS, checkMessageText, germanWhen, CONSENT_TEXT_VERSION, consentText, CUSTOMER_WEEKLY_CAP, OWNER_TEXT_VERSION, QUIET_HOURS_REFUSAL, SHOP_WEEKLY_CAP, WALLET_QUIET_HOURS,
} from "./wallet-message-rules";

// Wallet messages (ENG-043). A message is the PassFast `message` field of one Apple pass; nothing here touches the ledger.
// Surface "walletMessages" is withheld on real production until Legal's documents are live and the founder switches it on.

const WORKER_BATCH = 4;           // recipients per job run; a pass refresh takes 16 to 38 s server-side, the lease is 5 minutes
const WORKER_BUDGET_MS = 150_000;
const MAX_ATTEMPTS = 3;            // the first try plus at most two retries
const STALE_SENDING_MS = 10 * 60_000;

type Tx = Pick<typeof db, "execute">;
const rows = <T>(result: { rows: unknown[] }) => result.rows as T[];
const available = () => { if (surfaceHidden("walletMessages")) throw new DomainError("NOT_FOUND", "Nicht verfügbar"); };

// ---- Consent (customer side, card-token scoped like the other card endpoints) -------------------------------------

async function cardOf(cardToken: string) {
  if (!cardToken.startsWith("card_") || cardToken.length > 100) throw new DomainError("NOT_FOUND", "Card not found");
  const [card] = rows<{ tenantId: string; membershipId: string; shop: string; location: string; applePass: boolean; granted: boolean }>(await db.execute(sql`
    SELECT m.tenant_id AS "tenantId", m.id AS "membershipId", t.name AS shop, l.name AS location,
      EXISTS (SELECT 1 FROM wallet_passes p WHERE p.tenant_id = m.tenant_id AND p.membership_id = m.id AND p.provider = 'apple'
        AND p.provider_object_id LIKE 'passfast:%' AND p.status = 'created' AND p.revoked_at IS NULL) AS "applePass",
      EXISTS (SELECT 1 FROM wallet_message_consents c WHERE c.tenant_id = m.tenant_id AND c.membership_id = m.id AND c.withdrawn_at IS NULL) AS granted
    FROM memberships m JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id JOIN tenants t ON t.id = m.tenant_id
    WHERE m.card_token = ${cardToken} AND m.closed_at IS NULL`));
  if (!card) throw new DomainError("NOT_FOUND", "Card not found");
  return card;
}

/** What the card page shows: the unticked box with Legal's text, only for a card that holds an Apple pass. */
export async function getWalletConsent(cardToken: string) {
  available();
  const card = await cardOf(cardToken);
  const [given] = rows<{ givenAt: Date }>(await db.execute(sql`SELECT given_at AS "givenAt" FROM wallet_message_consents WHERE tenant_id = ${card.tenantId}::uuid AND membership_id = ${card.membershipId}::uuid AND withdrawn_at IS NULL`));
  return { available: card.applePass || card.granted, granted: card.granted, givenAt: given ? new Date(given.givenAt).toISOString() : null, shop: card.shop, text: consentText(card.shop, card.location), version: CONSENT_TEXT_VERSION };
}

export async function setWalletConsent(cardToken: string, granted: boolean) {
  available();
  const card = await cardOf(cardToken);
  if (granted) {
    if (!card.applePass) throw new DomainError("NOT_FOUND", "Card not found");
    await db.execute(sql`INSERT INTO wallet_message_consents (tenant_id, membership_id, text_version) VALUES (${card.tenantId}::uuid, ${card.membershipId}::uuid, ${CONSENT_TEXT_VERSION})
      ON CONFLICT (membership_id) WHERE withdrawn_at IS NULL DO NOTHING`);
  } else {
    await db.execute(sql`UPDATE wallet_message_consents SET withdrawn_at = clock_timestamp()
      WHERE tenant_id = ${card.tenantId}::uuid AND membership_id = ${card.membershipId}::uuid AND withdrawn_at IS NULL`);
  }
  return { granted };
}

// ---- Audience and caps --------------------------------------------------------------------------------------------

/**
 * Passes that may get a message now: Apple pass issued through PassFast and still live, card open, an open consent, and
 * room under the per-customer cap, counted from delivery (queue time until delivered), as the consent text promises. Sent, queued and sending rows count (and a send whose outcome is unknown), so
 * ENG-044 reuses this one counter by writing its own rows into wallet_message_recipients.
 */
/** A pass whose latest device event is an unregistration was removed from the Wallet: it gets no more messages (it still gets balance updates). */
const reachable = sql`COALESCE((SELECT e.event FROM wallet_pass_events e WHERE e.pass_id = p.id ORDER BY e.event_at DESC, e.received_at DESC LIMIT 1), 'device.registered') <> 'device.unregistered'`;

const eligible = (tenantId: string, programId: string, now: Date) => sql`
  FROM wallet_passes p JOIN memberships m ON m.id = p.membership_id AND m.tenant_id = p.tenant_id AND m.closed_at IS NULL
  WHERE p.tenant_id = ${tenantId}::uuid AND m.program_id = ${programId}::uuid AND p.provider = 'apple' AND p.provider_object_id LIKE 'passfast:%'
    AND p.status = 'created' AND p.revoked_at IS NULL AND ${reachable}
    AND EXISTS (SELECT 1 FROM wallet_message_consents c WHERE c.tenant_id = m.tenant_id AND c.membership_id = m.id AND c.withdrawn_at IS NULL)
    AND (SELECT count(*) FROM wallet_message_recipients r WHERE r.tenant_id = m.tenant_id AND r.membership_id = m.id
      AND (r.status IN ('queued','sending','sent') OR (r.status = 'failed' AND r.reason = 'uncertain'))
      AND coalesce(r.sent_at, r.created_at) > ${now}::timestamptz - make_interval(days => ${CAP_WINDOW_DAYS})) < ${CUSTOMER_WEEKLY_CAP}`;

/** The two newest owner messages of the window that count against the shop cap (a message stopped before any send does not count). */
async function shopWindow(tx: Tx, tenantId: string, programId: string, now: Date) {
  return rows<{ createdAt: Date }>(await tx.execute(sql`
    SELECT created_at AS "createdAt" FROM wallet_messages
    WHERE tenant_id = ${tenantId}::uuid AND program_id = ${programId}::uuid AND kind = 'owner'
      AND created_at > ${now}::timestamptz - make_interval(days => ${CAP_WINDOW_DAYS}) AND NOT (status = 'stopped' AND sent_count = 0)
    ORDER BY created_at DESC LIMIT ${SHOP_WEEKLY_CAP}`));
}

const reachOf = async (tx: Tx, tenantId: string, programId: string, now: Date) =>
  Number(rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n ${eligible(tenantId, programId, now)}`))[0].n);

const lock = (tx: Tx, tenantId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${"wallet-message:" + tenantId}, 0))`);

// ---- Removal report: cards that left the Wallet within 48 hours after a send ---------------------------------------------

/** Warn when more than this share of a send's recipients removed their card (default 5). */
export function removalWarningPercent(env: Record<string, string | undefined> = process.env) {
  const value = Number(env.WALLET_REMOVAL_WARNING_PERCENT?.trim() || "5");
  return value > 0 && value <= 100 ? value : 5;
}
export const removalWarning = (removed: number, sent: number, env?: Record<string, string | undefined>) => sent > 0 && removed * 100 > sent * removalWarningPercent(env);
/** Per message `m`: recipients that unregistered the pass from 0 to 48 hours (inclusive) after their own delivery. */
const removedWithin48h = sql`(SELECT count(DISTINCT r.pass_id)::int FROM wallet_message_recipients r JOIN wallet_pass_events e ON e.pass_id = r.pass_id AND e.event = 'device.unregistered'
  AND e.event_at >= r.sent_at AND e.event_at <= r.sent_at + interval '48 hours' WHERE r.message_id = m.id AND r.status = 'sent')`;

/** Operator view: owner messages of the last 30 days per programme, counts only. */
export async function walletMessageStats(tx: Tx = db) {
  const stats = rows<{ programId: string; messages: number; sent: number; removed: number }>(await tx.execute(sql`
    SELECT m.program_id AS "programId", count(*)::int AS messages, sum(m.sent_count)::int AS sent, sum(${removedWithin48h})::int AS removed
    FROM wallet_messages m WHERE m.kind = 'owner' AND m.created_at > now() - interval '30 days' GROUP BY m.program_id`));
  return new Map(stats.map(row => [row.programId, { ...row, warn: removalWarning(row.removed, row.sent) }]));
}

// ---- Owner: overview, send, stop ----------------------------------------------------------------------------------

export async function walletMessageOverview(input: { actorUserId: string; programSlug: string }, now = new Date()) {
  available();
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const [{ timezone }] = rows<{ timezone: string }>(await db.execute(sql`SELECT timezone FROM locations WHERE id = ${program.locationId}::uuid AND tenant_id = ${program.tenantId}::uuid`));
  const window = await shopWindow(db, program.tenantId, program.id, now);
  const [confirmed] = rows<{ n: number }>(await db.execute(sql`SELECT count(*)::int AS n FROM wallet_message_owner_confirmations WHERE tenant_id = ${program.tenantId}::uuid AND version = ${OWNER_TEXT_VERSION}`));
  const history = rows<Record<string, unknown>>(await db.execute(sql`
    SELECT m.id, m.text, m.status, m.created_at AS "createdAt", m.audience_count AS audience, m.sent_count AS sent, m.failed_count AS failed, m.skipped_count AS skipped,
      ${removedWithin48h} AS removed
    FROM wallet_messages m WHERE tenant_id = ${program.tenantId}::uuid AND program_id = ${program.id}::uuid AND kind = 'owner' ORDER BY created_at DESC LIMIT 20`))
    .map(row => ({ ...row, warn: removalWarning(Number(row.removed), Number(row.sent)) }));
  return {
    shopName: (rows<{ name: string }>(await db.execute(sql`SELECT name FROM tenants WHERE id = ${program.tenantId}::uuid`)))[0].name,
    reach: await reachOf(db, program.tenantId, program.id, now),
    remaining: Math.max(0, SHOP_WEEKLY_CAP - window.length),
    nextAllowedAt: window.length >= SHOP_WEEKLY_CAP ? reopensAt(window, timezone) : null,
    quietNow: quietHoursDeferral(now, timezone, WALLET_QUIET_HOURS) !== null,
    timezone,
    guidanceConfirmed: confirmed.n > 0,
    history,
  };
}

/** When the shop may send again: the older of the two counted messages leaves the window; inside quiet hours, the 08:00 after. */
function reopensAt(window: Array<{ createdAt: Date }>, timezone: string) {
  const free = new Date(new Date(window[SHOP_WEEKLY_CAP - 1].createdAt).getTime() + CAP_WINDOW_DAYS * 86_400_000);
  return quietHoursDeferral(free, timezone, WALLET_QUIET_HOURS) ?? free;
}

/** The owner's one-time confirmation of Legal's guidance (its own screen), stored with the text version. */
export async function acknowledgeWalletGuidance(input: { actorUserId: string; programSlug: string }, now = new Date()) {
  available();
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  await db.execute(sql`INSERT INTO wallet_message_owner_confirmations (tenant_id, version, confirmed_by_user_id, confirmed_at)
    VALUES (${program.tenantId}::uuid, ${OWNER_TEXT_VERSION}, ${input.actorUserId}, ${now}::timestamptz) ON CONFLICT DO NOTHING`);
  return { guidanceConfirmed: true };
}

const sendInput = z.object({ actorUserId: z.string().min(1), programSlug: z.string().min(1).max(120), text: z.string().max(2000) }).strict();

/**
 * Validates, applies both caps and the quiet hours under one tenant lock, then writes the audit row, one recipient row
 * per eligible pass and the outbox job in the same transaction. The count shown to the owner is the count written.
 */
export async function sendWalletMessage(raw: z.input<typeof sendInput>, now = new Date()) {
  available();
  const input = sendInput.parse(raw);
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const checked = checkMessageText(input.text);
  if (!checked.ok) throw new DomainError("MESSAGE_REFUSED", checked.error);
  const [{ timezone }] = rows<{ timezone: string }>(await db.execute(sql`SELECT timezone FROM locations WHERE id = ${program.locationId}::uuid AND tenant_id = ${program.tenantId}::uuid`));
  if (quietHoursDeferral(now, timezone, WALLET_QUIET_HOURS)) throw new DomainError("QUIET_HOURS", QUIET_HOURS_REFUSAL);
  return db.transaction(async tx => {
    await lock(tx, program.tenantId);
    const window = await shopWindow(tx, program.tenantId, program.id, now);
    if (window.length >= SHOP_WEEKLY_CAP) {
      throw new DomainError("SHOP_CAP", `Du hast diese Woche schon ${SHOP_WEEKLY_CAP} Nachrichten gesendet. Die nächste geht wieder ab ${germanWhen(reopensAt(window, timezone), timezone)}.`);
    }
    const [done] = rows<{ n: number }>(await tx.execute(sql`SELECT count(*)::int AS n FROM wallet_message_owner_confirmations WHERE tenant_id = ${program.tenantId}::uuid AND version = ${OWNER_TEXT_VERSION}`));
    if (!done.n) throw new DomainError("CONFIRM_REQUIRED", "Bitte lies zuerst die Hinweise und bestätige sie.");
    if (!(await reachOf(tx, program.tenantId, program.id, now))) throw new DomainError("NO_REACH", "Noch kann niemand deine Nachrichten bekommen.");
    const [message] = rows<{ id: string }>(await tx.execute(sql`INSERT INTO wallet_messages (tenant_id, program_id, sent_by_user_id, text, confirm_version, created_at)
      VALUES (${program.tenantId}::uuid, ${program.id}::uuid, ${input.actorUserId}, ${checked.text}, ${OWNER_TEXT_VERSION}, ${now}::timestamptz) RETURNING id`));
    const inserted = await tx.execute(sql`INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id, created_at)
      SELECT ${message.id}::uuid, p.id, p.tenant_id, p.membership_id, ${now}::timestamptz ${eligible(program.tenantId, program.id, now)} ON CONFLICT DO NOTHING RETURNING pass_id`);
    await tx.execute(sql`UPDATE wallet_messages SET audience_count = ${inserted.rows.length} WHERE id = ${message.id}::uuid`);
    await tx.execute(sql`INSERT INTO outbox_jobs (tenant_id, kind, payload) VALUES (${program.tenantId}::uuid, 'wallet.message', jsonb_build_object('messageId', ${message.id}::text))`);
    return { id: message.id, audience: inserted.rows.length };
  });
}

/** Stop switch: nothing queued is sent any more. A delivery already in flight finishes; it cannot be recalled. */
export async function stopWalletMessage(input: { actorUserId: string; programSlug: string; messageId: string }) {
  available();
  const program = await ownerProgram(input.actorUserId, input.programSlug);
  const [message] = rows<{ id: string }>(await db.execute(sql`UPDATE wallet_messages SET status = 'stopped', stopped_at = now()
    WHERE id = ${z.uuid().parse(input.messageId)}::uuid AND tenant_id = ${program.tenantId}::uuid AND program_id = ${program.id}::uuid AND status IN ('queued','sending') RETURNING id`));
  if (!message) throw new DomainError("NOT_FOUND", "Diese Nachricht läuft nicht mehr.");
  await db.execute(sql`UPDATE wallet_message_recipients SET status = 'skipped', reason = 'stopped' WHERE message_id = ${message.id}::uuid AND status = 'queued'`);
  await refreshCounts(message.id);
  return { stopped: true };
}

const refreshCounts = (messageId: string) => db.execute(sql`UPDATE wallet_messages SET
  sent_count = (SELECT count(*) FROM wallet_message_recipients WHERE message_id = ${messageId}::uuid AND status = 'sent'),
  failed_count = (SELECT count(*) FROM wallet_message_recipients WHERE message_id = ${messageId}::uuid AND status = 'failed'),
  skipped_count = (SELECT count(*) FROM wallet_message_recipients WHERE message_id = ${messageId}::uuid AND status = 'skipped')
  WHERE id = ${messageId}::uuid`);

// ---- Delivery (worker job `wallet.message`) -----------------------------------------------------------------------

export type WalletMessageSend = (call: { tenantId: string; locationId: string; objectId: string; data: Record<string, unknown> }) => Promise<void>;
/** The full agreed data contract with the one new value: PassFast's docs disagree on merge versus replace for PATCH, so every other field is re-sent unchanged. */
const providerSend: WalletMessageSend = async ({ tenantId, locationId, objectId, data }) => {
  const config = passFastConfig(process.env, tenantId, locationId);
  assertPassFastBinding(objectId, config);
  await new PassFastClient(config).update(passFastSerial(objectId), "apple", data);
};

export type WalletMessageOutcome = { status: "complete" | "blocked" | "suppressed"; reason?: string } | { status: "deferred"; reason: string; until: Date };
const payload = z.object({ messageId: z.uuid() }).strict();

export async function deliverWalletMessage(job: { id: string; tenantId: string; payload: Record<string, unknown> }, deps: { send?: WalletMessageSend; now?: () => Date } = {}): Promise<WalletMessageOutcome> {
  const clock = deps.now ?? (() => new Date());
  const send = deps.send ?? providerSend;
  const parsed = payload.safeParse(job.payload);
  if (!parsed.success) return { status: "blocked", reason: "Invalid wallet message job" };
  const messageId = parsed.data.messageId;
  const [message] = rows<{ text: string; status: string; timezone: string }>(await db.execute(sql`
    SELECT m.text, m.status, l.timezone FROM wallet_messages m JOIN programs p ON p.id = m.program_id AND p.tenant_id = m.tenant_id
      JOIN locations l ON l.id = p.location_id AND l.tenant_id = p.tenant_id
    WHERE m.id = ${messageId}::uuid AND m.tenant_id = ${job.tenantId}::uuid`));
  if (!message) return { status: "blocked", reason: "Message not found" };
  if (message.status === "stopped" || message.status === "complete") return { status: "suppressed", reason: `Message ${message.status}` };
  // Delivery that spills past 21:00 waits for 08:00 (the attempt is given back by the worker's deferral).
  const until = quietHoursDeferral(clock(), message.timezone, WALLET_QUIET_HOURS);
  if (until) return { status: "deferred", reason: "Quiet hours", until };
  // A crash between claim and outcome leaves the outcome unknown: never sent again, counted against the customer's cap.
  await db.execute(sql`UPDATE wallet_message_recipients SET status = 'failed', reason = 'uncertain'
    WHERE message_id = ${messageId}::uuid AND status = 'sending' AND claimed_at < ${new Date(clock().getTime() - STALE_SENDING_MS)}::timestamptz`);
  await db.execute(sql`UPDATE wallet_messages SET status = 'sending' WHERE id = ${messageId}::uuid AND status = 'queued'`);
  const started = Date.now();
  for (let done = 0; done < WORKER_BATCH && Date.now() - started < WORKER_BUDGET_MS; done++) {
    const [claim] = rows<{ passId: string; membershipId: string; attempts: number }>(await db.execute(sql`
      UPDATE wallet_message_recipients SET status = 'sending', attempts = attempts + 1, claimed_at = clock_timestamp()
      WHERE (message_id, pass_id) = (SELECT message_id, pass_id FROM wallet_message_recipients
        WHERE message_id = ${messageId}::uuid AND tenant_id = ${job.tenantId}::uuid AND status = 'queued' AND retry_at <= clock_timestamp()
        ORDER BY created_at, pass_id FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING pass_id AS "passId", membership_id AS "membershipId", attempts`));
    if (!claim) break;
    await deliverOne(job.tenantId, messageId, message.text, claim, send);
  }
  await refreshCounts(messageId);
  const [open] = rows<{ n: number; next: Date | null }>(await db.execute(sql`
    SELECT count(*)::int AS n, min(retry_at) FILTER (WHERE status = 'queued') AS next FROM wallet_message_recipients WHERE message_id = ${messageId}::uuid AND status IN ('queued','sending')`));
  if (!open.n) {
    await db.execute(sql`UPDATE wallet_messages SET status = 'complete' WHERE id = ${messageId}::uuid AND status <> 'stopped'`);
    return { status: "complete" };
  }
  return { status: "deferred", reason: "More recipients", until: new Date(Math.max(clock().getTime() + 1000, (open.next ? new Date(open.next).getTime() : 0))) };
}

async function deliverOne(tenantId: string, messageId: string, text: string, claim: { passId: string; membershipId: string; attempts: number }, send: WalletMessageSend) {
  const settle = (status: "sent" | "failed" | "skipped" | "queued", reason: string | null, retrySeconds = 0) => db.execute(sql`
    UPDATE wallet_message_recipients SET status = ${status}, reason = ${reason}, sent_at = ${status === "sent" ? sql`clock_timestamp()` : sql`NULL`},
      retry_at = clock_timestamp() + make_interval(secs => ${retrySeconds})
    WHERE message_id = ${messageId}::uuid AND pass_id = ${claim.passId}::uuid AND status = 'sending'`);
  // Rechecked right before the provider call: consent withdrawn, pass revoked, card closed or message stopped meanwhile.
  const [state] = rows<{ objectId: string; locationId: string; live: boolean; reachable: boolean; consent: boolean; stopped: boolean }>(await db.execute(sql`
    SELECT p.provider_object_id AS "objectId", pr.location_id AS "locationId",
      (p.status = 'created' AND p.revoked_at IS NULL AND m.closed_at IS NULL) AS live, ${reachable} AS reachable,
      EXISTS (SELECT 1 FROM wallet_message_consents c WHERE c.tenant_id = m.tenant_id AND c.membership_id = m.id AND c.withdrawn_at IS NULL) AS consent,
      (SELECT status = 'stopped' FROM wallet_messages WHERE id = ${messageId}::uuid) AS stopped
    FROM wallet_passes p JOIN memberships m ON m.id = p.membership_id AND m.tenant_id = p.tenant_id
      JOIN programs pr ON pr.id = m.program_id AND pr.tenant_id = m.tenant_id
    WHERE p.id = ${claim.passId}::uuid AND p.tenant_id = ${tenantId}::uuid`));
  if (!state || state.stopped) return settle("skipped", "stopped");
  if (!state.consent) return settle("skipped", "no_consent");
  if (!state.live) return settle("skipped", "pass_gone");
  if (!state.reachable) return settle("skipped", "unreachable");
  try {
    const snapshot = await walletCardSnapshot(claim.membershipId);
    if (!snapshot.open) return settle("skipped", "pass_gone");
    await send({ tenantId, locationId: state.locationId, objectId: state.objectId, data: { ...passFastData(snapshot.pass), message: text } });
  } catch (error) {
    // Only the error class is logged: never the text, the card or any contact data.
    console.error(`Wallet message ${messageId} delivery failed (${error instanceof Error ? error.name : "error"})`);
    return claim.attempts < MAX_ATTEMPTS ? settle("queued", "retry", 60 * claim.attempts) : settle("failed", "provider");
  }
  // Outside the try: a failure to record a delivered message must never turn into a retry (= a second send).
  return settle("sent", null);
}
