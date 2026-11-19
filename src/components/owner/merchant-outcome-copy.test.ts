import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./owner-context", () => ({ useDirtyGuard: () => {}, useOwner: () => ({ guard: (action: () => void) => action() }) }));

import { CorrectionStep } from "./card-actions";
import { ReferralSummary } from "./referral-summary";

describe("merchant outcome descriptions", () => {
  const step = (kind: "stamp" | "points", delta: number, balance: number) => renderToStaticMarkup(createElement(CorrectionStep, {
    entry: { id: "checkout", kind: "award", delta, source: "staff_online", createdAt: "2026-10-01T12:00:00Z", reversalOfId: null, reversed: false, rewardTitle: null, reason: null },
    kind, locationId: "location", balance, back: { label: "K-7QX2MA", onClick: () => {} }, onDone: () => {},
  }));

  it("does not promise the final balance when a correction may also reverse referral bonuses", () => {
    // A first checkout of one stamp plus a referred bonus of two has balance 3.
    // Correcting it returns 0 on the server, whereas the individual entry changes it to 2.
    const html = step("stamp", 1, 3);
    expect(html).toContain("<p class=\"ow-cardline-label\">Rechnerische Auswirkung dieses Vorgangs</p>"); // R6 sits under it
    expect(html).toContain("Empfehlungsboni");
    expect(html).toContain("endgültigen Stand");
  });

  it("counts one point in the singular when a correction is previewed (ENG-108)", () => {
    expect(step("points", 1, 1)).toMatch(/· \+1 Punkt<\/p>/);
    expect(step("points", 1, 1)).toContain("<dt>Stand jetzt</dt><dd>1 Punkt</dd>");
    expect(step("points", 1, 1)).toContain("<dt>Nach der Korrektur</dt><dd>0 Punkte</dd>");
    expect(step("points", 1, 1)).toContain("Loynara bucht <strong>-1 Punkt</strong>");
    expect(step("points", 2, 3)).toMatch(/· \+2 Punkte<\/p>/);
    expect(step("points", 2, 3)).toContain("<dt>Stand jetzt</dt><dd>3 Punkte</dd>");
    expect(step("points", 2, 3)).toContain("<dt>Nach der Korrektur</dt><dd>1 Punkt</dd>");
    expect(step("points", 2, 3)).toContain("Loynara bucht <strong>-2 Punkte</strong>");
  });

  it("shows the change itself, and a correction below zero as not possible before the tap (ENG-280)", () => {
    expect(step("stamp", 1, 3)).toContain("<dt>Korrektur</dt><dd>-1 Stempel</dd>");
    const html = step("stamp", 1, 0);
    expect(html).toContain("<dt>Nach der Korrektur</dt><dd>Nicht möglich</dd>");
    expect(html).toContain("unter null bringen");
    expect(html).toMatch(/disabled="">Korrektur buchen<\/button>/);
  });

  it("is a screen with the live words: the button waits for ten characters of reason", () => {
    const html = step("stamp", 2, 7);
    expect(html).toMatch(/<h1 tabindex="-1">Vorgang korrigieren<\/h1>/);
    expect(html).toContain("<button type=\"button\" class=\"ow-back\">");
    expect(html).toMatch(/<button type="submit" class="ow-btn ow-btn--primary" aria-busy="false" disabled="">Korrektur buchen<\/button>/);
    expect(html).toContain("Noch 10 Zeichen bis zum Mindestumfang.");
    expect(html).toContain("<dt>Nach der Korrektur</dt><dd>5 Stempel</dd>");
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
