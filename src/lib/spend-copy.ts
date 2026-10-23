/** ENG-070: every German string of the owner's spend figures, in one place for Marketing and Legal review. */
export const SPEND_COPY = {
  title: "Umsatz deiner Loynara-Kunden",
  lead: "Nach bestätigten Buchungen, unabhängig vom Zeitraum unten.",
  recent: "Letzte 30 Tage",
  total: "Seit Start",
  // Owner UI term rule (Marketing, 22 Oct): a booking is a „bestätigte Buchung“, never a „Besuch“.
  bookings: (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Buchung" : "Buchungen"}`,
  average: (amount: string) => `Ø\u00a0${amount} pro\u00a0Buchung`,
  newAndReturning: (fresh: string, returning: string) => `Neue Karten (im Zeitraum angemeldet): ${fresh} · Wiederkommende Karten: ${returning}`,
  estimated: "geschätzt",
  partlyEstimated: "teilweise geschätzt",
  /** A figure or location without any booking that has an amount (no average entered yet). */
  unpriced: "ohne Betrag",
  /** Leads the card while no booking has an amount, instead of a count under a revenue title. */
  noAverage: "Ohne Kassenbetrag kennen wir deinen Umsatz nicht. Trag deinen Durchschnittsbon ein, dann schätzen wir ihn aus deinen bestätigten Buchungen.",
  missingAverage: "Für Buchungen ohne Kassenbetrag fehlt dein Durchschnittsbon. Bis dahin zählen sie ohne Betrag.",
  missingAverageLink: "Durchschnittsbon eintragen",
  perLocation: "Je Standort",
  empty: "Noch keine bestätigten Buchungen.",
  howWeCountTitle: "So zählen wir den Umsatz",
  howWeCount: "Es zählen Einkäufe, die dein Team an der Kasse bestätigt hat, auch offline gebuchte, sobald sie übertragen sind; bestätigte NFC-Buchungen ebenso. Bei Punkten zählt der eingegebene Kassenbetrag. Wird eine Buchung korrigiert, fällt ihr Betrag weg; eine neu gebuchte zählt mit dem neuen Betrag. Bonuspunkte und Bonusstempel (Startbonus, Happy Hour, Rückkehr-, Geburtstags- und Challenge-Bonus) sind kein Umsatz und zählen nie. Bei Stempeln und von Hand vergebenen Punkten kennen wir keinen Betrag: Wir rechnen Buchungen × deinen aktuellen Durchschnittsbon und schreiben „geschätzt“ dazu. „Letzte 30 Tage“ heißt: heute und die 29 Tage davor, nach der Uhrzeit deines Standorts. Das ist der Umsatz deiner Kundinnen und Kunden mit Loynara-Karte, nicht Umsatz, den Loynara dir gebracht hat: Manche wären auch ohne Karte gekommen.",
  averageLabel: "Durchschnittsbon pro Buchung",
  averageHint: "Nur für die Auswertung: Buchungen × Durchschnittsbon ergibt den geschätzten Umsatz deiner Loynara-Kunden. Leer = keine Schätzung.",
  averageError: "Bitte einen Betrag von 0,01 bis 1.000,00 eingeben.",
  /** Replaces the old closing sentence of the Buchungen "So zählen wir" note, which said the page shows no revenue. */
  bookingsNote: "Die Zahlen zu Buchungen zeigen bestätigte Buchungen, nicht alle Besuche. Beträge stehen nur unter „Umsatz deiner Loynara-Kunden“.",
} as const;

export const AVERAGE_VISIT_SPEND_MAX_MINOR = 100_000;

/** Display only: the figures stay integer minor units until here. */
export function formatMinor(minor: number, currency: string): string {
  return (minor / 100).toLocaleString("de-DE", { style: "currency", currency });
}
