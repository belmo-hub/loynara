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
