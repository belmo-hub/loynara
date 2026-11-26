import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { book } from "./appointments";
import { CLEARED_BOOKING_NAME, clearOldBookingContacts } from "./retention";
import { bookingShop, futureStart, withBookingDatabase } from "./test-fixture";

// ENG-371 (founder Q-114 a): name and phone go 12 months after the appointment; the row and its effects stay.
withBookingDatabase();

/** Fixed instants on both sides, so the test never depends on today's date. */
const NOW = new Date("2026-03-10T09:30:00.000Z");
const row = async (id: string) => (await pool.query("SELECT * FROM booking_appointments WHERE id = $1", [id])).rows[0];

async function bookAt(shop: Awaited<ReturnType<typeof bookingShop>>, during: string, extra: { name?: string; phone?: string | null; status?: string } = {}) {
  // Booked through the real path, then moved into the past at once, which frees the slot for the next one.
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: futureStart(), customerName: extra.name ?? "Mia Muster", customerPhone: extra.phone === null ? undefined : extra.phone ?? "0561 123456", idempotencyKey: randomUUID() });
  await pool.query("UPDATE booking_appointments SET during = $2::tstzrange, status = $3::varchar, cancelled_at = CASE WHEN $3::varchar LIKE 'cancelled_%' THEN lower($2::tstzrange) END WHERE id = $1", [appointment.id, during, extra.status ?? "done"]);
  return appointment.id;
}

it("clears name and phone from appointments that ended 12 months ago or earlier, and leaves everything else on the row", async () => {
  const shop = await bookingShop();
  const atBoundary = await bookAt(shop, "[2025-03-10 09:00Z,2025-03-10 09:30Z)");
  const older = await bookAt(shop, "[2024-06-01 10:00Z,2024-06-01 10:45Z)", { status: "no_show" });
  const nameOnly = await bookAt(shop, "[2024-07-01 10:00Z,2024-07-01 10:30Z)", { phone: null, status: "cancelled_by_customer" });
  const justInside = await bookAt(shop, "[2025-03-10 09:00Z,2025-03-10 09:31Z)");
  const before = await row(atBoundary);

  expect(await clearOldBookingContacts(NOW)).toBe(3);
  for (const id of [atBoundary, older, nameOnly]) expect(await row(id)).toMatchObject({ customer_name: CLEARED_BOOKING_NAME, customer_phone: null });
  expect(await row(justInside)).toMatchObject({ customer_name: "Mia Muster", customer_phone: "0561 123456" });
  // Only the contact fields change: status, time, service, staff, membership and the ledger link stay as they were.
  const rest = (r: Record<string, unknown>) => Object.fromEntries(Object.entries(r).filter(([key]) => !["customer_name", "customer_phone", "updated_at"].includes(key)));
  expect(rest(await row(atBoundary))).toEqual(rest(before));
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_appointments WHERE tenant_id = $1", [shop.scope.tenantId])).rows[0].n).toBe(4);
});

it("is idempotent, never touches a future appointment, and leaves a card closure's „Karte geschlossen“ as it is", async () => {
  const shop = await bookingShop();
  const old = await bookAt(shop, "[2024-01-05 09:00Z,2024-01-05 09:30Z)");
  const closed = await bookAt(shop, "[2024-02-05 09:00Z,2024-02-05 09:30Z)", { name: "Karte geschlossen", phone: null });
  const start = futureStart();
  const { appointment: upcoming } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start, customerName: "Ali", customerPhone: "0170 555", idempotencyKey: randomUUID() });

  expect(await clearOldBookingContacts(NOW)).toBe(1);
  expect(await clearOldBookingContacts(NOW)).toBe(0);
  expect(await row(old)).toMatchObject({ customer_name: CLEARED_BOOKING_NAME, customer_phone: null });
  expect(await row(closed)).toMatchObject({ customer_name: "Karte geschlossen", customer_phone: null });
  // An appointment that has not ended 12 months before the clock keeps its contact.
  expect(await row(upcoming.id)).toMatchObject({ customer_name: "Ali", customer_phone: "0170 555" });
});
