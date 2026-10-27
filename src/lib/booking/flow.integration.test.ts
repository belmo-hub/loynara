import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { PUT as setupRoute } from "@/app/api/merchant/booking/setup/route";
import { closeCard } from "@/lib/card-lifecycle";
import { book, cancelAffected, cancelByCustomer, cardView, createBlock, customerSlots, reschedule } from "./appointments";
import { saveSetup } from "./setup";
import { allWeek, bookingShop, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();
const now = new Date("2026-11-02T06:00:00Z"), start = new Date("2026-11-03T09:00:00Z");
const code = (promise: Promise<unknown>) => promise.then(() => "OK", (error: { code?: string }) => error.code);

it("reschedules inside the rules, keeps the status, and cancels late with the flag", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  expect(appointment.status).toBe("requested");
  const token = shop.card.cardToken, id = appointment.id;
  const moved = await reschedule({ token, appointmentId: id, start: new Date("2026-11-03T10:00:00Z") }, now);
  expect(moved).toMatchObject({ status: "requested", start: "2026-11-03T10:00:00.000Z", rescheduleCount: 1 });
  expect(await reschedule({ token, appointmentId: id, start: new Date("2026-11-03T10:00:00Z") }, now)).toMatchObject({ rescheduleCount: 1 });
  await reschedule({ token, appointmentId: id, start: new Date("2026-11-03T11:00:00Z") }, now);
  expect(await code(reschedule({ token, appointmentId: id, start: new Date("2026-11-03T12:00:00Z") }, now))).toBe("RESCHEDULE_LIMIT");
  expect(await code(reschedule({ token, appointmentId: id, start: new Date("2026-11-03T12:00:00Z") }, new Date("2026-11-02T12:00:00Z")))).toBe("TOO_LATE");
  const cancelled = await cancelByCustomer({ token, appointmentId: id }, new Date("2026-11-02T12:00:00Z"));
  expect(cancelled).toMatchObject({ status: "cancelled_by_customer", lateCancel: true, canCancel: false });
  expect(await cardView(token, now)).toMatchObject({ enabled: true, blocked: false, upcoming: [], past: [{ id, status: "cancelled_by_customer" }] });
});

it("after the start only the shop decides: the customer's cancel is refused and the view hides the button", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const later = new Date("2026-11-03T09:05:00Z");
  expect(await code(cancelByCustomer({ token: shop.card.cardToken, appointmentId: appointment.id }, later))).toBe("TOO_LATE");
  expect((await cardView(shop.card.cardToken, later)).upcoming).toMatchObject([{ id: appointment.id, status: "confirmed", canCancel: false }]);
});

it("the monthly move limit counts the moves of that month only; a shop without online moves hides the option", async () => {
  const shop = await bookingShop();
  const token = shop.card.cardToken;
  const { appointment } = await book({ token, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  await reschedule({ token, appointmentId: appointment.id, start: new Date("2026-11-03T10:00:00Z") }, now);
  await reschedule({ token, appointmentId: appointment.id, start: new Date("2026-11-03T11:00:00Z") }, now);
  expect(await code(reschedule({ token, appointmentId: appointment.id, start: new Date("2026-11-03T12:00:00Z") }, now))).toBe("RESCHEDULE_LIMIT");
  const december = new Date("2026-12-01T06:00:00Z");
  const next = (await book({ token, serviceId: shop.serviceId, start: new Date("2026-12-03T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID() }, december)).appointment;
  expect(await reschedule({ token, appointmentId: next.id, start: new Date("2026-12-03T10:00:00Z") }, december)).toMatchObject({ rescheduleCount: 1 });
  await pool.query("UPDATE booking_settings SET max_reschedules_per_month = 0 WHERE tenant_id = $1", [shop.scope.tenantId]);
  expect((await cardView(token, december)).upcoming).toMatchObject([{ id: next.id, canReschedule: false }]);
  expect(await code(reschedule({ token, appointmentId: next.id, start: new Date("2026-12-03T11:00:00Z") }, december))).toBe("RESCHEDULE_LIMIT");
});

it("a move sees its own time as free; one card cannot hold two appointments at once even with two staff members", async () => {
  const shop = await bookingShop();
  const token = shop.card.cardToken;
  const { appointment } = await book({ token, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const starts = async (appointmentId?: string) => (await customerSlots(token, { serviceId: shop.serviceId, from: "2026-11-03", days: 1, appointmentId }, now)).days[0].slots.map(s => s.start);
  expect(await starts()).not.toContain("2026-11-03T09:15:00.000Z");
  expect(await starts(appointment.id)).toEqual(expect.arrayContaining(["2026-11-03T09:00:00.000Z", "2026-11-03T09:15:00.000Z"]));
  const settings = { shopType: "barber" as const, leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 };
  const both = await saveSetup(shop.scope, { settings, services: [{ id: shop.serviceId, name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }], staff: [{ id: shop.staffId, name: "Lena", workingHours: allWeek() }, { name: "Max", workingHours: allWeek() }] });
  const max = both.staff[1].id;
  expect(await code(book({ token, serviceId: shop.serviceId, staffId: max, start, customerName: "Mia", idempotencyKey: randomUUID() }, now))).toBe("OWN_OVERLAP");
});

it("closing the card forgets its devices, releases open appointments and erases the booking name and phone", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia Muster", customerPhone: "+49 170 0000000", idempotencyKey: randomUUID() }, now);
  await pool.query("INSERT INTO booking_push_subscriptions (tenant_id, membership_id, endpoint, p256dh, auth) VALUES ($1, $2, 'https://push.example.test/device', 'synthetic-p256dh', 'synthetic-auth')", [shop.scope.tenantId, shop.card.id]);
  await closeCard(shop.card.cardToken);
  expect((await pool.query("SELECT status, customer_name, customer_phone FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0]).toEqual({ status: "cancelled_by_customer", customer_name: "Karte geschlossen", customer_phone: null });
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_push_subscriptions WHERE membership_id = $1", [shop.card.id])).rows[0].n).toBe(0);
  const reminders = (await pool.query("SELECT status FROM outbox_jobs WHERE kind = 'booking.reminder' AND payload ->> 'appointmentId' = $1", [appointment.id])).rows;
  expect(reminders.length).toBeGreaterThan(0);
  expect(reminders.every(job => job.status === "suppressed")).toBe(true);
});

it("a block is never offered, lists the open appointments inside it, and cancels them only on request", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const { block, affected } = await createBlock({ ...shop.scope, start: new Date("2026-11-03T08:00:00Z"), end: new Date("2026-11-03T12:00:00Z"), reason: "Früher zu" });
  expect(affected.map(a => a.id)).toEqual([appointment.id]);
  expect(await code(book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-03T10:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID() }, now))).toBe("BLOCKED");
  expect(await cancelAffected({ ...shop.scope, blockId: block.id })).toEqual({ cancelled: 1 });
  expect((await pool.query("SELECT status, cancel_reason FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0]).toEqual({ status: "cancelled_by_shop", cancel_reason: "Geschäft geschlossen" });
});

it("set-up upserts by id, archives the missing, and refuses to archive staff with open appointments", async () => {
  const shop = await bookingShop();
  await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const body = { settings: { shopType: "barber" as const, leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 }, services: [{ id: shop.serviceId, name: "Haarschnitt", durationMin: 30, priceMinor: 2800 }], staff: [{ name: "Tom", workingHours: [] }] };
  const refused = await setupRoute(request("/api/merchant/booking/setup", { method: "PUT", body, cookie: shop.ownerCookie }));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "STAFF_HAS_APPOINTMENTS", staffId: shop.staffId, count: 1 });
  const saved = await saveSetup(shop.scope, { ...body, staff: [{ id: shop.staffId, name: "Lena", workingHours: [], serviceIds: [shop.serviceId] }, { name: "Tom", workingHours: [] }], services: [...body.services, { name: "Bart", durationMin: 15, priceMinor: 1200 }] });
  expect(saved.services.map(s => [s.name, s.priceMinor])).toEqual([["Haarschnitt", 2800], ["Bart", 1200]]);
  expect(saved.staff.map(s => [s.name, s.serviceIds])).toEqual([["Lena", [shop.serviceId]], ["Tom", []]]);
  const trimmed = await saveSetup(shop.scope, { ...body, staff: [{ id: shop.staffId, name: "Lena", workingHours: [] }] });
  expect(trimmed.services.map(s => s.name)).toEqual(["Haarschnitt"]);
  expect(trimmed.staff.map(s => s.name)).toEqual(["Lena"]);
});
