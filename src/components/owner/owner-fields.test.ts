import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CardLinePreview, NumberStepper, numberText } from "./owner-ui";

const DAY = { one: "Tag", many: "Tage" }, POINT = { one: "Punkt", many: "Punkte" };
type Preview = Parameters<typeof CardLinePreview>[0];
const stepper = (value: string, extra: Partial<Parameters<typeof NumberStepper>[0]> = {}) =>
  renderToStaticMarkup(createElement(NumberStepper, { id: "n", value, onChange: () => {}, min: 14, max: 90, unit: DAY, ...extra }));

describe("numberText (Marketing B1)", () => {
  it("puts the unit after the number, singular for 1", () => {
    expect(numberText("30", { min: 14, max: 90, unit: DAY })?.text).toBe("30 Tage");
    expect(numberText("1", { min: 0, max: 3, unit: POINT })?.text).toBe("1 Punkt");
  });
  it("gives bonus values a plus and shows „Aus“ where 0 means off", () => {
    expect(numberText("2", { min: 0, max: 5, unit: POINT, bonus: true, offAtZero: true })?.text).toBe("+2 Punkte");
    expect(numberText("0", { min: 0, max: 5, unit: POINT, bonus: true, offAtZero: true })).toEqual({ value: "Aus", unit: "", text: "Aus" });
    expect(numberText("0", { min: 0, max: 5, unit: POINT, bonus: true })?.text).toBe("0 Punkte");
  });
  it("has no text while the draft is not a whole number", () => {
    expect(numberText("", { min: 14, max: 90, unit: DAY })).toBeNull();
    expect(numberText("1,5", { min: 14, max: 90, unit: DAY })).toBeNull();
  });
});

describe("NumberStepper", () => {
  it("names its buttons and reads as a spin button with the unit", () => {
    const out = stepper("30");
    expect(out).toContain('aria-label="1 Tag weniger"');
    expect(out).toContain('aria-label="1 Tag mehr"');
    expect(out).toMatch(/<input[^>]*role="spinbutton"[^>]*inputMode="numeric"/);
    expect(out).toContain('aria-valuetext="30 Tage"');
    expect(out).toContain('aria-valuemin="14"');
    expect(out).toContain('aria-valuemax="90"');
  });
  it("disables − at the lower limit and + at the upper one", () => {
    expect(stepper("14")).toMatch(/<button[^>]*aria-label="1 Tag weniger"[^>]*disabled=""/);
    expect(stepper("14")).not.toMatch(/<button[^>]*aria-label="1 Tag mehr"[^>]*disabled=""/);
    expect(stepper("90")).toMatch(/<button[^>]*aria-label="1 Tag mehr"[^>]*disabled=""/);
  });
  it("keeps both buttons usable while the typed value is not a number, and marks the field invalid", () => {
    const out = stepper("", { invalid: true });
    expect(out).not.toContain('disabled=""');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain("data-invalid");
  });
  it("shows „Aus“ without a unit and „+2“ with one", () => {
    expect(stepper("0", { min: 0, max: 5, unit: POINT, bonus: true, offAtZero: true })).toMatch(/value="Aus"[^>]*\/><\/span>/);
    expect(stepper("2", { min: 0, max: 5, unit: POINT, bonus: true })).toMatch(/value="\+2"[^>]*\/><span aria-hidden="true">Punkte<\/span>/);
  });
});

describe("CardLinePreview", () => {
  it("labels the group and puts the rules under the line", () => {
    const out = renderToStaticMarkup(createElement(CardLinePreview, { label: "So steht es auf der Karte", shop: "Café Kurz", rules: "Regeltext" } as Preview, "Zeile"));
    expect(out).toMatch(/role="group" aria-labelledby="([^"]+)"><p id="\1" class="ow-cardline-label">So steht es auf der Karte<\/p>/);
    expect(out).toMatch(/Café Kurz<\/p><p class="ow-cardline-text">Zeile<\/p><p class="ow-cardline-rules">Regeltext<\/p>/);
  });
  it("leaves the rules out when there are none", () => {
    expect(renderToStaticMarkup(createElement(CardLinePreview, { label: "So sieht die Erinnerung aus", shop: "Café Kurz" } as Preview, "Nachricht"))).not.toContain("ow-cardline-rules");
  });
});
