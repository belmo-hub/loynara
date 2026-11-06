import { AuthShell } from "@/components/ui/auth-shell";
import { LegalContents } from "@/components/ui/legal-links";
import styles from "@/components/ui/legal-text.module.css";

// „Inhalt“ (G-26): the sections in page order; legal-sections.test.ts keeps them equal to the headings below.
const SECTIONS = [
  { id: "wer-ist-verantwortlich", title: "Wer ist verantwortlich?" },
  { id: "welche-daten-werden-verarbeitet", title: "Welche Daten werden verarbeitet?" },
  { id: "cookies-und-speicher-im-browser", title: "Cookies und Speicher im Browser" },
  { id: "optionale-wiederherstellungsadresse", title: "Optionale Wiederherstellungsadresse" },
  { id: "nachrichten-auf-deiner-wallet-karte", title: "Nachrichten auf deiner Wallet-Karte" },
  { id: "geburtstag", title: "Geburtstag" },
  { id: "nfc-schild-und-wallet-karte", title: "NFC-Schild und Wallet-Karte" },
  { id: "wofuer-und-auf-welcher-grundlage", title: "Wofür und auf welcher Grundlage?" },
  { id: "empfaenger", title: "Empfänger" },
  { id: "karte-exportieren-wieder-oeffnen-und-schliessen", title: "Karte exportieren, wieder öffnen und schließen" },
  { id: "deine-rechte", title: "Deine Rechte" }
] as const;

export default function DatenschutzPage() {
  return <AuthShell width="reading">
    <article className={styles.legal}>
    <h1>Datenschutzhinweise</h1>
    <p>Stand: 6. November 2026. Diese Hinweise gelten für deine digitale Kundenkarte, die du über einen QR-Code oder ein NFC-Schild eines Geschäfts anlegst.</p>
    <LegalContents sections={SECTIONS} />
    <h2 id="wer-ist-verantwortlich">Wer ist verantwortlich?</h2>
    <p>Für deine Karte ist das Geschäft verantwortlich, bei dem du sie nutzt. Name und Standort stehen auf deiner Karte. Die technische Plattform betreibt Loynara im Auftrag dieses Geschäfts:</p>
    <p>Youssef Belmokhtar, Loynara, Friedrich-Ebert-Straße 70, 34119 Kassel, Deutschland<br />E-Mail: support@getloynara.com</p>
    <h2 id="welche-daten-werden-verarbeitet">Welche Daten werden verarbeitet?</h2>
    <p>Beim Anlegen der Karte werden weder dein Name noch eine E-Mail-Adresse noch eine Telefonnummer abgefragt. Die Karte erhält einen zufälligen privaten Zugangslink, einen davon getrennten QR-Kartencode für die Kasse und eine kurze Kartennummer. Gespeichert werden der Kartenstand (Stempel oder Punkte), die vom Team bestätigten Buchungen mit Uhrzeit, Einlösungen sowie, falls du über einen Empfehlungslink gekommen bist oder selbst einen teilst, die Verbindung zwischen den beteiligten Karten.</p>
    <p>Zur Absicherung werden technische Sicherheitsereignisse der Karte und Zähler für Anfragebegrenzungen gespeichert, zum Beispiel um wiederholtes Raten von Links zu verhindern.</p>
    <h2 id="cookies-und-speicher-im-browser">Cookies und Speicher im Browser</h2>
    <p>Loynara setzt auf deinem Gerät nur technisch notwendige Cookies und Browserspeicher ein. Sie verbinden dein Gerät mit deiner Karte, damit du sie wieder öffnen kannst und das Team einen Besuch für die richtige Karte bestätigen kann. Es gibt keine Werbe- oder Analyse-Cookies und keine Tracker von Drittanbietern.</p>
    <h2 id="optionale-wiederherstellungsadresse">Optionale Wiederherstellungsadresse</h2>
    <p>Du kannst freiwillig eine E-Mail-Adresse hinterlegen, um deine Karte wiederzufinden, falls du den Link verlierst. Die Adresse wird per Bestätigung geprüft und nur für diesen Zweck verwendet. Sie ist keine Einwilligung in Werbung. Die Karte funktioniert auch ohne.</p>
    <h2 id="nachrichten-auf-deiner-wallet-karte">Nachrichten auf deiner Wallet-Karte</h2>
    <p>Wenn du es bei der Anmeldung oder auf deiner Karte ausdrücklich erlaubst, kann dir das Geschäft kurze Nachrichten mit Angeboten, Neuigkeiten und Erinnerungen auf deiner Wallet-Karte schicken, höchstens zwei pro Woche und nicht nachts. Dazu kann eine automatische Erinnerung gehören, wenn du länger nicht da warst. Diese Einwilligung ist freiwillig. Sie wird mit Zeitpunkt und Textversion protokolliert, und du kannst sie jederzeit auf deiner Karte widerrufen, ohne die Karte aus deiner Wallet zu löschen. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 Buchst. a DSGVO). Zugestellt werden die Nachrichten bei Apple Wallet über Apple, bei Google Wallet über Google.</p>
    <p>Läuft auf deiner Punktekarte ein Teil deiner Punkte bald ab, schickt dir das Geschäft vorher einen Hinweis auf deine Karte in Apple Wallet oder Google Wallet. Dafür musst du nichts erlauben; der Hinweis zählt zu den höchstens zwei Nachrichten pro Woche. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms (Art. 6 Abs. 1 Buchst. b DSGVO).</p>
    <h2 id="geburtstag">Geburtstag</h2>
    <p>Freiwillig kannst du auf deiner Karte Tag und Monat deines Geburtstags hinterlegen, ohne Jahr. Das Geschäft nutzt ihn nur für eine Geburtstagsprämie und, wenn du Nachrichten auf deiner Wallet-Karte erlaubt hast, für eine Erinnerung in deiner Geburtstagswoche. Du kannst ihn jederzeit auf deiner Karte löschen. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms (Art. 6 Abs. 1 Buchst. b DSGVO).</p>
    <h2 id="nfc-schild-und-wallet-karte">NFC-Schild und Wallet-Karte</h2>
    <p>Wenn ein Geschäft ein NFC-Schild anbietet, wird beim Antippen eine einmalige, signierte Kennung des Schilds geprüft, damit dein Besuch dem richtigen Geschäft zugeordnet wird. Für Apple Wallet erstellen wir selbst einen Pass mit deinem Kartenstand. Auf dem iPhone bieten wir ihn dir gleich nach dem Anlegen der Karte an; dein Gerät lädt ihn dafür von unserem Server. Ob du ihn hinzufügst, entscheidest du. Fügst du ihn hinzu, meldet dein Gerät uns eine Gerätekennung und einen Push-Token, damit der Pass aktuell bleibt. Ändert sich deine Karte, schicken wir über Apples Push-Dienst eine Benachrichtigung ohne Inhalt an dein Gerät; den neuen Stand holt es dann bei uns ab. Löschst du den Pass aus deiner Wallet, meldet dein Gerät ihn bei uns ab, und wir löschen die Anmeldung. Die weitere Verarbeitung durch Apple richtet sich nach Apples eigenen Bedingungen. Wenn du deine Karte zu Google Wallet hinzufügst, übermitteln wir an Google: deine Kartennummer, den QR-Kartencode für die Kasse, deinen Stempel- oder Punktestand, den Fortschritt zur nächsten Prämie sowie Name, Logo, Farbe und gegebenenfalls Standort des Geschäfts. Dein Name, deine E-Mail-Adresse, deine Telefonnummer und dein privater Kartenlink werden nicht übermittelt. Google erstellt und aktualisiert den Pass über die Google Wallet API; die weitere Verarbeitung in deinem Google-Konto richtet sich nach Googles eigenen Bedingungen. Schließt du die Karte oder wird sie neu ausgestellt, werden gespeicherte Pässe nicht aus der Ferne gelöscht. Ein Apple-Wallet-Pass wird als ungültig markiert und sein QR-Code entfernt. Ein Google-Wallet-Pass wird deaktiviert; Kartennummer, QR-Code und Stand werden entfernt. Du kannst den Pass danach selbst aus deiner Wallet löschen.</p>
    <h2 id="wofuer-und-auf-welcher-grundlage">Wofür und auf welcher Grundlage?</h2>
    <p>Wir verarbeiten die Daten, um die Kundenkarte bereitzustellen, Besuche und Prämien nachvollziehbar zu verbuchen, Missbrauch zu verhindern und die Plattform sicher zu betreiben. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms, an dem du teilnimmst (Art. 6 Abs. 1 Buchst. b DSGVO), und das berechtigte Interesse an Sicherheit und Missbrauchsschutz (Art. 6 Abs. 1 Buchst. f DSGVO).</p>
    <h2 id="empfaenger">Empfänger</h2>
    <p>Das Geschäft sieht den Stand und den Verlauf deiner Karte, aber keinen Namen. Als Dienstleister setzen wir ein: Railway (Hosting der Anwendung und Datenbank), Cloudflare (Auslieferung und Schutz der Verbindung), bei Google-Wallet-Karten Google und, wenn du eine Wiederherstellungsadresse hinterlegst, Mailgun (Versand der Bestätigungs- und Wiederherstellungs-E-Mails). Bei Apple-Wallet-Karten erhält Apple für Aktualisierungen den Push-Token deines Geräts, aber keine Karteninhalte. Eine Verarbeitung außerhalb der Europäischen Union kann bei diesen Anbietern nicht ausgeschlossen werden.</p>
    <h2 id="karte-exportieren-wieder-oeffnen-und-schliessen">Karte exportieren, wieder öffnen und schließen</h2>
    <p>Der private Kartenlink muss selbst sicher gespeichert werden. Ist er verloren, stellt dir das Geschäft die Karte neu aus: gleicher Stand, gleicher Verlauf. Der alte Link und der alte QR-Code funktionieren danach nicht mehr. Auf deiner Karte kannst du deine Daten exportieren und die Karte selbst schließen. Beim Schließen werden Link und QR-Code ungültig, hinterlegte Kontakt- und Wiederherstellungsdaten werden entfernt. Buchungen, Einlösungen und der Verlauf deiner Einwilligungen bleiben unter einer pseudonymen Karten-ID erhalten, damit Buchungen nachvollziehbar bleiben und Einwilligungen nachgewiesen werden können. Sie werden nicht für andere Zwecke genutzt. Eine feste Löschfrist dafür ist noch nicht festgelegt.</p>
    <h2 id="deine-rechte">Deine Rechte</h2>
    <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit, das Recht auf Widerspruch gegen Verarbeitungen aufgrund berechtigter Interessen sowie das Recht, erteilte Einwilligungen zu widerrufen. Wende dich dafür an das Geschäft oder an support@getloynara.com. Du kannst dich außerdem bei einer Datenschutzaufsichtsbehörde beschweren. Für Loynara ist der Hessische Beauftragte für Datenschutz und Informationsfreiheit, Wilhelmstraße 7, 65185 Wiesbaden, zuständig.</p>
    </article>
  </AuthShell>;
}
