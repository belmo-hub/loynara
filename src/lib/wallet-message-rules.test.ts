import { describe, expect, it } from "vitest";
import { EXCLUDED_GOODS } from "./card-extras";
import { shopCapText, almostText, birthdayCashierLine, birthdayRule, birthdayText, birthdayWeek, checkMessageText, CONSENT_TEXT_VERSION, CONSENT_TEXTS, consentText, needsActionHint, winbackCashierLine, winbackRule, winbackText } from "./wallet-message-rules";

describe("message text rules", () => {
  it("accepts the founder's example and counts characters, not bytes", () => {
    expect(checkMessageText("Heute ruhig: doppelte Punkte bis 17 Uhr")).toEqual({ ok: true, text: "Heute ruhig: doppelte Punkte bis 17 Uhr" });
    expect(checkMessageText("ä".repeat(140)).ok).toBe(true);
    expect(checkMessageText("ä".repeat(141)).ok).toBe(false);
    expect(checkMessageText("😀".repeat(140)).ok).toBe(true);
  });
  it.each(["Tabak", "Zigaretten im Angebot", "E-Zigarette 2 für 1", "VAPE", "Snus", "E-Liquid Aktion"])("blocks tobacco and e-cigarette term %s", text => {
    expect(checkMessageText(text)).toMatchObject({ ok: false, error: expect.stringContaining("Tabak") });
  });
  it("blocks health claims and alcohol aimed at minors, but not plain alcohol or a time like 'ab 17 Uhr'", () => {
    expect(checkMessageText("Unser Tee heilt Erkältungen").ok).toBe(false);
    expect(checkMessageText("Cocktails für Jugendliche, heute 2 für 1").ok).toBe(false);
    expect(checkMessageText("Schüler trinken bei uns Bier günstiger").ok).toBe(false);
    expect(checkMessageText("Cocktails ab 17 Uhr zum halben Preis").ok).toBe(true);
  });
  it("blocks links in all common forms and control characters", () => {
    for (const text of ["https://a.test", "www.a.de", "a.de", "mail@a.test", "Link: bit.ly"]) expect(checkMessageText(text).ok, text).toBe(false);
    expect(checkMessageText("Um 17.30 Uhr wieder offen").ok).toBe(true);
    expect(checkMessageText("a\u0007b").ok).toBe(false);
  });
});

describe("texts and hints", () => {
  it("consent text fills in shop and location", () => {
    expect(consentText("Café Kurz", "Kassel Mitte")).toMatch(/^Ja, Café Kurz, Kassel Mitte, darf mir Angebote.*\(höchstens 2 pro Woche\)\./);
  });
  it("never changes a published consent wording: a new one gets a new version and a line here (ENG-174b)", () => {
    const published: Record<string, string> = {
      "wallet-consent-2026-10-22-v1": "Ja, Café Kurz, Kassel Mitte, darf mir Angebote, Neuigkeiten und Erinnerungen als Nachricht auf meiner Wallet-Karte schicken (höchstens 2 pro Woche). Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit hier auf meiner Karte abschalten. Mehr in den Datenschutzhinweisen.",
      "wallet-consent-join-2026-11-06-v1": "Ja, Café Kurz, Kassel Mitte, darf mir Angebote, Neuigkeiten und Erinnerungen als Nachricht auf meiner Wallet-Karte schicken (höchstens 2 pro Woche). Das ist freiwillig und für die Karte nicht nötig. Ich kann es jederzeit auf meiner Karte abschalten. Mehr in den Datenschutzhinweisen.",
    };
    expect(Object.keys(CONSENT_TEXTS).sort()).toEqual(Object.keys(published).sort());
    for (const [version, text] of Object.entries(published)) expect(CONSENT_TEXTS[version]("Café Kurz", "Kassel Mitte")).toBe(text);
    expect(consentText("Café Kurz", "Kassel Mitte")).toBe(CONSENT_TEXTS[CONSENT_TEXT_VERSION]("Café Kurz", "Kassel Mitte"));
  });
  it("shows the action hint for Punkte, Stempel or doppelt in any case, never otherwise", () => {
    for (const text of ["Doppelte Punkte heute", "STEMPEL extra", "heute doppelt", "punkte"]) expect(needsActionHint(text), text).toBe(true);
    expect(needsActionHint("Heute ruhig: Kaffee gratis zum Croissant")).toBe(false);
  });
});

describe("a one-point bonus in the singular (ENG-104)", () => {
  // Legal's rules lines stay word for word: between 1 and 2 only the number may differ.
  const onlyTheNumber = (one: string, two: string) => expect(one).toBe(two.replace("2 Punkte", "1 Punkt"));
  it("win-back and birthday reminders", () => {
    expect(winbackText("points", 1, "5. November")).toBe("Wir vermissen dich. Komm bis zum 5. November vorbei, dann gibt's 1 Punkt extra.");
    expect(winbackText("points", 2, "5. November")).toBe("Wir vermissen dich. Komm bis zum 5. November vorbei, dann gibt's 2 Punkte extra.");
    expect(birthdayText("points", 1, "8. November")).toBe("Alles Gute zum Geburtstag! Komm bis zum 8. November vorbei, dann gibt's 1 Punkt extra.");
    expect(birthdayText("points", 2, "8. November")).toBe("Alles Gute zum Geburtstag! Komm bis zum 8. November vorbei, dann gibt's 2 Punkte extra.");
    expect(winbackText("stamp", 1, "5. November")).toBe("Wir vermissen dich. Komm bis zum 5. November vorbei, dann gibt's einen Stempel extra.");
  });
  it("win-back and birthday rules on the card", () => {
    expect(winbackRule("points", 30, 1)).toContain("einmal 1 Punkt extra. Mit Nachrichten");
    expect(winbackRule("points", 30, 2)).toContain("einmal 2 Punkte extra. Mit Nachrichten");
    onlyTheNumber(winbackRule("points", 30, 1), winbackRule("points", 30, 2));
    onlyTheNumber(winbackRule("points", 30, 1, false), winbackRule("points", 30, 2, false));
    expect(winbackRule("stamp", 30, 1)).toContain("einmal 1 Stempel extra.");
    // Legal's exclusions stay in the line (card, owner preview) unless a page prints them once for all rules (sign-up).
    for (const line of [winbackRule("points", 30, 2), winbackRule("points", 30, 2, false), birthdayRule("points", 2)]) expect(line.endsWith(` ${EXCLUDED_GOODS}`)).toBe(true);
    expect(winbackRule("stamp", 30, 1, false, false)).toBe("Willkommen-zurück-Bonus: Warst du 30 Tage nicht da, gibt es bei deinem nächsten bestätigten Besuch in den 14 Tagen danach einmal 1 Stempel extra.");
    expect(birthdayRule("points", 2, false)).not.toContain("Nicht auf");
    expect(birthdayRule("points", 1)).toContain("bei einem bestätigten Besuch 1 Punkt extra. Nicht auf Tabak");
    expect(birthdayRule("points", 2)).toContain("bei einem bestätigten Besuch 2 Punkte extra. Nicht auf Tabak");
    onlyTheNumber(birthdayRule("points", 1), birthdayRule("points", 2));
    expect(birthdayRule("stamp", 1)).toContain("bei einem bestätigten Besuch 1 Stempel extra.");
  });
  it("„Fast geschafft“ with one point missing", () => {
    expect(almostText("points", 1, "Pizza gratis")).toBe("Nur noch 1 Punkt bis zu deiner Prämie: Pizza gratis.");
    expect(almostText("points", 2, "Pizza gratis")).toBe("Nur noch 2 Punkte bis zu deiner Prämie: Pizza gratis.");
    expect(almostText("stamp", 1, "Pizza gratis")).toBe("Nur noch 1 Stempel bis zu deiner Prämie: Pizza gratis.");
  });
  it("the lines the cashier sees", () => {
    expect(winbackCashierLine("points", 1)).toBe("Willkommen zurück: +1 Punkt extra");
    expect(winbackCashierLine("points", 2)).toBe("Willkommen zurück: +2 Punkte extra");
    expect(winbackCashierLine("stamp", 1)).toBe("Willkommen zurück: +1 Stempel extra");
    expect(birthdayCashierLine("points", 1)).toBe("Geburtstag: +1 Punkt extra");
    expect(birthdayCashierLine("points", 2)).toBe("Geburtstag: +2 Punkte extra");
    expect(birthdayCashierLine("stamp", 1)).toBe("Geburtstag: +1 Stempel extra");
  });
});

describe("birthdayWeek (ENG-049)", () => {
  it("is Monday to Sunday around the birthday, inclusive", () => {
    expect(birthdayWeek(22, 10, "2026-10-19")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(birthdayWeek(22, 10, "2026-10-25")).toEqual({ start: "2026-10-19", end: "2026-10-25" });
    expect(birthdayWeek(22, 10, "2026-10-18")).toBeNull();
    expect(birthdayWeek(22, 10, "2026-10-26")).toBeNull();
  });
  it("treats 29 February as 28 February outside leap years, and finds weeks across New Year", () => {
    expect(birthdayWeek(29, 2, "2027-02-22")).toEqual({ start: "2027-02-22", end: "2027-02-28" });
    expect(birthdayWeek(29, 2, "2028-02-29")).toEqual({ start: "2028-02-28", end: "2028-03-05" });
    expect(birthdayWeek(31, 12, "2027-01-02")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
    expect(birthdayWeek(1, 1, "2026-12-29")).toEqual({ start: "2026-12-28", end: "2027-01-03" });
  });
});

describe("contentRefusal, shared with email campaigns and automations (ENG-163, Legal 1 Nov)", () => {
  it.each([
    ["Neu bei uns: E-Zigaretten und Liquids zum Probierpreis.", "Tabak"],
    ["Neue Tabaksorten sind da.", "Tabak"],
    ["Vapes 2 für 1", "Tabak"],
    ["Unser Tee heilt Erkältungen.", "Heilversprechen"],
    ["hilft gegen Krebs", "Heilversprechen"],
    ["senkt den Blutdruck", "Heilversprechen"],
    ["Für Schüler: Cocktails zum halben Preis.", "Jugendliche"],
    ["Abi-Party: Shots für alle unter 18", "Jugendliche"],
    // An exclusion ends at a colon: what follows it is the offer (Reviewer N-1).
    ["Außer sonntags: Zigaretten 10 % günstiger", "Tabak"],
    ["Für alle außer Kinder: neue E-Liquids", "Tabak"],
  ])("refuses %s", async (text, reason) => {
    const { contentRefusal } = await import("./wallet-message-rules");
    expect(contentRefusal(text)).toContain(reason);
  });
  it.each([
    "10 % auf alles, nicht auf Tabak und Zeitschriften.",
    "Nicht auf Tabak, Presse, Bücher, Lotto und Handyguthaben.",
    "Glühwein für die Großen, Kinderpunsch für die Kleinen.",
    // Alcohol and minors in different sentences: the rule works per sentence (Reviewer N-4).
    "Schülerrabatt auf Kakao. Abends Bier vom Fass.",
    "Frischer Flusskrebs-Salat",
    "Sternzeichen Krebs? Alles Gute!",
    "Unser neues Styling-Liquid",
    "Doppelter Espresso-Shot",
    "Insektenschutz",
  ])("lets %s through", async text => {
    const { contentRefusal } = await import("./wallet-message-rules");
    expect(contentRefusal(text)).toBeNull();
  });
  it("applies only the content rules to email: long text with a link passes", async () => {
    const { contentRefusal } = await import("./wallet-message-rules");
    expect(contentRefusal(`Herbstkarte ab Montag, alle Details auf https://example.test. ${"Kaffee und Kuchen. ".repeat(20)}`)).toBeNull();
  });
});

describe("shop cap sentence (Marketing G16)", () => {
  it("names the rolling 7 days and when the next message may go, numbers held to their units", () => {
    expect(shopCapText("Sonntag, 15. November, 13:45 Uhr")).toBe("Du hast in den letzten 7\u00a0Tagen schon 2\u00a0Nachrichten gesendet. Die nächste kannst du ab Sonntag, 15.\u00a0November, 13:45\u00a0Uhr senden.");
    expect(shopCapText()).toBe("Du hast in den letzten 7\u00a0Tagen schon 2\u00a0Nachrichten gesendet.");
  });
});
