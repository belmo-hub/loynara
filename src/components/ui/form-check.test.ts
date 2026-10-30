import { expect, it } from "vitest";
import { validityMessage } from "./form-check";

const control = (type: string, validity: Partial<ValidityState>, extra: object = {}) =>
  ({ type, validity: { valid: false, ...validity }, min: "", max: "", minLength: -1, ...extra }) as unknown as HTMLInputElement;

it("says in German what is wrong with each kind of field", () => {
  expect(validityMessage(control("checkbox", { valueMissing: true }))).toBe("Bitte bestätige das, um fortzufahren.");
  expect(validityMessage(control("email", { valueMissing: true }))).toBe("Bitte gib deine E-Mail-Adresse ein.");
  expect(validityMessage(control("email", { typeMismatch: true }))).toBe("Diese E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.");
  expect(validityMessage(control("text", { valueMissing: true }))).toBe("Bitte fülle dieses Feld aus.");
  expect(validityMessage(control("text", { tooShort: true }, { minLength: 2 }))).toBe("Bitte gib mindestens 2 Zeichen ein.");
  expect(validityMessage(control("number", { valueMissing: true }, { min: "1", max: "3650" }))).toBe("Bitte eine ganze Zahl von 1 bis 3650 eingeben.");
  expect(validityMessage(control("number", { rangeUnderflow: true }, { min: "7", max: "365" }))).toBe("Bitte eine ganze Zahl von 7 bis 365 eingeben.");
  expect(validityMessage(control("text", { valid: true }))).toBe("");
});
