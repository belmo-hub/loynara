import type { Pool } from "pg";
import { pool } from "@/db";

/** Founder Q-114 (a), 23 Nov: the name and phone typed when booking go 12 months after the appointment ended (ENG-371). */
export const BOOKING_CONTACT_RETENTION = "12 months";
/** What stays in place of the name, like „Karte geschlossen“ after a card closure: the views always have a line to show. */
export const CLEARED_BOOKING_NAME = "Name gelöscht";
export const BOOKING_CONTACT_PRUNE_INTERVAL_MS = 24 * 60 * 60_000;

/**
 * Clears name and phone on appointments that ended 12 months or more before `now`. The row itself stays (status, time,
 * service, its ledger link and no-show history), so stamps, points and the shop's statistics are untouched. Idempotent:
 * a cleared row (or one a card closure cleared) matches no more. `now` is passed in so tests run on a fixed clock.
 */
export async function clearOldBookingContacts(now: Date, queries: Pick<Pool, "query"> = pool): Promise<number> {
  // shortcut: at most 10,000 rows per run, in batches of 500; a larger backlog waits for the next daily run.
  let cleared = 0;
  for (let batch = 0; batch < 20; batch += 1) {
    const result = await queries.query(`
      UPDATE booking_appointments SET customer_name = $3, customer_phone = NULL, updated_at = now()
      WHERE id IN (
        SELECT id FROM booking_appointments
        WHERE upper(during) <= $1::timestamptz - $2::interval
          AND (customer_phone IS NOT NULL OR customer_name NOT IN ($3, 'Karte geschlossen'))
        ORDER BY upper(during)
        LIMIT 500
      )`, [now.toISOString(), BOOKING_CONTACT_RETENTION, CLEARED_BOOKING_NAME]);
    cleared += result.rowCount ?? 0;
    if ((result.rowCount ?? 0) < 500) break;
  }
  return cleared;
}
