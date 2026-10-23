import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeResponse } from "@/components/client-api";
import { RETENTION_RULES, type RetentionSummary } from "@/lib/retention";

const state = vi.hoisted(() => ({ locations: [] as unknown[] }));
vi.mock("./owner-context", () => ({ useOwner: () => ({ locations: state.locations }) }));

import { CancellationNotice } from "./cancellation-notice";
import { NextStep } from "./overview";
import { RetentionInsights } from "./retention-insights";

const base: MeResponse = {
  userId: "u", tenantId: "t", locationId: "l", role: "owner", businessName: "Pizzeria Test", locationName: "Kassel Mitte", publicBaseUrl: "http://localhost:3000",
  programSlug: "pizzeria", programType: "stamp", rewardTitle: "Pizza", rewardCost: 8,
};
const at = (iso: string) => new Date(iso);
const notice = (me: Partial<MeResponse>, now = "2026-11-10T10:00:00Z") => renderToStaticMarkup(createElement(CancellationNotice, { me: { ...base, ...me }, now: at(now) }));
const confirmed = { cancellationEndDate: "2026-11-30", cancellationConfirmed: true };
const requested = { cancellationEndDate: "2026-10-31", cancellationConfirmed: false };

describe("the end-date notice", () => {
  it("shows nothing without a cancellation", () => {
    expect(notice({})).toBe("");
    expect(notice({ cancellationEndDate: null })).toBe("");
  });

  it("confirmed: the date, how long customers can still redeem, and the next steps", () => {
    const html = notice(confirmed);
    expect(html).toContain("Dein Programm endet am 30.11.2026.");
    expect(html).toContain("Noch 20 Tage. Bis dahin läuft alles normal: Deine Kunden sammeln weiter und lösen ihre Prämien ein.");
    expect(html).toContain("Sag es deinen Kunden");
    expect(html).toContain("herunterladen");
    expect(html).toContain("30.12.2026"); // the export window
    expect(html).toContain('href="/merchant/settings"');
    expect(html).toContain("Text für deine Kunden");
  });

  it("requested: provisional wording, redemptions work, and the owner can still withdraw", () => {
    const html = notice(requested, "2026-10-21T10:00:00Z");
    expect(html).toContain("Voraussichtlich bis zum 31.10.2026.");
    expect(html).toContain("Wir bestätigen dir das genaue Enddatum per E-Mail. Bis dahin läuft alles normal, auch das Einlösen von Prämien.");
    expect(html).toContain("Kündigung in den Einstellungen");
    expect(html).not.toContain("Dein Programm endet am");
  });

  it("handles the end date being tomorrow, today and already past (Berlin days)", () => {
    expect(notice(confirmed, "2026-11-29T10:00:00Z")).toContain("Noch 1 Tag. Bis dahin");
    expect(notice(confirmed, "2026-11-30T10:00:00Z")).toContain("Heute ist der letzte Tag. Bis Mitternacht läuft alles normal, auch das Einlösen von Prämien.");
    expect(notice(confirmed, "2026-11-30T22:59:59Z")).toContain("Heute ist der letzte Tag"); // 23:59:59 in Berlin
    const past = notice(confirmed, "2026-11-30T23:00:00Z");
    expect(past).toContain("Das Enddatum ist erreicht. Das Programm wird in Kürze beendet.");
    expect(past).not.toContain("Sag es deinen Kunden"); // too late to tell them
    expect(past).toContain("herunterladen");
    expect(past).not.toContain("/merchant/settings");
    // A provisional date that passes without confirmation never ends the programme.
    expect(notice(requested, "2026-11-05T10:00:00Z")).toContain("Dein Programm läuft weiter, bis wir das Enddatum bestätigen.");
  });

  it("names the location for an owner with several, and not for one", () => {
    state.locations = [{}, {}];
    expect(notice(confirmed)).toContain("Programm endet · Kassel Mitte");
    state.locations = [{}];
    expect(notice(confirmed)).not.toContain("Kassel Mitte");
  });

  it("offers no Einstellungen link where the cancel card is withheld (production) or to a manager, but keeps the facts", () => {
    for (const me of [{ hiddenSurfaces: ["cancellation" as const] }, { role: "manager" as const }]) {
      const html = notice({ ...confirmed, ...me });
      expect(html).toContain("Dein Programm endet am 30.11.2026.");
      expect(html).not.toContain("/merchant/settings");
    }
    expect(notice({ ...confirmed, role: "manager" })).not.toContain("herunterladen"); // the export is the owner's
  });
});

describe("a calm Übersicht never says nothing is urgent while the programme is ending", () => {
  const quiet: RetentionSummary = { asOf: "2026-11-10T00:00:00.000Z", inactiveDays: 30, locationId: null, openCards: 5, recent: 5, drifting: 0, never: 0, neverAfterWeek: 0,
    nearReward: 0, rewardReady: 0, driftingWeekAgo: 0, nearRewardMaxRemaining: 0, nearRewardId: null, programCount: 1, rules: RETENTION_RULES };
  const readiness = { state: "ok" as const, at: 0, data: { locationId: "l", steps: [], next: null, requiredDone: 0, requiredTotal: 0 } };
  const retention = { state: "ok" as const, at: 0, data: quiet };
  const next = (me: Partial<MeResponse>) => renderToStaticMarkup(createElement(NextStep, { me: { ...base, ...me }, retention, referrals: null, readiness }));
  const insights = (me: Partial<MeResponse>) => renderToStaticMarkup(createElement(RetentionInsights, { me: { ...base, ...me }, summary: retention, referrals: null, reload: () => undefined }));

  it("says so when nothing is going on and no cancellation exists", () => {
    expect(next({})).toContain("Gerade nichts Dringendes");
    expect(insights({})).toContain("Gerade nichts Dringendes");
  });

  it.each([["requested", requested], ["confirmed", confirmed]])("does not say so while a cancellation is %s", (_, cancellation) => {
    expect(next(cancellation)).toBe("");
    expect(insights(cancellation)).not.toContain("Gerade nichts Dringendes");
    expect(insights(cancellation)).toContain("Sonst ist nichts offen.");
  });
});
