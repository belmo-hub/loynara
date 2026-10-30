import { useState, type FormEvent } from "react";

type Control = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** The app's German text for a control the browser marks invalid; every form is noValidate, so no browser bubble shows. */
export function validityMessage(control: Control): string {
  const v = control.validity;
  if (v.valid) return "";
  if (control.type === "checkbox") return "Bitte bestätige das, um fortzufahren.";
  if (control.type === "email") return v.valueMissing ? "Bitte gib die E-Mail-Adresse ein." : "Die E-Mail-Adresse ist unvollständig, z. B. name@beispiel.de.";
  const { min, max } = control as HTMLInputElement;
  if (control.type === "number" && min && max) return `Bitte gib eine ganze Zahl von ${min} bis ${max} ein.`;
  if (v.valueMissing) return control.type === "file" ? "Bitte wähle eine Datei." : "Bitte fülle dieses Feld aus.";
  if (v.tooShort) return `Bitte gib mindestens ${(control as HTMLInputElement).minLength} Zeichen ein.`;
  return "Bitte prüfe diese Eingabe.";
}

/** Each invalid control's message by id (a field's own message when it is empty or too short); the first one takes the focus. */
export function checkForm(form: Pick<HTMLFormElement, "elements">, messages: Record<string, string> = {}) {
  const errors: Record<string, string> = {};
  let first: Control | undefined;
  for (const control of Array.from(form.elements) as Control[]) {
    if (!control.id || !control.validity || control.validity.valid) continue;
    errors[control.id] = ((control.validity.valueMissing || control.validity.tooShort) && messages[control.id]) || validityMessage(control);
    first ??= control;
  }
  first?.focus();
  return errors;
}

/** `errors` without the control's entry once that control is valid again (same object when nothing changes). */
export function clearFixed(errors: Record<string, string>, control: Control) {
  if (!errors[control.id] || !control.validity?.valid) return errors;
  const rest = { ...errors };
  delete rest[control.id];
  return rest;
}

/**
 * Checks a noValidate form against its own attributes (required, minLength, min, max, type) on submit. `error(id)` is the
 * message for the control with that id, for the field's `error`; the first invalid control takes the focus. An error goes
 * as soon as its control is valid again (`onInput` on the form). `aria(id)` wires a bare input to its `${id}-error` line.
 * `messages` names what is missing for a field id, used when it is empty or too short; other problems keep the general line.
 */
export function useFormCheck(messages: Record<string, string> = {}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  function check(form: HTMLFormElement) {
    const next = checkForm(form, messages);
    setErrors(next);
    return Object.keys(next).length === 0;
  }
  const onInput = (event: FormEvent<HTMLFormElement>) => setErrors(current => clearFixed(current, event.target as Control));
  const aria = (id: string) => errors[id] ? { "aria-invalid": true, "aria-describedby": `${id}-error` } : {};
  return { check, onInput, aria, error: (id: string) => errors[id] || undefined };
}
