import { expect, it } from "vitest";
import { pool } from "@/db";
import { GET as setupGet, PUT as setupPut } from "@/app/api/merchant/booking/setup/route";
import { getSetup } from "./setup";
import { bookingShop, identity, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();

/** The set-up as the wizard sends it back, with one rule changed. */
async function body(shop: Awaited<ReturnType<typeof bookingShop>>, settings: Record<string, unknown> = {}) {
  const setup = await getSetup(shop.scope);
  return { settings: { ...setup.settings, ...settings }, services: setup.services, staff: setup.staff.map(s => ({ id: s.id, name: s.name, workingHours: s.workingHours, serviceIds: s.serviceIds })) };
}
const save = (cookie: string, data: unknown) => setupPut(request("/api/merchant/booking/setup", { method: "PUT", body: data, cookie }));

it("a manager of the location reads the booking set-up but may not save it; the owner may (owner-only by design)", async () => {
  const shop = await bookingShop(), manager = await identity();
  await pool.query("INSERT INTO staff_roles (tenant_id, user_id, role, location_id) VALUES ($1, $2, 'manager', $3)", [shop.scope.tenantId, manager.userId, shop.scope.locationId]);
  expect((await setupGet(request("/api/merchant/booking/setup", { cookie: manager.cookie }))).status).toBe(200);
  const refused = await save(manager.cookie, await body(shop));
  expect(refused.status).toBe(403);
  expect(await refused.json()).toMatchObject({ code: "FORBIDDEN" });
  expect((await save(shop.ownerCookie, await body(shop))).status).toBe(200);
});

it("open bookings per card are capped at 2: the set-up refuses more, and so does the database", async () => {
  const shop = await bookingShop();
  expect((await save(shop.ownerCookie, await body(shop, { maxOpenPerCard: 3 }))).status).toBe(400);
  expect((await save(shop.ownerCookie, await body(shop, { maxOpenPerCard: 2 }))).status).toBe(200);
  await expect(pool.query("UPDATE booking_settings SET max_open_per_card = 3 WHERE location_id = $1", [shop.scope.locationId])).rejects.toThrow(/booking_settings_valid/);
});
