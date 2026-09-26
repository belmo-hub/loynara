import Link from "next/link";

export default function DatenschutzPage() {
  return <main className="legal-page">
    <Link href="/">← Loynara</Link>
    <h1>Datenschutzhinweise – Entwurf</h1>
    <p>Diese Seite beschreibt den aktuellen Teststand und ist keine freigegebene Datenschutzerklärung.</p>
    <h2>Verantwortliche Stelle</h2>
    <p><strong>Vor öffentlichem Start ergänzen:</strong> Name, ladungsfähige Anschrift und Kontakt des Betreibers.</p>
    <h2>Verarbeitete Daten</h2>
    <p>Für Händlerkonten werden Name, geschäftliche E-Mail, Passwort-Hash und Sitzungsdaten verarbeitet. Bei der öffentlichen Kundenkarten-Anmeldung werden derzeit keine E-Mail-Adresse und keine Marketing-Einwilligung abgefragt. Die Karte erhält einen zufälligen privaten Zugangslink und einen davon getrennten QR-Kartencode für die Kasse. Gespeichert werden Kartenguthaben, bestätigte Buchungen und Einlösungen.</p>
    <h2>Karte wieder öffnen und schließen</h2>
    <p>Der private Kartenlink muss selbst sicher gespeichert werden. Ohne ihn ist eine Wiederherstellung derzeit nicht möglich. Vor dem Schließen können die Kartendaten exportiert werden. Beim Schließen werden der Link und der QR-Kartencode ungültig; eventuell vorhandene Kontakt- und Wiederherstellungsdaten werden entfernt. Buchungen, Einlösungen und Einwilligungsverlauf bleiben vorerst unter einer pseudonymen Karten-ID erhalten, bis eine geprüfte Aufbewahrungsregel feststeht. Bereits bei Wallet-Anbietern gespeicherte Pässe werden dadurch nicht aus der Ferne gelöscht.</p>
    <h2>Zwecke und Dienstleister</h2>
    <p>Die lokale Vorschau verarbeitet diese Daten für die Kartenfunktion und Sicherheit. Externe E-Mail-Zustellung, Wallet-Anbieter und Live-Zahlungen sind in der Vorschau ausgeschaltet. <strong>Vor öffentlichem Start ergänzen:</strong> konkrete Anbieter, Rechtsgrundlagen, Speicherfristen, Auftragsverarbeitung und internationale Übermittlungen.</p>
    <h2>Kontakt und Rechte</h2>
    <p><strong>Vor öffentlichem Start ergänzen:</strong> Datenschutzkontakt sowie geprüfte Verfahren für Auskunft, Berichtigung und Löschung.</p>
  </main>;
}
