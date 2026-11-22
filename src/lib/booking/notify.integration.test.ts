import { enroll } from "@/lib/product";
import { randomUUID } from "node:crypto";
import { WebPushError } from "web-push";
import { afterEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { GET as bookingRoute } from "@/app/api/card/[token]/booking/route";
import { POST as consentRoute } from "@/app/api/card/[token]/booking/consent/route";
import { POST as pushRoute } from "@/app/api/card/[token]/booking/push/route";
import { blockCustomer, book, cancelAffected, cancelByCustomer, createBlock, move, transition, unblockCustomer } from "./appointments";
import { deliverBookingJob, deliverRebook, deliverReminder, deliverRequest, deliverShopChange, queueRebookPushes, sendCustomerPush, setRebookConsent } from "./notify";
import { bookingShop, identity, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();
type Shop = Awaited<ReturnType<typeof bookingShop>>;
const env = { VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "p".repeat(43), VAPID_SUBJECT: "mailto:ops@example.test" };
const now = new Date("2026-11-02T06:00:00Z"), daytime = new Date("2026-11-02T09:00:00Z");
const endpoint = () => `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`;
const keys = { p256dh: "B" + "a".repeat(86), auth: "c".repeat(22) };
afterEach(() => { vi.unstubAllEnvs(); });

const bookAt = (shop: Shop, start: string, at = now) => book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date(start), customerName: "Mia", idempotencyKey: randomUUID() }, at).then(r => r.appointment);
const jobs = async (kind: string, appointmentId: string) => (await pool.query(
  "SELECT payload, next_attempt_at FROM outbox_jobs WHERE kind = $1 AND payload->>'appointmentId' = $2 ORDER BY next_attempt_at", [kind, appointmentId])).rows as { payload: Record<string, string>; next_attempt_at: Date }[];
const subscribe = (shop: Shop) => pool.query("INSERT INTO booking_push_subscriptions (tenant_id, membership_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)",
  [shop.scope.tenantId, shop.card.id, endpoint(), keys.p256dh, keys.auth]);
const fakeSender = () => vi.fn(async (_subscription: unknown, payload: string) => { void payload; return { statusCode: 201, body: "", headers: {} }; });

it("a confirmed booking gets a 24 h and a 2 h reminder job at the right instants", async () => {
  const shop = await bookingShop();
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const found = await jobs("booking.reminder", appointment.id);
  expect(found.map(j => [j.payload.which, j.next_attempt_at.toISOString()])).toEqual([["24h", "2026-11-02T09:00:00.000Z"], ["2h", "2026-11-03T07:00:00.000Z"]]);
  // A request gets none until the owner confirms it.
  const requested = await bookingShop({ autoConfirm: false });
  expect(await jobs("booking.reminder", (await bookAt(requested, "2026-11-03T09:00:00Z")).id)).toEqual([]);
});

it("a 2 h reminder in quiet hours moves to 08:00 while still before the start, otherwise it is dropped", async () => {
  const shop = await bookingShop();
  const early = await bookAt(shop, "2026-11-03T07:30:00Z"); // 08:30 Berlin: 06:30 → 08:00
  expect((await jobs("booking.reminder", early.id)).map(j => [j.payload.which, j.next_attempt_at.toISOString()])).toEqual([["24h", "2026-11-02T07:30:00.000Z"], ["2h", "2026-11-03T07:00:00.000Z"]]);
  const other = await bookingShop();
  const eight = await bookAt(other, "2026-11-03T07:00:00Z"); // 08:00 Berlin: 08:00 is the start itself
  expect((await jobs("booking.reminder", eight.id)).map(j => j.payload.which)).toEqual(["24h"]);
});

it("delivers a reminder once with the fake sender, a retry is a no-op, and a cancelled appointment's job says nothing", async () => {
  const shop = await bookingShop();
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const [day] = await jobs("booking.reminder", appointment.id);
  expect(await deliverReminder(day, { env, send: fakeSender(), now: day.next_attempt_at })).toEqual({ status: "complete", reason: "no subscription" });
  await subscribe(shop);
  const send = fakeSender();
  // At night the reminder waits for 08:00 as well (then its lateness check decides).
  // 22:00 Berlin on 1 Nov: the wake time is 08:00 Berlin the next day (CET), as a UTC instant.
  expect(await deliverReminder(day, { env, send, now: new Date(day.next_attempt_at.getTime() - 12 * 3_600_000) })).toEqual({ status: "deferred", reason: "Quiet hours", until: new Date("2026-11-02T07:00:00Z") });
  expect(await deliverReminder(day, { env, send, now: day.next_attempt_at })).toEqual({ status: "complete" });
  expect(await deliverReminder(day, { env, send, now: day.next_attempt_at })).toEqual({ status: "complete", reason: "already sent" });
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0][1])).toEqual({ title: "Synthetic Barber", body: "Dein Termin Haarschnitt ist Di 03.11. um 10:00 bei Lena.", url: `/card/${shop.card.cardToken}/termin` });
  expect((await pool.query("SELECT kind FROM booking_push_log WHERE appointment_id = $1", [appointment.id])).rows).toEqual([{ kind: "reminder_24h" }]);
  // Without VAPID keys nothing is sent.
  expect((await deliverReminder(day, { env: {}, send, now: day.next_attempt_at })).status).toBe("suppressed");

  await cancelByCustomer({ token: shop.card.cardToken, appointmentId: appointment.id }, now);
  const [, late] = await jobs("booking.reminder", appointment.id);
  expect(await deliverReminder(late, { env, send, now: late.next_attempt_at })).toMatchObject({ status: "suppressed" });
  expect(send).toHaveBeenCalledTimes(1);
});

it("a move makes the old reminder jobs no-ops and notifies the customer; cancelAffected enqueues a shop_cancel push", async () => {
  const shop = await bookingShop();
  await subscribe(shop);
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const [old] = await jobs("booking.reminder", appointment.id);
  // Confirming the current slot is a no-op: no push, the reminder jobs stay as they are.
  await move({ ...shop.scope, appointmentId: appointment.id, start: new Date("2026-11-03T09:00:00Z"), staffId: shop.staffId }, now);
  expect(await jobs("booking.change", appointment.id)).toEqual([]);
  expect((await jobs("booking.reminder", appointment.id)).length).toBe(2);
  await move({ ...shop.scope, appointmentId: appointment.id, start: new Date("2026-11-03T13:00:00Z"), staffId: shop.staffId }, now);
  // The jobs of the old start step aside at once, not only when they come up.
  expect((await pool.query("SELECT status, last_error FROM outbox_jobs WHERE kind = 'booking.reminder' AND payload->>'appointmentId' = $1 AND payload->>'start' = '2026-11-03T09:00:00.000Z'", [appointment.id])).rows)
    .toEqual([{ status: "suppressed", last_error: "Replanned" }, { status: "suppressed", last_error: "Replanned" }]);
  const send = fakeSender();
  expect(await deliverReminder(old, { env, send, now: old.next_attempt_at })).toMatchObject({ status: "suppressed" });
  const [moved] = await jobs("booking.change", appointment.id);
  expect(moved.payload.kind).toBe("moved");
  // At night the push waits for 08:00 shop time; by day it goes out.
  expect(await deliverShopChange(moved, { env, send, now: new Date("2026-11-02T21:30:00Z") })).toEqual({ status: "deferred", reason: "Quiet hours", until: new Date("2026-11-03T07:00:00Z") });
  expect(await deliverShopChange(moved, { env, send, now: daytime })).toEqual({ status: "complete" });
  expect(JSON.parse(send.mock.calls[0][1]).body).toBe("Dein Termin ist jetzt Di 03.11. um 14:00 bei Lena.");
  expect((await jobs("booking.reminder", appointment.id)).length).toBe(4);

  const { block } = await createBlock({ ...shop.scope, start: new Date("2026-11-03T12:00:00Z"), end: new Date("2026-11-03T16:00:00Z"), reason: "Früher zu" }, now);
  await cancelAffected({ ...shop.scope, blockId: block.id }, now);
  const cancel = (await jobs("booking.change", appointment.id)).find(j => j.payload.kind === "shop_cancel")!;
  expect(cancel).toBeDefined();
  expect(await deliverShopChange(cancel, { env, send, now: daytime })).toEqual({ status: "complete" });
  expect(JSON.parse(send.mock.calls[1][1]).body).toBe("Dein Termin Di 03.11. 14:00 wurde abgesagt. Neuen Termin wählen.");
});

it("the rebook scan respects consent, an open appointment and the cap shared with Wallet messages, and claims once", async () => {
  const shop = await bookingShop();
  const first = await bookAt(shop, "2026-11-03T09:00:00Z");
  await pool.query("UPDATE booking_appointments SET status = 'done' WHERE id = $1", [first.id]);
  await pool.query("UPDATE booking_services SET rebook_after_days = 21 WHERE id = $1", [shop.serviceId]);
  await subscribe(shop);
  const scan = new Date("2026-11-25T09:00:00Z");
  expect(await queueRebookPushes(scan)).toBe(0); // no consent yet
  await setRebookConsent(shop.card.cardToken, true);

  const open = await bookAt(shop, "2026-11-27T09:00:00Z", scan);
  expect(await queueRebookPushes(scan)).toBe(0);
  await cancelByCustomer({ token: shop.card.cardToken, appointmentId: open.id }, scan);
  // Nothing goes out when the card cannot book here any more: a paused card, booking switched off.
  await blockCustomer({ ...shop.scope, membershipId: shop.card.id, userId: shop.owner.userId });
  expect(await queueRebookPushes(scan)).toBe(0);
  await unblockCustomer({ ...shop.scope, membershipId: shop.card.id });
  await pool.query("UPDATE booking_settings SET enabled = false WHERE tenant_id = $1", [shop.scope.tenantId]);
  expect(await queueRebookPushes(scan)).toBe(0);
  await pool.query("UPDATE booking_settings SET enabled = true WHERE tenant_id = $1", [shop.scope.tenantId]);

  const { rows: [message] } = await pool.query("INSERT INTO wallet_messages (tenant_id, program_id, kind, text) VALUES ($1, $2, 'owner', 'Synthetic') RETURNING id", [shop.scope.tenantId, shop.merchant.programId]);
  await pool.query("INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id, status, created_at) VALUES ($1, $2, $3, $4, 'queued', $5)",
    [message.id, randomUUID(), shop.scope.tenantId, shop.card.id, new Date(scan.getTime() - 3_600_000)]);
  expect(await queueRebookPushes(scan)).toBe(0); // a Wallet message in the last 24 h
  await pool.query("UPDATE wallet_message_recipients SET created_at = $1", [new Date(scan.getTime() - 3 * 86_400_000)]);
  // A Wallet send with an unknown outcome counts like a send, as Wallet's own cap counts it.
  const { rows: [second] } = await pool.query("INSERT INTO wallet_messages (tenant_id, program_id, kind, text) VALUES ($1, $2, 'owner', 'Synthetic 2') RETURNING id", [shop.scope.tenantId, shop.merchant.programId]);
  await pool.query("INSERT INTO wallet_message_recipients (message_id, pass_id, tenant_id, membership_id, status, reason, created_at) VALUES ($1, $2, $3, $4, 'failed', 'uncertain', $5)",
    [second.id, randomUUID(), shop.scope.tenantId, shop.card.id, new Date(scan.getTime() - 2 * 86_400_000)]);
  expect(await queueRebookPushes(scan)).toBe(0); // 2 of 2 this week, one of them uncertain
  await pool.query("DELETE FROM wallet_message_recipients WHERE message_id = $1", [second.id]);
  expect(await queueRebookPushes(scan)).toBe(1); // 1 of 2 this week
  expect(await queueRebookPushes(scan)).toBe(0);
  expect((await pool.query("SELECT rebook_sent_at FROM booking_appointments WHERE id = $1", [first.id])).rows[0].rebook_sent_at.toISOString()).toBe(scan.toISOString());
  const [job] = await jobs("booking.rebook", first.id);
  expect(job.next_attempt_at.toISOString()).toBe(scan.toISOString()); // 10:00 Berlin: inside the send window

  // Between the scan and the send the service may be gone: nothing goes out.
  await pool.query("UPDATE booking_services SET archived_at = now() WHERE id = $1", [shop.serviceId]);
  expect(await deliverRebook(job, { env, send: fakeSender(), now: scan })).toMatchObject({ status: "suppressed" });
  await pool.query("UPDATE booking_services SET archived_at = NULL WHERE id = $1", [shop.serviceId]);
  // The same for the staff member.
  await pool.query("UPDATE booking_staff SET archived_at = now() WHERE id = $1", [shop.staffId]);
  expect(await deliverRebook(job, { env, send: fakeSender(), now: scan })).toEqual({ status: "suppressed", reason: "No consent or already booked" });
  await pool.query("UPDATE booking_staff SET archived_at = NULL WHERE id = $1", [shop.staffId]);
  // Queued but not sent yet: a booking from the link has no source.
  const early = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-30T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID(), rebookSourceId: first.id }, scan);
  expect((await pool.query("SELECT rebook_source_id FROM booking_appointments WHERE id = $1", [early.appointment.id])).rows[0].rebook_source_id).toBeNull();
  await cancelByCustomer({ token: shop.card.cardToken, appointmentId: early.appointment.id }, scan);
  const send = fakeSender();
  expect(await deliverRebook(job, { env, send, now: scan })).toEqual({ status: "complete" });
  expect(JSON.parse(send.mock.calls[0][1])).toEqual({ title: "Synthetic Barber", body: "Zeit für Haarschnitt? Dein Slot bei Lena: Termin buchen.",
    url: `/card/${shop.card.cardToken}/termin?service=${shop.serviceId}&staff=${shop.staffId}&rebook=${first.id}` });
  // The link's source lands on the new booking, only for this card's own appointment.
  const rebooked = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-28T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID(), rebookSourceId: first.id }, scan);
  expect((await pool.query("SELECT rebook_source_id FROM booking_appointments WHERE id = $1", [rebooked.appointment.id])).rows[0].rebook_source_id).toBe(first.id);
  // Another service, or a push older than 14 days, books without a source (the booking itself goes through).
  const { rows: [other] } = await pool.query("INSERT INTO booking_services (tenant_id, location_id, name, duration_min, price_minor) VALUES ($1, $2, 'Bart', 15, 1200) RETURNING id", [shop.scope.tenantId, shop.scope.locationId]);
  const sourceOf = async (serviceId: string, start: string, at: Date) => (await pool.query("SELECT rebook_source_id FROM booking_appointments WHERE id = $1",
    [(await book({ token: shop.card.cardToken, serviceId, start: new Date(start), customerName: "Mia", idempotencyKey: randomUUID(), rebookSourceId: first.id }, at)).appointment.id])).rows[0].rebook_source_id;
  expect(await sourceOf(other.id, "2026-11-29T09:00:00Z", scan)).toBeNull();
  expect(await sourceOf(shop.serviceId, "2026-12-11T09:00:00Z", new Date(scan.getTime() + 15 * 86_400_000))).toBeNull();
});

const staffDevice = async (shop: Shop, userId = shop.owner.userId) => {
  const { rows: [session] } = await pool.query(`SELECT id FROM "session" WHERE "userId" = $1 LIMIT 1`, [userId]);
  const device = endpoint();
  await pool.query("INSERT INTO staff_push_subscriptions (tenant_id, location_id, user_id, session_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [shop.scope.tenantId, shop.scope.locationId, userId, session.id, device, keys.p256dh, keys.auth]);
  return device;
};

it("an unconfirmed request warns the owner devices 1 h before and is cancelled at its end with a customer push", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  await subscribe(shop);
  const ownerDevice = await staffDevice(shop);
  // A cashier cannot open the day view, so the warning skips the cashier's phone.
  const cashier = await identity();
  await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'cashier', $3)", [shop.scope.tenantId, cashier.userId, shop.scope.locationId]);
  await staffDevice(shop, cashier.userId);
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const [warn, expire] = await jobs("booking.request", appointment.id);
  expect([warn, expire].map(j => [j.payload.phase, j.next_attempt_at.toISOString()])).toEqual([["warn", "2026-11-03T08:00:00.000Z"], ["expire", "2026-11-03T11:00:00.000Z"]]);
  // A customer who came on time keeps the request while the counter can still link the visit: at the start nothing expires yet.
  expect(await deliverRequest(expire, { env, now: new Date("2026-11-03T09:00:00Z") })).toEqual({ status: "deferred", reason: "Not due yet", until: new Date("2026-11-03T11:00:00Z") });
  const staffSend = fakeSender();
  // The worker's entry routes the kind.
  expect(await deliverBookingJob({ kind: "booking.request", payload: warn.payload }, { env, send: staffSend, now: warn.next_attempt_at })).toEqual({ status: "complete" });
  expect(staffSend).toHaveBeenCalledTimes(1);
  expect(staffSend.mock.calls[0][0]).toMatchObject({ endpoint: ownerDevice });
  expect(JSON.parse(staffSend.mock.calls[0][1])).toEqual({ v: 1, kind: "booking_request", title: "Synthetic Barber", body: "Anfrage 10:00 · Haarschnitt ist noch nicht bestätigt.", url: "/merchant/termine?date=2026-11-03", tag: appointment.id });

  expect(await deliverRequest(expire, { env, send: staffSend, now: expire.next_attempt_at })).toEqual({ status: "complete" });
  expect((await pool.query("SELECT status, cancel_reason FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0]).toEqual({ status: "cancelled_by_shop", cancel_reason: "Nicht bestätigt" });
  const [cancel] = await jobs("booking.change", appointment.id);
  expect([cancel.payload.kind, cancel.next_attempt_at.toISOString()]).toEqual(["shop_cancel", "2026-11-03T11:00:00.000Z"]);
  const send = fakeSender();
  expect(await deliverShopChange(cancel, { env, send, now: expire.next_attempt_at })).toEqual({ status: "complete" });
  expect(JSON.parse(send.mock.calls[0][1]).body).toBe("Dein Termin Di 03.11. um 10:00 konnte nicht bestätigt werden. Buch gern einen neuen.");
  // A retry of the expiry changes nothing.
  expect(await deliverRequest(expire, { env, send, now: expire.next_attempt_at })).toEqual({ status: "suppressed", reason: "Request no longer open" });
  expect(staffSend).toHaveBeenCalledTimes(1);
});

it("a confirmed request suppresses both request jobs and gets one confirmation push; a second confirm is STALE and sends nothing", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  await subscribe(shop);
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const confirm = () => transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: appointment.id, to: "confirmed", expected: "requested" }, now);
  await confirm();
  const send = fakeSender();
  for (const job of await jobs("booking.request", appointment.id)) expect(await deliverRequest(job, { env, send, now: job.next_attempt_at })).toEqual({ status: "suppressed", reason: "Request no longer open" });
  const [confirmed] = await jobs("booking.change", appointment.id);
  expect(confirmed.payload.kind).toBe("confirmed");
  expect(await deliverShopChange(confirmed, { env, send, now: daytime })).toEqual({ status: "complete" });
  expect(await deliverShopChange(confirmed, { env, send, now: daytime })).toEqual({ status: "complete", reason: "already sent" });
  expect(send).toHaveBeenCalledTimes(1);
  expect(JSON.parse(send.mock.calls[0][1]).body).toBe("Dein Termin Di 03.11. um 10:00 bei Lena ist bestätigt.");
  await expect(confirm()).rejects.toMatchObject({ code: "STALE" });
  expect((await jobs("booking.change", appointment.id)).length).toBe(1);
});

it("a request moved later gets fresh jobs and the old one steps aside", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const [warn] = await jobs("booking.request", appointment.id);
  await move({ ...shop.scope, appointmentId: appointment.id, start: new Date("2026-11-03T13:00:00Z"), staffId: shop.staffId }, now);
  expect(await deliverRequest(warn, { env, send: fakeSender(), now: warn.next_attempt_at })).toEqual({ status: "suppressed", reason: "Replanned" });
  // The move replanned the jobs as well.
  expect((await pool.query("SELECT payload->>'phase' AS phase, next_attempt_at FROM outbox_jobs WHERE kind = 'booking.request' AND status = 'pending' AND payload->>'appointmentId' = $1 ORDER BY next_attempt_at", [appointment.id])).rows)
    .toEqual([{ phase: "warn", next_attempt_at: new Date("2026-11-03T12:00:00Z") }, { phase: "expire", next_attempt_at: new Date("2026-11-03T15:00:00Z") }]);
});

it("a replan leaves a job that is mid-send with its worker; the moved request gets fresh jobs", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  await pool.query("UPDATE outbox_jobs SET status = 'processing' WHERE kind = 'booking.request' AND payload->>'phase' = 'warn' AND payload->>'appointmentId' = $1", [appointment.id]);
  await move({ ...shop.scope, appointmentId: appointment.id, start: new Date("2026-11-03T13:00:00Z"), staffId: shop.staffId }, now);
  expect((await pool.query("SELECT payload->>'phase' AS phase, status FROM outbox_jobs WHERE kind = 'booking.request' AND payload->>'appointmentId' = $1 ORDER BY status, next_attempt_at", [appointment.id])).rows)
    .toEqual([{ phase: "warn", status: "pending" }, { phase: "expire", status: "pending" }, { phase: "warn", status: "processing" }, { phase: "expire", status: "suppressed" }]);
});

it("an expiry that waited on a move's row lock leaves the moved request open", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const [, expire] = await jobs("booking.request", appointment.id);
  const mover = await pool.connect();
  try {
    await mover.query("BEGIN");
    await mover.query("UPDATE booking_appointments SET during = tstzrange('2026-11-03T13:00:00Z', '2026-11-03T13:30:00Z') WHERE id = $1", [appointment.id]);
    // The job reads the old end, then its UPDATE waits for the move's lock.
    const expiring = deliverRequest(expire, { env, now: expire.next_attempt_at });
    await vi.waitFor(async () => expect((await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query LIKE 'UPDATE booking_appointments SET status%'")).rows[0].n).toBe(1), { timeout: 5_000 });
    await mover.query("COMMIT");
    expect(await expiring).toEqual({ status: "suppressed", reason: "Request no longer open" });
  } finally {
    mover.release();
  }
  expect((await pool.query("SELECT status FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0].status).toBe("requested");
});

it("a change at night for an appointment before 08:00 goes out at once; a move or confirmation after the start says nothing", async () => {
  const shop = await bookingShop();
  await subscribe(shop);
  const appointment = await bookAt(shop, "2026-11-03T09:00:00Z");
  const night = new Date("2026-11-02T20:10:00Z"); // 21:10 Berlin
  await move({ ...shop.scope, appointmentId: appointment.id, start: new Date("2026-11-03T06:30:00Z"), staffId: shop.staffId }, night); // 07:30 Berlin
  const [moved] = await jobs("booking.change", appointment.id);
  expect(moved.next_attempt_at.toISOString()).toBe(night.toISOString());
  const send = fakeSender();
  expect(await deliverShopChange(moved, { env, send, now: new Date("2026-11-03T06:31:00Z") })).toEqual({ status: "suppressed", reason: "Appointment already started" });
  expect(await deliverShopChange(moved, { env, send, now: night })).toEqual({ status: "complete" });
  expect(JSON.parse(send.mock.calls[0][1]).body).toBe("Dein Termin ist jetzt Di 03.11. um 07:30 bei Lena.");
});

it("an expiry at night is told at 08:00: the appointment is over, nothing is urgent", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  await subscribe(shop);
  const appointment = await bookAt(shop, "2026-11-03T19:30:00Z"); // 20:30 Berlin, ends 21:00, expires 22:30
  const [, expire] = await jobs("booking.request", appointment.id);
  expect(expire.next_attempt_at.toISOString()).toBe("2026-11-03T21:30:00.000Z");
  expect(await deliverRequest(expire, { env, now: expire.next_attempt_at })).toEqual({ status: "complete" });
  const [cancel] = await jobs("booking.change", appointment.id);
  expect(cancel.next_attempt_at.toISOString()).toBe("2026-11-04T07:00:00.000Z"); // 08:00 Berlin
});

it("a confirmation at night for an appointment at 08:00 sharp goes out at once", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  await subscribe(shop);
  const appointment = await bookAt(shop, "2026-11-03T07:00:00Z"); // 08:00 Berlin, the end of quiet hours
  const night = new Date("2026-11-02T21:00:00Z"); // 22:00 Berlin
  await transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: appointment.id, to: "confirmed", expected: "requested" }, night);
  const [confirmed] = await jobs("booking.change", appointment.id);
  expect(confirmed.next_attempt_at.toISOString()).toBe(night.toISOString());
  const send = fakeSender();
  expect(await deliverShopChange(confirmed, { env, send, now: night })).toEqual({ status: "complete" });
  expect(send).toHaveBeenCalledTimes(1);
});

it("a device is dropped after its third definitive refusal", async () => {
  const shop = await bookingShop();
  await subscribe(shop);
  const refuse = vi.fn(async () => { throw new WebPushError("Refused", 403, {}, "", "synthetic"); });
  const devices = async () => (await pool.query("SELECT failure_count FROM booking_push_subscriptions WHERE membership_id = $1", [shop.card.id])).rows;
  const message = { title: "Synthetic Barber", body: "Synthetic", url: "/" };
  await sendCustomerPush(shop.scope.tenantId, shop.card.id, message, { env, send: refuse });
  await sendCustomerPush(shop.scope.tenantId, shop.card.id, message, { env, send: refuse });
  expect(await devices()).toEqual([{ failure_count: 2 }]);
  await sendCustomerPush(shop.scope.tenantId, shop.card.id, message, { env, send: refuse });
  expect(await devices()).toEqual([]);
});

it("GET …/booking reports the push state; the push and consent routes store a device and the opt-in", async () => {
  const shop = await bookingShop();
  const token = shop.card.cardToken, params = { params: Promise.resolve({ token }) };
  const read = async () => (await (await bookingRoute(request(`/api/card/${token}/booking`), params)).json()).push;
  expect(await read()).toEqual({ subscribed: false, rebookConsent: false });
  vi.stubEnv("VAPID_PUBLIC_KEY", env.VAPID_PUBLIC_KEY); vi.stubEnv("VAPID_PRIVATE_KEY", env.VAPID_PRIVATE_KEY); vi.stubEnv("VAPID_SUBJECT", env.VAPID_SUBJECT);
  expect((await pushRoute(request(`/api/card/${token}/booking/push`, { body: { subscription: { endpoint: "https://evil.example/x", keys } } }), params)).status).toBe(400);
  const device = endpoint();
  expect((await pushRoute(request(`/api/card/${token}/booking/push`, { body: { subscription: { endpoint: device, expirationTime: null, keys } } }), params)).status).toBe(204);
  expect((await consentRoute(request(`/api/card/${token}/booking/consent`, { body: { rebook: true } }), params)).status).toBe(204);
  expect(await read()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY, subscribed: true, rebookConsent: true });
  expect((await pool.query("SELECT channel, purpose, granted, notice_version, source FROM consent_events WHERE membership_id = $1", [shop.card.id])).rows)
    .toEqual([{ channel: "push", purpose: "booking_rebook", granted: true, notice_version: "booking-rebook-v2", source: "card" }]);
  // Another card may claim the same browser only with that browser's keys; the URL alone is refused.
  const second = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const other = { params: Promise.resolve({ token: second.cardToken }) };
  expect((await pushRoute(request(`/api/card/${second.cardToken}/booking/push`, { body: { subscription: { endpoint: device, expirationTime: null, keys: { ...keys, auth: "d".repeat(22) } } } }), other)).status).toBe(409);
  expect((await pushRoute(request(`/api/card/${second.cardToken}/booking/push`, { body: { subscription: { endpoint: device, expirationTime: null, keys } } }), other)).status).toBe(204);
  expect(await read()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY, subscribed: false, rebookConsent: true });
});
