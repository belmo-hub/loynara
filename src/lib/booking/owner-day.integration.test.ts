import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { GET as dayRoute } from "@/app/api/merchant/booking/day/route";
import { GET as slotsRoute } from "@/app/api/merchant/booking/appointments/[id]/slots/route";
import { blockCustomer, book, transition } from "./appointments";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();

it("owner slots offer the appointment's own start and skip other bookings; the day view carries timezone and paused cards; a cancel keeps its reason", async () => {
  const shop = await bookingShop();
  const now = new Date("2026-11-02T06:00:00Z");
  const mine = (await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: new Date("2026-11-03T09:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID() }, now)).appointment;
  const path = `/api/merchant/booking/appointments/${mine.id}/slots?date=2026-11-03`;
  const slots = await (await slotsRoute(request(path, { cookie: shop.ownerCookie }), { params: Promise.resolve({ id: mine.id }) })).json();
  const starts = slots.slots.map((s: { start: string }) => s.start);
  expect(starts).toContain("2026-11-03T09:00:00.000Z");
  expect(starts).toContain("2026-11-03T09:30:00.000Z");

  await blockCustomer({ ...shop.scope, membershipId: shop.card.id, userId: shop.owner.userId });
  const day = await (await dayRoute(request("/api/merchant/booking/day?date=2026-11-03", { cookie: shop.ownerCookie }))).json();
  expect(day).toMatchObject({ timezone: "Europe/Berlin", blockedMembershipIds: [shop.card.id], appointments: [{ id: mine.id }] });

  await transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: mine.id, to: "cancelled_by_shop", expected: "confirmed", reason: "Krank" }, now);
  expect((await pool.query("SELECT cancel_reason FROM booking_appointments WHERE id = $1", [mine.id])).rows[0].cancel_reason).toBe("Krank");
});
