/** Fewer days than this left in the month when the owner cancels: the programme runs to the end of the next month. */
export const MIN_NOTICE_DAYS = 14;

/** The end date for a cancellation made now (Berlin calendar), and whether the notice period pushed it into the next month. */
export function cancellationEnd(now: Date): { endDate: string; nextMonth: boolean } {
  const endDate = lastDayOfBerlinMonth(now);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
  const left = Number(endDate.slice(8)) - Number(today.slice(8));
  if (left >= MIN_NOTICE_DAYS) return { endDate, nextMonth: false };
  // Two days after noon UTC on the last day is always inside the next month in Berlin.
  return { endDate: lastDayOfBerlinMonth(new Date(Date.parse(`${endDate}T12:00:00Z`) + 2 * 86_400_000)), nextMonth: true };
}

export function lastDayOfBerlinMonth(now: Date): string {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** "2026-10-31" → "31.10.2026". The day is a calendar day, so no zone conversion. */
export const germanDate = (isoDay: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDay}T00:00:00Z`));

/** Days after the confirmed end date during which the owner can still log in and download the export (pilot agreement § 6 (3)). */
export const EXPORT_DAYS_AFTER_END = 30;

const dayNumber = (isoDay: string) => Date.parse(`${isoDay}T00:00:00Z`) / 86_400_000;
export const addDays = (isoDay: string, days: number) => new Date(Date.parse(`${isoDay}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/**
 * Where a cancellation stands today (Berlin calendar): the end date is the last day the programme works, so on that day it
 * still runs ("last-day"); after it the end job ends the programme ("past").
 */
export function cancellationTimeline(endDate: string, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now);
  const daysLeft = dayNumber(endDate) - dayNumber(today);
  return { daysLeft, phase: daysLeft > 0 ? "running" as const : daysLeft === 0 ? "last-day" as const : "past" as const, exportUntil: addDays(endDate, EXPORT_DAYS_AFTER_END) };
}
