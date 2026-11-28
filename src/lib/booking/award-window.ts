import { sql, type SQL } from "drizzle-orm";

/**
 * The award belongs to the appointment when it lands between 30 minutes before the start (early arrivals) and 90 minutes
 * after the booked end (long services, paying afterwards); an earlier purchase on the same day is not the visit.
 * Imports nothing but drizzle, so the ledger core can use it without an import cycle.
 */
export const awardWindow = (at: string | SQL, alias: string) => {
  const t = typeof at === "string" ? sql`${at}::timestamptz` : at;
  return sql`lower(${sql.raw(alias)}.during) <= ${t} + interval '30 minutes' AND upper(${sql.raw(alias)}.during) >= ${t} - interval '90 minutes'`;
};

/** When a ledger entry's visit happened: the till's time for an offline award (its sync is later), else when the server
 *  booked it. An online award's device_at is only the client's clock and never decides the visit (F-1b). */
export const visitAt = (alias: string) => sql.raw(`(CASE WHEN ${alias}.source = 'staff_offline' AND ${alias}.device_at IS NOT NULL THEN ${alias}.device_at ELSE ${alias}.created_at END)`);
