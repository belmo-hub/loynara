import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DatenschutzPage from "./datenschutz/page";
import TeilnahmebedingungenPage from "./teilnahmebedingungen/page";

// Customers tick a checkbox linking to these pages when they create a card.
describe("customer legal pages", () => {
  const pages = [["Datenschutz", DatenschutzPage], ["Teilnahmebedingungen", TeilnahmebedingungenPage]] as const;

  it.each(pages)("%s is final text that names the operator", (_name, Page) => {
    const html = renderToStaticMarkup(createElement(Page));
    expect(html).not.toMatch(/Entwurf|Vor öffentlichem Start|ergänzen/i);
    expect(html).toContain("Friedrich-Ebert-Straße 70");
    expect(html).toContain("support@getloynara.com");
  });

  it("privacy notice keeps recovery email and marketing consent separate", () => {
    const html = renderToStaticMarkup(createElement(DatenschutzPage));
    expect(html).toContain("keine Einwilligung in Werbung");
    expect(html).toContain("ausdrücklich und getrennt");
    expect(html).toContain("jederzeit");
  });

  it("privacy notice has Legal's section on Wallet messages, verbatim and separate from e-mail", () => {
    const html = renderToStaticMarkup(createElement(DatenschutzPage));
    expect(html).toContain(">Nachrichten auf deiner Wallet-Karte</h2>");
    // ENG-049: Legal's birthday section (22 Oct), right after the Wallet messages.
    expect(html.indexOf(">Nachrichten auf deiner Wallet-Karte</h2>")).toBeLessThan(html.indexOf(">Geburtstag</h2>"));
    expect(html).toContain("Freiwillig kannst du auf deiner Karte Tag und Monat deines Geburtstags hinterlegen, ohne Jahr. Das Geschäft nutzt ihn nur für eine Geburtstagsprämie und, wenn du Nachrichten auf deiner Wallet-Karte erlaubt hast, für eine Erinnerung in deiner Geburtstagswoche. Du kannst ihn jederzeit auf deiner Karte löschen. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms (Art. 6 Abs. 1 Buchst. b DSGVO).");
    for (const part of ["höchstens zwei pro Woche und nicht nachts", "getrennt von der Einwilligung in E-Mails", "ohne die Karte aus deiner Wallet zu löschen", "Art. 6 Abs. 1 Buchst. a DSGVO"]) expect(html).toContain(part);
    expect(html.indexOf(">E-Mail-Angebote</h2>")).toBeLessThan(html.indexOf(">Nachrichten auf deiner Wallet-Karte</h2>"));
    expect(html).toContain("Wenn du es auf deiner Karte ausdrücklich erlaubst, kann dir das Geschäft kurze Nachrichten mit Angeboten, Neuigkeiten und Erinnerungen auf deiner Wallet-Karte schicken, höchstens zwei pro Woche und nicht nachts. Dazu kann eine automatische Erinnerung gehören, wenn du länger nicht da warst. Diese Einwilligung ist freiwillig und getrennt von der Einwilligung in E-Mails. Sie wird mit Zeitpunkt und Textversion protokolliert, und du kannst sie jederzeit auf deiner Karte widerrufen, ohne die Karte aus deiner Wallet zu löschen. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 Buchst. a DSGVO). Zugestellt werden die Nachrichten bei Apple Wallet über PassFast und Apple, bei Google Wallet über Google.");
    expect(html).toContain("Läuft auf deiner Punktekarte ein Teil deiner Punkte bald ab, schickt dir das Geschäft vorher einen Hinweis auf deine Karte in Apple Wallet. Dafür musst du nichts erlauben; der Hinweis zählt zu den höchstens zwei Nachrichten pro Woche. Rechtsgrundlage ist die Durchführung des Kundenkartenprogramms (Art. 6 Abs. 1 Buchst. b DSGVO).");
  });

  it("privacy notice names Google for Google Wallet cards and splits the pass deactivation", () => {
    const html = renderToStaticMarkup(createElement(DatenschutzPage));
    expect(html).toContain("Wenn du deine Karte zu Google Wallet hinzufügst, übermitteln wir an Google: deine Kartennummer, den QR-Kartencode für die Kasse, deinen Stempel- oder Punktestand, den Fortschritt zur nächsten Prämie sowie Name, Logo, Farbe und gegebenenfalls Standort des Geschäfts. Dein Name, deine E-Mail-Adresse, deine Telefonnummer und dein privater Kartenlink werden nicht übermittelt. Google erstellt und aktualisiert den Pass über die Google Wallet API; die weitere Verarbeitung in deinem Google-Konto richtet sich nach Googles eigenen Bedingungen.");
    expect(html).toContain("Schließt du die Karte oder wird sie neu ausgestellt, werden gespeicherte Pässe nicht aus der Ferne gelöscht. Ein Apple-Wallet-Pass wird als ungültig markiert und sein QR-Code entfernt. Ein Google-Wallet-Pass wird deaktiviert; Kartennummer, QR-Code und Stand werden entfernt. Du kannst den Pass danach selbst aus deiner Wallet löschen.");
    expect(html).toContain("bei Apple-Wallet-Karten PassFast, bei Google-Wallet-Karten Google");
    expect(html).toContain("Stand: 31. Oktober 2026.");
  });

  it("announces changes to the customer's disadvantage four weeks ahead (ENG-100, Legal §3 and Q-88)", () => {
    const html = renderToStaticMarkup(createElement(TeilnahmebedingungenPage));
    expect(html).toContain("Es gelten die Regeln, die auf deiner Karte angezeigt werden. Das Geschäft kann sie für die Zukunft ändern. Verbesserungen gelten sofort. Ändert das Geschäft etwas zu deinem Nachteil, zeigt deine Karte das mindestens vier Wochen vorher mit Datum an, zum Beispiel wenn eine Prämie mehr Stempel oder Punkte braucht, kleiner oder eingeschränkt wird oder wegfällt, oder wenn du für deinen Einkauf weniger bekommst. Bis dahin gilt die bisherige Regel. Deine gesammelten Stempel und Punkte bleiben erhalten. Extra-Boni wie den Willkommen-zurück- oder den Geburtstagsbonus kann das Geschäft jederzeit ändern oder beenden; schon gebuchte Boni bleiben dir.");
    expect(html).toContain("Stand: 30. Oktober 2026.");
    expect(html).not.toContain("die bei der Anmeldung für das gewählte Programm angezeigt werden");
  });
});
