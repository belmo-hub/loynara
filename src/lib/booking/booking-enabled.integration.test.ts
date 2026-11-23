import { expect, it } from "vitest";
import { pool } from "@/db";
import { GET as meRoute } from "@/app/api/me/route";
import { GET as exportRoute } from "@/app/api/merchant/export/route";
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

it("switched off, a location that had appointments keeps the day view and „Termine für Excel“, also once all are past (§ 3 (5))", async () => {
  const shop = await bookingShop();
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 2); start.setUTCHours(9, 0, 0, 0);
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() });
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: true, bookingShown: true });
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false, bookingShown: true });
  // Every appointment past (here: a year ago, finished): still shown, read-only, and the export answers with it.
  await pool.query("UPDATE booking_appointments SET during = tstzrange(now() - interval '1 year', now() - interval '1 year' + interval '30 minutes'), status = 'done' WHERE id = $1", [appointment.id]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false, bookingShown: true });
  const csv = await exportRoute(request("/api/merchant/export?format=appointments", { cookie: shop.ownerCookie }));
  expect(csv.status).toBe(200);
  expect(await csv.text()).toContain("Mia");
});
