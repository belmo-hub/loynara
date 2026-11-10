import type { LocationAnalytics } from "@/lib/merchant-analytics";

const nf = new Intl.NumberFormat("de-DE");

/**
 * ENG-210: the owner's weekly line on the Übersicht (behind OWNER_WEEKLY_LINE_ENABLED): bookings since Monday, how many
 * of them by cards with an earlier booking, and the cards created since Monday. Rule-based; nothing is stored.
 * Wording: Marketing, 10 Nov. „mit früherer Buchung“, because „Wiederkehrend“ means something else on this page.
 */
export function weekLine({ bookings: b, returning: r, newCards: n }: NonNullable<LocationAnalytics["week"]>): string {
  const cards = n === 0 ? "keine neue Karte" : n === 1 ? "1 neue Karte" : `${nf.format(n)} neue Karten`;
  if (b === 0) return n === 0 ? "Diese Woche gab es noch keine Buchung und keine neue Karte." : `Diese Woche gab es noch keine Buchung, aber ${cards}.`;
  const earlier = b === 1 ? (r === 1 ? "von einer Karte mit früherer Buchung" : "die erste ihrer Karte")
    : r === 0 ? "alle davon erste Buchungen ihrer Karte"
    : r === 1 ? "1 davon von einer Karte mit früherer Buchung"
    : r < b ? `${nf.format(r)} davon von Karten mit früherer Buchung`
    : "alle von Karten mit früherer Buchung";
  return `Diese Woche: ${b === 1 ? "1 Buchung" : `${nf.format(b)} Buchungen`}, ${earlier}, und ${cards}.`;
}
