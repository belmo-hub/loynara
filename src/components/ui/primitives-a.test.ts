import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge } from "./badge";
import { Button, buttonClassName } from "./button";
import { Card, CardHeader } from "./card";
import { Checkbox } from "./checkbox";
import { TextArea, TextField } from "./field";
import { Select } from "./select";

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

describe("Button", () => {
  it("is a plain button by default so it never submits a form by accident", () => {
    expect(html(h(Button, null, "Speichern"))).toMatch(/^<button type="button"/);
  });
  it("keeps an explicit submit type", () => {
    expect(html(h(Button, { type: "submit" }, "Anmelden"))).toContain('type="submit"');
  });
  it("marks a loading button busy without removing it from the focus order", () => {
    const out = html(h(Button, { loading: true }, "Stempel vergeben"));
    expect(out).toContain('aria-busy="true"');
    expect(out).toContain('aria-disabled="true"');
    expect(out).not.toMatch(/ disabled=""/);
    expect(out).toContain("Stempel vergeben");
  });
  it("exposes the same classes for links styled as buttons", () => {
    expect(buttonClassName({ variant: "secondary", size: "lg", block: true }).split(" ").length).toBeGreaterThanOrEqual(3);
  });
});

describe("TextField", () => {
  it("ties the label, hint and error to the input", () => {
    const out = html(h(TextField, { id: "email", label: "E-Mail-Adresse", hint: "Nur für die Wiederherstellung.", error: "Bitte gib eine gültige E-Mail-Adresse ein." }));
    expect(out).toContain('<label for="email"');
    expect(out).toMatch(/aria-describedby="email-hint email-error"/);
    expect(out).toContain('aria-invalid="true"');
    expect(out).toMatch(/id="email-error"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="email-error"/);
  });
  it("omits error wiring when the value is valid", () => {
    const out = html(h(TextField, { id: "name", label: "Name" }));
    expect(out).not.toContain("aria-invalid");
    expect(out).not.toContain("aria-describedby");
  });
  it("generates an id when none is given", () => {
    expect(html(h(TextField, { label: "Name" }))).toMatch(/<label for="[^"]+"/);
  });
  it("renders a textarea with the same wiring", () => {
    expect(html(h(TextArea, { id: "csv", label: "CSV-Inhalt", error: "Leer" }))).toMatch(/<textarea[^>]*aria-invalid="true"/);
  });
});

describe("Select", () => {
  it("labels the native select and hides the decorative chevron", () => {
    const out = html(h(Select, { id: "loc", label: "Standort" }, h("option", { value: "a" }, "Kassel Mitte")));
    expect(out).toContain('<label for="loc"');
    expect(out).toContain('<select id="loc"');
    expect(out).toMatch(/<svg[^>]*aria-hidden="true"/);
  });
});

describe("Checkbox", () => {
  it("wraps the input in its label so the whole row is the target", () => {
    const out = html(h(Checkbox, { name: "terms" }, "Ich akzeptiere die Teilnahmebedingungen."));
    expect(out).toMatch(/^<label[^>]*><input type="checkbox"/);
  });
});

describe("Badge and Card", () => {
  it("renders a badge with its tone", () => {
    expect(html(h(Badge, { tone: "success" }, "Einlösbar"))).toContain("Einlösbar");
  });
  it("renders a card as the requested landmark with a heading", () => {
    const out = html(h(Card, { as: "section", "aria-labelledby": "t" }, h(CardHeader, { id: "t", title: "Startklar", description: "4 von 6 erledigt" })));
    expect(out).toMatch(/^<section/);
    expect(out).toContain('<h2 id="t"');
  });
});
