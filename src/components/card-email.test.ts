import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmailOffer, EmailSheet, emailRow, type EmailStatus } from "./card-email";
import { CustomerCard } from "./customer/customer-card";

const none: EmailStatus = { available: true, marketingAvailable: true, contactPresent: false, emailVerified: false, marketingEmail: false, maskedEmail: null, pending: null, linkExpired: false, marketingSince: null, recoverUrl: "app.test/recover", offer: true };
const pending: EmailStatus = { ...none, contactPresent: true, maskedEmail: "m•••@beispiel.test", pending: "marketing", offer: false };
const verified: EmailStatus = { ...none, contactPresent: true, emailVerified: true, maskedEmail: "m•••@beispiel.test", offer: false };
const on: EmailStatus = { ...verified, marketingEmail: true, marketingSince: "2026-11-04T08:42:00.000Z" };
const launch = (status: EmailStatus): EmailStatus => ({ ...status, marketingAvailable: false });
const shop = { shop: "Café Lindenblatt", location: "Kassel Mitte" };
const sheet = (status: EmailStatus) => renderToStaticMarkup(h(EmailSheet, { token: "t", shop, status, reload: async () => {}, open: true, onClose: () => {} }));

describe("the „Deine Karte“ row (E27–E29)", () => {
  it("names the state in its sub-line, the address masked", () => {
    expect(emailRow(none)).toEqual({ title: "E-Mail", sub: "Für Erinnerungen und zum Wiederfinden" });
    expect(emailRow(pending).sub).toBe("Bestätigung offen");
    expect(emailRow({ ...pending, linkExpired: true }).sub).toBe("Link abgelaufen");
    expect(emailRow(on).sub).toBe("m•••@beispiel.test · Nachrichten an");
    expect(emailRow(verified).sub).toBe("m•••@beispiel.test · Nachrichten aus");
  });
  it("reads „Karte sichern“ while marketing mail is off", () => {
    expect(emailRow(launch(none))).toEqual({ title: "Karte sichern", sub: "Mit E-Mail wiederfinden" });
    expect(emailRow(launch(verified)).sub).toBe("m•••@beispiel.test · bestätigt");
  });
});

describe("the offer under the card (K01)", () => {
  const out = renderToStaticMarkup(h(EmailOffer, { token: "t", shop, onSent: () => {}, onClose: () => {}, reload: async () => {} }));
  it("asks with Legal's unticked consent and the recovery hint", () => {
    expect(out).toContain("Erinnerungen per E-Mail?");
    expect(out).toContain("Café Lindenblatt sagt dir Bescheid, wenn deine Prämie bereitliegt oder du länger nicht da warst.");
    expect(out).toContain("Ja, Café Lindenblatt, Kassel Mitte, darf mir Angebote, Neuigkeiten und Erinnerungen per E-Mail schicken. Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit widerrufen, auf meiner Karte oder mit einem Klick in jeder E-Mail. <a href=\"/datenschutz\">Mehr in den Datenschutzhinweisen.</a>");
    expect(out).toMatch(/<input type="checkbox"(?![^>]*checked)[^>]*>/);
    expect(out).toContain("Sie wird nur dafür genutzt, nicht für Werbung.");
    expect(out).toContain('type="email"');
    expect(out).toContain('autoComplete="email"');
    expect(out).toContain("Bestätigungslink schicken");
    expect(out).toContain("Nein, danke");
  });
  it("drops the location when it is the shop's name", () => {
    const same = renderToStaticMarkup(h(EmailOffer, { token: "t", shop: { shop: "Lindenblatt", location: "Lindenblatt" }, onSent: () => {}, onClose: () => {}, reload: async () => {} }));
    expect(same).toContain("Ja, Lindenblatt, darf mir");
  });
});

describe("the sheet (K06–K09c, K17–K19)", () => {
  it("shows the confirmed address masked, the messages state and remove (K06)", () => {
    const out = sheet(on);
    expect(out).toContain("m•••@beispiel.test");
    expect(out).toContain("Bestätigt · zum Wiederfinden der Karte");
    expect(out).toContain("Nachrichten von Café Lindenblatt");
    expect(out).toMatch(/An · seit \d+\. Nov\., \d\d:42/);
    expect(out).toContain("Abbestellen");
    expect(out).toContain("Adresse entfernen");
    expect(out).not.toContain('type="checkbox"');
  });
  it("offers „Einrichten“ with the unticked consent when messages are off", () => {
    const out = sheet(verified);
    expect(out).toContain("Aus");
    expect(out).toContain("Einrichten");
    expect(out).toContain('id="card-email-tick"');
  });
  it("is neutral while the link is open, and says when it expired (K09, K09b, K09c)", () => {
    expect(sheet(pending)).toContain("Noch nicht bestätigt. Erst wenn du den Link in der E-Mail anklickst, bekommst du Nachrichten.");
    expect(sheet({ ...pending, pending: "recovery" })).toContain("Erst wenn du den Link in der E-Mail anklickst, ist deine Adresse bestätigt.");
    expect(sheet({ ...pending, linkExpired: true })).toContain("Der Link ist abgelaufen. Fordere einen neuen an, er gilt 30 Minuten.");
    expect(sheet(pending)).toContain("Link noch einmal schicken");
    expect(sheet(pending)).toContain("Andere Adresse eingeben");
  });
  it("holds only the address part while marketing mail is off (K18, K19)", () => {
    const empty = sheet(launch(none));
    expect(empty).toContain("Karte sichern");
    expect(empty).toContain("Mit einer bestätigten E-Mail-Adresse findest du deine Karte wieder, falls du diesen Link verlierst.");
    expect(empty).not.toContain('type="checkbox"');
    const confirmed = sheet(launch(verified));
    expect(confirmed).toContain("Mit dieser Adresse findest du deine Karte unter app.test/recover wieder.");
    expect(confirmed).not.toContain("Nachrichten von");
  });
});

describe("the recovery sheet's fourth way (E39)", () => {
  it("names the recovery page only with a confirmed address", () => {
    const base = { businessName: "Café Lindenblatt", locationName: "Kassel Mitte", programType: "stamps" as const, balance: 1, rewards: [] };
    expect(renderToStaticMarkup(h(CustomerCard, { ...base, recoverUrl: "app.test/recover" }))).toContain("Oder gib unter app.test/recover deine bestätigte E-Mail-Adresse ein.");
    expect(renderToStaticMarkup(h(CustomerCard, base))).not.toContain("/recover deine");
  });
});
