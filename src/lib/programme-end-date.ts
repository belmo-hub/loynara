export function lastDayOfBerlinMonth(now: Date): string {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now).split("-").map(Number);
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

/** "2026-10-31" → "31.10.2026". The day is a calendar day, so no zone conversion. */
export const germanDate = (isoDay: string) => new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${isoDay}T00:00:00Z`));
