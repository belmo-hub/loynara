import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { POST as bookRoute } from "@/app/api/card/[token]/booking/appointments/route";
import { TOO_MANY_BOOKINGS } from "@/components/booking/booking-format";
import { enroll } from "@/lib/product";
import { bookingShop, request, withBookingDatabase } from "./test-fixture";

// F-4 (CTO, 22 Nov): one peer fills at most 10 slots an hour at one shop, however many cards it holds.
withBookingDatabase();
const slot = (n: number) => { const d = new Date(Date.now() + 3 * 86_400_000); d.setUTCHours(6, 0, 0, 0); return new Date(d.getTime() + n * 30 * 60_000); };
const post = (token: string, serviceId: string, n: number) => bookRoute(request(`/api/card/${token}/booking/appointments`, { body: { serviceId, start: slot(n).toISOString(), customerName: "Mia", idempotencyKey: randomUUID() } }), { params: Promise.resolve({ token }) });

it("ten bookings an hour per peer and shop, then a German refusal with Retry-After; another shop is unaffected", async () => {
  await pool.query("DELETE FROM rate_limits");
  const shop = await bookingShop();
  const cards = [shop.card.cardToken, ...await Promise.all(Array.from({ length: 5 }, async () => (await enroll({ slug: shop.merchant.programSlug, acceptedTerms: true })).cardToken))];
  for (let n = 0; n < 10; n++) expect((await post(cards[Math.floor(n / 2)], shop.serviceId, n)).status).toBe(201);
  const refused = await post(cards[5], shop.serviceId, 10);
  expect(refused.status).toBe(429);
  expect(refused.headers.get("Retry-After")).toMatch(/^\d+$/);
  expect(await refused.json()).toMatchObject({ code: "TOO_MANY_BOOKINGS", error: TOO_MANY_BOOKINGS });
  expect((await pool.query("SELECT count(*)::int AS n FROM booking_appointments WHERE tenant_id = $1", [shop.scope.tenantId])).rows[0].n).toBe(10);
  const other = await bookingShop();
  expect((await post(other.card.cardToken, other.serviceId, 0)).status).toBe(201);
});
