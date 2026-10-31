import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CustomerState, StateLink } from "./customer-state";

describe("CustomerState (mock 29, G-07)", () => {
  it("heads a known shop's state with its header, and an unknown one with the Loynara mark", () => {
    expect(renderToStaticMarkup(h(CustomerState, { title: "Anfrage abgelaufen", merchant: "Café Lindenblatt" }))).toMatch(/<strong>Café Lindenblatt<\/strong><span>Deine Treuekarte<\/span>/);
    expect(renderToStaticMarkup(h(CustomerState, { title: "Abmeldelink ungültig." }))).toContain('aria-label="Loynara"');
  });
  it("gives an error its danger tile and announces the message", () => {
    const out = renderToStaticMarkup(h(CustomerState, { title: "Karte nicht erreichbar.", message: "x", tone: "error", icon: h("svg") }));
    expect(out).toMatch(/data-tone="error" aria-hidden="true"><svg>/);
    expect(out).toContain('role="alert"');
  });
  it("announces a live message politely and leaves a plain one alone", () => {
    expect(renderToStaticMarkup(h(CustomerState, { title: "Warte auf das Team", message: "x", live: true }))).toContain('role="status" aria-live="polite"');
    expect(renderToStaticMarkup(h(CustomerState, { title: "E-Mail-Angebote abbestellen", message: "x" }))).toMatch(/<p class="[^"]*">x<\/p>/);
  });
  it("draws an action as a signpost row, green only as the one next step", () => {
    expect(renderToStaticMarkup(h(StateLink, { href: "/card/x", icon: null, primary: true, children: "Karte und Prämien ansehen" }))).toContain("data-primary=\"true\"");
    expect(renderToStaticMarkup(h(StateLink, { href: "/recover", icon: null, children: "Karte wiederfinden" }))).not.toContain("data-primary");
  });
});
