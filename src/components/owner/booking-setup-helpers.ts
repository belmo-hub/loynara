import type { WorkingDay } from "@/db/schema";
import { parseGermanMoney } from "./program-helpers";

export const WEEKDAYS = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"] as const;
/** One editable weekday; index 0 is Monday. Empty break times mean no break. */
export type Day = { open: boolean; start: string; end: string; breakStart: string; breakEnd: string };

export function toDays(hours: WorkingDay[]): Day[] {
  return WEEKDAYS.map((_, index) => {
    const day = hours.find(item => item.weekday === index + 1);
    return day ? { open: true, start: day.start, end: day.end, breakStart: day.breaks[0]?.start ?? "", breakEnd: day.breaks[0]?.end ?? "" } : { open: false, start: "09:00", end: "18:00", breakStart: "", breakEnd: "" };
  });
}

export function fromDays(days: Day[]): WorkingDay[] {
  return days.flatMap((day, index) => day.open ? [{ weekday: index + 1, start: day.start, end: day.end, breaks: day.breakStart && day.breakEnd ? [{ start: day.breakStart, end: day.breakEnd }] : [] }] : []);
}

/** What is wrong with one open day, or "". Times are "HH:MM", so string order is time order. */
export function dayProblem(day: Day): string {
  if (!day.open) return "";
  if (!day.start || !day.end || day.end <= day.start) return "Ende muss nach dem Beginn liegen.";
  if (!day.breakStart && !day.breakEnd) return "";
  if (!day.breakStart || !day.breakEnd || day.breakEnd <= day.breakStart) return "Pause: Ende muss nach dem Beginn liegen.";
  if (day.breakStart < day.start || day.breakEnd > day.end) return "Die Pause muss in den Öffnungszeiten liegen.";
  return "";
}

export function hoursProblem(days: Day[]): string {
  if (!days.some(day => day.open)) return "Mindestens ein Tag muss geöffnet sein.";
  const index = days.findIndex(day => dayProblem(day));
  return index < 0 ? "" : `${WEEKDAYS[index]}: ${dayProblem(days[index])}`;
}

/** A person's own hours must lie inside the shop's opening hours (only those are bookable); "" when they do. */
export function withinHours(own: Day[], shop: Day[]): string {
  const index = own.findIndex((day, i) => day.open && (!shop[i].open || day.start < shop[i].start || day.end > shop[i].end));
  return index < 0 ? "" : `${WEEKDAYS[index]}: Die Zeiten müssen in den Öffnungszeiten liegen.`;
}

/** Per weekday the earliest start and latest end of anyone's hours, without breaks: the stand-in for shop hours saved before they were stored. */
export function unionHours(lists: WorkingDay[][]): WorkingDay[] {
  const byDay = new Map<number, WorkingDay>();
  for (const day of lists.flat()) {
    const seen = byDay.get(day.weekday);
    byDay.set(day.weekday, { weekday: day.weekday, start: seen && seen.start < day.start ? seen.start : day.start, end: seen && seen.end > day.end ? seen.end : day.end, breaks: [] });
  }
  return [...byDay.values()].sort((a, b) => a.weekday - b.weekday);
}

/** "nach 1 verpassten Termin", "nach 3 verpassten Terminen". */
export const missedPhrase = (n: number) => n === 1 ? "1 verpassten Termin" : `${n} verpassten Terminen`;

export const sameHours = (a: WorkingDay[], b: WorkingDay[]) => JSON.stringify(fromDays(toDays(a))) === JSON.stringify(fromDays(toDays(b)));

/** "12,50" for 1250; whole euros without decimals. */
export const priceText = (minor: number) => (minor / 100).toFixed(2).replace(".", ",").replace(/,00$/, "");

/** Euro text to cents, 0 to 1.000 €; null when not a price. */
export function parsePrice(raw: string): number | null {
  if (/^\s*0+(?:[,.]0{1,2})?\s*$/.test(raw)) return 0;
  const euros = parseGermanMoney(raw);
  return euros === null || euros > 1000 ? null : Math.round(euros * 100);
}

export function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (!hours) return `${rest} Min.`;
  return rest ? `${hours}:${String(rest).padStart(2, "0")} Std.` : `${hours} Std.`;
}

const hoursPhrase = (hours: number) => hours === 1 ? "1 Stunde" : hours % 24 === 0 && hours > 24 ? `${hours / 24} Tage` : `${hours} Stunden`;

/** The honest default customers read before booking; it names exactly the rules the server enforces. */
export function defaultTerms(rules: { cancelDeadlineHours: number; maxReschedulesPerMonth: number; noShowBlockAfter: number }) {
  const until = rules.cancelDeadlineHours ? `bis ${hoursPhrase(rules.cancelDeadlineHours)} vorher` : "bis zum Termin";
  const lines = [
    rules.cancelDeadlineHours ? `Absagen bitte ${until}; später zählt es als kurzfristige Absage.` : "Absagen geht jederzeit bis zum Termin.",
    rules.maxReschedulesPerMonth ? `Verschieben geht online ${until}, bis zu ${rules.maxReschedulesPerMonth}-mal im Monat.` : "Verschieben geht online nicht: bitte absagen und neu buchen.",
  ];
  if (rules.noShowBlockAfter) lines.push(`Nach ${missedPhrase(rules.noShowBlockAfter)} ohne Absage ist die Online-Buchung für dich pausiert; ruf dann kurz an.`);
  return lines.join(" ");
}
