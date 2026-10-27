import { sql } from "drizzle-orm";
import { db } from "@/db";
import { awardWindow, completeAppointmentForAward } from "./appointments";
import { instantToWall } from "./time";

/** After a staff award: marks the card's matching appointment done. Booking must never fail or slow down an award. */
export async function completeAfterAward(entryId: string | null | undefined) {
  if (!entryId) return;
  await completeAppointmentForAward(entryId).catch(error => console.error("Booking completion after award failed", error instanceof Error ? error.name : "unknown"));
}

/** For each pending tap: the card's open appointment at that location inside the award window around now, its start as HH:MM in the location's timezone. */
export async function appointmentsForTaps(locationId: string, tapIds: string[], now = new Date()) {
  const found = new Map<string, { start: string; startLabel: string; serviceName: string }>();
  if (!tapIds.length) return found;
  try {
    const at = now.toISOString();
    const { rows } = await db.execute<{ tap_id: string; start: Date | string; service_name: string; timezone: string }>(sql`
      SELECT t.id AS tap_id, a.start, s.name AS service_name, l.timezone FROM tap_requests t
      CROSS JOIN LATERAL (
        SELECT b.tenant_id, b.service_id, lower(b.during) AS start FROM booking_appointments b
        WHERE b.tenant_id = t.tenant_id AND b.location_id = t.location_id AND b.membership_id = t.membership_id AND b.status IN ('requested','confirmed')
          AND ${awardWindow(at, "b")}
        ORDER BY abs(extract(epoch FROM lower(b.during) - ${at}::timestamptz)) LIMIT 1) a
      JOIN booking_services s ON s.tenant_id = a.tenant_id AND s.id = a.service_id
      JOIN locations l ON l.tenant_id = t.tenant_id AND l.id = t.location_id
      WHERE t.location_id = ${locationId}::uuid AND t.id IN (${sql.join(tapIds.map(id => sql`${id}::uuid`), sql`, `)})`);
    for (const row of rows) found.set(row.tap_id, { start: new Date(row.start).toISOString(), startLabel: instantToWall(new Date(row.start), row.timezone).time, serviceName: row.service_name });
  } catch (error) {
    // The pending list is the cashier's live queue; without the appointment line it still works.
    console.error("Booking lookup for pending taps failed", error instanceof Error ? error.name : "unknown");
  }
  return found;
}
