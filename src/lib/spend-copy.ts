/** ENG-070: every German string of the owner's spend figures, in one place for Marketing and Legal review. */
export const SPEND_COPY = {
  title: "Umsatz deiner Loynara-Kunden",
  lead: "Nach bestätigten Buchungen, unabhängig vom Zeitraum unten.",
  recent: "Letzte 30 Tage",
  total: "Seit Start",
  // Owner UI term rule (Marketing, 22 Oct): a booking is a „bestätigte Buchung“, never a „Besuch“.
  bookings: (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Buchung" : "Buchungen"}`,
  average: (amount: string) => `Ø\u00a0${amount} pro\u00a0Buchung`,
  /** ENG-084 (Marketing, 24 Oct): while some bookings have no amount, name how many the euros and the average come from. */
  pricedBookings: (priced: number, average: string) => `${priced.toLocaleString("de-DE")}\u00a0${priced === 1 ? "Buchung" : "Buchungen"} mit Betrag · Ø\u00a0${average} pro\u00a0Buchung`,
  newAndReturning: (fresh: string, returning: string) => `Neue Karten (im Zeitraum angemeldet): ${fresh} · Wiederkommende Karten: ${returning}`,
  estimated: "geschätzt",
  partlyEstimated: "teilweise geschätzt",
  /** A figure or location without any booking that has an amount (no average entered yet). */
  unpriced: "ohne Betrag",
  /** Leads the card while no booking has an amount, instead of a count under a revenue title. */
  noAverage: "Ohne Kassenbetrag kennen wir den Umsatz deiner Loynara-Kunden nicht. Trag deinen Durchschnittsbon ein, dann schätzen wir ihn aus deinen bestätigten Buchungen.",
  missingAverage: "Für Buchungen ohne Kassenbetrag fehlt dein Durchschnittsbon. Bis dahin zählen sie ohne Betrag.",
  missingAverageLink: "Durchschnittsbon eintragen",
  perLocation: "Je Standort",
  empty: "Noch keine bestätigten Buchungen.",
  howWeCountTitle: "So zählen wir den Umsatz",
  howWeCount: "Es zählen Einkäufe, die dein Team an der Kasse bestätigt hat, auch offline gebuchte, sobald sie übertragen sind; bestätigte NFC-Buchungen ebenso. Bei Punkten zählt der eingegebene Kassenbetrag. Wird eine Buchung korrigiert, fällt ihr Betrag weg; eine neu gebuchte zählt mit dem neuen Betrag. Bonuspunkte und Bonusstempel (Startbonus, Happy Hour, Rückkehr-, Geburtstags- und Challenge-Bonus) sind kein Umsatz und zählen nie. Bei Stempeln und von Hand vergebenen Punkten kennen wir keinen Betrag: Wir rechnen Buchungen × deinen aktuellen Durchschnittsbon und schreiben „geschätzt“ dazu. „Letzte 30 Tage“ heißt: heute und die 29 Tage davor, nach der Uhrzeit deines Standorts. Das ist der Umsatz deiner Kundinnen und Kunden mit Loynara-Karte, nicht Umsatz, den Loynara dir gebracht hat: Manche wären auch ohne Karte gekommen.",
  averageLabel: "Durchschnittsbon pro Buchung",
  averageHint: "Nur für die Ergebnisse: Buchungen × Durchschnittsbon ergibt den geschätzten Umsatz deiner Loynara-Kunden. Leer = keine Schätzung.",
  averageError: "Bitte einen Betrag von 0,01 bis 1.000,00 eingeben.",
  /** Replaces the old closing sentence of the Buchungen "So zählen wir" note, which said the page shows no revenue. */
  bookingsNote: "Die Zahlen zu Buchungen zeigen bestätigte Buchungen, nicht alle Besuche. Beträge stehen nur unter „Umsatz deiner Loynara-Kunden“.",
} as const;


/** Loynara Termin lines under the spend figures: list prices are an estimate, cashier amounts are named apart. */
export const BOOKING_COPY = {
  title: "Termine",
  // D6 (Design, 22 Nov): a label per figure, the number in the value column, the period as the muted sub.
  today: "Heute", next7: "Nächste 7 Tage", noShowTitle: "Nicht erschienen", listPriceTitle: "Listenpreise erledigter Termine",
  confirmedTitle: "Davon an der Kasse bestätigt", rebookedTitle: "Über Erinnerung neu gebucht",
  last30: "letzte 30 Tage", estimated: "geschätzt, nicht kassiert, letzte 30 Tage",
  noShowValue: (noShow: number, total: number) => `${noShow.toLocaleString("de-DE")} von ${total.toLocaleString("de-DE")}`,
  empty: "Nach deinem ersten erledigten Termin siehst du hier Ausfälle und die Listenpreise erledigter Termine.",
  howWeCount: "Es zählen Termine nach ihrer Startzeit an deinem Standort. „Letzte 30 Tage“ heißt: heute und die 29 Tage davor. Nicht erschienen zählt gegen alle erledigten, nicht erschienenen und kurzfristig abgesagten Termine. Neu gebucht über Erinnerung heißt: über den Link aus der Erinnerung an den nächsten Termin. „Listenpreise erledigter Termine“ ist die Summe der Preise, so wie sie beim Buchen galten. Das ist kein kassierter Betrag. „An der Kasse bestätigt“ ist der Betrag, den dein Team beim Abschluss des Termins eingegeben hat; korrigierte Buchungen fallen weg.",
} as const;

/**
 * ENG-095 on the Übersicht (labels: Marketing; Legal checked, 27 Oct): the heading names two events, never a cause, and the
 * block shows no share, ratio or estimate. Its last line keeps howWeCount's closing sentence word for word.
 */
export const BROUGHT_COPY = {
  // No-break spaces keep the dot with „Empfehlung“ and „letzte 30 Tage“ on one line (Design).
  title: "Wieder da oder neu auf Empfehlung · letzte 30 Tage",
  customers: (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Kunde" : "Kunden"}`,
  winback: "Nach längerer Pause wieder da, mit Bonus",
  referral: "Neu auf Empfehlung",
  revenue: "Umsatz dieser Buchungen",
  /** „aus 3 Buchungen mit Kassenbetrag“ when every booking has one, else „2 von 3 …“ (also „0 von 3 …“ beside „–“). */
  priced: (priced: number, bookings: number) => `${priced === bookings ? "aus" : `${priced.toLocaleString("de-DE")} von`} ${SPEND_COPY.bookings(bookings)} mit Kassenbetrag`,
  all: "Alle Kunden mit Karte:",
  allNote: "Manche wären auch ohne Karte gekommen.",
  howWeCountTitle: "So zählen wir",
  howWeCount: "Gezählt werden nur die Buchungen, bei denen der Willkommen-zurück-Bonus dazukam, und die erste Buchung nach einer Empfehlung. Spätere Buchungen zählen darunter bei allen Loynara-Kunden mit. Manche wären auch ohne Bonus wiedergekommen.",
  bonusOff: "Willkommen-zurück-Bonus einschalten",
  bonusOffText: "Ein kleiner Bonus für Kunden, die länger nicht da waren.",
} as const;

export const AVERAGE_VISIT_SPEND_MAX_MINOR = 100_000;

/** Display only: the figures stay integer minor units until here. */
export function formatMinor(minor: number, currency: string): string {
  return (minor / 100).toLocaleString("de-DE", { style: "currency", currency });
}
