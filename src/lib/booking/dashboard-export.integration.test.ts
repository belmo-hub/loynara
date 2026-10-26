import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { pool } from "@/db";
import { formatCardLocator } from "@/lib/card-locator";
import { getCustomerExport, getMerchantCsv } from "@/lib/export";
import { getMerchantAnalytics } from "@/lib/merchant-analytics";
import { book, transition } from "./appointments";
import { bookingShop, withBookingDatabase } from "./test-fixture";

withBookingDatabase();
type Shop = Awaited<ReturnType<typeof bookingShop>>;
const DAY = 86_400_000;
const lines = (body: string) => body.replace(/^﻿/, "").trimEnd().split("\r\n");

/** Writes a row directly so each status lands at an exact start; the booking rules are covered by their own tests. */
async function seed(shop: Shop, start: Date, status: string, extra: { priceMinor?: number; lateCancel?: boolean; rebookSourceId?: string; phone?: string } = {}) {
  const cancelled = status.startsWith("cancelled_");
  const { rows } = await pool.query<{ id: string }>(`
    INSERT INTO booking_appointments (tenant_id, location_id, membership_id, service_id, staff_id, during, duration_min, price_minor, status, customer_name, customer_phone, idempotency_key, late_cancel, cancelled_at, rebook_source_id)
    VALUES ($1, $2, $3, $4, $5, tstzrange($6::timestamptz, $6::timestamptz + interval '30 minutes', '[)'), 30, $7, $8, 'Mia', $9, $10, $11, $12, $13) RETURNING id
  `, [shop.merchant.tenantId, shop.merchant.locationId, shop.card.id, shop.serviceId, shop.staffId, start, extra.priceMinor ?? 2500, status, extra.phone ?? null, randomUUID(), extra.lateCancel ?? false, cancelled ? start : null, extra.rebookSourceId ?? null]);
  return rows[0].id;
}

it("reports the Termin figures of the selected location, list prices apart from cashier-confirmed amounts", async () => {
  const shop = await bookingShop({ programType: "points" });
  const now = new Date(Math.floor(Date.now() / 900_000) * 900_000);
  // Done through the real transition: the points award stores the 25 € service price as the cashier amount.
  const doneStart = new Date(now.getTime() - 2 * DAY);
  const { appointment } = await book({ token: shop.card.cardToken, serviceId: shop.serviceId, start: doneStart, customerName: "Mia", idempotencyKey: randomUUID() }, new Date(doneStart.getTime() - DAY));
  await transition({ ...shop.scope, userId: shop.owner.userId, appointmentId: appointment.id, to: "done", expected: "confirmed" }, doneStart);
  await seed(shop, new Date(now.getTime() - 2 * DAY - 3_600_000), "done", { priceMinor: 4000 });
  await seed(shop, new Date(now.getTime() - 3 * DAY), "no_show");
  await seed(shop, new Date(now.getTime() - 4 * DAY), "cancelled_by_customer", { lateCancel: true });
  await seed(shop, new Date(now.getTime() - 5 * DAY), "cancelled_by_customer");
  await seed(shop, new Date(now.getTime() - 6 * DAY), "cancelled_by_shop");
  await seed(shop, new Date(now.getTime() - 40 * DAY), "done");
  await seed(shop, now, "confirmed"); // earlier today: counts for today, no longer upcoming
  await seed(shop, new Date(now.getTime() + 3 * DAY), "confirmed", { rebookSourceId: appointment.id });
  await seed(shop, new Date(now.getTime() + 8 * DAY), "requested");

  // The database clock after the rows were created (created_at is its now()); +1 ms because a JS Date drops the microseconds.
  const asOf = (await pool.query<{ t: Date }>("SELECT clock_timestamp() + interval '1 millisecond' AS t")).rows[0].t;
  const report = await getMerchantAnalytics(shop.owner.userId, { windowDays: 30, asOf, booking: { locationId: shop.merchant.locationId } });
  expect(report.booking).toEqual({ locationName: "Synthetic Barber", appointmentsToday: 1, done30: 2, noShow30: 1, total30: 4, rebooked30: 1, listPriceMinor30: 6500, confirmedMinor30: 2500, upcoming7: 1 });
  // No cookie: the oldest location, here the same one.
  expect((await getMerchantAnalytics(shop.owner.userId, { windowDays: 90, asOf, booking: { locationId: null } })).booking).toEqual(report.booking);
  expect((await getMerchantAnalytics(shop.owner.userId, { windowDays: 30, asOf })).booking).toBeUndefined();

  await pool.query("UPDATE booking_settings SET enabled = false WHERE tenant_id = $1", [shop.merchant.tenantId]);
  expect((await getMerchantAnalytics(shop.owner.userId, { windowDays: 30, asOf, booking: { locationId: shop.merchant.locationId } })).booking).toBeNull();
});

it("exports the location's appointments as Excel-ready CSV and puts them in the customer's own export", async () => {
  const shop = await bookingShop();
  const other = await bookingShop();
  await seed(other, new Date("2026-11-03T09:00:00Z"), "confirmed");
  await seed(shop, new Date("2026-11-02T09:00:00Z"), "done");
  const id = await seed(shop, new Date("2026-11-03T09:00:00Z"), "cancelled_by_customer", { lateCancel: true, phone: "+49 151 2345678" });
  const created = (await pool.query<{ createdAt: Date }>(`SELECT created_at AS "createdAt" FROM booking_appointments WHERE id = $1`, [id])).rows[0].createdAt;
  const { rows: [card] } = await pool.query<{ locator: string }>("SELECT card_locator AS locator FROM memberships WHERE id = $1", [shop.card.id]);

  const { filename, body } = await getMerchantCsv(shop.owner.userId, "appointments", shop.merchant.locationId);
  expect(filename).toMatch(/^loynara-appointments-\d{4}-\d{2}-\d{2}\.csv$/);
  const [header, ...rows] = lines(body);
  expect(header).toBe("Datum;Uhrzeit;Leistung;Team;Kunde;Telefon;Kartennummer;Status;Preis (Listenpreis, €);Dauer (Minuten);Erstellt am;Abgesagt am");
  expect(rows).toHaveLength(2);
  const createdDay = created.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric" });
  // Newest first, wall clock of the Berlin location (09:00 UTC = 10:00 CET); a leading + is neutralised like every text cell.
  expect(rows[0]).toBe(`03.11.2026;10:00;Haarschnitt;Lena;Mia;'+49 151 2345678;${formatCardLocator(card.locator)};Vom Kunden abgesagt (kurzfristig);25,00;30;${createdDay};03.11.2026`);
  expect(rows[1]).toMatch(/^02\.11\.2026;10:00;.*;Erledigt;25,00;30;.*;$/);

  const exported = await getCustomerExport(shop.card.cardToken);
  expect(exported.appointments).toEqual([
    { start: new Date("2026-11-02T09:00:00Z"), service: "Haarschnitt", staff: "Lena", status: "done", priceMinor: 2500, customerName: "Mia", customerPhone: null },
    { start: new Date("2026-11-03T09:00:00Z"), service: "Haarschnitt", staff: "Lena", status: "cancelled_by_customer", priceMinor: 2500, customerName: "Mia", customerPhone: "+49 151 2345678" },
  ]);
  // The customer's own name and phone belong in their data-access export; the card token never does.
  expect(JSON.stringify(exported)).not.toContain(shop.card.cardToken);
});
