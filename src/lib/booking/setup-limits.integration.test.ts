import { expect, it } from "vitest";
import { pool } from "@/db";
import { GET as setupGet, PUT as setupPut } from "@/app/api/merchant/booking/setup/route";
import { randomUUID } from "node:crypto";
import { book, dayView } from "./appointments";
import { getSetup, outsideOpeningHours } from "./setup";
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

it("first-time set-up: a row from the operator's switch is not „set up“; the first save sets setup_done_at, later saves keep it", async () => {
  const shop = await bookingShop(), setup = await getSetup(shop.scope);
  await pool.query("UPDATE booking_settings SET setup_done_at = NULL WHERE location_id = $1", [shop.scope.locationId]);
  expect((await getSetup(shop.scope)).settings).toBeNull();
  expect((await save(shop.ownerCookie, await body(shop, setup.settings as never))).status).toBe(200);
  const first = (await pool.query("SELECT setup_done_at FROM booking_settings WHERE location_id = $1", [shop.scope.locationId])).rows[0].setup_done_at as Date;
  expect(first).toBeInstanceOf(Date);
  expect((await getSetup(shop.scope)).settings).not.toBeNull();
  expect((await save(shop.ownerCookie, await body(shop))).status).toBe(200);
  expect((await pool.query("SELECT setup_done_at FROM booking_settings WHERE location_id = $1", [shop.scope.locationId])).rows[0].setup_done_at).toEqual(first);
});

it("closing hours on a booked day: the save lists the appointment and the day view marks it; open hours list nothing", async () => {
  const shop = await bookingShop();
  const day = new Date(); day.setUTCDate(day.getUTCDate() + 2); day.setUTCHours(9, 0, 0, 0); // 10:00 Berlin
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: day, customerName: "Mia", idempotencyKey: randomUUID() });
  const weekday = ((day.getUTCDay() + 6) % 7) + 1;
  const all = [1, 2, 3, 4, 5, 6, 7].map(d => ({ weekday: d, start: "08:00", end: "20:00", breaks: [] }));
  const open = await save(shop.ownerCookie, await body(shop, { openingHours: all }));
  expect((await open.json()).outsideHours).toEqual([]);
  const closed = await save(shop.ownerCookie, await body(shop, { openingHours: all.filter(d => d.weekday !== weekday) }));
  expect(closed.status).toBe(200);
  expect((await closed.json()).outsideHours).toMatchObject([{ id: appointment.id, status: "confirmed", serviceName: "Haarschnitt", customerName: "Mia", timezone: "Europe/Berlin" }]);
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(day);
  expect((await dayView({ ...shop.scope, date })).appointments).toMatchObject([{ id: appointment.id, outsideHours: true }]);
});

it("outsideOpeningHours: inside, across the end, on a closed day, and with no hours stored", () => {
  const hours = [{ weekday: 1, start: "09:00", end: "18:00", breaks: [] }];
  const monday10 = new Date("2026-11-23T09:00:00Z"); // Monday 10:00 Berlin
  expect(outsideOpeningHours(monday10, 30, "Europe/Berlin", hours)).toBe(false);
  expect(outsideOpeningHours(new Date("2026-11-23T16:45:00Z"), 30, "Europe/Berlin", hours)).toBe(true); // 17:45 to 18:15
  expect(outsideOpeningHours(new Date("2026-11-24T09:00:00Z"), 30, "Europe/Berlin", hours)).toBe(true); // Tuesday
  expect(outsideOpeningHours(monday10, 30, "Europe/Berlin", null)).toBe(false);
});
