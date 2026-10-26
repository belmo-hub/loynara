import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { GET as dayRoute } from "@/app/api/merchant/booking/day/route";
import { POST as transitionRoute } from "@/app/api/merchant/booking/appointments/[id]/transition/route";
import { selectionCookieName } from "@/lib/locations";
import { blockCustomer, book, cancelAffected, move, transition } from "./appointments";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();
const now = new Date("2026-11-02T06:00:00Z"), start = new Date("2026-11-03T09:00:00Z");
const code = (promise: Promise<unknown>) => promise.then(() => "OK", (error: { code?: string }) => error.code);

it("another shop's owner cannot see, move or finish an appointment, and a card cannot book at another shop", async () => {
  const a = await bookingShop(), b = await bookingShop();
  const { appointment } = await book({ token: a.card.cardToken, serviceId: a.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);

  const transitionB = await transitionRoute(request(`/api/merchant/booking/appointments/${appointment.id}/transition`, { body: { to: "cancelled_by_shop", expected: "confirmed" }, cookie: b.ownerCookie }), { params: Promise.resolve({ id: appointment.id }) });
  expect(transitionB.status).toBe(404);
  expect(await code(transition({ ...b.scope, userId: b.owner.userId, appointmentId: appointment.id, to: "done", expected: "confirmed" }, start))).toBe("NOT_FOUND");
  expect(await code(move({ ...b.scope, appointmentId: appointment.id, start: new Date("2026-11-03T10:00:00Z"), staffId: b.staffId }, now))).toBe("NOT_FOUND");
  expect(await code(blockCustomer({ ...b.scope, membershipId: a.card.id, userId: b.owner.userId }))).toBe("NOT_FOUND");
  expect(await code(cancelAffected({ ...b.scope, blockId: randomUUID() }))).toBe("NOT_FOUND");

  // B's own day view never lists A's appointment; pointing B's location cookie at A's location is not found.
  const ownDay = await dayRoute(request("/api/merchant/booking/day?date=2026-11-03", { cookie: b.ownerCookie }));
  expect(ownDay.status).toBe(200);
  expect((await ownDay.json()).appointments).toEqual([]);
  const foreignDay = await dayRoute(request("/api/merchant/booking/day?date=2026-11-03", { cookie: `${b.owner.cookie}; ${selectionCookieName(b.owner.userId)}=${a.merchant.locationId}` }));
  expect(foreignDay.status).toBe(404);
  const aDay = await dayRoute(request("/api/merchant/booking/day?date=2026-11-03", { cookie: a.ownerCookie }));
  expect((await aDay.json()).appointments.map((x: { id: string }) => x.id)).toEqual([appointment.id]);

  expect(await code(book({ token: a.card.cardToken, serviceId: b.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now))).toBe("NOT_FOUND");
  expect(await code(book({ token: a.card.cardToken, serviceId: a.serviceId, staffId: b.staffId, start: new Date("2026-11-03T11:00:00Z"), customerName: "Mia", idempotencyKey: randomUUID() }, now))).toBe("NOT_FOUND");
});
