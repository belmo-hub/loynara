import { notFound } from "next/navigation";
import { AuthShell } from "@/components/ui/auth-shell";
import styles from "@/components/ui/legal-text.module.css";
import { AVV_FILL_INS, hasOpenMarks, OWNER_AVV, OWNER_TERMS } from "@/lib/owner-contract";

export const metadata = { title: "Vertrag zur Auftragsverarbeitung – Loynara" };

// Legal's AVV (legal-drafts-2026-10-17/02-avv.md, Stand 22.10.) with the web changes of part 2 of
// legal-ops/2026-11-20-vertragsbedingungen-geschaefte-draft.md: proposed fill-ins as proposed, the counsel marks left out.
// The fill-ins still open come from AVV_FILL_INS; the configuration gate keeps sign-up closed while any is left.
export default function AvvPage() {
  // Legal: never with an open fill-in; otherwise always readable, so a shop that accepted can read its contract.
  if (hasOpenMarks()) notFound();
  return <AuthShell width="reading">
    <article className={styles.legal}>
    <h1>Vertrag zur Auftragsverarbeitung</h1>
    <p>Vertrag über die Verarbeitung personenbezogener Daten im Auftrag nach Art. 28 DSGVO. Stand: {OWNER_AVV.stand}. Fassung {OWNER_AVV.version}.</p>
    <p><strong>Verantwortlicher</strong> (nachfolgend „Betrieb“): der Betrieb, der die <a href={OWNER_TERMS.href}>Vertragsbedingungen für Geschäfte</a> angenommen hat; Name und Anschrift laut Inhaberbereich. Weisungsberechtigt: das Inhaberkonto. E-Mail für Datenschutzfragen: die E-Mail-Adresse des Inhaberkontos.</p>
    <p><strong>Auftragsverarbeiter</strong> (nachfolgend „Anbieter“): Youssef Belmokhtar, Loynara, Friedrich-Ebert-Straße 70, 34119 Kassel, Deutschland, E-Mail: support@getloynara.com. Ansprechperson für Datenschutz: der Anbieter, support@getloynara.com.</p>

    <h2>§ 1 Gegenstand und Dauer</h2>
    <p>(1) Der Anbieter betreibt für den Betrieb das digitale Kundenkartenprogramm „Loynara“ nach den Vertragsbedingungen für Geschäfte (Hauptvertrag). Gegenstand, Art und Zweck der Verarbeitung, Art der Daten und Kategorien betroffener Personen beschreibt Anlage 1.</p>
    <p>(2) Dieser Vertrag gilt, solange der Anbieter personenbezogene Daten im Auftrag des Betriebs verarbeitet, einschließlich der Löschung nach § 8.</p>
    <p>(3) Nicht Gegenstand dieses Vertrags sind Daten, die der Anbieter als eigener Verantwortlicher verarbeitet, insbesondere Vertrags-, Rechnungs- und Kontaktdaten des Betriebs für die Abwicklung des Hauptvertrags.</p>

    <h2>§ 2 Weisungen</h2>
    <p>(1) Der Anbieter verarbeitet die Daten nur auf dokumentierte Weisung des Betriebs, auch für Übermittlungen in ein Drittland, es sei denn, er ist nach Unionsrecht oder deutschem Recht dazu verpflichtet. In diesem Fall teilt er dem Betrieb die rechtliche Anforderung vorher mit, sofern das Recht dies nicht verbietet.</p>
    <p>(2) Weisungen sind dieser Vertrag, der Hauptvertrag, die Einstellungen und Handlungen des Betriebs und seiner Beschäftigten in der Anwendung (zum Beispiel Programmregeln, Buchungen, Korrekturen, Neuausstellung von Karten, Exporte, E-Mail-Angebote, Nachrichten auf der Wallet-Karte, automatische Erinnerungen) sowie Einzelweisungen in Textform an support@getloynara.com.</p>
    <p>(3) Hält der Anbieter eine Weisung für rechtswidrig, weist er den Betrieb unverzüglich darauf hin. Er darf die Ausführung aussetzen, bis der Betrieb sie bestätigt oder ändert.</p>

    <h2>§ 3 Pflichten des Anbieters</h2>
    <p>(1) <strong>Vertraulichkeit.</strong> Zugang zu den Daten erhalten nur Personen, die zur Vertraulichkeit verpflichtet sind oder einer gesetzlichen Verschwiegenheitspflicht unterliegen. Derzeit sind das: der Betreiber persönlich.</p>
    <p>(2) <strong>Sicherheit.</strong> Der Anbieter trifft die technischen und organisatorischen Maßnahmen nach Art. 32 DSGVO, die Anlage 2 beschreibt. Er darf sie dem technischen Fortschritt anpassen, ohne das Schutzniveau zu senken.</p>
    <p>(3) <strong>Betroffenenrechte.</strong> Der Anbieter unterstützt den Betrieb bei Anträgen nach Kapitel III DSGVO. Die Anwendung bietet dafür Export einer Karte, Neuausstellung, Schließung durch die Kundin oder den Kunden und Abmeldung von E-Mail-Angeboten. Anträge, die beim Anbieter eingehen, leitet er unverzüglich an den Betrieb weiter und beantwortet sie nur auf dessen Weisung.</p>
    <p>(4) <strong>Unterstützung nach Art. 32 bis 36 DSGVO.</strong> Der Anbieter unterstützt den Betrieb bei Sicherheit, Meldungen von Datenschutzverletzungen, Datenschutz-Folgenabschätzungen und vorherigen Konsultationen, soweit es die Art der Verarbeitung und die ihm verfügbaren Informationen erlauben.</p>
    <p>(5) <strong>Datenschutzverletzungen.</strong> Der Anbieter meldet dem Betrieb eine Verletzung des Schutzes personenbezogener Daten unverzüglich, spätestens 24 Stunden nach Kenntnis, mit den Angaben nach Art. 33 Abs. 3 DSGVO, soweit bekannt. Fehlende Angaben reicht er unverzüglich nach.</p>
    <p>(6) Ein Datenschutzbeauftragter ist beim Anbieter nicht benannt, weil die gesetzlichen Voraussetzungen dafür nicht vorliegen. Der Anbieter führt ein Verzeichnis der Verarbeitungstätigkeiten nach Art. 30 Abs. 2 DSGVO.</p>
    <p>(7) Sind die Daten des Betriebs beim Anbieter durch Maßnahmen Dritter gefährdet (zum Beispiel Pfändung oder Insolvenzverfahren), informiert der Anbieter den Betrieb unverzüglich.</p>

    <h2>§ 4 Pflichten des Betriebs</h2>
    <p>Der Betrieb ist für die Rechtmäßigkeit der Verarbeitung und für die Information seiner Kundschaft und seiner Beschäftigten verantwortlich. Einwilligungen in E-Mail-Angebote holt er nur über die dafür vorgesehene Funktion der Karte ein. Fehler oder Unregelmäßigkeiten, die er feststellt, teilt er dem Anbieter unverzüglich mit.</p>

    <h2>§ 5 Unterauftragsverarbeiter</h2>
    <p>(1) Der Betrieb genehmigt die in Anlage 3 genannten Unterauftragsverarbeiter.</p>
    <p>(2) Will der Anbieter einen Unterauftragsverarbeiter hinzuziehen oder ersetzen, informiert er den Betrieb mindestens 14 Tage vorher in Textform. Der Betrieb kann innerhalb dieser Frist aus wichtigem datenschutzrechtlichem Grund widersprechen. Einigen sich die Parteien nicht, kann jede Seite den Hauptvertrag zum Zeitpunkt der Änderung kündigen.</p>
    <p>(3) Der Anbieter verpflichtet jeden Unterauftragsverarbeiter vertraglich auf Datenschutzpflichten, die diesem Vertrag entsprechen (Art. 28 Abs. 4 DSGVO). Er haftet gegenüber dem Betrieb für deren Einhaltung.</p>

    <h2>§ 6 Ort der Verarbeitung, Drittländer</h2>
    <p>Die Daten werden vorrangig in der Europäischen Union verarbeitet. Eine Übermittlung in ein Drittland oder ein Zugriff von dort erfolgt nur, wenn die Voraussetzungen der Art. 44 ff. DSGVO erfüllt sind, für die Anbieter in Anlage 3 auf der dort genannten Grundlage (Angemessenheitsbeschluss, insbesondere EU-US Data Privacy Framework, oder Standardvertragsklauseln).</p>

    <h2>§ 7 Nachweise und Kontrollen</h2>
    <p>(1) Der Anbieter stellt dem Betrieb die Informationen zur Verfügung, die zum Nachweis der Pflichten aus Art. 28 DSGVO nötig sind, in erster Linie durch diesen Vertrag mit Anlagen, schriftliche Auskünfte und Nachweise seiner Dienstleister.</p>
    <p>(2) Der Betrieb oder ein von ihm beauftragter, zur Verschwiegenheit verpflichteter Prüfer, der kein Wettbewerber des Anbieters ist, darf Kontrollen durchführen, auch vor Ort, nach Anmeldung mit angemessener Frist (in der Regel 14 Tage) und während der Geschäftszeiten, ohne den Betrieb des Dienstes zu stören. Jede Seite trägt ihre eigenen Kosten.</p>

    <h2>§ 8 Löschung und Rückgabe</h2>
    <p>(1) Der Betrieb kann seine Daten während der Laufzeit und noch 30 Tage nach Vertragsende im Inhaberbereich exportieren. Das gilt als Rückgabe.</p>
    <p>(2) Danach löscht der Anbieter alle Daten des Betriebs innerhalb von 7 Tagen, soweit keine gesetzliche Pflicht zur Speicherung besteht, und bestätigt die Löschung in Textform. Verschlüsselte Sicherungskopien werden nicht einzeln bearbeitet; sie werden 14 Tage nach ihrer Erstellung gelöscht und bis dahin nur zur Wiederherstellung genutzt. Wird eine Sicherung eingespielt, löscht der Anbieter bereits gelöschte Daten erneut, bevor der Dienst wieder freigegeben wird. Ausgenommen sind Prüfwerte (Hashes) von E-Mail-Adressen, an die eine E-Mail dauerhaft nicht zugestellt werden konnte oder über die eine Spam-Beschwerde einging; sie speichert der Anbieter in eigener Verantwortung zum Schutz des E-Mail-Versands der Plattform und löscht sie 24 Monate nach dem letzten solchen Ereignis.</p>

    <h2>§ 9 Haftung und Schlussbestimmungen</h2>
    <p>(1) Für die Haftung gegenüber betroffenen Personen gilt Art. 82 DSGVO. Im Verhältnis zwischen den Parteien gilt die Haftungsregelung des Hauptvertrags, soweit Art. 82 DSGVO nicht entgegensteht.</p>
    <p>(2) Bei Widersprüchen geht dieser Vertrag in Fragen des Datenschutzes dem Hauptvertrag vor. Änderungen bedürfen der Textform. Ist eine Bestimmung unwirksam, bleibt der Vertrag im Übrigen wirksam. Es gilt deutsches Recht.</p>
    <p>(3) Anlagen: 1 Beschreibung der Verarbeitung · 2 Technische und organisatorische Maßnahmen · 3 Unterauftragsverarbeiter.</p>
    <p>Dieser Vertrag kommt zusammen mit dem Hauptvertrag zustande, wenn der Betrieb ihn bei der Registrierung annimmt. Das elektronische Format genügt (Art. 28 Abs. 9 DSGVO). Diesen Vertrag kann der Betrieb auf dieser Seite jederzeit ausdrucken oder speichern. Frühere Fassungen schickt der Anbieter auf Anfrage.</p>

    <h2>Anlage 1 · Beschreibung der Verarbeitung</h2>
    <p><strong>Zweck:</strong> Betrieb des digitalen Kundenkartenprogramms des Betriebs: Karten anlegen, Stempel oder Punkte nach Bestätigung durch das Team buchen, Prämien einlösen, Empfehlungen, Auswertungen für den Betrieb, Schutz vor Missbrauch. Soweit freigeschaltet: Wiederherstellung der Karte per E-Mail, Nachrichten des Betriebs an seine Kundschaft per E-Mail oder auf der Wallet-Karte, einschließlich automatischer Erinnerungen, jeweils mit Einwilligung, Antippen per NFC-Schild, Wallet-Pässe, Benachrichtigung auf dem Kassengerät.</p>
    <p><strong>Art der Verarbeitung:</strong> Erheben, Speichern, Abfragen, Verwenden, Anzeigen für das Team, Übermitteln an Unterauftragsverarbeiter (Anlage 3), Export, Löschen.</p>
    <p><strong>Betroffene Personen:</strong> (a) Kundinnen und Kunden des Betriebs, die eine Karte anlegen, einschließlich Personen, die über eine Empfehlung kommen. (b) Beschäftigte und andere Personen, denen der Betrieb Zugang gibt (Leitung, Kasse).</p>
    <p><strong>Daten der Kundschaft:</strong> Kartendaten: zufällige Karten-ID, privater Zugangslink, davon getrennter QR-Kartencode, kurze Kartennummer, Programm, Standort, Anlage- und Schließdatum. Buchungsdaten: Stempel- oder Punktestand, vom Team bestätigte Buchungen mit Zeitpunkt, Standort und bestätigender Person, Korrekturen mit Begründung, Einlösungen; bei Punkteprogrammen der Einkaufsbetrag. Empfehlungen: Verbindung zwischen den beteiligten Karten und Bonusstatus. Sicherheitsdaten: technische Sicherheitsereignisse der Karte, Zähler für Anfragebegrenzung (IP-Adresse nur als HMAC-Wert), technisch notwendige Cookies und Browserspeicher.</p>
    <p><strong>Nur wenn genutzt:</strong> E-Mail-Adresse zur Wiederherstellung (per Bestätigung geprüft); Einwilligung in E-Mail-Angebote mit Zeitpunkt und Textversion, Abmeldungen, Versand- und Zustellstatus; NFC: Kennung des Schilds, Zähler, Zeitpunkt und Status des Antippens; Wallet: Pass-Kennung, Plattform und Status, bei Apple Wallet zusätzlich Gerätekennung und Push-Token des Geräts; Wallet-Nachrichten: Einwilligung mit Zeitpunkt und Textversion, Abmeldungen, Inhalt, Zeitpunkt und Zustellstatus versendeter Nachrichten; Geburtstag: Tag und Monat ohne Jahr, freiwillig und jederzeit löschbar.</p>
    <p><strong>Nicht erhoben:</strong> Name, Telefonnummer, Anschrift, Geburtsdatum und Zahlungsdaten der Kundschaft. Eine E-Mail-Adresse ist für die Karte nicht erforderlich. Besondere Kategorien nach Art. 9 DSGVO werden nicht verarbeitet.</p>
    <p><strong>Daten der Beschäftigten:</strong> Name, E-Mail-Adresse, Rolle und Standortzuordnung, Einladungen und Zugangsverlauf, Anmeldesitzungen mit IP-Adresse und Browserkennung, von ihnen bestätigte Buchungen, Push-Abonnement des Kassengeräts (falls genutzt).</p>
    <p><strong>Trennung der Betriebe:</strong> Daten eines Betriebs sind nur diesem Betrieb zugänglich. Eine Karte gilt nur bei dem Betrieb, bei dem sie angelegt wurde. Es gibt keine betriebsübergreifende Auswertung oder Werbung.</p>
    <p><strong>Neuausstellung:</strong> Verliert jemand den Kartenlink, stellt der Betrieb die Karte neu aus: gleicher Stand, gleicher Verlauf; alter Link und alter QR-Code werden ungültig.</p>
    <p><strong>Speicherdauer:</strong> Karten bleiben gespeichert, solange sie genutzt werden. Schließt die Kundin oder der Kunde die Karte, werden Link und QR-Code sofort ungültig und Kontakt- und Wiederherstellungsdaten entfernt. Buchungen, Einlösungen und Einwilligungsverlauf einer geschlossenen Karte bleiben derzeit unter einer pseudonymen Karten-ID gespeichert. Eine feste Löschfrist dafür ist noch nicht festgelegt. Bei Vertragsende gilt § 8.</p>
    <p><strong>Ort:</strong> Hosting in der EU (Rechenzentrum Amsterdam); Ausnahmen und Dienstleister siehe Anlage 3.</p>

    <h2>Anlage 2 · Technische und organisatorische Maßnahmen (Art. 32 DSGVO)</h2>
    <p><strong>Zutritt.</strong> Der Anbieter betreibt kein eigenes Rechenzentrum. Anwendung und Datenbank laufen bei Railway (Region EU West, Amsterdam), Auslieferung und Sicherungen über Cloudflare; die physische Sicherheit verantworten diese Anbieter. {AVV_FILL_INS.devices}</p>
    <p><strong>Zugang.</strong> Produktionssysteme sind nur über persönliche Konten des Anbieters bei den Dienstleistern erreichbar. {AVV_FILL_INS.twoFactor} Schlüssel und Passwörter liegen in den Variablenspeichern der Dienstleister oder in verschlüsselter Verwahrung, nicht im Quellcode. Anmeldeversuche des Teams sind begrenzt; Ratenbegrenzung verhindert das Erraten von Kartenlinks.</p>
    <p><strong>Zugriff.</strong> Rollen je Betrieb und Standort: Inhaber, Leitung, Kasse. Die Kasse kann keine Korrekturen buchen; große Korrekturen bestätigt die Inhaberin oder der Inhaber. Entzogene Zugänge werden sofort für Buchung, Kartensuche und offene Antipp-Anfragen gesperrt. Eine Karte öffnet nur, wer ihren zufälligen privaten Link kennt.</p>
    <p><strong>Trennung.</strong> Jede Abfrage ist an den Betrieb gebunden. Ein Betrieb kann Karten eines anderen Betriebs weder per QR-Code noch per Kartennummer finden; das wird bei der Abnahme jeder Version geprüft.</p>
    <p><strong>Datensparsamkeit und Pseudonymisierung.</strong> Kein Name und keine Pflicht-E-Mail für die Karte. Das Team sieht Kartennummern statt Namen. IP-Adressen werden für Anfragebegrenzungen nur als HMAC-Wert verarbeitet (IPv6 auf /64 gekürzt).</p>
    <p><strong>Weitergabe.</strong> Verbindungen zur Anwendung und zu den Dienstleistern laufen über HTTPS (TLS). Datenbanksicherungen werden vor der Übertragung verschlüsselt (age) und in einem privaten Speicher im EU-Rechtsraum (Cloudflare R2) abgelegt. E-Mails werden über die EU-Region von Mailgun versendet. Benachrichtigungen auf dem Kassengerät enthalten keine Kundendaten, nur den Hinweis auf eine offene Anfrage.</p>
    <p><strong>Eingabekontrolle.</strong> Buchungen entstehen nur nach Bestätigung durch angemeldete Teammitglieder und speichern Zeitpunkt und bestätigende Person. Buchungen werden nicht überschrieben: eine Korrektur ist ein eigener Eintrag mit Begründung. Einlösungen und Prämienversionen sind in der Datenbank gegen Änderung und Löschung gesperrt. Schutz gegen Doppelbuchungen bei wiederholten Anfragen. Einladung, Annahme und Entzug von Team-Zugängen werden unveränderlich protokolliert. Einwilligungen werden mit Zeitpunkt und Textversion protokolliert.</p>
    <p><strong>Verfügbarkeit und Wiederherstellung.</strong> Tägliche automatische Datenbanksicherung, verschlüsselt (age) und außerhalb des Hosters gespeichert. Der Anbieter prüft die Wiederherstellung aus einer Sicherung in einer getrennten Umgebung, erstmals bis zum 4. Dezember 2026, danach mindestens einmal im Kalendervierteljahr, und hält jeden Test mit Datum und Ergebnis fest. Jede Freigabe hält die vorherigen Versionen als Ziel für eine Rücknahme fest. Erreichbarkeit, Hintergrunddienst und Sicherung werden überwacht; bei einem Ausfall wird der Anbieter benachrichtigt.</p>
    <p><strong>Regelmäßige Überprüfung.</strong> Codeänderungen werden vor der Freigabe automatisch getestet. Freigaben erfolgen nur für genau geprüfte Versionen. Verfahren für Datenschutzverletzungen und Auskunftsanträge sind schriftlich festgelegt. Die Maßnahmen werden mindestens jährlich und bei wesentlichen Änderungen überprüft.</p>

    <h2>Anlage 3 · Unterauftragsverarbeiter</h2>
    <p><strong>Railway</strong>, {AVV_FILL_INS.railway}. Leistung: Hosting von Anwendung, Hintergrunddienst und Datenbank. Ort der Verarbeitung: Region EU West, Amsterdam. Grundlage für Drittlandbezug: {AVV_FILL_INS.railwayBasis}.</p>
    <p><strong>Cloudflare</strong>, {AVV_FILL_INS.cloudflare}. Leistung: DNS, TLS und Schutz der Verbindung; Speicher für verschlüsselte Sicherungen (R2). Ort der Verarbeitung: Weltweites Netz; Sicherungsspeicher im EU-Rechtsraum. Grundlage für Drittlandbezug: {AVV_FILL_INS.cloudflareBasis}.</p>
    <p><strong>Mailgun</strong>, {AVV_FILL_INS.mailgun}. Leistung: Versand von E-Mails an die Kundschaft (Bestätigung und Wiederherstellung; E-Mail-Angebote nur wenn freigeschaltet) und an das Team (Bestätigung der E-Mail-Adresse, Zurücksetzen des Passworts). Ort der Verarbeitung: EU-Region (Versand über api.eu.mailgun.net). Grundlage für Drittlandbezug: {AVV_FILL_INS.mailgunBasis}.</p>
    <p><strong>Apple.</strong> Apple-Wallet-Pässe erstellt und signiert der Anbieter selbst; das Gerät lädt sie von den Servern des Anbieters. Für Aktualisierungen schickt der Anbieter über den Apple Push Notification Service eine Benachrichtigung ohne Inhalt an das Gerät; Apple erhält dabei den Push-Token des Geräts, aber keine Karteninhalte. Die weitere Verarbeitung im Apple Wallet der Kundin oder des Kunden richtet sich nach Apples eigenen Bedingungen.</p>
    <p><strong>Ohne Zugriff auf Kundendaten.</strong> Push-Dienste der Kassengeräte (Apple, Google, Mozilla) erhalten nur eine verschlüsselte Benachrichtigung ohne Kundendaten. Die Überwachungsdienste Healthchecks.io (SIA Monkey See Monkey Do, Matīsa iela 61A - 20, Rīga, LV-1009, Lettland) für Heartbeats und UptimeRobot (UptimeRobot s. r. o., Obchodná 507/2, 811 06 Bratislava, Slowakei) für die Erreichbarkeitsprüfung erhalten keine personenbezogenen Daten der Kundschaft.</p>
    </article>
  </AuthShell>;
}
