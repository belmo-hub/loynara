import { describe, expect, it } from "vitest";
import { ClientApiError } from "@/components/client-api";
import { ruleBody } from "./program-rule-changes";
import { failure } from "./question-form";

describe("what the rule screens post (ENG-100, S1b's update route)", () => {
  it("sends worse: true only for „Schlechter“", () => {
    expect(ruleBody.text("pizza", "Nur abends.", "worse")).toEqual({ programSlug: "pizza", rulesText: "Nur abends.", worse: true });
    expect(ruleBody.text("pizza", "Auch abends.", "better")).toEqual({ programSlug: "pizza", rulesText: "Auch abends.", worse: false });
    expect(ruleBody.earning("pizza", { earningMode: "manual", rulesText: "10 Punkte pro Pizza." }, "worse")).toMatchObject({ earningMode: "manual", worse: true });
    expect(ruleBody.earning("pizza", { earningMode: "purchase", pointsPerCurrencyUnit: 2, rulesText: "" }, "better")).toMatchObject({ earningMode: "purchase", worse: false });
  });
  it("sends no answer for a change of rate alone, and takeBack for the take-back", () => {
    expect(ruleBody.earning("pizza", { earningMode: "purchase", pointsPerCurrencyUnit: 1 })).toEqual({ programSlug: "pizza", earningMode: "purchase", pointsPerCurrencyUnit: 1 });
    expect(ruleBody.takeBack("pizza")).toEqual({ programSlug: "pizza", takeBack: true });
  });
  it("shows the server's German message for a change already waiting", () => {
    const message = "Für die Regel wartet schon eine Änderung auf ihr Datum. Nimm sie zuerst zurück.";
    expect(failure(new ClientApiError(409, message, "CHANGE_PENDING"))).toBe(message);
    expect(failure(new ClientApiError(500, "Internal error", "INTERNAL"))).toBe("Die Einstellungen konnten nicht gespeichert werden.");
  });
});
