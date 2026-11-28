import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { enroll } from "@/lib/product";
import { POST as bookRoute } from "@/app/api/card/[token]/booking/appointments/route";
import { book } from "./appointments";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

withBookingDatabase();

const now = new Date("2026-11-02T06:00:00Z"), start = new Date("2026-11-03T09:00:00Z");
const openRows = async (tenantId: string) => (await pool.query("SELECT id FROM booking_appointments WHERE tenant_id = $1 AND status IN ('requested','confirmed')", [tenantId])).rows;

it("50 concurrent bookings of one slot with different keys: one open row, 49 SLOT_TAKEN", async () => {
  const shop = await bookingShop();
  const results = await Promise.allSettled(Array.from({ length: 50 }, () => book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now)));
  expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter(r => r.status === "rejected").map(r => (r as PromiseRejectedResult).reason.code)).toEqual(Array(49).fill("SLOT_TAKEN"));
  expect(await openRows(shop.merchant.tenantId)).toHaveLength(1);
});

it("50 concurrent retries with the same key: one row, 49 duplicates", async () => {
  const shop = await bookingShop();
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 50 }, () => book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: key }, now)));
  expect(new Set(results.map(r => r.appointment.id)).size).toBe(1);
  expect(results.filter(r => r.duplicate)).toHaveLength(49);
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_appointments WHERE tenant_id = $1", [shop.merchant.tenantId])).rows[0].n).toBe(1);
});

it("the exclusion constraint refuses an overlapping open row that skipped the lock", async () => {
  const shop = await bookingShop();
  const first = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const insert = (key: string, status: string) => pool.query(`INSERT INTO booking_appointments (tenant_id, location_id, membership_id, service_id, staff_id, during, duration_min, price_minor, status, customer_name, idempotency_key, cancelled_at)
    SELECT tenant_id, location_id, membership_id, service_id, staff_id, tstzrange('2026-11-03T09:15:00Z', '2026-11-03T09:45:00Z', '[)'), 30, 2500, $2::text, 'Raw', $1, CASE WHEN $2::text LIKE 'cancelled_%' THEN now() END FROM booking_appointments WHERE id = $3`, [key, status, first.appointment.id]);
  await expect(insert(randomUUID(), "confirmed")).rejects.toMatchObject({ code: "23P01" });
  await expect(insert(randomUUID(), "cancelled_by_shop")).resolves.toBeDefined();
});

it("the route answers 201, then 409 SLOT_TAKEN with the next free start", async () => {
  const shop = await bookingShop();
  const other = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const slot = new Date(Date.now() + 3 * 86_400_000); slot.setUTCHours(9, 0, 0, 0);
  const body = { serviceId: shop.serviceId, start: slot.toISOString(), customerName: "Mia", idempotencyKey: randomUUID() };
  const created = await bookRoute(request(`/api/card/${shop.card.cardToken}/booking/appointments`, { body }), { params: Promise.resolve({ token: shop.card.cardToken }) });
  expect(created.status).toBe(201);
  expect(await created.json()).toMatchObject({ status: "confirmed", start: slot.toISOString(), durationMin: 30, priceMinor: 2500, service: { name: "Haarschnitt" }, staff: { name: "Lena" } });
  const taken = await bookRoute(request(`/api/card/${other.cardToken}/booking/appointments`, { body: { ...body, idempotencyKey: randomUUID() } }), { params: Promise.resolve({ token: other.cardToken }) });
  expect(taken.status).toBe(409);
  expect(await taken.json()).toMatchObject({ code: "SLOT_TAKEN", nextFree: new Date(slot.getTime() + 30 * 60_000).toISOString() });
});
