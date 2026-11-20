import { notFound } from "next/navigation";
import { AuthShell } from "@/components/ui/auth-shell";
import styles from "@/components/ui/legal-text.module.css";
import { OWNER_AVV, OWNER_TERMS } from "@/lib/owner-contract";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vertragsbedingungen für Geschäfte – Loynara" };

// Legal's text, verbatim (legal-ops/2026-11-20-vertragsbedingungen-geschaefte-draft.md, part 1). The provider's name and
// address are the Impressum's, as on /datenschutz.
export default function VertragsbedingungenPage() {
  // Legal: online only while /register is open; read per request, like the register layout.
  if (process.env.PUBLIC_REGISTRATION_ENABLED !== "true") notFound();
  return <AuthShell width="reading">
    <article className={styles.legal}>
    <h1>Vertragsbedingungen für Geschäfte</h1>
    <p>Stand: {OWNER_TERMS.stand}. Fassung {OWNER_TERMS.version}.</p>
    <p><strong>Anbieter:</strong> Youssef Belmokhtar, Loynara, Friedrich-Ebert-Straße 70, 34119 Kassel, Deutschland, E-Mail: support@getloynara.com.<br /><strong>Betrieb:</strong> das Unternehmen, für das ein Konto bei Loynara erstellt wird. Name, Anschrift, Standorte und E-Mail-Adresse trägt der Betrieb bei der Registrierung und im Inhaberbereich ein.</p>

    <h2>§ 0 Geltung</h2>
    <p>(1) Diese Bedingungen gelten für Verträge über Loynara, die ein Betrieb online abschließt. Der Anbieter schließt Verträge nur mit Unternehmern im Sinne von § 14 BGB, die Loynara für ihr Geschäft nutzen.</p>
    <p>(2) Hat der Betrieb mit dem Anbieter eine Vereinbarung unterschrieben, gilt diese, und diese Bedingungen gelten nicht.</p>

    <h2>§ 1 Leistung</h2>
    <p>(1) Der Anbieter stellt dem Betrieb die Software „Loynara“ als Online-Dienst bereit: eine digitale Kundenkarte, die die Kundschaft des Betriebs ohne App im Browser nutzt. Für die Karte braucht die Kundschaft keine E-Mail-Adresse, keinen Namen und keine Telefonnummer. Stempel oder Punkte werden nur gutgeschrieben, wenn das Team des Betriebs den Besuch bestätigt.</p>
    <p>(2) Enthalten sind: Kundenkarte mit Stempeln oder Punkten, Prämien und Einlösung, QR-Einstieg am Tresen, Bestätigung durch das Team mit Rollen (Inhaber, Leitung, Kasse), Empfehlungen, Kundenübersicht und Auswertung, Datenexport und mehrere Standorte. Verliert jemand seinen Kartenlink, stellt der Betrieb die Karte neu aus; Stand und Verlauf bleiben erhalten.</p>
    <p>(3) Enthalten sind außerdem, soweit der Anbieter sie für den Betrieb freigeschaltet hat: NFC-Schild zum Antippen, Apple Wallet und Google Wallet, Benachrichtigung auf dem Kassengerät sowie Nachrichten an die Kundschaft per E-Mail und auf der Wallet-Karte. Sie sind im Preis enthalten. Bis zur Freischaltung arbeitet der Betrieb mit QR-Code und Browserkarte.</p>
    <p>(4) Loynara ist in der Einführungsphase. Der Anbieter entwickelt den Dienst weiter und bittet den Betrieb um Rückmeldungen. Die Funktionen nach Absatz 2 bleiben während der Laufzeit erhalten. Wesentliche Änderungen kündigt der Anbieter mindestens zwei Wochen vorher in Textform an.</p>

    <h2>§ 2 Start, Laufzeit, Kündigung</h2>
    <p>(1) Der Vertrag kommt zustande, wenn der Betrieb bei der Registrierung „Konto erstellen“ wählt. Starttag ist der Tag, an dem der Betrieb sein erstes Programm startet. Jeder Abrechnungsmonat beginnt am Kalendertag des Starttags; hat ein Monat diesen Tag nicht, am letzten Tag des Monats.</p>
    <p>(2) Der erste Abrechnungsmonat ist kostenlos. Für ihn braucht der Anbieter keine Zahlungsdaten. Kündigt der Betrieb nicht, läuft der Vertrag danach weiter. Der Anbieter erinnert den Betrieb spätestens sieben Tage vor Ablauf des ersten Abrechnungsmonats in Textform daran, dass eine Kündigung bis dahin nichts kostet (Abs. 3).</p>
    <p>(3) Danach läuft der Vertrag auf unbestimmte Zeit. Jede Seite kann mit einer Frist von 14 Tagen zum Ende eines Abrechnungsmonats kündigen. Kündigt der Betrieb im ersten Abrechnungsmonat, endet der Vertrag mit dessen Ablauf, frühestens aber 14 Tage nach Zugang der Kündigung, damit die Kundschaft das Ende rechtzeitig auf ihren Karten sieht; für die Zeit nach dem ersten Abrechnungsmonat fällt kein Entgelt an. Textform genügt, zum Beispiel eine E-Mail oder „Programm beenden“ im Inhaberbereich. Nutzt der Betrieb den Dienst nach Vertragsende weiter, verlängert sich der Vertrag dadurch nicht (§ 545 BGB gilt nicht). Die Kündigung aus wichtigem Grund bleibt unberührt.</p>

    <h2>§ 3 Preis und Zahlung</h2>
    <p>(1) Das Entgelt beträgt 49 € je Standort und Monat. Der erste Abrechnungsmonat ist kostenlos (§ 2 Abs. 2); für Standorte, die der Betrieb später hinzunimmt, zahlt er ab ihrem Starttag, im laufenden Abrechnungsmonat anteilig nach Tagen. Eine Einrichtungsgebühr fällt nicht an.</p>
    <p>(2) Alle Preise sind Nettopreise. Schuldet der Anbieter Umsatzsteuer, kommt sie in der gesetzlichen Höhe hinzu und wird in der Rechnung ausgewiesen. Ändert sich das während der Laufzeit, kündigt der Anbieter es mindestens vier Wochen vorher in Textform an.</p>
    <p>(3) Ab dem zweiten Abrechnungsmonat ist das Entgelt jeweils zu Beginn des Abrechnungsmonats fällig. Die Rechnung erhält der Betrieb per E-Mail. Er überweist den Betrag innerhalb von 14 Tagen nach Rechnungsdatum auf das in der Rechnung genannte Konto oder zahlt per SEPA-Lastschrift oder Karte über den Zahlungsdienstleister Stripe; dafür erteilt er im Inhaberbereich ein SEPA-Lastschriftmandat oder hinterlegt eine Karte. Den Einzug kündigt der Anbieter abweichend von der üblichen Frist mindestens zwei Tage vorher an.</p>
    <p>(4) Ist der Betrieb mit mehr als einem Monatsentgelt im Rückstand, darf der Anbieter nach einer Ankündigung in Textform mit 14 Tagen Frist neue Buchungen sperren. Karten, Daten und Export bleiben erhalten.</p>

    <h2>§ 4 Pflichten des Betriebs</h2>
    <p>(1) Der Betrieb bietet das Kundenkartenprogramm seiner Kundschaft selbst an. Er legt Regeln und Prämien fest und löst erreichte Prämien danach ein. Für sein Programm verwendet er die Teilnahmebedingungen und Datenschutzhinweise unter app.getloynara.com/teilnahmebedingungen und app.getloynara.com/datenschutz.</p>
    <p>(2) Der Betrieb gibt Zugänge nur eigenen Beschäftigten, hält Zugangsdaten geheim und entzieht ausscheidenden Personen den Zugang sofort.</p>
    <p>(3) Der Betrieb nutzt die Daten seiner Kundschaft nur für sein Kundenkartenprogramm. Nachrichten mit Angeboten, Neuigkeiten oder Erinnerungen, per E-Mail oder auf der Wallet-Karte, sendet er nur an Personen, die dafür eingewilligt haben. Für Inhalt und Richtigkeit der Nachrichten, die Einhaltung angekündigter Angebote und die gesetzlichen Pflichtangaben ist der Betrieb verantwortlich. Werbung für Tabakerzeugnisse und elektronische Zigaretten ist ausgeschlossen. Stempel, Punkte und Prämien gelten nicht für Waren mit gebundenem Preis, insbesondere Tabakwaren, Bücher, Zeitungen und Zeitschriften.</p>
    <p>(4) Vor dem Ende des Programms informiert der Betrieb seine Kundschaft rechtzeitig und legt fest, wie mit gesammelten Stempeln oder Punkten umgegangen wird.</p>
    <p>(5) Der Betrieb erlaubt dem Anbieter, seinen Namen, sein Logo, seine Farben und die übrigen Inhalte, die er im Inhaberbereich einträgt, für das Kundenkartenprogramm zu nutzen: auf der Kundenkarte, auf Apple-Wallet- und Google-Wallet-Pässen, die der Anbieter unter seinem eigenen Aussteller-Konto ausstellt, auf Aufstellern und NFC-Schildern und in Nachrichten an die Kundschaft. Das Recht ist einfach und gilt für die Laufzeit des Vertrags. Der Betrieb beauftragt den Anbieter, diese Pässe für ihn auszustellen, und erlaubt ihm, die Inhalte an Apple und Google zu übermitteln und ihnen die Nutzungsrechte einzuräumen, die sie für Ausstellung und Anzeige der Pässe brauchen. Auf bereits gespeicherten Pässen, die der Anbieter nicht aus der Ferne löschen kann, dürfen diese Inhalte auch nach Vertragsende bleiben. Der Betrieb sichert zu, dass er diese Rechte einräumen darf. Trifft das nicht zu und hat er das zu vertreten, stellt er den Anbieter von Ansprüchen Dritter frei. Für andere Zwecke nutzt der Anbieter diese Inhalte nicht; als Referenz nennt er den Betrieb nur mit dessen gesonderter Einwilligung in Textform.</p>
    <p>(6) Die Angaben bei der Registrierung und im Inhaberbereich macht der Betrieb vollständig und richtig und hält sie aktuell.</p>

    <h2>§ 5 Leistungen des Anbieters</h2>
    <p>(1) Der Anbieter betreibt den Dienst sorgfältig und nach dem Stand der Technik. Der Betrieb richtet sein Programm und die Team-Zugänge im Inhaberbereich selbst ein. Der Anbieter hilft per E-Mail, in der Regel am selben oder nächsten Werktag.</p>
    <p>(2) Eine bestimmte Verfügbarkeit sagt der Anbieter in der Einführungsphase nicht zu. Wartungen kündigt er nach Möglichkeit vorher an. Ist der Dienst an mehr als zwei aufeinanderfolgenden Tagen nicht nutzbar, entfällt das Entgelt für diese Tage anteilig.</p>
    <p>(3) Den QR-Code für den Tresen kann der Betrieb im Inhaberbereich selbst drucken. Stellt der Anbieter einen Aufsteller oder ein NFC-Schild, bleiben sie sein Eigentum und werden nach Vertragsende auf Anfrage zurückgegeben.</p>

    <h2>§ 6 Daten</h2>
    <p>(1) Für die Daten seiner Kundschaft ist der Betrieb Verantwortlicher, der Anbieter verarbeitet sie in seinem Auftrag. Der <a href={OWNER_AVV.href}>Vertrag zur Auftragsverarbeitung</a> (AVV) ist Teil dieses Vertrags und geht in Datenschutzfragen vor.</p>
    <p>(2) Der Anbieter gibt Daten eines Betriebs nicht an andere Betriebe weiter und nutzt sie nicht für eigene Werbung. Eine Karte gilt nur bei dem Betrieb, bei dem sie angelegt wurde.</p>
    <p>(3) Der Betrieb kann seine Daten jederzeit im Inhaberbereich exportieren, nach Vertragsende noch 30 Tage lang. Danach löscht der Anbieter sie nach dem AVV.</p>

    <h2>§ 7 Haftung</h2>
    <p>(1) Der Anbieter haftet unbeschränkt bei Vorsatz und grober Fahrlässigkeit, bei Verletzung von Leben, Körper oder Gesundheit und nach dem Produkthaftungsgesetz.</p>
    <p>(2) Bei leichter Fahrlässigkeit haftet der Anbieter nur für die Verletzung wesentlicher Vertragspflichten, also solcher, deren Erfüllung die Durchführung des Vertrags erst ermöglicht und auf die der Betrieb vertrauen darf. Die Haftung ist dann auf den vertragstypischen, vorhersehbaren Schaden begrenzt, höchstens auf das Zwölffache des vereinbarten Monatsentgelts für alle Standorte. Die Haftung nach Art. 82 DSGVO bleibt unberührt.</p>

    <h2>§ 8 Schluss</h2>
    <p>Änderungen und Ergänzungen bedürfen der Textform. Es gilt deutsches Recht. Gerichtsstand ist Kassel, soweit der Betrieb Kaufmann ist. Ist eine Bestimmung unwirksam, bleibt der Vertrag im Übrigen wirksam. Diese Bedingungen kann der Betrieb auf dieser Seite jederzeit ausdrucken oder speichern. Frühere Fassungen schickt der Anbieter auf Anfrage.</p>
    </article>
  </AuthShell>;
}
