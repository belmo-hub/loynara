import { AuthShell } from "@/components/ui/auth-shell";
import styles from "@/components/ui/legal-text.module.css";

export default function DatenschutzPage() {
  return <AuthShell width="reading" brandHref="/">
    <article className={styles.legal}>
    <h1>Datenschutzhinweise</h1>
    <p>Stand: 19. Oktober 2026. Diese Hinweise gelten für deine digitale Kundenkarte, die du über einen QR-Code oder ein NFC-Schild eines Geschäfts anlegst.</p>
    <h2>Wer ist verantwortlich?</h2>
    <p>Für deine Karte ist das Geschäft verantwortlich, bei dem du sie nutzt. Name und Standort stehen auf deiner Karte. Die technische Plattform betreibt Loynara im Auftrag dieses Geschäfts:</p>
    <p>Youssef Belmokhtar, Loynara, Friedrich-Ebert-Straße 70, 34119 Kassel, Deutschland<br />E-Mail: support@getloynara.com</p>
    <h2>Welche Daten werden verarbeitet?</h2>
    <p>Beim Anlegen der Karte werden weder dein Name noch eine E-Mail-Adresse noch eine Telefonnummer abgefragt. Die Karte erhält einen zufälligen privaten Zugangslink, einen davon getrennten QR-Kartencode für die Kasse und eine kurze Kartennummer. Gespeichert werden der Kartenstand (Stempel oder Punkte), die vom Team bestätigten Buchungen mit Uhrzeit, Einlösungen sowie, falls du über einen Empfehlungslink gekommen bist oder selbst einen teilst, die Verbindung zwischen den beteiligten Karten.</p>
    <p>Zur Absicherung werden technische Sicherheitsereignisse der Karte und Zähler für Anfragebegrenzungen gespeichert, zum Beispiel um wiederholtes Raten von Links zu verhindern.</p>
    <h2>Cookies und Speicher im Browser</h2>
    <p>Loynara setzt auf deinem Gerät nur technisch notwendige Cookies und Browserspeicher ein. Sie verbinden dein Gerät mit deiner Karte, damit du sie wieder öffnen kannst und das Team einen Besuch für die richtige Karte bestätigen kann. Es gibt keine Werbe- oder Analyse-Cookies und keine Tracker von Drittanbietern.</p>
    <h2>Optionale Wiederherstellungsadresse</h2>
    <p>Du kannst freiwillig eine E-Mail-Adresse hinterlegen, um deine Karte wiederzufinden, falls du den Link verlierst. Die Adresse wird per Bestätigung geprüft und nur für diesen Zweck verwendet. Sie ist keine Einwilligung in Werbung. Die Karte funktioniert auch ohne.</p>
    <h2>E-Mail-Angebote</h2>
    <p>Angebote des Geschäfts per E-Mail erhältst du nur, wenn du das auf deiner Karte ausdrücklich und getrennt von der Wiederherstellungsadresse aktivierst. Diese Einwilligung ist freiwillig, kann jederzeit mit Wirkung für die Zukunft widerrufen werden (auf deiner Karte oder über den Abmeldelink in jeder E-Mail) und wird mit Zeitpunkt und Textversion protokolliert. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 Buchst. a DSGVO). Wenn ein Geschäft diese Funktion noch nicht nutzt, werden keine Angebote versendet.</p>
    <h2>NFC-Schild und Wallet-Karte</h2>
    <p>Wenn ein Geschäft ein NFC-Schild anbietet, wird beim Antippen eine einmalige, signierte Kennung des Schilds geprüft, damit dein Besuch dem richtigen Geschäft zugeordnet wird. Wenn du deine Karte zu Apple Wallet hinzufügst, erstellt unser Dienstleister PassFast den Pass mit deinem Kartenstand; die weitere Verarbeitung durch Apple richtet sich nach Apples eigenen Bedingungen. Wenn du deine Karte zu Google Wallet hinzufügst, übermitteln wir an Google: deine Kartennummer, den QR-Kartencode für die Kasse, deinen Stempel- oder Punktestand, den Fortschritt zur nächsten Prämie sowie Name, Logo, Farbe und gegebenenfalls Standort des Geschäfts. Dein Name, deine E-Mail-Adresse, deine Telefonnummer und dein privater Kartenlink werden nicht übermittelt. Google erstellt und aktualisiert den Pass über die Google Wallet API; die weitere Verarbeitung in deinem Google-Konto richtet sich nach Googles eigenen Bedingungen. Schließt du die Karte oder wird sie neu ausgestellt, werden gespeicherte Pässe nicht aus der Ferne gelöscht. Ein Apple-Wallet-Pass wird als ungültig markiert und sein QR-Code entfernt. Ein Google-Wallet-Pass wird deaktiviert; Kartennummer, QR-Code und Stand werden entfernt. Du kannst den Pass danach selbst aus deiner Wallet löschen.</p>
    <h2>Wofür und auf welcher Grundlage?</h2>
    <p>Wir verarbeiten die Daten, um die Kundenkarte bereitzustellen, Besuche und Prämien nachvollziehbar zu verbuchen, Missbrauch zu verhindern und die Plattform sicher zu betreiben. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms, an dem du teilnimmst (Art. 6 Abs. 1 Buchst. b DSGVO), und das berechtigte Interesse an Sicherheit und Missbrauchsschutz (Art. 6 Abs. 1 Buchst. f DSGVO).</p>
    <h2>Empfänger</h2>
    <p>Das Geschäft sieht den Stand und den Verlauf deiner Karte, aber keinen Namen. Als Dienstleister setzen wir ein: Railway (Hosting der Anwendung und Datenbank), Cloudflare (Auslieferung und Schutz der Verbindung), bei Apple-Wallet-Karten PassFast, bei Google-Wallet-Karten Google und, falls E-Mail-Funktionen genutzt werden, Mailgun (E-Mail-Versand). Eine Verarbeitung außerhalb der Europäischen Union kann bei diesen Anbietern nicht ausgeschlossen werden.</p>
    <h2>Karte exportieren, wieder öffnen und schließen</h2>
    <p>Der private Kartenlink muss selbst sicher gespeichert werden. Ist er verloren, stellt dir das Geschäft die Karte neu aus: gleicher Stand, gleicher Verlauf. Der alte Link und der alte QR-Code funktionieren danach nicht mehr. Auf deiner Karte kannst du deine Daten exportieren und die Karte selbst schließen. Beim Schließen werden Link und QR-Code ungültig, hinterlegte Kontakt- und Wiederherstellungsdaten werden entfernt. Buchungen, Einlösungen und der Verlauf deiner Einwilligungen bleiben unter einer pseudonymen Karten-ID erhalten, damit Buchungen nachvollziehbar bleiben und Einwilligungen nachgewiesen werden können. Sie werden nicht für andere Zwecke genutzt. Eine feste Löschfrist dafür ist noch nicht festgelegt.</p>
    <h2>Deine Rechte</h2>
    <p>Du hast das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung und Datenübertragbarkeit, das Recht auf Widerspruch gegen Verarbeitungen aufgrund berechtigter Interessen sowie das Recht, erteilte Einwilligungen zu widerrufen. Wende dich dafür an das Geschäft oder an support@getloynara.com. Du kannst dich außerdem bei einer Datenschutzaufsichtsbehörde beschweren. Für Loynara ist der Hessische Beauftragte für Datenschutz und Informationsfreiheit, Wilhelmstraße 7, 65185 Wiesbaden, zuständig.</p>
    </article>
  </AuthShell>;
}
