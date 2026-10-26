import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { enroll } from "@/lib/product";
import { book, customerSlots } from "./appointments";
import { allWeek, bookingShop, withBookingDatabase } from "./test-fixture";
import { wallToInstant } from "./time";

withBookingDatabase();
const now = new Date("2026-10-20T08:00:00Z");

it("stores Berlin wall time as the right instant across the 25 Oct 2026 clock change", async () => {
  const shop = await bookingShop({ workingHours: allWeek("09:00", "18:00") });
  const second = await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true });
  const sunday = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: wallToInstant("2026-10-25", "10:00", "Europe/Berlin")!, customerName: "Mia", idempotencyKey: randomUUID() }, now);
  const saturday = await book({ token: second.cardToken, serviceId: shop.serviceId, start: wallToInstant("2026-10-24", "10:00", "Europe/Berlin")!, customerName: "Ali", idempotencyKey: randomUUID() }, now);
  const stored = async (id: string) => (await pool.query("SELECT lower(during) AS start FROM booking_appointments WHERE id = $1", [id])).rows[0].start.toISOString();
  expect(await stored(sunday.appointment.id)).toBe("2026-10-25T09:00:00.000Z");
  expect(await stored(saturday.appointment.id)).toBe("2026-10-24T08:00:00.000Z");
  // A 24 h reminder is instant arithmetic: 25 wall hours across the change.
  expect(new Date(wallToInstant("2026-10-26", "10:00", "Europe/Berlin")!.getTime() - 24 * 3_600_000).toISOString()).toBe("2026-10-25T09:00:00.000Z");

  const { days } = await customerSlots(shop.card.cardToken, { serviceId: shop.serviceId, from: "2026-10-24", days: 2 }, now);
  expect(days.map(d => d.slots[0].start)).toEqual(["2026-10-24T07:00:00.000Z", "2026-10-25T08:00:00.000Z"]);
  expect(days.map(d => d.slots[d.slots.length - 1].start)).toEqual(["2026-10-24T15:30:00.000Z", "2026-10-25T16:30:00.000Z"]);
  expect(days[1].slots.map(s => s.start)).not.toContain("2026-10-25T09:00:00.000Z");
});
