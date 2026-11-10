import { AuthShell } from "@/components/ui/auth-shell";
import styles from "@/components/ui/legal-text.module.css";

// The same address as the legal links (ui/legal-links, a client module whose constants a server page cannot read).
const IMPRESSUM = "https://getloynara.com/impressum/";
const impressum = <a href={IMPRESSUM} target="_blank" rel="noopener">Impressum</a>;

/** Legal's demo privacy notice (legal-ops/2026-11-09-demo-mode-review.md), served at /datenschutz in the demo environment. */
export function DemoPrivacy() {
  return <AuthShell width="reading">
    <article className={styles.legal}>
      <h1>Datenschutzhinweise zur Demo</h1>
      <p>Diese Seite ist eine Vorführung von Loynara. Sie zeigt, wie eine Kundenkarte für ein Geschäft aussehen würde. Das Geschäft, dessen Name und Logo du siehst, betreibt diese Demo nicht.</p>
      <p><strong>Verantwortlich</strong> ist der Betreiber von Loynara, siehe {impressum}.</p>
      <p><strong>Was wir speichern:</strong> einen zufälligen Kartenlink, einen QR-Kartencode, eine Kartennummer, Stempel und Einlösungen mit Uhrzeit. Wenn du die Karte zu Apple Wallet hinzufügst, meldet dein Gerät uns eine Gerätekennung und einen Push-Token. Wenn du Nachrichten erlaubst, speichern wir deine Einwilligung mit Zeitpunkt und Textversion und die gesendeten Nachrichten. Name, E-Mail-Adresse oder Telefonnummer fragen wir nicht ab.</p>
      <p><strong>Warum:</strong> für die Vorführung, die du dir ansiehst (Art. 6 Abs. 1 Buchst. f DSGVO; unser Interesse ist, dir Loynara zu zeigen). Nachrichten auf deiner Wallet-Karte nur mit deiner Einwilligung (Art. 6 Abs. 1 Buchst. a DSGVO). Du kannst sie jederzeit auf der Karte abschalten.</p>
      <p><strong>Wie lange:</strong> 24 Stunden nach dem Start der Demo wird die Karte ungültig. Etwa eine Stunde später löschen wir alle Daten der Demo, spätestens 48 Stunden nach dem Start. Den ungültigen Pass kannst du selbst aus deiner Wallet löschen.</p>
      <p><strong>Dienstleister:</strong> Railway (Hosting), Cloudflare (Auslieferung und Schutz der Verbindung) und Apple (Push-Benachrichtigungen für den Pass, ohne Karteninhalte). In der Demo gibt es keine E-Mails, keine Zahlungen und kein Google. Eine Verarbeitung außerhalb der Europäischen Union kann bei diesen Anbietern nicht ausgeschlossen werden.</p>
      <p><strong>Deine Rechte:</strong> Auskunft, Berichtigung, Löschung, Einschränkung, Widerspruch gegen die Verarbeitung und Beschwerde bei einer Datenschutz-Aufsichtsbehörde. Kontakt: siehe {impressum}.</p>
    </article>
  </AuthShell>;
}
