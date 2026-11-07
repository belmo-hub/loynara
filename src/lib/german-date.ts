// One date helper for the owner pages (Design decision 6, 7 Nov). Three forms:
// short: contract and billing dates, no leading zeros („1.12.2026“);
// long: a date in a sentence, the year only when it isn't the current Berlin year („4. Dezember“, „1. Januar 2027“);
// feed: event times in a list („29.10., 12:43“).
// A plain day ("2026-12-01") is that calendar day wherever it is shown; a timestamp is read in `timeZone` (Berlin by default).

export type GermanDateForm = "short" | "long" | "feed";

const BERLIN = "Europe/Berlin";
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function germanDate(value: string | Date, form: GermanDateForm = "short", { timeZone, now = new Date() }: { timeZone?: string; now?: Date } = {}) {
  const plain = typeof value === "string" && PLAIN_DAY.test(value);
  const date = plain ? new Date(`${value}T00:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  // The feed keeps its live behaviour: the viewer's clock unless a zone is given.
  if (form === "feed") return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone }).format(date);
  const zone = plain ? "UTC" : timeZone ?? BERLIN;
  if (form === "short") return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "numeric", year: "numeric", timeZone: zone }).format(date);
  const year = (at: Date, zoneName: string) => new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: zoneName }).format(at);
  const sameYear = year(date, zone) === year(now, BERLIN);
  // The day stays with its month on a line break („24.\u00a0November“), as owner screens always wrote it.
  return new Intl.DateTimeFormat("de-DE", { day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }), timeZone: zone }).format(date).replace(". ", ".\u00a0");
}
