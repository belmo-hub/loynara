import type { LocationAnalytics } from "@/lib/merchant-analytics";

const nf = new Intl.NumberFormat("de-DE");

/**
 * The owner's weekly line on the Übersicht (behind OWNER_WEEKLY_LINE_ENABLED): bookings since Monday, how many of them
 * by cards that had an earlier booking, and the cards created since Monday. Rule-based; nothing is stored.
 */
// wording: draft, Marketing confirms
export function weekLine(week: NonNullable<LocationAnalytics["week"]>): string {
  const cards = week.newCards > 0 ? ` ${nf.format(week.newCards)} neue ${week.newCards === 1 ? "Karte" : "Karten"}.` : "";
  if (week.bookings === 0) return `Diese Woche gab es noch keine Buchung.${cards}`;
  const returning = week.returning === 0 ? "" : week.bookings === 1 ? ", von einer Karte, die schon einmal da war"
    : `, ${week.returning === week.bookings ? "alle" : `${nf.format(week.returning)} davon`} von Karten, die schon einmal da waren`;
  return `Diese Woche: ${nf.format(week.bookings)} ${week.bookings === 1 ? "Buchung" : "Buchungen"}${returning}.${cards}`;
}
