import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import { db, pool } from "@/db";
import { POST as transitionRoute } from "@/app/api/merchant/booking/appointments/[id]/transition/route";
import { getCustomerExport } from "@/lib/export";
import { createAdditionalLocation } from "@/lib/locations";
import { awardInTransaction } from "@/lib/loyalty";
import { enroll } from "@/lib/product";
import { blockCustomer, book, cancelByCustomer, reschedule, transition } from "./appointments";
import { deliverRebook, queueRebookPushes, sendCustomerPush, setRebookConsent } from "./notify";
import { getSetup, saveSetup } from "./setup";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

// The Reviewer's merge conditions for #330 (engineering/reviews/330-2026-11-22.md, P-1 to P-9): customer-data and credit
// guards that held, but whose removal no test caught. Each test below fails under that break.
withBookingDatabase();
type Shop = Awaited<ReturnType<typeof bookingShop>>;
const env = { VAPID_PUBLIC_KEY: "B".repeat(87), VAPID_PRIVATE_KEY: "p".repeat(43), VAPID_SUBJECT: "mailto:ops@example.test" };
const keys = { p256dh: "B" + "a".repeat(86), auth: "c".repeat(22) };
const fakeSender = () => vi.fn(async (_subscription: { endpoint: string }, payload: string) => { void payload; return { statusCode: 201, body: "", headers: {} }; });
const subscribe = async (tenantId: string, membershipId: string) => {
  const endpoint = `https://fcm.googleapis.com/fcm/send/${randomUUID().replaceAll("-", "")}`;
  await pool.query("INSERT INTO booking_push_subscriptions (tenant_id, membership_id, endpoint, p256dh, auth) VALUES ($1, $2, $3, $4, $5)", [tenantId, membershipId, endpoint, keys.p256dh, keys.auth]);
  return endpoint;
};
const tomorrowAt = (hourUtc: number) => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, hourUtc)); };
const bookFor = (token: string, serviceId: string, start: Date, name = "Mia", phone?: string) =>
  book({ token, serviceId, start, customerName: name, customerPhone: phone, idempotencyKey: randomUUID() });
const code = (promise: Promise<unknown>) => promise.then(() => "ok", (error: { code?: string }) => error.code ?? "error");
const secondCard = async (shop: Shop) => enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
const quarterNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
const fertig = (shop: Shop, id: string) => transitionRoute(request(`/api/merchant/booking/appointments/${id}/transition`, { body: { to: "done", expected: "confirmed" }, cookie: shop.ownerCookie }), { params: Promise.resolve({ id }) });
const doneEntry = async (id: string) => (await pool.query("SELECT done_ledger_entry_id FROM booking_appointments WHERE id = $1", [id])).rows[0].done_ledger_entry_id as string | null;
const bareAward = (shop: Shop) => db.transaction(tx => awardInTransaction(tx, { userId: shop.owner.userId, locationId: shop.scope.locationId, membershipId: shop.card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() }));

it("P-1: a customer push goes to that card's devices only, never to the shop's other cards", async () => {
  const shop = await bookingShop(), other = await secondCard(shop);
  const mine = await subscribe(shop.scope.tenantId, shop.card.id);
  await subscribe(shop.scope.tenantId, other.id);
  const send = fakeSender();
  await sendCustomerPush(shop.scope.tenantId, shop.card.id, { title: "Synthetic", body: "Synthetic", url: "/" }, { env, send });
  expect(send.mock.calls.map(([subscription]) => subscription.endpoint)).toEqual([mine]);
});

it("P-2: the customer's own export lists that card's appointments only, never another customer's name or phone", async () => {
  const shop = await bookingShop(), other = await secondCard(shop);
  await bookFor(shop.card.cardToken, shop.serviceId, tomorrowAt(9), "Mia", "0170 1111111");
  await bookFor(other.cardToken, shop.serviceId, tomorrowAt(11), "Max Mustermann", "0170 2222222");
  const text = JSON.stringify(await getCustomerExport(shop.card.cardToken));
  expect(text).toContain("0170 1111111");
  expect(text).not.toContain("Max Mustermann");
  expect(text).not.toContain("0170 2222222");
});

it("P-3: a queued rebook push re-checks consent at send time: withdrawn after the scan, nothing goes out", async () => {
  const shop = await bookingShop();
  const at = new Date("2026-11-02T06:00:00Z");
  const { appointment: first } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-03T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID() }, at);
  await pool.query("UPDATE booking_appointments SET status = 'done' WHERE id = $1", [first.id]);
  await pool.query("UPDATE booking_services SET rebook_after_days = 21 WHERE id = $1", [shop.serviceId]);
  await subscribe(shop.scope.tenantId, shop.card.id);
  await setRebookConsent(shop.card.cardToken, true);
  const scan = new Date("2026-11-25T09:00:00Z");
  expect(await queueRebookPushes(scan)).toBe(1);
  const { rows: [job] } = await pool.query("SELECT payload FROM outbox_jobs WHERE kind = 'booking.rebook' AND payload->>'appointmentId' = $1", [first.id]);
  await setRebookConsent(shop.card.cardToken, false);
  const send = fakeSender();
  expect(await deliverRebook(job, { env, send, now: scan })).toMatchObject({ status: "suppressed" });
  expect(send).not.toHaveBeenCalled();
});

it("P-4: „Fertig“ never links a credit outside the award window; that visit gets its own credit", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date(quarterNow().getTime() - 5 * 3_600_000), customerName: "Mia", idempotencyKey: randomUUID() }, new Date(Date.now() - 86_400_000));
  const today = await bareAward(shop); // now: five hours after the appointment, a different visit
  expect((await fertig(shop, appointment.id)).status).toBe(200);
  const linked = await doneEntry(appointment.id);
  expect(linked).not.toBeNull();
  expect(linked).not.toBe(today.entryId);
});

it("P-5: „Fertig“ never links a reversed credit; that visit gets its own credit", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: quarterNow(), customerName: "Mia", idempotencyKey: randomUUID() }, new Date(Date.now() - 86_400_000));
  const wrong = await bareAward(shop);
  await pool.query("INSERT INTO ledger_entries (tenant_id, location_id, membership_id, delta, kind, source, actor_user_id, request_id, idempotency_key, reversal_of_id, reason) VALUES ($1, $2, $3, -1, 'reversal', 'staff_correction', $4, gen_random_uuid(), $5, $6, 'Synthetic correction')",
    [shop.scope.tenantId, shop.scope.locationId, shop.card.id, shop.owner.userId, `reverse:${randomUUID()}`, wrong.entryId]);
  await pool.query("UPDATE memberships SET balance = balance - 1 WHERE id = $1", [shop.card.id]);
  expect((await fertig(shop, appointment.id)).status).toBe(200);
  const linked = await doneEntry(appointment.id);
  expect(linked).not.toBeNull();
  expect(linked).not.toBe(wrong.entryId);
});

it("P-6: one card's routes cannot cancel or move another card's appointment by its id", async () => {
  const shop = await bookingShop(), other = await secondCard(shop);
  const { appointment } = await bookFor(other.cardToken, shop.serviceId, tomorrowAt(9));
  expect(await code(cancelByCustomer({ token: shop.card.cardToken, appointmentId: appointment.id }))).toBe("NOT_FOUND");
  expect(await code(reschedule({ token: shop.card.cardToken, appointmentId: appointment.id, start: tomorrowAt(11) }))).toBe("NOT_FOUND");
  expect((await pool.query("SELECT status, lower(during) AS start FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0]).toEqual({ status: "confirmed", start: tomorrowAt(9) });
});

it("P-7: with booking off the library refuses a booking, and the set-up can never switch booking on", async () => {
  const shop = await bookingShop();
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  expect(await code(bookFor(shop.card.cardToken, shop.serviceId, tomorrowAt(9)))).toBe("NOT_FOUND");
  const setup = await getSetup(shop.scope);
  await saveSetup(shop.scope, { settings: { ...setup.settings, enabled: true }, services: setup.services, staff: setup.staff } as Parameters<typeof saveSetup>[1]);
  expect((await pool.query("SELECT enabled FROM booking_settings WHERE location_id = $1", [shop.scope.locationId])).rows[0].enabled).toBe(false);
});

it("P-8: a closed card cannot book, so no name or phone is written back onto it", async () => {
  const shop = await bookingShop();
  await pool.query("UPDATE memberships SET closed_at = now() WHERE id = $1", [shop.card.id]);
  expect(await code(bookFor(shop.card.cardToken, shop.serviceId, tomorrowAt(9), "Mia", "0170 1111111"))).toBe("NOT_FOUND");
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_appointments WHERE membership_id = $1", [shop.card.id])).rows[0].n).toBe(0);
});

it("P-9: a second location of the same business: its service, appointment, card and set-up rows stay out of reach", async () => {
  const shop = await bookingShop();
  const second = await createAdditionalLocation(shop.owner.userId, { name: "Synthetic second counter", city: "Berlin", country: "DE", timezone: "Europe/Berlin", programName: "Second card", programType: "stamp", rulesText: "One stamp per confirmed checkout.", rewardTitle: "Coffee", rewardCost: 5 });
  const there = { tenantId: shop.scope.tenantId, locationId: second.locationId };
  const hours = [1, 2, 3, 4, 5, 6, 7].map(weekday => ({ weekday, start: "00:00", end: "24:00", breaks: [] }));
  const setupThere = await saveSetup(there, {
    settings: { shopType: "barber", leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ name: "Bart dort", durationMin: 30, priceMinor: 1500 }], staff: [{ name: "Tom", workingHours: hours }],
  });
  await pool.query("UPDATE booking_settings SET enabled = true WHERE location_id = $1", [second.locationId]);
  const serviceThere = setupThere.services[0].id;
  const cardThere = await enroll({ slug: second.programSlug, acceptedTerms: true });
  const { appointment: appointmentThere } = await bookFor(cardThere.cardToken, serviceThere, tomorrowAt(9));

  // B26: a card here cannot book the other location's service.
  expect(await code(bookFor(shop.card.cardToken, serviceThere, tomorrowAt(11)))).not.toBe("ok");
  // B28: the owner's scope here cannot finish the other location's appointment.
  expect(await code(transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: appointmentThere.id, to: "cancelled_by_shop", expected: "confirmed" }))).toBe("NOT_FOUND");
  // B40: nor pause booking for the other location's card.
  expect(await code(blockCustomer({ ...shop.scope, membershipId: cardThere.id, userId: shop.owner.userId }))).toBe("NOT_FOUND");
  // B44: a set-up save here naming the other location's service id does not touch that row.
  const here = await getSetup(shop.scope);
  await code(saveSetup(shop.scope, { settings: here.settings, services: [...here.services, { id: serviceThere, name: "Übernommen", durationMin: 30, priceMinor: 1500 }], staff: here.staff } as Parameters<typeof saveSetup>[1]));
  expect((await pool.query("SELECT name, location_id, archived_at FROM booking_services WHERE id = $1", [serviceThere])).rows[0]).toEqual({ name: "Bart dort", location_id: second.locationId, archived_at: null });
  expect((await pool.query("SELECT status FROM booking_appointments WHERE id = $1", [appointmentThere.id])).rows[0].status).toBe("confirmed");
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_blocked_customers WHERE membership_id = $1", [cardThere.id])).rows[0].n).toBe(0);
});
