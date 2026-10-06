import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CorrectionDialog } from "./card-actions";
import { ReferralSummary } from "./referral-summary";

describe("merchant outcome descriptions", () => {
  it("does not promise the final balance when a correction may also reverse referral bonuses", () => {
    // A first checkout of one stamp plus a referred bonus of two has balance 3.
    // Correcting it returns 0 on the server, whereas the individual entry changes it to 2.
    const html = renderToStaticMarkup(createElement(CorrectionDialog, {
      entry: { id: "checkout", kind: "award", delta: 1, source: "staff_online", createdAt: "2026-10-01T12:00:00Z", reversalOfId: null, reversed: false, rewardTitle: null, reason: null },
      unit: "Stempel", locationId: "location", balance: 3, onClose: () => {}, onDone: () => {},
    }));
    expect(html).not.toContain("nach Korrektur");
    expect(html).toContain("Empfehlungsboni");
    expect(html).toContain("endgültigen Stand");
  });

  it("keeps signup, pending, credited and review counts distinct without deriving visits from bonus status", () => {
    const html = renderToStaticMarkup(createElement(ReferralSummary, {
      enabled: true, referrerBonus: 2, referredBonus: 1, programType: "stamp", truncated: false,
      referrals: [{ status: "qualified" }, { status: "pending" }, { status: "review" }, { status: "rejected" }],
    }));
    expect(html).toMatch(/Über Link angemeldet<\/dt><dd><span class="ow-metric-value">4<\/span>/);
    expect(html).toMatch(/Bonus gutgeschrieben<\/dt><dd><span class="ow-metric-value">1<\/span>/);
    expect(html).toMatch(/Braucht deine Prüfung<\/dt><dd><span class="ow-metric-value">1<\/span>/);
    expect(html).not.toContain("% der Anmeldungen");
    expect(html).not.toContain("kamen wirklich an die Kasse");
  });
});
