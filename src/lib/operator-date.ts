/** Tomorrow's calendar day in Berlin ("2026-10-22"): the earliest end date /operator accepts, so no confirmation ends a programme at once. */
export function earliestEndDate(now: Date): string {
  const [year, month, day] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Berlin" }).format(now).split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export const END_DATE_TOO_EARLY = "Das Enddatum muss mindestens morgen sein. Zum sofortigen Beenden nutze in der Konsole den Befehl „end“.";
