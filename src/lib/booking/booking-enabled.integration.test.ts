import { expect, it } from "vitest";
import { pool } from "@/db";
import { GET as meRoute } from "@/app/api/me/route";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

// Design blocker 3 (22 Nov): every booking surface hides unless the operator switched booking on at the location.
withBookingDatabase();
const me = async (cookie: string) => (await meRoute(request("/api/me", { cookie }))).json() as Promise<{ bookingEnabled?: boolean }>;

it("/api/me says whether booking is on at the location: on, off, and no settings row at all", async () => {
  const shop = await bookingShop();
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: true });
  await pool.query("UPDATE booking_settings SET enabled = false WHERE location_id = $1", [shop.scope.locationId]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false });
  await pool.query("DELETE FROM booking_settings WHERE location_id = $1", [shop.scope.locationId]);
  expect(await me(shop.ownerCookie)).toMatchObject({ bookingEnabled: false });
});
