import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { db, pool } from "@/db";
import { POST as transitionRoute } from "@/app/api/merchant/booking/appointments/[id]/transition/route";
import { award, awardInTransaction } from "@/lib/loyalty";
import { enroll } from "@/lib/product";
import { acceptStaffInvite, createStaffInvite } from "@/lib/staff";
import { book, completeAppointmentForAward, reschedule, transition } from "./appointments";
import { bookingShop, identity, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();
const code = (promise: Promise<unknown>) => promise.then(() => "OK", (error: { code?: string }) => error.code);
const balance = async (id: string) => (await pool.query("SELECT balance FROM memberships WHERE id = $1", [id])).rows[0].balance as number;
const awards = async (id: string) => (await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE membership_id = $1 AND kind = 'award'", [id])).rows[0].n as number;
// The current quarter hour: an appointment that is running now, booked a day earlier.
const quarterNow = () => new Date(Math.floor(Date.now() / 900_000) * 900_000);
const bookAt = (shop: Awaited<ReturnType<typeof bookingShop>>, token: string, start: Date) =>
  book({ token, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, new Date(start.getTime() - 86_400_000)).then(r => r.appointment);

it("done awards one stamp once; a second attempt is STALE; the cashier role cannot transition", async () => {
  const shop = await bookingShop();
  const appointment = await bookAt(shop, shop.card.cardToken, quarterNow());
  const path = `/api/merchant/booking/appointments/${appointment.id}/transition`, params = { params: Promise.resolve({ id: appointment.id }) };

  const cashier = await identity();
  const invite = await createStaffInvite({ actorUserId: shop.owner.userId, locationId: shop.merchant.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.userId, token: invite.token });
  const refused = await transitionRoute(request(path, { body: { to: "done", expected: "confirmed" }, cookie: cashier.cookie }), params);
  expect(refused.status).toBe(403);

  const before = await balance(shop.card.id);
  const done = await transitionRoute(request(path, { body: { to: "done", expected: "confirmed" }, cookie: shop.ownerCookie }), params);
  expect(done.status).toBe(200);
  expect(await done.json()).toMatchObject({ id: appointment.id, status: "done", doneAward: { creditedQuantity: 1 } });
  expect(await balance(shop.card.id)).toBe(before + 1);

  const again = await transitionRoute(request(path, { body: { to: "done", expected: "confirmed" }, cookie: shop.ownerCookie }), params);
  expect(again.status).toBe(409);
  expect(await again.json()).toMatchObject({ code: "STALE" });
  // A replay of the ledger key (a retry after a crash) is a duplicate, never a second stamp.
  const replay = await db.transaction(tx => awardInTransaction(tx, { userId: shop.owner.userId, locationId: shop.merchant.locationId, membershipId: shop.card.id, quantity: 1, idempotencyKey: `booking:${appointment.id}`, requestId: randomUUID() }));
  expect(replay.duplicate).toBe(true);
  expect((await pool.query("SELECT count(*)::int AS n FROM ledger_entries WHERE idempotency_key = $1", [`booking:${appointment.id}`])).rows[0].n).toBe(1);
  expect(await awards(shop.card.id)).toBe(1);
  expect(await balance(shop.card.id)).toBe(before + 1);
  expect((await pool.query("SELECT done_ledger_entry_id IS NOT NULL AS linked FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0].linked).toBe(true);
});

it("a purchase programme credits only the amount the team typed at the newest rule version; none, or too little for a point, completes without a credit", async () => {
  const shop = await bookingShop({ programType: "points" });
  const now = new Date("2026-11-02T06:00:00Z"), at = (s: string) => new Date(s);
  const other = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const booked = async (token: string, start: string) => (await book({ token, serviceId: shop.serviceId, start: at(start), customerName: "Mia", idempotencyKey: randomUUID() }, now)).appointment.id;
  const [untyped, typed, tiny] = [await booked(shop.card.cardToken, "2026-11-03T09:00:00Z"), await booked(shop.card.cardToken, "2026-11-04T09:00:00Z"), await booked(other.cardToken, "2026-11-05T09:00:00Z")];
  const done = (appointmentId: string, start: string, extra: { purchaseAmountMinor?: number } = {}) => transition({ ...shop.scope, userId: shop.owner.userId, appointmentId, to: "done", expected: "confirmed", ...extra }, at(start));
  expect(await done(untyped, "2026-11-03T09:00:00Z")).not.toHaveProperty("doneAward");
  expect(await done(typed, "2026-11-04T09:00:00Z", { purchaseAmountMinor: 2500 })).toMatchObject({ status: "done", doneAward: { creditedQuantity: 75 } });
  expect(await done(tiny, "2026-11-05T09:00:00Z", { purchaseAmountMinor: 20 })).toMatchObject({ status: "done" });
  expect((await pool.query("SELECT status, done_ledger_entry_id IS NOT NULL AS credited FROM booking_appointments ORDER BY lower(during)")).rows).toEqual([{ status: "done", credited: false }, { status: "done", credited: true }, { status: "done", credited: false }]);
  expect((await pool.query("SELECT amount_minor FROM purchase_awards WHERE tenant_id = $1", [shop.merchant.tenantId])).rows).toEqual([{ amount_minor: 2500 }]);
  expect(await balance(shop.card.id)).toBe(75);
});

it("the cashier award completes the appointment from 30 minutes before the start to 90 minutes after the booked end, not outside", async () => {
  const shop = await bookingShop();
  // Offsets of the start from the current quarter hour; the booked length is 30 minutes.
  for (const [offsetMin, completes] of [[15, true], [60, false], [-105, true], [-150, false]] as const) {
    const card = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
    const appointment = await bookAt(shop, card.cardToken, new Date(quarterNow().getTime() + offsetMin * 60_000));
    const entry = await award({ userId: shop.owner.userId, locationId: shop.merchant.locationId, membershipId: card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
    expect([offsetMin, await completeAppointmentForAward(entry.entryId)]).toEqual([offsetMin, completes ? appointment.id : null]);
  }
});

it("refuses done before the start and blocks the card after the third no-show", async () => {
  const shop = await bookingShop();
  const now = new Date("2026-11-02T06:00:00Z");
  const starts = ["2026-11-03T09:00:00Z", "2026-11-04T09:00:00Z", "2026-11-05T09:00:00Z"].map(s => new Date(s));
  const kept = (await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-07T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID() }, now)).appointment;
  for (const [i, start] of starts.entries()) {
    const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
    if (i === 0) expect(await code(transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: appointment.id, to: "done", expected: "confirmed" }, now))).toBe("TOO_EARLY");
    expect((await pool.query("SELECT count(*)::int AS n FROM booking_blocked_customers WHERE membership_id = $1", [shop.card.id])).rows[0].n).toBe(0);
    await transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: appointment.id, to: "no_show", expected: "confirmed" }, start);
  }
  expect((await pool.query("SELECT reason FROM booking_blocked_customers WHERE membership_id = $1", [shop.card.id])).rows).toEqual([{ reason: "Nicht erschienen" }]);
  expect(await code(book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-06T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID() }, now))).toBe("BLOCKED_CUSTOMER");
  // The kept appointment stays, but a paused card cannot move it either.
  expect(await code(reschedule({ token: shop.card.cardToken, appointmentId: kept.id, start: new Date("2026-11-07T10:00:00Z") }, now))).toBe("BLOCKED_CUSTOMER");
});

it("the tap path marks the matching appointment done without a second award; the owner's done is then STALE", async () => {
  const shop = await bookingShop();
  const other = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const appointment = await bookAt(shop, shop.card.cardToken, quarterNow());
  const otherCard = await bookAt(shop, other.cardToken, new Date(quarterNow().getTime() + 30 * 60_000));
  const entry = await award({ userId: shop.owner.userId, locationId: shop.merchant.locationId, membershipId: shop.card.id, quantity: 1, idempotencyKey: randomUUID(), requestId: randomUUID() });
  expect(await completeAppointmentForAward(entry.entryId)).toBe(appointment.id);
  expect(await completeAppointmentForAward(entry.entryId)).toBeNull();
  const row = (await pool.query("SELECT status, done_ledger_entry_id FROM booking_appointments WHERE id = $1", [appointment.id])).rows[0];
  expect(row).toEqual({ status: "done", done_ledger_entry_id: entry.entryId });
  expect((await pool.query("SELECT status FROM booking_appointments WHERE id = $1", [otherCard.id])).rows[0].status).toBe("confirmed");
  expect(await code(transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: appointment.id, to: "done", expected: "confirmed" }))).toBe("STALE");
  expect(await awards(shop.card.id)).toBe(1);
});
