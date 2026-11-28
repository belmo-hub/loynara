import { expect, it } from "vitest";
import { pool } from "@/db";
import { GET as meRoute } from "@/app/api/me/route";
import { randomUUID } from "node:crypto";
import { book } from "./appointments";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

// Design blocker 3 (22 Nov): every booking surface hides unless the operator switched booking on at the location.
withBookingDatabase();
const me = async (cookie: string) => (await meRoute(request("/api/me", { cookie }))).json() as Promise<{ bookingEnabled?: boolean; bookingShown?: boolean }>;

it("/api/me says whether booking is on at the location: on, off, and no settings row at all", async () => {
  const shop = await bookingShop();
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: true });
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false });
  await pool.query("DELETE FROM booking_settings WHERE location_id = $1", [shop.scope.locationId]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false });
});

it("switched off with an appointment still ahead, the day view stays (shown, read-only); once nothing is ahead it goes", async () => {
  const shop = await bookingShop();
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(9, 0, 0, 0);
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() });
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: true, bookingShown: true });
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false, bookingShown: true });
  await pool.query("UPDATE booking_appointments SET status = 'cancelled_by_shop', cancelled_at = now() WHERE id = $1", [appointment.id]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false, bookingShown: false });
});
