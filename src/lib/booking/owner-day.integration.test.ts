import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { POST as bookRoute } from "@/app/api/card/[token]/booking/appointments/route";
import { GET as dayRoute } from "@/app/api/merchant/booking/day/route";
import { GET as slotsRoute } from "@/app/api/merchant/booking/appointments/[id]/slots/route";
import { GET as blockedRoute } from "@/app/api/merchant/booking/customers/blocked/route";
import { acceptStaffInvite, createStaffInvite } from "@/lib/staff";
import { blockCustomer, book, move, transition, unblockCustomer } from "./appointments";
import { saveSetup } from "./setup";
import { allWeek, bookingShop, dayOf, futureStart, identity, origin, request, withBookingDatabase } from "./test-fixture";
import { instantToWall } from "./time";

withBookingDatabase();

it("the day view defaults to the shop's today; cashiers get 403; a card write from another origin is refused", async () => {
  const shop = await bookingShop();
  expect((await (await dayRoute(request("/api/merchant/booking/day", { cookie: shop.ownerCookie }))).json()).date).toBe(instantToWall(new Date(), "Europe/Berlin").date);
  const cashier = await identity();
  const invite = await createStaffInvite({ actorUserId: shop.owner.userId, locationId: shop.merchant.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.userId, token: invite.token });
  expect((await dayRoute(request("/api/merchant/booking/day", { cookie: cashier.cookie }))).status).toBe(403);
  const foreign = new Request(`${origin}/api/card/${shop.card.cardToken}/booking/appointments`, { method: "POST", headers: { "content-type": "application/json", origin: "https://other.example" },
    body: JSON.stringify({ serviceId: shop.serviceId, start: "2026-11-03T09:00:00.000Z", customerName: "Mia", idempotencyKey: randomUUID() }) });
  expect((await bookRoute(foreign, { params: Promise.resolve({ token: shop.card.cardToken }) })).status).toBe(403);
});

it("owner slots offer the appointment's own start and skip other bookings; the day view carries timezone and paused cards; a cancel keeps its reason", async () => {
  const shop = await bookingShop();
  // The slots route reads the real clock, so the day must lie ahead.
  const start = futureStart(), now = new Date(start.getTime() - 27 * 3_600_000);
  const mine = (await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now)).appointment;
  const path = `/api/merchant/booking/appointments/${mine.id}/slots?date=${dayOf(start)}`;
  const slots = await (await slotsRoute(request(path, { cookie: shop.ownerCookie }), { params: Promise.resolve({ id: mine.id }) })).json();
  const starts = slots.slots.map((s: { start: string }) => s.start);
  expect(starts).toContain(start.toISOString());
  expect(starts).toContain(new Date(start.getTime() + 1_800_000).toISOString());

  await blockCustomer({ ...shop.scope, membershipId: shop.card.id, userId: shop.owner.userId });
  const day = await (await dayRoute(request(`/api/merchant/booking/day?date=${dayOf(start)}`, { cookie: shop.ownerCookie }))).json();
  expect(day).toMatchObject({ timezone: "Europe/Berlin", blockedMembershipIds: [shop.card.id], appointments: [{ id: mine.id }] });

  await transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: mine.id, to: "cancelled_by_shop", expected: "confirmed", reason: "Krank" }, now);
  expect((await pool.query("SELECT cancel_reason FROM booking_appointments WHERE id = $1", [mine.id])).rows[0].cancel_reason).toBe("Krank");
});

it("owner slots cover every staff member who offers the service, and the owner hands the appointment to another one", async () => {
  const shop = await bookingShop();
  await saveSetup(shop.scope, {
    settings: { shopType: "barber", leadTimeMin: 120, maxDaysAhead: 42, cancelDeadlineHours: 24, maxReschedulesPerMonth: 2, autoConfirm: true, noShowBlockAfter: 3, maxOpenPerCard: 2 },
    services: [{ id: shop.serviceId, name: "Haarschnitt", durationMin: 30, priceMinor: 2500 }],
    staff: [{ id: shop.staffId, name: "Lena", workingHours: allWeek() }, { name: "Sara", workingHours: allWeek() }],
  });
  const start = futureStart(), now = new Date(start.getTime() - 27 * 3_600_000);
  const mine = (await book({ token: shop.card.cardToken, serviceId: shop.serviceId, staffId: shop.staffId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now)).appointment;
  const result = await (await slotsRoute(request(`/api/merchant/booking/appointments/${mine.id}/slots?date=${dayOf(start)}`, { cookie: shop.ownerCookie }), { params: Promise.resolve({ id: mine.id }) })).json();
  const sara = result.staff.find((s: { name: string }) => s.name === "Sara");
  expect(result.staff.map((s: { name: string }) => s.name)).toEqual(["Lena", "Sara"]);
  const at = result.slots.filter((s: { start: string }) => s.start === start.toISOString()).map((s: { staffId: string }) => s.staffId);
  expect(at).toEqual(expect.arrayContaining([shop.staffId, sara.id]));
  const moved = await move({ ...shop.scope, appointmentId: mine.id, start, staffId: sara.id }, now);
  expect(moved.staff).toEqual({ id: sara.id, name: "Sara" });
});

it("the blocked list names paused cards of this location; the day carries the next request's day and the booking switch", async () => {
  const shop = await bookingShop({ autoConfirm: false });
  const start = futureStart(), now = new Date(start.getTime() - 27 * 3_600_000);
  await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const day = await (await dayRoute(request("/api/merchant/booking/day", { cookie: shop.ownerCookie }))).json();
  expect(day).toMatchObject({ bookingEnabled: true, nextRequestDate: instantToWall(start, "Europe/Berlin").date, pendingRequests: 1 });

  const list = async (cookie: string) => blockedRoute(request("/api/merchant/booking/customers/blocked", { cookie }));
  expect((await (await list(shop.ownerCookie)).json()).customers).toEqual([]);
  await blockCustomer({ ...shop.scope, membershipId: shop.card.id, userId: shop.owner.userId, reason: "Nicht erschienen" });
  const [row] = (await (await list(shop.ownerCookie)).json()).customers;
  expect(row).toMatchObject({ membershipId: shop.card.id, name: "Mia", reason: "Nicht erschienen" });
  expect(row.cardLocator).toMatch(/^K-/);

  // Another shop's owner sees nothing of this one; a cashier gets 403.
  const other = await bookingShop();
  expect((await (await list(other.ownerCookie)).json()).customers).toEqual([]);
  const cashier = await identity();
  const invite = await createStaffInvite({ actorUserId: shop.owner.userId, locationId: shop.merchant.locationId, email: cashier.email, role: "cashier" });
  await acceptStaffInvite({ userId: cashier.userId, token: invite.token });
  expect((await list(cashier.cookie)).status).toBe(403);

  await unblockCustomer({ ...shop.scope, membershipId: shop.card.id });
  expect((await (await list(shop.ownerCookie)).json()).customers).toEqual([]);
});
