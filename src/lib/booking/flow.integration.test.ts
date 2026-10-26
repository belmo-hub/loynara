import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { PUT as setupRoute } from "@/app/api/merchant/booking/setup/route";
import { book, cancelAffected, cancelByCustomer, cardView, createBlock, reschedule } from "./appointments";
import { saveSetup } from "./setup";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

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
