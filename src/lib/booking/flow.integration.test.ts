import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { PUT as setupRoute } from "@/app/api/merchant/booking/setup/route";
import { GET as slotsRoute } from "@/app/api/card/[token]/booking/slots/route";
import { closeCard } from "@/lib/card-lifecycle";
import { book, cancelAffected, cancelByCustomer, cardView, createBlock, customerSlots, reschedule, transition } from "./appointments";
import { acceptStaffInvite, createStaffInvite } from "@/lib/staff";
import { saveSetup } from "./setup";
import { allWeek, bookingShop, dayOf, futureStart, identity, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();
// Seven days ahead: the set-up and closure paths compare with the database clock, so these dates must stay in the future.
const start = futureStart(), now = new Date(start.getTime() - 27 * 3_600_000);
const at = (hours: number) => new Date(start.getTime() + hours * 3_600_000);
const code = (promise: Promise<unknown>) => promise.then(() => "OK", (error: { code?: string }) => error.code);

it("reschedules inside the rules, keeps the status, and cancels late with the flag", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  expect(appointment.status).toBe("requested");
  const token = shop.card.cardToken, id = appointment.id;
  const moved = await reschedule({ token, appointmentId: id, start: at(1) }, now);
  expect(moved).toMatchObject({ status: "requested", start: at(1).toISOString(), rescheduleCount: 1 });
  expect(await reschedule({ token, appointmentId: id, start: at(1) }, now)).toMatchObject({ rescheduleCount: 1 });
  await reschedule({ token, appointmentId: id, start: at(2) }, now);
  expect(await code(reschedule({ token, appointmentId: id, start: at(3) }, now))).toBe("RESCHEDULE_LIMIT");
  expect(await code(reschedule({ token, appointmentId: id, start: at(3) }, at(-21)))).toBe("TOO_LATE");
  const cancelled = await cancelByCustomer({ token, appointmentId: id }, at(-21));
  expect(cancelled).toMatchObject({ status: "cancelled_by_customer", lateCancel: true, canCancel: false });
  expect(await cardView(token, now)).toMatchObject({ enabled: true, blocked: false, upcoming: [], past: [{ id, status: "cancelled_by_customer" }] });
});

it("after the start only the shop decides: the customer's cancel is refused and the view hides the button", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const later = new Date(start.getTime() + 5 * 60_000);
  expect(await code(cancelByCustomer({ token: shop.card.cardToken, appointmentId: appointment.id }, later))).toBe("TOO_LATE");
  expect((await cardView(shop.card.cardToken, later)).upcoming).toMatchObject([{ id: appointment.id, status: "confirmed", canCancel: false }]);
});

it("the monthly move limit counts the moves of that month only; a shop without online moves hides the option", async () => {
  const shop = await bookingShop();
  const token = shop.card.cardToken;
  // Two moves last month, then a touch of that row this month (as a confirm or a shop move would): this month still has no move.
  const real = new Date(), last = new Date(Date.UTC(real.getUTCFullYear(), real.getUTCMonth() - 1, 10, 6));
  const at = (hour: number) => new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth(), 11, hour));
  const { appointment } = await book({ token, serviceId: shop.serviceId, start: at(9), customerName: "Mia", idempotencyKey: randomUUID() }, last);
  await reschedule({ token, appointmentId: appointment.id, start: at(10) }, last);
  await reschedule({ token, appointmentId: appointment.id, start: at(11) }, last);
  expect(await code(reschedule({ token, appointmentId: appointment.id, start: at(12) }, last))).toBe("RESCHEDULE_LIMIT");
  await pool.query("UPDATE booking_appointments SET updated_at = now() WHERE id = $1", [appointment.id]);
  const soon = new Date(Math.ceil((real.getTime() + 3 * 86_400_000) / 3_600_000) * 3_600_000);
  const next = (await book({ token, serviceId: shop.serviceId, start: soon, customerName: "Mia", idempotencyKey: randomUUID() }, real)).appointment;
  expect(await reschedule({ token, appointmentId: next.id, start: new Date(soon.getTime() + 3_600_000) }, real)).toMatchObject({ rescheduleCount: 1 });
  await pool.query("UPDATE booking_settings SET max_reschedules_per_month = 0 WHERE tenant_id = $1", [shop.scope.tenantId]);
  expect((await cardView(token, real)).upcoming).toMatchObject([{ id: next.id, canReschedule: false }]);
  expect(await code(reschedule({ token, appointmentId: next.id, start: new Date(soon.getTime() + 7_200_000) }, real))).toBe("RESCHEDULE_LIMIT");
});

it("a move sees its own time as free; one card cannot hold two appointments at once even with two staff members", async () => {
  const shop = await bookingShop();
  const token = shop.card.cardToken;
  const { appointment } = await book({ token, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const starts = async (appointmentId?: string) => (await customerSlots(token, { serviceId: shop.serviceId, from: dayOf(start), days: 1, appointmentId }, now)).days[0].slots.map(s => s.start);
  expect(await starts()).not.toContain(at(0.25).toISOString());
  expect(await starts(appointment.id)).toEqual(expect.arrayContaining([start.toISOString(), at(0.25).toISOString()]));
  // The route takes the appointment id and refuses anything that is not one.
  const slotsPath = (appointmentId: string) => `/api/card/${token}/booking/slots?serviceId=${shop.serviceId}&from=${dayOf(start)}&days=1&appointmentId=${appointmentId}`;
  expect((await slotsRoute(request(slotsPath(appointment.id)), { params: Promise.resolve({ token }) })).status).toBe(200);
  expect((await slotsRoute(request(slotsPath("nope")), { params: Promise.resolve({ token }) })).status).toBe(400);
  const settings = { shopType: "barber" as const, leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 };
  const both = await saveSetup(shop.scope, { settings, services: [{ id: shop.serviceId, name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }], staff: [{ id: shop.staffId, name: "Lena", workingHours: allWeek() }, { name: "Max", workingHours: allWeek() }] });
  const max = both.staff[1].id;
  expect(await code(book({ token, serviceId: shop.serviceId, staffId: max, start, customerName: "Mia", idempotencyKey: randomUUID() }, now))).toBe("OWN_OVERLAP");
});

it("closing the card forgets its devices, releases open appointments and erases the booking name and phone", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia Muster", customerPhone: "+49 170 0000000", idempotencyKey: randomUUID() }, now);
  // One under way right now (15 minutes ago, on the grid): the shop finishes it, without a credit.
  const quarter = Math.floor(Date.now() / 900_000) * 900_000;
  const running = (await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date(quarter - 900_000), customerName: "Mia Muster", idempotencyKey: randomUUID() }, new Date(quarter - 86_400_000))).appointment;
  await pool.query("INSERT INTO booking_push_subscriptions (tenant_id, membership_id, endpoint, p256dh, auth) VALUES ($1, $2, 'https://push.example.test/device', 'synthetic-p256dh', 'synthetic-auth')", [shop.scope.tenantId, shop.card.id]);
  await closeCard(shop.card.cardToken);
  expect((await pool.query("SELECT status, customer_name, customer_phone FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0]).toEqual({ status: "cancelled_by_customer", customer_name: "Karte geschlossen", customer_phone: null });
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_push_subscriptions WHERE membership_id = $1", [shop.card.id])).rows[0].n).toBe(0);
  const reminders = (await pool.query("SELECT status FROM outbox_jobs WHERE kind = 'booking.reminder' AND payload ->> 'appointmentId' = $1", [appointment.id])).rows;
  expect(reminders.length).toBeGreaterThan(0);
  expect(reminders.every(job => job.status === "suppressed")).toBe(true);
  expect((await pool.query("SELECT status, customer_name FROM booking_appointments WHERE id = $1", [running.id])).rows[0]).toEqual({ status: "confirmed", customer_name: "Karte geschlossen" });
  const finished = await transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: running.id, to: "done", expected: "confirmed" });
  expect(finished).toMatchObject({ status: "done" });
  expect(finished).not.toHaveProperty("doneAward");
});

it("a block is never offered, lists the open appointments inside it, and cancels them only on request", async () => {
  const shop = await bookingShop();
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const { block, affected } = await createBlock({ ...shop.scope, start: at(-1), end: at(3), reason: "Früher zu" });
  expect(affected.map(a => a.id)).toEqual([appointment.id]);
  expect(await code(book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: at(1), customerName: "Mia", idempotencyKey: randomUUID() }, now))).toBe("BLOCKED");
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
  // A staff row links only to this shop's logins.
  expect((await saveSetup(shop.scope, { ...body, staff: [{ id: shop.staffId, name: "Lena", userId: shop.owner.userId, workingHours: [] }] })).staff[0].userId).toBe(shop.owner.userId);
  expect(await code(saveSetup(shop.scope, { ...body, staff: [{ id: shop.staffId, name: "Lena", userId: randomUUID(), workingHours: [] }] }))).toBe("INVALID_STAFF_USER");
  // A former team member keeps their link, so an old link never blocks a save.
  const former = await identity();
  const invite = await createStaffInvite({ actorUserId: shop.owner.userId, locationId: shop.merchant.locationId, email: former.email, role: "cashier" });
  await acceptStaffInvite({ userId: former.userId, token: invite.token });
  await pool.query("UPDATE staff_roles SET active = false WHERE user_id = $1", [former.userId]);
  expect((await saveSetup(shop.scope, { ...body, staff: [{ id: shop.staffId, name: "Lena", userId: former.userId, workingHours: [] }] })).staff[0].userId).toBe(former.userId);
});
