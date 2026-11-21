import { describe, expect, it } from "vitest";
import data from "@/content/shop-templates.json";
import { draftRules } from "@/components/owner/program-helpers";
import { swatchName } from "@/components/owner/swatches";
import { setupReviewValidation } from "@/components/owner/program-setup-validation";
import { checkRulesText } from "./points";
import { merchantInput, requireAllowedRewardTitle } from "./product";
import { SHOP_TEMPLATES, templateProblems, templateProgramme, type ShopTemplate } from "./shop-templates";

const barber = SHOP_TEMPLATES[0];

describe("shop templates", () => {
  it("is marked as draft and keeps the five types in order", () => {
    expect(data.status).toBe("draft");
    expect(SHOP_TEMPLATES.map(t => t.label)).toEqual(["Friseur / Barbershop", "Nagelstudio", "Pizzeria / Imbiss", "Café / Bäckerei", "Anderes Geschäft"]);
  });

  it("names every template colour from the house swatches, so the demo form never reads out a hex value", () => {
    for (const t of SHOP_TEMPLATES) for (const hex of t.colours) expect(swatchName(hex), `${t.id} ${hex}`).toBeTruthy();
  });

  it.each(SHOP_TEMPLATES.map(t => [t.id, t] as const))("%s passes every limit", (_, t) => {
    expect(templateProblems(t)).toEqual([]);
  });

  it.each(SHOP_TEMPLATES.map(t => [t.id, t] as const))("%s maps to input the setup and onboard checks accept", (_, t) => {
    const programme = templateProgramme(t);
    const programName = "Salon Test Treuekarte", rulesText = draftRules(programme.programType, programme.earningMode);
    const review = setupReviewValidation({ programName, date: "2026-11-09" });
    expect(Object.values(review.problems).filter(Boolean)).toEqual([]);
    const input = merchantInput.parse({ userId: "u1", businessName: "Salon Test", locationName: "Mitte", city: "Kassel", country: "DE", timezone: "Europe/Berlin", locale: "de", currency: "EUR", programName, rulesText, effectiveDate: "2026-11-09", ...programme });
    expect(() => checkRulesText(input.programType, input.earningMode ?? "manual", input.rulesText)).not.toThrow();
    expect(() => requireAllowedRewardTitle(input.rewardTitle)).not.toThrow();
  });

  it.each<[string, Partial<ShopTemplate>]>([
    ["win-back after 7 days", { suggestions: { ...barber.suggestions, winback: { days: 7, bonus: 1 } } }],
    ["a tobacco reward", { rewardTitle: "Zigaretten gratis" }],
    ["a link in the message", { exampleMessage: "Mehr auf www.beispiel.de" }],
    ["happy hour on a stamp card", { suggestions: { ...barber.suggestions, happyHour: { days: [1], start: "14:00", end: "17:00" } } }],
    ["a stamp bonus above 1", { suggestions: { ...barber.suggestions, birthday: { bonus: 2 } } }],
    ["a cost above the server limit", { cost: 100_001 }],
    ["a colour that is not hex", { colours: ["grün"] }],
  ])("reports %s", (_, change) => {
    expect(templateProblems({ ...barber, ...change })).not.toEqual([]);
  });
});
