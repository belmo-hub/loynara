import { describe, expect, it } from "vitest";
import { cardNewsProblem, reviewUrlValid } from "./card-extras";

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
