import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";

const state = vi.hoisted(() => ({ me: null as Partial<MeResponse> | null, loaded: { state: "loading" } as unknown }));
vi.mock("@/components/owner/owner-context", () => ({ useOwner: () => ({ me: state.me, refresh: async () => {} }) }));
vi.mock("@/components/owner/use-load", () => ({ useLoad: () => [state.loaded, () => {}] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {}, replace: () => {} }) }));

import CancelProgrammePage from "./page";

const facts = {
  lastDay: { label: "Letzter Tag", value: "27.11.2026", sub: "Bis dahin läuft alles normal: Deine Kunden sammeln weiter und lösen Prämien ein." },
  lastInvoice: { label: "Letzte Rechnung", value: "Keine weitere Rechnung", sub: "Die letzte kam am 28.10.2026: 49 € für 28.10.–27.11.2026." },
  exportUntil: { label: "Daten herunterladen bis", value: "27.12.2026", sub: "Danach löschen wir alle Daten deines Geschäfts und deiner Kunden. Rechnungen und Vertragsunterlagen bewahren wir auf, solange das Gesetz es verlangt." },
};
const view = (over: Record<string, unknown> = {}) => ({ state: "open", requestedOn: null, endDate: "2026-11-27", endDateText: "27.11.2026", facts, reason: null, locations: null,
  customerText: "Unsere Stempelkarte läuft noch bis einschließlich 27.11.2026. Bis dahin kannst du weiter sammeln und Prämien einlösen. Danach geht das nicht mehr.", unit: "Stempel",
  withdrawal: { text: "Dein Programm läuft dann ohne Enddatum weiter. Die Abrechnung bleibt wie bisher: nächste Rechnung am 28.11.2026, 49 €." }, ...over });
const page = (loaded: unknown, me: Partial<MeResponse> = {}) => {
  state.me = { role: "owner", programSlug: "shop", ...me };
  state.loaded = loaded;
  return renderToStaticMarkup(createElement(CancelProgrammePage));
};

describe("Programm beenden (ENG-167, Design's spec with Legal's answers)", () => {
  it("O1: the lead, the three facts from the server, and the one danger action with Abbrechen", () => {
    const html = page({ state: "ok", data: view() });
    expect(html).toContain("Prüfe die drei Angaben. Wir bestätigen dir das Enddatum per E-Mail.");
    for (const text of ["Letzter Tag", "27.11.2026", "Keine weitere Rechnung", "Die letzte kam am 28.10.2026", "Daten herunterladen bis", "27.12.2026"]) expect(html).toContain(text);
    expect(html).toContain("Ja, Programm beenden");
    expect(html).toContain("Abbrechen");
    expect(html).not.toContain("Gekündigt am");
  });

  it("O2 / O3 / O9: the reason line and every location under the facts, before cancelling", () => {
    const html = page({ state: "ok", data: view({ reason: "Du kannst mit 14 Tagen Frist zum letzten Tag eines Abrechnungsmonats kündigen. …", locations: "Gilt für alle deine Standorte: Kassel Mitte und Kassel Nord enden am selben Tag." }) });
    expect(html).toContain("Du kannst mit 14 Tagen Frist zum letzten Tag eines Abrechnungsmonats kündigen.");
    expect(html).toContain("Gilt für alle deine Standorte: Kassel Mitte und Kassel Nord enden am selben Tag.");
  });

  it("O4 after the cancellation: when it came in, the end, the mail sent, the customer text in the shop's unit, and the quiet withdrawal", () => {
    const html = page({ state: "ok", data: view({ state: "cancelled", requestedOn: "01.11.2026" }) });
    expect(html).toContain("Gekündigt am 01.11.2026");
    expect(html).toContain("Deine Kündigung ist bei uns eingegangen. Dein Programm endet am 27.11.2026. Die Bestätigung haben wir dir per E-Mail geschickt. Bis dahin läuft alles normal.");
    expect(html).toContain("Unsere Stempelkarte läuft noch bis einschließlich 27.11.2026.");
    expect(html).toContain("Kündigung zurücknehmen");
    expect(html).not.toContain("Ja, Programm beenden");
    expect(html).not.toContain("Prüfe die drei Angaben");
    expect(page({ state: "ok", data: view({ state: "cancelled", requestedOn: "01.11.2026", unit: "Punkte", customerText: "Unsere Punktekarte läuft noch bis einschließlich 27.11.2026." }) })).toContain("Unsere Punktekarte");
  });

  it("O5: a later end agreed with the shop (C36)", () => {
    const html = page({ state: "ok", data: view({ state: "later", requestedOn: "01.11.2026", endDateText: "27.12.2026" }) });
    expect(html).toContain("Neues Enddatum: 27.12.2026");
    expect(html).toContain("So haben wir es mit dir vereinbart. Die Bestätigung haben wir dir per E-Mail geschickt. Bis dahin läuft alles normal.");
  });

  it("the desktop preview shows the card's own end notice, from the moment of cancelling (C22, C37)", () => {
    const html = page({ state: "ok", data: view() });
    expect(html).toContain("So sehen es deine Kunden");
    expect(html).toContain("Diese Karte endet am 27.\u00a0November\u00a02026.");
    expect(html).toContain("Bis dahin kannst du weiter Stempel sammeln und Prämien einlösen.");
    expect(html).toContain("Deine Kunden sehen das Enddatum ab dem Moment, in dem du kündigst.");
  });

  it("a planned end (no request): the agreed date and its facts, focusable for the move after cancelling, and no withdrawal (Design 6, 9)", () => {
    const html = page({ state: "ok", data: view({ state: "planned", endDateText: "27.12.2026" }) });
    expect(html).toContain("Dein Programm endet am 27.12.2026.");
    expect(html).toContain("So haben wir es mit dir vereinbart.");
    expect(html).toContain("Letzter Tag");
    expect(html).not.toContain("Gekündigt am");
    expect(html).not.toContain("Kündigung zurücknehmen");
    expect(html).not.toContain("Ja, Programm beenden");
    // The status the focus moves to after „Ja, Programm beenden“ (blocking 9).
    expect(page({ state: "ok", data: view({ state: "cancelled", requestedOn: "01.11.2026" }) })).toMatch(/<div tabindex="-1" class="ow-qstatus">/);
  });

  it("loading and a failed read; staff see the owner-only notice and nothing is loaded", () => {
    expect(page({ state: "loading" })).toContain("ow-skel");
    expect(page({ state: "error", message: "Das hat gerade nicht geklappt." })).toContain("Das hat gerade nicht geklappt.");
    expect(page({ state: "idle" }, { role: "manager" })).toContain("Die Einstellungen sind Inhaber:innen vorbehalten.");
  });
});
