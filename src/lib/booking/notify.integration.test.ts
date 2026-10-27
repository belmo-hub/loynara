import { enroll } from "@/lib/product";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { pool } from "@/db";
import { GET as bookingRoute } from "@/app/api/card/[token]/booking/route";
import { POST as consentRoute } from "@/app/api/card/[token]/booking/consent/route";
import { POST as pushRoute } from "@/app/api/card/[token]/booking/push/route";
import { blockCustomer, book, cancelAffected, cancelByCustomer, createBlock, move, unblockCustomer } from "./appointments";
import { deliverRebook, deliverReminder, deliverShopChange, queueRebookPushes, setRebookConsent } from "./notify";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

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
  await move({ ...shop.scope, appointmentId: appointment.id, start: new Date("2026-11-03T13:00:00Z"), staffId: shop.staffId }, now);
  // The jobs of the old start step aside at once, not only when they come up.
  expect((await pool.query("SELECT status, last_error FROM outbox_jobs WHERE kind = 'booking.reminder' AND payload->>'appointmentId' = $1 AND payload->>'start' = '2026-11-03T09:00:00.000Z'", [appointment.id])).rows)
    .toEqual([{ status: "suppressed", last_error: "Replanned" }, { status: "suppressed", last_error: "Replanned" }]);
  const send = fakeSender();
  expect(await deliverReminder(old, { env, send, now: old.next_attempt_at })).toMatchObject({ status: "suppressed" });
  const [moved] = await jobs("booking.change", appointment.id);
  expect(moved.payload.kind).toBe("moved");
  // At night the push waits for 08:00 shop time; by day it goes out.
  expect(await deliverShopChange(moved, { env, send, now: new Date("2026-11-02T21:30:00Z") })).toEqual({ status: "retry", reason: "Quiet hours", delaySeconds: 34_200 });
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

  const send = fakeSender();
  expect(await deliverRebook(job, { env, send, now: scan })).toEqual({ status: "complete" });
  expect(JSON.parse(send.mock.calls[0][1])).toEqual({ title: "Synthetic Barber", body: "Zeit für Haarschnitt? Dein Slot bei Lena: Termin buchen.",
    url: `/card/${shop.card.cardToken}/termin?service=${shop.serviceId}&staff=${shop.staffId}&rebook=${first.id}` });
  // The link's source lands on the new booking, only for this card's own appointment.
  const rebooked = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-28T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID(), rebookSourceId: first.id }, scan);
  expect((await pool.query("SELECT rebook_source_id FROM booking_appointments WHERE id = $1", [rebooked.appointment.id])).rows[0].rebook_source_id).toBe(first.id);
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
    .toEqual([{ channel: "push", purpose: "booking_rebook", granted: true, notice_version: "booking-rebook-v1", source: "card" }]);
  // Another card may claim the same browser only with that browser's keys; the URL alone is refused.
  const second = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const other = { params: Promise.resolve({ token: second.cardToken }) };
  expect((await pushRoute(request(`/api/card/${second.cardToken}/booking/push`, { body: { subscription: { endpoint: device, expirationTime: null, keys: { ...keys, auth: "d".repeat(22) } } } }), other)).status).toBe(409);
  expect((await pushRoute(request(`/api/card/${second.cardToken}/booking/push`, { body: { subscription: { endpoint: device, expirationTime: null, keys } } }), other)).status).toBe(204);
  expect(await read()).toEqual({ publicKey: env.VAPID_PUBLIC_KEY, subscribed: false, rebookConsent: true });
});
