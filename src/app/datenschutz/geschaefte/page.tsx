import { AuthShell } from "@/components/ui/auth-shell";
import styles from "@/components/ui/legal-text.module.css";
import { OWNER_PRIVACY_NOTICE } from "@/lib/owner-privacy";

export const metadata = { title: "Datenschutzhinweise für Geschäfte – Loynara" };

// Legal's text, verbatim (legal-ops/2026-11-19-eng-277-owner-consent.md).
export default function GeschaefteDatenschutzPage() {
  return <AuthShell width="reading">
    <article className={styles.legal}>
    <h1>Datenschutzhinweise für Geschäfte</h1>
    <p>Stand: {OWNER_PRIVACY_NOTICE.stand}. Diese Hinweise gelten für alle, die für ein Geschäft ein Konto bei Loynara haben: Inhaber:innen, Leitung und Kasse. Für die Kundinnen und Kunden eines Geschäfts gelten die <a href="/datenschutz">Datenschutzhinweise zur Kundenkarte</a>.</p>
    <p><strong>Verantwortlich</strong> für dein Konto als Inhaber:in und für den Vertrag mit deinem Geschäft ist der Betreiber von Loynara, siehe <a href="https://getloynara.com/impressum/" target="_blank" rel="noopener">Impressum</a>. Für die Zugänge von Leitung und Kasse ist das Geschäft verantwortlich. Loynara verarbeitet sie in seinem Auftrag.</p>
    <p><strong>Was wir speichern:</strong> deinen Namen, deine E-Mail-Adresse, dein Passwort nur als Prüfwert, deine Rolle und dein Geschäft sowie deine Buchungen und Änderungen im Programm mit Uhrzeit. Bei jeder Anmeldung speichern wir die Sitzung mit IP-Adresse und Browser. Zum Schutz vor Missbrauch zählen wir Anmeldeversuche; dafür speichern wir von der IP-Adresse nur einen Prüfwert. Als Inhaber:in außerdem: wann du welche Fassung der Vertragsbedingungen und des Vertrags zur Auftragsverarbeitung angenommen hast, und die Rechnungsdaten deines Geschäfts. Ohne Namen und E-Mail-Adresse können wir kein Konto einrichten.</p>
    <p><strong>Warum:</strong> für den Vertrag mit deinem Geschäft und für dein Konto (Art. 6 Abs. 1 Buchst. b DSGVO; handelst du für ein Unternehmen, Buchst. f: unser Interesse ist, den Vertrag mit ihm zu erfüllen). Sitzungen und Anmeldeversuche, um dein Konto und die Plattform zu schützen (Buchst. f). Rechnungen, weil Handels- und Steuerrecht es verlangen (Buchst. c).</p>
    {/* Names the verification (ENG-278) and password-reset (ENG-279) emails: this page merges only after or together with them. */}
    <p><strong>E-Mails:</strong> Wir schicken dir E-Mails, die zu deinem Konto und zum Vertrag gehören: die Bestätigung deiner E-Mail-Adresse, das Zurücksetzen deines Passworts, Erinnerungen und Berichte zu deinem Programm. Werbung schicken wir dir nur mit deiner Einwilligung.</p>
    <p><strong>Empfänger:</strong> Railway (Hosting der Anwendung und Datenbank), Cloudflare (Auslieferung und Schutz der Verbindung), Mailgun (E-Mail-Versand, über Server in der EU) und, sobald die Abrechnung läuft, Stripe (Zahlungen). Eine Verarbeitung außerhalb der Europäischen Union kann bei diesen Anbietern nicht ausgeschlossen werden.</p>
    {/* ENG-323: Legal's T-1 (legal-ops/2026-11-21-eng-323-google-places.md); the refresh is lib/place-refresh. */}
    <p><strong>Standortsuche:</strong> Die Lage deines Geschäfts bestimmst du über eine Suche. Dafür schicken wir deinen Suchtext über unseren Server an Google (Google Places API) und rufen für den Vorschlag, den du wählst, dessen Koordinaten ab. Google erhält dabei weder deinen Namen noch deine E-Mail-Adresse noch deine IP-Adresse. Google verarbeitet den Suchtext als eigener Verantwortlicher nach der <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Datenschutzerklärung von Google</a> und kann ihn auch in den USA verarbeiten; Grundlage ist der Angemessenheitsbeschluss der EU-Kommission zum EU-US Data Privacy Framework, nach dem die Google LLC zertifiziert ist. Die Koordinaten speichern wir beim Standort, damit Wallet-Karten deiner Kundschaft in der Nähe des Geschäfts angezeigt werden können, und frischen sie regelmäßig bei Google auf.</p>
    {/* The 48-hour promise is kept by the worker's daily pruneExpiredRateLimits (ENG-281); Legal: never one without the other. */}
    <p><strong>Wie lange:</strong> Eine Sitzung endet nach sieben Tagen. Die Zähler für Anmeldeversuche löschen wir spätestens 48 Stunden nach Ablauf ihres Zeitfensters. Dein Konto löschen wir mit den Daten deines Geschäfts, wenn der Vertrag endet und die Exportfrist abgelaufen ist. Die Annahme des Vertrags und die Rechnungen bewahren wir auf, solange Handels- und Steuerrecht es verlangen, Rechnungen bis zu acht Jahre.</p>
    <p><strong>Deine Rechte:</strong> Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch gegen Verarbeitungen aufgrund berechtigter Interessen. Wende dich dafür an support@getloynara.com, als Leitung oder Kasse auch an dein Geschäft. Du kannst dich außerdem bei einer Datenschutzaufsichtsbehörde beschweren. Für Loynara ist der Hessische Beauftragte für Datenschutz und Informationsfreiheit, Wilhelmstraße 7, 65185 Wiesbaden, zuständig.</p>
    </article>
  </AuthShell>;
}
