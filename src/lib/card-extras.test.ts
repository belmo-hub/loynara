import { describe, expect, it } from "vitest";
import { cardNewsProblem } from "./card-extras";

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
