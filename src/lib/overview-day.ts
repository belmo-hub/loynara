/**
 * ENG-085 (direction D): the Übersicht board's sentences, from bookings per local day at one location.
 * Pure functions, so every rule is unit-tested. Dates are the location's local calendar days as YYYY-MM-DD.
 * Every sentence here is a Design draft that Marketing approves before release.
 */

export type DayCount = { date: string; bookings: number };
/** One local day of the diary: its counted bookings, the units they awarded and every entry in order (never netted). */
export type DiaryDay = { date: string; bookings: number; units: number; entries: Array<{ kind: "award" | "correction" | "redemption"; amount: number }> };
/** The board's day data for one location (part of the per-location read). */
export type LocationDays = {
  timezone: string;
  /** The location's local date at the time of the read. */
  today: string;
  /** Bookings per local day, the 15 days ending yesterday, oldest first. */
  days: DayCount[];
  lastBookingOn: string | null;
  /** The programme ran the full 15 days the „bester Tag“ rule compares. */
  fullTwoWeeks: boolean;
  /** Up to 10 local days with entries in the last 30 days, newest first. */
  diary: DiaryDay[];
};

const NBSP = "\u00a0";
const WEEKDAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const SHORT_WEEKDAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

/** A number and its noun never break across lines. */
export const bookingsText = (n: number) => `${n.toLocaleString("de-DE")}${NBSP}${n === 1 ? "Buchung" : "Buchungen"}`;

const utcDay = (date: string) => new Date(`${date}T12:00:00Z`);
export const daysBetween = (from: string, to: string) => Math.round((utcDay(to).getTime() - utcDay(from).getTime()) / 86_400_000);
export const weekdayShort = (date: string) => SHORT_WEEKDAYS[utcDay(date).getUTCDay()];
/** „Mittwoch, 21.10.“ */
export const dayLabel = (date: string) => `${WEEKDAYS[utcDay(date).getUTCDay()]}, ${date.slice(8, 10)}.${date.slice(5, 7)}.`;

/** The location's local date and hour at `now`. */
export function localNow(now: Date, timeZone: string): { date: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now).map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

/** „Guten Morgen“ before 11:00, „Guten Tag“ until 17:00, „Guten Abend“ after, in the location's time. */
export function greeting(hour: number): string {
  return hour < 11 ? "Guten Morgen" : hour < 17 ? "Guten Tag" : "Guten Abend";
}

/**
 * The board's headline (spec §3, the first rule that matches wins). `days` are the local days before today, oldest first,
 * ending yesterday; `fullTwoWeeks` says the 14 days before yesterday are complete data (the programme ran 15 days).
 */
export function headline(input: { days: DayCount[]; lastBookingOn: string | null; today: string; fullTwoWeeks: boolean }): string | null {
  const { days, lastBookingOn, today, fullTwoWeeks } = input;
  if (!lastBookingOn || days.length === 0) return null; // rule 5: never a booking (the empty-shop board)
  const yesterday = days[days.length - 1].bookings;
  const before = days.slice(-15, -1);
  if (fullTwoWeeks && before.length === 14 && yesterday >= 2 && before.every(day => day.bookings < yesterday)) {
    return `Gestern war der beste Tag seit zwei Wochen: ${bookingsText(yesterday)} am${NBSP}Tresen.`;
  }
  if (yesterday > 0) return `Gestern: ${bookingsText(yesterday)} am${NBSP}Tresen.`;
  const week = days.slice(-7).reduce((sum, day) => sum + day.bookings, 0);
  if (week > 0) return `In den letzten 7 Tagen: ${bookingsText(week)} am${NBSP}Tresen.`;
  // Rule 4 needs the last booking before the week; a shop whose only bookings are today's gets no headline yet.
  if (lastBookingOn === today) return null;
  return `Eine ruhige Woche. Die letzte Buchung war am ${dayLabel(lastBookingOn)}`;
}

/** The quiet-week next step: days since the last booking, when that is 7 or more (spec §2.3); else null. */
export function quietDays(lastBookingOn: string | null, today: string): number | null {
  if (!lastBookingOn) return null;
  const days = daysBetween(lastBookingOn, today);
  return days >= 7 ? days : null;
}
