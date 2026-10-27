import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { POST as bookRoute } from "@/app/api/card/[token]/booking/appointments/route";
import { GET as dayRoute } from "@/app/api/merchant/booking/day/route";
import { GET as slotsRoute } from "@/app/api/merchant/booking/appointments/[id]/slots/route";
import { acceptStaffInvite, createStaffInvite } from "@/lib/staff";
import { blockCustomer, book, transition } from "./appointments";
import { bookingShop, dayOf, futureStart, identity, origin, request, withBookingDatabase } from "./test-fixture";
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
