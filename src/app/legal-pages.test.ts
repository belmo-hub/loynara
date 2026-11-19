import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DatenschutzPage from "./datenschutz/page";
import TeilnahmebedingungenPage from "./teilnahmebedingungen/page";
import GeschaefteDatenschutzPage, { metadata as GeschaefteMetadata } from "./datenschutz/geschaefte/page";
import { InviteClient } from "@/components/invite-client";

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
    expect(html).toContain("bei Google-Wallet-Karten Google und, wenn du eine Wiederherstellungsadresse hinterlegst, Mailgun (Versand der Bestätigungs- und Wiederherstellungs-E-Mails).");
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
    expect(html).toContain("Stand: 6. November 2026.");
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
    expect(html).toContain("Stand: 19. November 2026. Diese Hinweise gelten für alle, die für ein Geschäft ein Konto bei Loynara haben: Inhaber:innen, Leitung und Kasse.");
    expect(html).toContain('<a href="/datenschutz">Datenschutzhinweise zur Kundenkarte</a>');
    expect(html).toContain('href="https://getloynara.com/impressum/"');
    expect(html).toContain("Mailgun (E-Mail-Versand, über Server in der EU)");
    expect(html).toContain("die Bestätigung deiner E-Mail-Adresse, das Zurücksetzen deines Passworts, Einladungen, Erinnerungen und Berichte zu deinem Programm.");
    expect(html).toContain("Für Loynara ist der Hessische Beauftragte für Datenschutz und Informationsfreiheit, Wilhelmstraße 7, 65185 Wiesbaden, zuständig.");
    expect(html).not.toMatch(/\{Datum\}|Entwurf/);
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

