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
    expect(html).toContain("<h2>Nachrichten auf deiner Wallet-Karte</h2>");
    for (const part of ["höchstens zwei pro Woche und nicht nachts", "getrennt von der Einwilligung in E-Mails", "ohne die Karte aus deiner Wallet zu löschen", "Art. 6 Abs. 1 Buchst. a DSGVO"]) expect(html).toContain(part);
    expect(html.indexOf("<h2>E-Mail-Angebote</h2>")).toBeLessThan(html.indexOf("<h2>Nachrichten auf deiner Wallet-Karte</h2>"));
    expect(html).toContain("Wenn du es auf deiner Karte ausdrücklich erlaubst, kann dir das Geschäft kurze Nachrichten mit Angeboten, Neuigkeiten und Erinnerungen auf deiner Wallet-Karte schicken, höchstens zwei pro Woche und nicht nachts. Dazu kann eine automatische Erinnerung gehören, wenn du länger nicht da warst. Diese Einwilligung ist freiwillig und getrennt von der Einwilligung in E-Mails. Sie wird mit Zeitpunkt und Textversion protokolliert, und du kannst sie jederzeit auf deiner Karte widerrufen, ohne die Karte aus deiner Wallet zu löschen. Rechtsgrundlage ist deine Einwilligung (Art. 6 Abs. 1 Buchst. a DSGVO). Zugestellt werden die Nachrichten bei Apple Wallet über PassFast und Apple, bei Google Wallet über Google.");
  });

  it("privacy notice names Google for Google Wallet cards and splits the pass deactivation", () => {
    const html = renderToStaticMarkup(createElement(DatenschutzPage));
    expect(html).toContain("Wenn du deine Karte zu Google Wallet hinzufügst, übermitteln wir an Google: deine Kartennummer, den QR-Kartencode für die Kasse, deinen Stempel- oder Punktestand, den Fortschritt zur nächsten Prämie sowie Name, Logo, Farbe und gegebenenfalls Standort des Geschäfts. Dein Name, deine E-Mail-Adresse, deine Telefonnummer und dein privater Kartenlink werden nicht übermittelt. Google erstellt und aktualisiert den Pass über die Google Wallet API; die weitere Verarbeitung in deinem Google-Konto richtet sich nach Googles eigenen Bedingungen.");
    expect(html).toContain("Schließt du die Karte oder wird sie neu ausgestellt, werden gespeicherte Pässe nicht aus der Ferne gelöscht. Ein Apple-Wallet-Pass wird als ungültig markiert und sein QR-Code entfernt. Ein Google-Wallet-Pass wird deaktiviert; Kartennummer, QR-Code und Stand werden entfernt. Du kannst den Pass danach selbst aus deiner Wallet löschen.");
    expect(html).toContain("bei Apple-Wallet-Karten PassFast, bei Google-Wallet-Karten Google");
    expect(html).toContain("Stand: 22. Oktober 2026.");
  });
});
