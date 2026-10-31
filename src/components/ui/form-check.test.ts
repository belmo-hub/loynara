import { expect, it } from "vitest";
import { checkForm, clearFixed, validityMessage } from "./form-check";

const control = (type: string, validity: Partial<ValidityState>, extra: object = {}) =>
  ({ type, validity: { valid: false, ...validity }, min: "", max: "", minLength: -1, ...extra }) as unknown as HTMLInputElement;

it("says in German what is wrong with each kind of field", () => {
  expect(validityMessage(control("checkbox", { valueMissing: true }))).toBe("Bitte bestätige das, um fortzufahren.");
  expect(validityMessage(control("email", { valueMissing: true }))).toBe("Bitte gib die E-Mail-Adresse ein.");
  expect(validityMessage(control("email", { typeMismatch: true }))).toBe("Die E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.");
  expect(validityMessage(control("text", { valueMissing: true }))).toBe("Bitte fülle dieses Feld aus.");
  expect(validityMessage(control("text", { tooShort: true }, { minLength: 2 }))).toBe("Bitte gib mindestens 2 Zeichen ein.");
  expect(validityMessage(control("number", { valueMissing: true }, { min: "1", max: "3650" }))).toBe("Bitte gib eine ganze Zahl von 1 bis 3650 ein.");
  expect(validityMessage(control("number", { rangeUnderflow: true }, { min: "7", max: "365" }))).toBe("Bitte gib eine ganze Zahl von 7 bis 365 ein.");
  expect(validityMessage(control("text", { valid: true }))).toBe("");
});

it("blocks the submit, names each bad field and focuses the first one", () => {
  const focused: string[] = [];
  const field = (id: string, type: string, validity: Partial<ValidityState>) =>
    ({ ...control(type, validity), id, focus: () => focused.push(id) }) as unknown as HTMLInputElement;
  const form = { elements: [field("ok", "text", { valid: true }), field("name", "text", { valueMissing: true }), field("mail", "email", { typeMismatch: true }), field("short", "text", { tooShort: true })] };
  const errors = checkForm(form as unknown as HTMLFormElement, { name: "Bitte gib die Stadt ein.", mail: "nicht für das Format", short: "Bitte gib einen Betreff ein." });
  // A field's own message covers empty and too short; a malformed address keeps the general line.
  expect(errors).toEqual({ name: "Bitte gib die Stadt ein.", mail: "Die E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.", short: "Bitte gib einen Betreff ein." });
  expect(focused).toEqual(["name"]);
  expect(checkForm({ elements: [field("ok", "text", { valid: true })] } as unknown as HTMLFormElement)).toEqual({});
});

it("drops a field's error once it is valid, and only then", () => {
  const errors = { name: "x", city: "y" };
  expect(clearFixed(errors, { id: "name", validity: { valid: true } } as HTMLInputElement)).toEqual({ city: "y" });
  expect(clearFixed(errors, { id: "name", validity: { valid: false } } as HTMLInputElement)).toBe(errors);
});
