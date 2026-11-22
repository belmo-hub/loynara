import { sql, type SQL } from "drizzle-orm";

/**
 * The award belongs to the appointment when it lands between 30 minutes before the start (early arrivals) and 90 minutes
 * after the booked end (long services, paying afterwards); an earlier purchase on the same day is not the visit.
 * No imports beyond drizzle, so the ledger core can use it without a cycle.
 */
export const awardWindow = (at: string | SQL, alias: string) => {
  const t = typeof at === "string" ? sql`${at}::timestamptz` : at;
  return sql`lower(${sql.raw(alias)}.during) <= ${t} + interval '30 minutes' AND upper(${sql.raw(alias)}.during) >= ${t} - interval '90 minutes'`;
};

/** When a ledger entry's visit happened: the till's time for an offline award, else when the server booked it. */
export const visitAt = (alias: string) => sql.raw(`coalesce(${alias}.device_at, ${alias}.created_at)`);
