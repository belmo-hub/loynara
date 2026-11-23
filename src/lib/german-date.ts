// One date helper for the owner pages (Design decision 6, 7 Nov). Three forms:
// short: contract and billing dates, no leading zeros („1.12.2026“);
// long: a date in a sentence, the year only when it isn't the current Berlin year („4. Dezember“, „1. Januar 2027“);
// feed: event times in a list („29.10., 12:43“, „9.10., 08:05“), no leading zero on day or month (decision 6).
// A plain day ("2026-12-01") is that calendar day wherever it is shown; a timestamp is read in `timeZone` (Berlin by default).

export type GermanDateForm = "short" | "long" | "feed";

// Design's time-zone rule (22 Nov): every shop date, time and day boundary is read in the shop's zone; this is the
// fallback when a screen doesn't know it (every shop is in Germany today). Relative times („vor 3 Min.“) need no zone.
export const BERLIN = "Europe/Berlin";
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function germanDate(value: string | Date, form: GermanDateForm = "short", { timeZone, now = new Date() }: { timeZone?: string; now?: Date } = {}) {
  const plain = typeof value === "string" && PLAIN_DAY.test(value);
  const date = plain ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // The shop's clock, never the viewer's (time-zone rule, 22 Nov).
  if (form === "feed") return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: timeZone ?? BERLIN }).format(date);
  const zone = plain ? "UTC" : timeZone ?? BERLIN;
  if (form === "short") return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", year: "numeric", timeZone: zone }).format(date);
  const year = (at: Date, zoneName: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: zoneName }).format(at);
  const sameYear = year(date, zone) === year(now, BERLIN);
  // The day stays with its month on a line break („24.\u00a0November“), as owner screens always wrote it.
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: zone }).format(date).replace(". ", ".\u00a0");
}

/** A number keeps its unit on a line break (Design decision 29): „10\u00a0Punkte“, „15.\u00a0November“, „23\u00a0Uhr“. For text
 *  shown to the owner only; what customers receive is sent as written. */
export const keepUnits = (text: string) => text.replace(/(\d\.?) (?=\S)/g, "$1\u00a0");

/** The calendar day of a moment in a zone, as YYYY-MM-DD: the key for „Heute“, „Gestern“ and a date field's today. */
export const zoneDay = (at: string | Date, timeZone = BERLIN) => new Intl.DateTimeFormat("en-CA", { timeZone }).format(new Date(at));
/** Whole calendar days from one YYYY-MM-DD to another. */
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
/** The zone of the location an owner is viewing, Berlin while it isn't known (time-zone rule, 22 Nov). */
export const shopZone = (owner: { me?: { locationId?: string | null } | null; locations?: ReadonlyArray<{ id: string; timezone?: string }> }) =>
  owner.locations?.find(location => location.id === owner.me?.locationId)?.timezone ?? BERLIN;
