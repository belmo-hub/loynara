import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DatenschutzPage from "./datenschutz/page";
import TeilnahmebedingungenPage from "./teilnahmebedingungen/page";
import GeschaefteDatenschutzPage, { metadata as GeschaefteMetadata } from "./datenschutz/geschaefte/page";
import { InviteClient } from "@/components/invite-client";
import VertragsbedingungenPage, { metadata as TermsMetadata } from "./vertragsbedingungen/page";
import AvvPage, { metadata as AvvMetadata } from "./avv/page";
import { AVV_FILL_INS, hasOpenMarks } from "@/lib/owner-contract";

const search = vi.hoisted(() => ({ value: "" }));
// Lets a test show the pages with an open AVV fill-in; otherwise the real check.
const marks = vi.hoisted(() => ({ open: false }));
vi.mock("@/lib/owner-contract", async importOriginal => {
  const real = await importOriginal<typeof import("@/lib/owner-contract")>();
  return { ...real, hasOpenMarks: (...args: Parameters<typeof real.hasOpenMarks>) => marks.open || real.hasOpenMarks(...args) };
});
vi.mock("next/navigation", async importOriginal => ({ ...await importOriginal<typeof import("next/navigation")>(), useRouter: () => ({}), useSearchParams: () => new URLSearchParams(search.value) }));
const { default: RegisterPage } = await import("./register/page");

// Customers tick a checkbox linking to these pages when they create a card.
describe("customer legal pages", () => {
  it("the demo environment serves Legal's demo privacy notice instead; elsewhere the normal one", () => {
    const saved = process.env.DEMO_ENVIRONMENT;
    process.env.DEMO_ENVIRONMENT = "true";
    try {
      const html = renderToStaticMarkup(createElement(DatenschutzPage));
      expect(html).toContain("<h1>Datenschutzhinweise zur Demo</h1>");
      expect(html).toContain("Das Geschäft, dessen Name und Logo du siehst, betreibt diese Demo nicht.");
      expect(html).toContain("In der Demo gibt es keine E-Mails, keine Zahlungen und kein Google.");
    } finally { if (saved === undefined) delete process.env.DEMO_ENVIRONMENT; else process.env.DEMO_ENVIRONMENT = saved; }
    expect(renderToStaticMarkup(createElement(DatenschutzPage))).not.toContain("zur Demo");
  });

  const pages = [["Datenschutz", DatenschutzPage], ["Teilnahmebedingungen", TeilnahmebedingungenPage]] as const;

  it.each(pages)("%s is final text that names the operator", (_name, Page) => {
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).not.toMatch(/Entwurf|Vor öffentlichem Start|ergänzen/i);
    expect(html).toContain("Friedrich-Ebert-Straße 70");
    expect(html).toContain("support@getloynara.com");
  });

  it("privacy notice uses the recovery email only to recover the card (ENG-171, push only)", () => {
    const html = renderToStaticMarkup(createElement(DatenschutzPage));
    expect(html).toContain("keine Einwilligung in Werbung");
    expect(html).toContain(">Optionale Wiederherstellungsadresse</h2>");
    expect(html).toContain("nur für diesen Zweck verwendet");
    expect(html).not.toContain("e-mail-angebote");
  });

  it("privacy notice has Legal's section on Wallet messages, verbatim", () => {
    const html = renderToStaticMarkup(createElement(DatenschutzPage));
    expect(html).toContain(">Nachrichten auf deiner Wallet-Karte</h2>");
    // ENG-049: Legal's birthday section (22 Oct), right after the Wallet messages.
    expect(html.indexOf(">Nachrichten auf deiner Wallet-Karte</h2>")).toBeLessThan(html.indexOf(">Geburtstag</h2>"));
    expect(html).toContain("Freiwillig kannst du auf deiner Karte Tag und Monat deines Geburtstags hinterlegen, ohne Jahr. Das Geschäft nutzt ihn nur für eine Geburtstagsprämie und, wenn du Nachrichten auf deiner Wallet-Karte erlaubt hast, für eine Erinnerung in deiner Geburtstagswoche. Du kannst ihn jederzeit auf deiner Karte löschen. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms (Art. 6 Abs. 1 Buchst. b DSGVO).");
    for (const part of ["höchstens zwei pro Woche und nicht nachts", "ohne die Karte aus deiner Wallet zu löschen", "Art. 6 Abs. 1 Buchst. a DSGVO"]) expect(html).toContain(part);
    expect(html).not.toContain("E-Mail-Angebote");
    // ENG-306a: Google is an independent controller for Wallet passes, not a Dienstleister.
    expect(html).toContain("Als Dienstleister setzen wir ein: Railway (Hosting der Anwendung und Datenbank), Cloudflare (Auslieferung und Schutz der Verbindung) und, wenn du eine Wiederherstellungsadresse hinterlegst, Mailgun (Versand der Bestätigungs- und Wiederherstellungs-E-Mails). Speicherst du deine Karte in Google Wallet, erhält Google die Inhalte des Passes (Name und Logo des Geschäfts, Kartennummer, QR-Code, Stand, nächste Prämie und, wenn du eingewilligt hast, Nachrichten des Geschäfts) und verarbeitet sie als eigener Verantwortlicher nach den Datenschutzhinweisen von Google.");
    expect(html).not.toContain("bei Google-Wallet-Karten Google");
    expect(html).toContain("Eine Verarbeitung außerhalb der Europäischen Union kann bei diesen Anbietern nicht ausgeschlossen werden. Google kann die Inhalte des Passes auch in den USA verarbeiten; Grundlage ist der Angemessenheitsbeschluss der EU-Kommission zum EU-US Data Privacy Framework, nach dem die Google LLC zertifiziert ist.");
    expect(html).toContain("Wenn du es bei der Anmeldung oder auf deiner Karte ausdrücklich erlaubst, kann dir das Geschäft kurze Nachrichten mit Angeboten, Neuigkeiten und Erinnerungen auf deiner Wallet-Karte schicken, höchstens zwei pro Woche und nicht nachts. Dazu kann eine automatische Erinnerung gehören, wenn du länger nicht da warst. Diese Einwilligung ist freiwillig. Sie wird mit Zeitpunkt und Textversion protokolliert, und du kannst sie jederzeit auf deiner Karte widerrufen, ohne die Karte aus deiner Wallet zu löschen. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 Buchst. a DSGVO). Zugestellt werden die Nachrichten bei Apple Wallet über Apple, bei Google Wallet über Google.");
    expect(html).toContain("Läuft auf deiner Punktekarte ein Teil deiner Punkte bald ab, schickt dir das Geschäft vorher einen Hinweis auf deine Karte in Apple Wallet oder Google Wallet. Dafür musst du nichts erlauben; der Hinweis zählt zu den höchstens zwei Nachrichten pro Woche. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms (Art. 6 Abs. 1 Buchst. b DSGVO).");
  });

  it("privacy notice names Google for Google Wallet cards and splits the pass deactivation", () => {
    const html = renderToStaticMarkup(createElement(DatenschutzPage));
    expect(html).toContain("Wenn du deine Karte zu Google Wallet hinzufügst, übermitteln wir an Google: deine Kartennummer, den QR-Kartencode für die Kasse, deinen Stempel- oder Punktestand, den Fortschritt zur nächsten Prämie sowie Name, Logo, Farbe und gegebenenfalls Standort des Geschäfts. Dein Name, deine E-Mail-Adresse, deine Telefonnummer und dein privater Kartenlink werden nicht übermittelt. Google erstellt und aktualisiert den Pass über die Google Wallet API; die weitere Verarbeitung in deinem Google-Konto richtet sich nach Googles eigenen Bedingungen.");
    expect(html).toContain("Schließt du die Karte oder wird sie neu ausgestellt, werden gespeicherte Pässe nicht aus der Ferne gelöscht. Ein Apple-Wallet-Pass wird als ungültig markiert und sein QR-Code entfernt. Ein Google-Wallet-Pass wird deaktiviert; Kartennummer, QR-Code und Stand werden entfernt. Du kannst den Pass danach selbst aus deiner Wallet löschen.");
    expect(html).toContain("Bei Apple-Wallet-Karten erhält Apple für Aktualisierungen den Push-Token deines Geräts, aber keine Karteninhalte.");
    expect(html).toContain("erstellen wir den Pass mit deinem Kartenstand selbst, und dein Gerät lädt ihn von unserem Server.");
    expect(html).not.toContain("PassFast");
    expect(html).toContain("Stand: 21. November 2026.");
  });

  it("announces changes to the customer's disadvantage four weeks ahead (ENG-100, Legal §3 and Q-88)", () => {
    const html = renderToStaticMarkup(createElement(TeilnahmebedingungenPage));
    expect(html).toContain("Es gelten die Regeln, die auf deiner Karte angezeigt werden. Das Geschäft kann sie für die Zukunft ändern. Verbesserungen gelten sofort. Ändert das Geschäft etwas zu deinem Nachteil, zeigt deine Karte das mindestens vier Wochen vorher mit Datum an, zum Beispiel wenn eine Prämie mehr Stempel oder Punkte braucht, kleiner oder eingeschränkt wird oder wegfällt, oder wenn du für deinen Einkauf weniger bekommst. Bis dahin gilt die bisherige Regel. Deine gesammelten Stempel und Punkte bleiben erhalten. Extra-Boni wie den Willkommen-zurück- oder den Geburtstagsbonus kann das Geschäft jederzeit ändern oder beenden; schon gebuchte Boni bleiben dir.");
    expect(html).toContain("Stand: 30. Oktober 2026.");
    expect(html).not.toContain("die bei der Anmeldung für das gewählte Programm angezeigt werden");
  });
});

// ENG-277: Legal's owner privacy notice (legal-ops/2026-11-19-eng-277-owner-consent.md), and the invite sentence linking to it.
describe("owner privacy notice", () => {
  const html = renderToStaticMarkup(createElement(GeschaefteDatenschutzPage)).replaceAll("<!-- -->", "");

  it("is Legal's text with its Stand, the customer page and the Impressum linked", () => {
    expect(html).toContain("<h1>Datenschutzhinweise für Geschäfte</h1>");
    expect(GeschaefteMetadata.title).toBe("Datenschutzhinweise für Geschäfte – Loynara");
    expect(html).toContain("Stand: 29. November 2026. Diese Hinweise gelten für alle, die für ein Geschäft ein Konto bei Loynara haben: Inhaber:innen, Leitung und Kasse.");
    expect(html).toContain('<a href="/datenschutz">Datenschutzhinweise zur Kundenkarte</a>');
    expect(html).toContain('href="https://getloynara.com/impressum/"');
    expect(html).toContain("Mailgun (E-Mail-Versand, über Server in der EU)");
    // ENG-338, Legal (legal-ops/2026-11-22-eng-201-termin-booking.md): kept by the worker's daily pruneStaffPushSubscriptions.
    expect(html).toContain("dafür speichern wir von der IP-Adresse nur einen Prüfwert. Erlaubst du auf einem Gerät Mitteilungen, speichern wir für dieses Gerät eine Push-Adresse. Wir löschen sie, wenn du die Mitteilungen ausschaltest oder dich abmeldest, spätestens einen Tag nachdem deine Anmeldung abgelaufen oder dein Zugang beendet ist. Die Mitteilungen gehen verschlüsselt und ohne Kundendaten über den Push-Dienst deines Browsers. Als Inhaber:in außerdem:");
    // ENG-323, Legal's T-1, right after „Empfänger“.
    expect(html).toContain(`Stripe (Zahlungen). Eine Verarbeitung außerhalb der Europäischen Union kann bei diesen Anbietern nicht ausgeschlossen werden.</p><p><strong>Standortsuche:</strong> Die Lage deines Geschäfts bestimmst du über eine Suche, sobald wir sie anbieten. Dafür schicken wir deinen Suchtext über unseren Server an Google (Google Places API) und rufen für den Vorschlag, den du wählst, dessen Koordinaten ab. Google erhält dabei weder deinen Namen noch deine E-Mail-Adresse noch deine IP-Adresse. Google verarbeitet den Suchtext als eigener Verantwortlicher nach der <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Datenschutzerklärung von Google</a> und kann ihn auch in den USA verarbeiten; Grundlage ist der Angemessenheitsbeschluss der EU-Kommission zum EU-US Data Privacy Framework, nach dem die Google LLC zertifiziert ist. Die Koordinaten speichern wir beim Standort, damit Wallet-Karten deiner Kundschaft in der Nähe des Geschäfts angezeigt werden können, und frischen sie regelmäßig bei Google auf.</p>`);
    expect(html).toContain("die Bestätigung deiner E-Mail-Adresse, das Zurücksetzen deines Passworts, Erinnerungen und Berichte zu deinem Programm. Werbung schicken wir dir nur mit deiner Einwilligung.");
    expect(html).not.toContain("Einladungen");
    expect(html).toContain("Für Loynara ist der Hessische Beauftragte für Datenschutz und Informationsfreiheit, Wilhelmstraße 7, 65185 Wiesbaden, zuständig.");
    expect(html).not.toMatch(/\{Datum\}|Entwurf/);
  });

  it("promises the push address goes a day after login or access ends only because the worker prunes daily (ENG-338)", () => {
    expect(readFileSync("scripts/worker.ts", "utf8")).toMatch(/staffPushPrunedAt >= 24 \* 60 \* 60_000[\s\S]{0,400}pruneStaffPushSubscriptions\(housekeepingDatabase\)/);
  });

  it("promises the 48-hour counter deletion only because the worker runs the prune daily (ENG-281)", () => {
    expect(html).toContain("Die Zähler für Anmeldeversuche löschen wir spätestens 48 Stunden nach Ablauf ihres Zeitfensters.");
    const worker = readFileSync("scripts/worker.ts", "utf8");
    expect(worker).toMatch(/rateLimitsPrunedAt >= RATE_LIMIT_PRUNE_INTERVAL_MS[\s\S]{0,400}pruneExpiredRateLimits\(housekeepingDatabase\)/);
  });

  const invite = (role: "owner" | "manager" | "cashier") => renderToStaticMarkup(createElement(InviteClient, { token: "t", registrationOpen: false, invite: { email: "a@example.test", role, businessName: "Café Test", locationName: "Mitte" } })).replaceAll("<!-- -->", "").replace(/ class="[^"]*"/g, "");
  // A new tab, as on the join page, so a name typed into the form survives reading the notice (Design, #295).
  const link = '<a target="_blank" rel="noopener" href="/datenschutz/geschaefte">Datenschutzhinweisen für Geschäfte</a>';

  it("the owner invite names the notice under both buttons, without a checkbox", () => {
    const page = invite("owner");
    expect(page.split(`Wie Loynara deine Daten verarbeitet, steht in den ${link}.`)).toHaveLength(3);
    expect(page).not.toContain('type="checkbox"');
  });

  it.each(["manager", "cashier"] as const)("a %s invite says the data is processed for the shop", (role) => {
    expect(invite(role).split(`Wie Loynara deine Daten im Auftrag von Café Test verarbeitet, steht in den ${link}.`)).toHaveLength(3);
  });
});


// ENG-277: Legal's sentence above „Konto erstellen“ (legal-ops/2026-11-20-eng-277-signup-acceptance.md) and the two pages.
describe("owner sign-up acceptance", () => {
  const register = (query = "") => {
    search.value = query;
    return renderToStaticMarkup(createElement(RegisterPage)).replaceAll("<!-- -->", "").replace(/ class="[^"]*"/g, "");
  };
  const link = (href: string, text: string) => `<a target="_blank" rel="noopener" href="${href}">${text}</a>`;

  it("states the contract above the button, links the three owner documents in a new tab, and has no checkbox", () => {
    const page = register();
    expect(page).toContain(`<p>Mit „Konto erstellen“ schließt du für dein Geschäft den Vertrag mit Loynara nach den ${link("/vertragsbedingungen", "Vertragsbedingungen für Geschäfte")} und dem ${link("/avv", "Vertrag zur Auftragsverarbeitung")}. Der erste Monat ist gratis; kündigst du in diesem Monat, kostet es nichts. Danach kostet Loynara 49 € pro Monat und Standort, bis du kündigst. Wie wir deine Daten verarbeiten, steht in den ${link("/datenschutz/geschaefte", "Datenschutzhinweisen für Geschäfte")}.</p>`);
    expect(page.indexOf("Mit „Konto erstellen“")).toBeLessThan(page.indexOf('type="submit"'));
    expect(page).not.toContain("Es wird keine Zahlung ausgelöst.");
    expect(page).not.toContain('type="checkbox"');
  });

  it("shows staff coming from an invitation no contract sentence", () => {
    const page = register(`next=${encodeURIComponent(`/invite/${"a".repeat(43)}`)}`);
    expect(page).not.toContain("Mit „Konto erstellen“");
    expect(page).toContain("Es wird keine Zahlung ausgelöst.");
  });

  const open = (Page: () => unknown, registration?: string) => {
    const saved = process.env.PUBLIC_REGISTRATION_ENABLED;
    if (registration === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = registration;
    try { return renderToStaticMarkup(createElement(Page as () => null)).replaceAll("<!-- -->", ""); }
    finally { if (saved === undefined) delete process.env.PUBLIC_REGISTRATION_ENABLED; else process.env.PUBLIC_REGISTRATION_ENABLED = saved; }
  };

  // Legal, 20 Nov: never served with an open fill-in; otherwise always, whether /register is open or closed.
  it.each([["terms", VertragsbedingungenPage], ["AVV", AvvPage]] as const)("the %s page answers 404 while the AVV has an open fill-in, and is served otherwise, sign-up open or closed", (_name, Page) => {
    marks.open = true;
    try { for (const registration of [undefined, "false", "true"]) expect(() => open(Page, registration)).toThrow(expect.objectContaining({ digest: expect.stringContaining("404") })); }
    finally { marks.open = false; }
    for (const registration of [undefined, "false"]) expect(open(Page, registration)).toContain("<h1>");
    expect(open(Page, "true")).toContain("Youssef Belmokhtar, Loynara, Friedrich-Ebert-Straße 70, 34119 Kassel, Deutschland, E-Mail: support@getloynara.com.");
  });

  it("the terms page is Legal's part 1 with its Stand, version and the AVV linked", () => {
    const html = open(VertragsbedingungenPage, "true");
    expect(TermsMetadata.title).toBe("Vertragsbedingungen für Geschäfte – Loynara");
    expect(html).toContain("<h1>Vertragsbedingungen für Geschäfte</h1>");
    expect(html).toContain("Stand: 22. November 2026. Fassung 2026-11-22.");
    // ENG-323, Legal's T-2 as § 1 (5), right after (4).
    expect(html).toContain(`Wesentliche Änderungen kündigt der Anbieter mindestens zwei Wochen vorher in Textform an.</p><p>(5) Die Lage eines Standorts bestimmt der Betrieb über eine Suche, die Google Maps nutzt, sobald der Anbieter sie anbietet. Für diese Suche gelten die <a href="https://maps.google.com/help/terms_maps/" target="_blank" rel="noopener">Zusätzlichen Nutzungsbedingungen für Google Maps/Google Earth</a> und die <a href="https://policies.google.com/privacy" target="_blank" rel="noopener">Datenschutzerklärung von Google</a>.</p>`);
    expect(html).toContain("(1) Der Vertrag kommt zustande, wenn der Betrieb bei der Registrierung „Konto erstellen“ wählt.");
    expect(html).toContain("(1) Das Entgelt beträgt 49 € je Standort und Monat.");
    expect(html).toContain('Der <a href="/avv">Vertrag zur Auftragsverarbeitung</a> (AVV) ist Teil dieses Vertrags');
    expect(html).toContain("Diese Bedingungen kann der Betrieb auf dieser Seite jederzeit ausdrucken oder speichern.");
    expect(html).not.toMatch(/\{[^}]*\}|Entwurf/);
  });

  it("the AVV page is the web AVV: made with the terms, no signature block, no counsel marks", () => {
    const html = open(AvvPage, "true");
    expect(AvvMetadata.title).toBe("Vertrag zur Auftragsverarbeitung – Loynara");
    expect(html).toContain("<h1>Vertrag zur Auftragsverarbeitung</h1>");
    expect(html).toContain("nach den Vertragsbedingungen für Geschäfte (Hauptvertrag)");
    expect(html).toContain("Dieser Vertrag kommt zusammen mit dem Hauptvertrag zustande, wenn der Betrieb ihn bei der Registrierung annimmt. Das elektronische Format genügt (Art. 28 Abs. 9 DSGVO).");
    expect(html).toContain(">Anlage 3 · Unterauftragsverarbeiter</h2>");
    expect(html).toContain("Leistung: Versand von E-Mails an die Kundschaft (Bestätigung und Wiederherstellung; E-Mail-Angebote nur wenn freigeschaltet) und an das Team (Bestätigung der E-Mail-Adresse, Zurücksetzen des Passworts).");
    expect(html).not.toMatch(/⚖|Pilotvereinbarung|Unterschrift|\{\{/);
    // Reviewer F-1: the page's open fill-ins are exactly the ones the configuration gate reads.
    expect(html.includes("[[")).toBe(hasOpenMarks());
    for (const mark of Object.values(AVV_FILL_INS)) expect(html).toContain(mark);
    // Founder, 20 Nov: Google Wallet is in the AVV, with Google as its own controller (Legal's text B), not a sub-processor.
    expect(html).toContain("<p><strong>Google (nur wenn Google Wallet für den Betrieb freigeschaltet ist).</strong> Fügt eine Kundin oder ein Kunde die Karte zu Google Wallet hinzu, übermittelt der Anbieter auf Weisung des Betriebs über die Google Wallet API an Google. Vertragspartner der Google Wallet API ist die Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA; für Daten aus dem Europäischen Wirtschaftsraum ist Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland, verantwortlich. Übermittelt werden zum Programm Name und Logo des Betriebs, Programmname, Farbe und, falls eingetragen, die Lage des Standorts; zur Karte Kartennummer, QR-Kartencode, Stempel- oder Punktestand, die nächste Prämie mit ihrem Status und, nur mit Einwilligung, Nachrichten des Betriebs auf dem Pass. Google verarbeitet diese Daten als eigener Verantwortlicher nach seinen eigenen Bedingungen und Datenschutzhinweisen; Google ist kein Unterauftragsverarbeiter im Sinne von § 5. Grundlage für den Drittlandbezug: EU-US Data Privacy Framework (Zertifizierung der Google LLC). Wird die Karte geschlossen oder neu ausgestellt, setzt der Anbieter den Pass auf ungültig und entfernt Kartennummer, QR-Kartencode und Stand.</p>");
    expect(html.indexOf("<strong>Apple.</strong>")).toBeLessThan(html.indexOf("<strong>Google (nur wenn"));
    expect(html).toContain("<p><strong>Art der Verarbeitung:</strong> Erheben, Speichern, Abfragen, Verwenden, Anzeigen für das Team, Übermitteln an Unterauftragsverarbeiter und, soweit Google Wallet freigeschaltet ist, an Google als eigenen Verantwortlichen (Anlage 3), Export, Löschen.</p>");
    expect(html).toContain("Einträge eines Programms bei Google Wallet lassen sich nicht löschen; der Anbieter deaktiviert die Pässe und überschreibt den Eintrag mit neutralen Angaben ohne Namen und Logo des Betriebs.</p>");
    expect(html).not.toMatch(/UV-1[012]|<strong>Google<\/strong>,/);
    expect(html).toContain("Push-Dienste der Kassengeräte (Apple, Google, Mozilla)");
    expect(html).toContain("die physische Sicherheit verantworten diese Anbieter. Die Festplatten der Arbeitsgeräte sind verschlüsselt (FileVault); der Bildschirm sperrt sich nach 5 Minuten.</p>");
    expect(html).toContain("bei den Dienstleistern erreichbar. Zwei-Faktor-Anmeldung ist bei Railway, Cloudflare, Mailgun, dem Apple-Entwicklerkonto und GitHub eingeschaltet, ebenso beim Google-Konto, über das sich der Anbieter bei Dienstleistern anmeldet. Schlüssel und Passwörter");
    // Legal § 6 (20 Nov): Annex 2 says only what is true today; the restore test is a dated commitment, not a claim.
    expect(html).toContain("<strong>Verfügbarkeit und Wiederherstellung.</strong> Tägliche automatische Datenbanksicherung, verschlüsselt (age) und außerhalb des Hosters gespeichert. Der Anbieter prüft die Wiederherstellung aus einer Sicherung in einer getrennten Umgebung, erstmals bis zum 4. Dezember 2026, danach mindestens einmal im Kalendervierteljahr, und hält jeden Test mit Datum und Ergebnis fest. Jede Freigabe hält die vorherigen Versionen als Ziel für eine Rücknahme fest. Erreichbarkeit, Hintergrunddienst und Sicherung werden überwacht; bei einem Ausfall wird der Anbieter benachrichtigt.</p>");
    expect(html).toContain("Verbindungen zur Anwendung und zu den Dienstleistern laufen über HTTPS (TLS).");
    expect(html).toContain("Leistung: DNS, TLS und Schutz der Verbindung; Speicher für verschlüsselte Sicherungen (R2).");
    expect(html).not.toMatch(/bereits angewendet|öffentlichen Port|Cloudflare-Tunnel|Wiederherstellungsperson|Release-Protokoll|Alle Verbindungen|zuletzt am|Mobiltelefone/);
    expect(html).toContain("<strong>Mailgun</strong>, Mailgun Technologies, Inc., 112 E Pecan Street #1135, San Antonio, TX 78205, USA.");
    expect(Object.values(AVV_FILL_INS).filter(text => text.includes("[[")).map(text => text.slice(2, 7))).toEqual([]);
  });
});
