import { describe, expect, it } from "vitest";
import { reviewNotice } from "./referral-summary";

describe("review decision notice (ENG-179, fault 7)", () => {
  it("shows a still-held bonus correction as a warning, a saved decision as success", () => {
    expect(reviewNotice("review")).toEqual({ text: "Die Bonus-Korrektur ist noch nicht möglich. Der Vorgang bleibt zur Prüfung offen.", tone: "warn" });
    expect(reviewNotice("rejected")).toEqual({ text: "Prüfentscheidung gespeichert.", tone: "ok" });
  });
});
