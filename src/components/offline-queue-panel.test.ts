import { createElement as h } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { OfflineQueuedEvent } from "@/lib/offline-queue";
import { OfflineQueuePanel } from "./offline-queue-panel";

const event = (over: Partial<OfflineQueuedEvent>): OfflineQueuedEvent => ({
  eventId: "0b0e6c0e-3d5c-4d0e-9a55-0d6c3a1f2b01", leaseId: "0b0e6c0e-3d5c-4d0e-9a55-0d6c3a1f2b02", actorUserId: "synthetic-user",
  membershipId: "0b0e6c0e-3d5c-4d0e-9a55-0d6c3a1f2b03", cardLocator: "K-ABCDEF", eventAt: "2026-11-12T19:14:02.000Z", award: { quantity: 1 }, state: "pending", ...over,
});
const panel = (events: OfflineQueuedEvent[], currency?: string) => renderToStaticMarkup(h(OfflineQueuePanel, { events, currency, busy: false, onSync: () => {}, onAcknowledge: () => {}, locale: "de" }));

// The cashier reads sentences, never the system's reason codes (Design, 12 Nov, rule C-R7).
describe("OfflineQueuePanel", () => {
  it("names a refusal with its sentence and without the reason code", () => {
    const out = panel([event({ state: "rejected", reason: "LEASE_EXPIRED" })]);
    expect(out).toContain("Abgelehnt: Die Offline-Freigabe ist abgelaufen.");
    expect(out).not.toContain("LEASE_EXPIRED");
  });
  it("never prints a reason it has no sentence for", () => {
    const out = panel([event({ state: "rejected", reason: "SOMETHING_NEW" })]);
    expect(out).toContain("Abgelehnt: Unbekannter Grund");
    expect(out).not.toContain("SOMETHING_NEW");
  });
  it("shows the time as the app's feeds do: day, month, hours and minutes", () => {
    const out = panel([event({})]);
    expect(out).toMatch(/K-ABCDEF · \d{1,2}\.\d{1,2}\., \d{2}:\d{2}</);
  });
  it("shows a purchase as money, with the shop's currency once the Kasse knows it", () => {
    const award = { purchaseAmountMinor: 1670, ruleVersionId: "0b0e6c0e-3d5c-4d0e-9a55-0d6c3a1f2b04" };
    expect(panel([event({ award })], "EUR")).toContain("Kaufbetrag: 16,70 €");
    expect(panel([event({ award })])).toContain("Kaufbetrag: 16,70<");
  });
});
