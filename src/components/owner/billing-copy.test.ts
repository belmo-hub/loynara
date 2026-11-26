import { describe, expect, it } from "vitest";
import { billingStatus, liveStatusSub, money, perMonth } from "./billing-copy";

const plain = (text: string) => text.replace(/ /g, " ");

describe("Abrechnung wording (ENG-122c, R17 FINAL, D-021)", () => {
  it("prints the stored amounts in whole euros where there are no cents", () => {
    expect(plain(money(4900, "EUR"))).toBe("49 €");
    expect(plain(money(4950, "EUR"))).toBe("49,50 €");
  });
  it("names the locations and the sum per month, one and many, with no VAT wording of its own", () => {
    expect(plain(perMonth(1, 4900, "EUR"))).toBe("1 Standort · 49 € im Monat");
    expect(plain(perMonth(2, 9800, "EUR"))).toBe("2 Standorte · 98 € im Monat");
    expect(perMonth(2, 9800, "EUR")).not.toMatch(/Steuer|MwSt|USt/);
  });
  it("labels a state by the billing mode: live (Stripe) or the local payment test", () => {
    expect(billingStatus({ liveBilling: true, status: "manual_pending" })).toBe("Noch kein Abo");
    expect(billingStatus({ liveBilling: false, status: "manual_pending" })).toBe("Noch kein Abo") // Marketing FINAL while billing is off;
    expect(billingStatus({ liveBilling: true, status: "unknown_state" })).toBe("unknown_state");
  });
});

describe("live status sub (ENG-179, fault 1)", () => {
  const sub = (status: string, cancelAtPeriodEnd = false) => liveStatusSub({ status, cancelAtPeriodEnd, currentPeriodEnd: "2026-12-01" }, day => day);
  it("names a next charge only while the subscription runs and charges", () => {
    expect(sub("active")).toBe("Nächste Abrechnung am 2026-12-01.");
    expect(sub("past_due")).toBe("Nächste Abrechnung am 2026-12-01.");
    for (const status of ["suspended", "cancelled", "pending_checkout"]) expect(sub(status)).toBeUndefined();
    // A new shop gets no checkout: billing starts at go-live, with the free month (ENG-375).
    expect(sub("manual_pending")).toBe("Die Abrechnung startet mit deinem Go-live. Der erste Monat ist kostenlos.");
    expect(sub("active", true)).toBe("Gekündigt zum 2026-12-01.");
  });
});
