/** ENG-070: every German string of the owner's spend figures, in one place for Marketing and Legal review. */
export const SPEND_COPY = {
  title: "Umsatz deiner Loynara-Kunden",
  lead: "Was Kundinnen und Kunden mit Loynara-Karte bei dir ausgegeben haben, nach bestätigten Buchungen. Unabhängig vom Zeitraum unten.",
  recent: "Letzte 30 Tage",
  recentNote: "Heute und die 29 Tage davor, nach der Uhrzeit deines Standorts.",
  total: "Seit Start",
  visits: (n: number) => `${n.toLocaleString("de-DE")} ${n === 1 ? "Besuch" : "Besuche"}`,
  average: (amount: string) => `Ø ${amount} pro Besuch`,
  newAndReturning: (fresh: string, returning: string) => `Neue Karten (im Zeitraum angemeldet): ${fresh} · Wiederkommende Karten: ${returning}`,
  estimated: "geschätzt",
  partlyEstimated: "teilweise geschätzt",
  estimateNote: "Bei Stempeln kennen wir keinen Betrag: geschätzt als Besuche × dein Durchschnittsbon.",
  missingAverage: "Für Besuche ohne Kassenbetrag fehlt dein Durchschnittsbon. Trag ihn unter „Sammelregeln & Prämien“ › „Auf der Kundenkarte“ ein, dann zeigen wir eine Schätzung. Bis dahin zählen wir nur die Besuche.",
  missingAverageLink: "Durchschnittsbon eintragen",
  perLocation: "Je Standort",
  empty: "Noch keine bestätigten Buchungen.",
  howWeCountTitle: "So zählen wir den Umsatz",
  howWeCount: "Es zählen Einkäufe, die dein Team an der Kasse bestätigt hat, auch offline gebuchte, sobald sie übertragen sind; bestätigte NFC-Besuche ebenso. Bei Punkten zählt der eingegebene Kassenbetrag. Wird eine Buchung korrigiert, fällt ihr Betrag weg; eine neu gebuchte zählt mit dem neuen Betrag. Bonuspunkte und Bonusstempel (Startbonus, Happy Hour, Rückkehr-, Geburtstags- und Challenge-Bonus) sind kein Umsatz und zählen nie. Bei Stempeln rechnen wir Besuche × deinen aktuellen Durchschnittsbon und schreiben „geschätzt“ dazu. Das ist der Umsatz deiner Kundinnen und Kunden mit Loynara-Karte, nicht Umsatz, den Loynara dir gebracht hat: Manche wären auch ohne Karte gekommen.",
  averageLabel: "Durchschnittsbon pro Besuch",
  averageHint: "Nur für die Auswertung: Besuche × Durchschnittsbon ergibt den geschätzten Umsatz deiner Loynara-Kunden. Leer = nur Besuche zeigen.",
  averageError: "Bitte einen Betrag von 0,01 bis 1.000,00 eingeben.",
  /** Replaces the old closing sentence of the Buchungen "So zählen wir" note, which said the page shows no revenue. */
  bookingsNote: "Die Zahlen zu Buchungen zeigen bestätigte Buchungen, nicht alle Besuche. Beträge stehen nur unter „Umsatz deiner Loynara-Kunden“.",
} as const;

export const AVERAGE_VISIT_SPEND_MAX_MINOR = 100_000;

/** Display only: the figures stay integer minor units until here. */
export function formatMinor(minor: number, currency: string): string {
  return (minor / 100).toLocaleString("de-DE", { style: "currency", currency });
}
