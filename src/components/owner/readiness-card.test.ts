import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LaunchReadiness } from "@/lib/readiness";
import { ReadinessCard } from "./readiness-card";

const data: LaunchReadiness = {
  locationId: "location", requiredDone: 1, requiredTotal: 3,
  next: { stepId: "enrolment", reason: "Erst mit einer eigenen Karte lässt sich der Ablauf prüfen." },
  steps: [
    { id: "programme", group: "setup", required: true, status: "done", title: "Programm und Prämie", evidence: "Stempelkarte", action: { label: "Ansehen", href: "/merchant/program" } },
    { id: "card", group: "setup", required: false, status: "todo", title: "Kundenkarte gestaltet", evidence: "Standardfarbe", action: { label: "Karte gestalten", href: "/merchant/program/card", ownerOnly: true } },
    { id: "team", group: "setup", required: false, status: "todo", title: "Teamzugang für die Kasse", evidence: "Noch keiner", action: { label: "Person einladen", href: "/merchant/staff", ownerOnly: true } },
    { id: "enrolment", group: "verify", required: true, status: "todo", title: "Erste Karte angemeldet", evidence: "Noch keine Karte.", action: { label: "Anmeldelink öffnen", href: "/merchant/settings" } },
    { id: "first_award", group: "verify", required: true, status: "todo", title: "Erste Buchung an der Kasse bestätigt", evidence: "Noch keine.", note: "Boni zählen nicht.", action: { label: "Kasse öffnen", href: "/cashier" } },
    { id: "nfc", group: "external", required: false, status: "external", title: "NFC am Tresen", evidence: "Keine Schlüsselverwaltung." }, // without NFC, the only step outside Loynara
  ],
};
const render = (isOwner: boolean, readiness = data, compact = false) => renderToStaticMarkup(createElement(ReadinessCard, { readiness: { state: "ok", data: readiness, at: 0 }, reload: () => {}, isOwner, compact }));

describe("readiness card", () => {
  it("keeps the three German groups and shows outside-Loynara items as non-ticked, never done", () => {
    const html = render(true);
    for (const heading of ["Einrichtung", "Im Betrieb geprüft", "Außerhalb von Loynara"]) expect(html).toContain(heading);
    const external = html.slice(html.indexOf("Außerhalb von Loynara"));
    expect(external).toContain("außerhalb von Loynara</span>"); // screen-reader status for each external step
    expect(external).not.toContain('data-done="true"');
    expect(external).not.toContain("– erledigt");
    expect(html).toContain("1 von 3 Pflichtschritten belegt.");
  });

  it("shows what does not count as its own muted line, so the step text stays the action", () => {
    const html = render(true);
    expect(html).toContain('<div class="ow-step-note">Noch keine.</div><div class="ow-step-note">Boni zählen nicht.</div>');
    expect(html).not.toContain("Noch keine. Boni zählen nicht.");
  });

  it("hides a group with no steps, heading and all", () => {
    const html = render(true, { ...data, steps: data.steps.filter(step => step.group !== "external") }); // NFC available: nothing is outside
    for (const heading of ["Einrichtung", "Im Betrieb geprüft"]) expect(html).toContain(heading);
    expect(html).not.toContain("Außerhalb von Loynara");
    expect(html).not.toContain("Loynara kann es nicht prüfen.");
  });

  it("offers a manager no link to owner-only pages, but keeps the shared ones", () => {
    const manager = render(false);
    expect(manager).not.toContain("/merchant/staff");
    expect(manager).not.toContain("/merchant/program/card");
    for (const href of ["/merchant/settings", "/cashier", "/merchant/program"]) expect(manager).toContain(href);
    const owner = render(true);
    expect(owner).toContain("/merchant/staff");
    expect(owner).toContain("/merchant/program/card");
  });

  it("collapses only when required evidence is complete, with a summary that leaves nothing legal open", () => {
    const done = { ...data, requiredDone: 3, next: null, steps: data.steps.map(step => step.required ? { ...step, status: "done" as const } : step) };
    const html = render(true, done, true);
    expect(html).toContain("<details");
    const summaryOf = (steps = done.steps) => render(true, { ...done, steps }, true).match(/<summary>.*?<span class="ow-muted">(.*?)<\/span><\/summary>/)?.[1];
    expect(summaryOf()).toBe("Alle 3 Pflichtschritte sind belegt, 2 Empfehlungen offen.");
    expect(summaryOf()).not.toMatch(/Rechtliches|Entwurf/);
    expect(summaryOf(done.steps.map(step => step.id === "card" ? { ...step, status: "done" as const } : step))).toBe("Alle 3 Pflichtschritte sind belegt, 1 Empfehlung offen.");
    expect(summaryOf(done.steps.map(step => step.status === "todo" ? { ...step, status: "done" as const } : step))).toBe("Alle 3 Pflichtschritte sind belegt.");
    expect(render(true, data, true)).not.toContain("<details"); // incomplete: stays open on the overview
    expect(render(true, done, false)).not.toContain("<details"); // the first-run page never collapses
  });
});
