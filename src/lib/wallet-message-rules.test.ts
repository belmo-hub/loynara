import { describe, expect, it } from "vitest";
import { birthdayWeek, checkMessageText, consentText, needsActionHint } from "./wallet-message-rules";

describe("message text rules", () => {
  it("accepts the founder's example and counts characters, not bytes", () => {
    expect(checkMessageText("Heute ruhig: doppelte Punkte bis 17 Uhr")).toEqual({ ok: true, text: "Heute ruhig: doppelte Punkte bis 17 Uhr" });
    expect(checkMessageText("ä".repeat(140)).ok).toBe(true);
    expect(checkMessageText("ä".repeat(141)).ok).toBe(false);
    expect(checkMessageText("😀".repeat(140)).ok).toBe(true);
  });
  it.each(["Tabak", "Zigaretten im Angebot", "E-Zigarette 2 für 1", "VAPE", "Snus", "Liquid Aktion"])("blocks tobacco and e-cigarette term %s", text => {
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
  it("shows the action hint for Punkte, Stempel or doppelt in any case, never otherwise", () => {
    for (const text of ["Doppelte Punkte heute", "STEMPEL extra", "heute doppelt", "punkte"]) expect(needsActionHint(text), text).toBe(true);
    expect(needsActionHint("Heute ruhig: Kaffee gratis zum Croissant")).toBe(false);
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
