import { describe, expect, it } from "vitest";
import { cardNewsProblem, challengeSentence, reviewUrlValid } from "./card-extras";

describe("review link", () => {
  it("accepts https links on the three Google review hosts", () => {
    for (const url of ["https://g.page/r/CdEf123/review", "https://www.google.com/maps/place/Synthetic+Caf%C3%A9", "https://google.com/maps?cid=123", "https://search.google.com/local/writereview?placeid=ChIJ123"]) expect(reviewUrlValid(url), url).toBe(true);
  });
  it("refuses everything else", () => {
    for (const url of ["http://g.page/r/x/review", "https://g.page.example.test/r/x", "https://evil.test/?u=https://g.page", "https://www.google.com/search?q=x", "https://www.google.com/mapsx", "https://search.google.com/local/reviews", "https://user:pw@g.page/r/x", "https://g.page:8443/r/x", "javascript:alert(1)", "g.page/r/x", "", `https://g.page/${"a".repeat(500)}`]) expect(reviewUrlValid(url), url).toBe(false);
  });
});

describe("card news", () => {
  it("accepts empty and short plain text up to 140 characters", () => {
    expect(cardNewsProblem("")).toBeNull();
    expect(cardNewsProblem("Ab Montag neue Öffnungszeiten: 8 bis 18 Uhr. <3 & Danke!")).toBeNull();
    expect(cardNewsProblem("ü".repeat(140))).toBeNull();
  });
  it("refuses more than 140 characters", () => {
    expect(cardNewsProblem("a".repeat(141))).toBe("TOO_LONG");
  });
  it("refuses links and web addresses", () => {
    for (const text of ["Mehr auf https://example.test", "www.beispiel", "Besuch beispiel.de", "javascript://x", "Shop: laden.com/angebot"]) expect(cardNewsProblem(text), text).toBe("LINK");
  });
  it("refuses line breaks and control characters", () => {
    expect(cardNewsProblem("Zeile\nzwei")).toBe("CONTROL");
  });
});

describe("challengeSentence in the card's language", () => {
  it("keeps the German sentence and writes French on a French card", () => {
    expect(challengeSentence(3, 50, "points", "Oktober", "31.10.2026").text).toBe("Komm 3-mal im Oktober, dann gibt's 50 Punkte extra.");
    const fr = challengeSentence(3, 20, "points", "octobre", "31/10/2026", "fr");
    expect(fr.text).toBe("Venez 3 fois en octobre et recevez 20 points en plus.");
    expect(fr.conditions).toBe("Seules les visites confirmées en caisse comptent, une par jour au maximum. Valable jusqu’au 31/10/2026. Hors tabac, presse, livres, loterie et recharges téléphoniques.");
    expect(challengeSentence(3, 1, "stamp", "octobre", "31/10/2026", "fr").text).toBe("Venez 3 fois en octobre et recevez 1 tampon en plus.");
  });
});
