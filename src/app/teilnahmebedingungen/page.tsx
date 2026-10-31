import Link from "next/link";
import { AuthShell } from "@/components/ui/auth-shell";
import { LegalBack, LegalContents } from "@/components/ui/legal-links";
import styles from "@/components/ui/legal-text.module.css";

export default function TeilnahmebedingungenPage() {
  return <AuthShell width="reading">
    <article className={styles.legal}>
    <LegalBack />
    <h1>Teilnahmebedingungen</h1>
    <p>Stand: 30. Oktober 2026. Diese Bedingungen gelten für die digitale Kundenkarte, die du bei einem Geschäft über Loynara anlegst.</p>
    <LegalContents />
    <h2>Wer bietet das Programm an?</h2>
    <p>Das Programm bietet das Geschäft an, dessen Name und Standort auf deiner Karte stehen. Jedes Geschäft legt seine Regeln und Prämien selbst fest. Es gelten die Regeln, die auf deiner Karte angezeigt werden. Das Geschäft kann sie für die Zukunft ändern. Verbesserungen gelten sofort. Ändert das Geschäft etwas zu deinem Nachteil, zeigt deine Karte das mindestens vier Wochen vorher mit Datum an, zum Beispiel wenn eine Prämie mehr Stempel oder Punkte braucht, kleiner oder eingeschränkt wird oder wegfällt, oder wenn du für deinen Einkauf weniger bekommst. Bis dahin gilt die bisherige Regel. Deine gesammelten Stempel und Punkte bleiben erhalten. Extra-Boni wie den Willkommen-zurück- oder den Geburtstagsbonus kann das Geschäft jederzeit ändern oder beenden; schon gebuchte Boni bleiben dir. Die technische Plattform betreibt Youssef Belmokhtar, Loynara, Friedrich-Ebert-Straße 70, 34119 Kassel, support@getloynara.com.</p>
    <h2>Teilnahme</h2>
    <p>Die Teilnahme ist freiwillig und für dich kostenlos. Du brauchst dafür keine App und keine E-Mail-Adresse. Die Karte gehört zu einem privaten Link, den du selbst sicher aufbewahren solltest. Wer den Link kennt, kann die Karte öffnen.</p>
    <h2>Stempel, Punkte und Prämien</h2>
    <p>Stempel und Punkte werden erst gutgeschrieben, wenn das Team des Geschäfts deinen Besuch oder Einkauf bestätigt hat. Teilen, Öffnen oder Anmelden allein bringt nichts. Jede Buchung steht mit Uhrzeit im Verlauf deiner Karte. Fehlerhafte Buchungen kann das Geschäft mit Begründung korrigieren; die ursprüngliche Buchung und die Korrektur bleiben nachvollziehbar.</p>
    <p>Stempel und Punkte haben keinen Geldwert, werden nicht ausgezahlt und sind nicht auf andere Karten oder andere Geschäfte übertragbar. Die Einlösung einer Prämie wird online anhand des Kartenstands geprüft und vom Team des Geschäfts bestätigt. Danach wird der Kartenstand entsprechend den Programmregeln angepasst.</p>
    <h2>Empfehlungen</h2>
    <p>Wenn das Geschäft Empfehlungen anbietet, kannst du deinen persönlichen Link teilen. Ein Bonus wird erst gebucht, wenn das Team den ersten Besuch der geworbenen Person bestätigt hat, und nur einmal. Auffällige Fälle, etwa dieselbe verifizierte E-Mail-Adresse, werden zur Prüfung zurückgestellt. Ändert das Geschäft seine Regeln, bleibt für eine Empfehlung die Regel gültig, die bei der Anmeldung der geworbenen Person galt.</p>
    <h2>Karte verloren, exportieren und schließen</h2>
    <p>Wenn du den Link verlierst, kann das Geschäft deine Karte neu ausstellen. Der alte Link und der alte QR-Code funktionieren danach nicht mehr. Du kannst deine Kartendaten exportieren und die Karte jederzeit selbst schließen. Näheres steht in den <Link href="/datenschutz">Datenschutzhinweisen</Link>.</p>
    </article>
  </AuthShell>;
}
