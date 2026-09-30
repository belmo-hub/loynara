import { describe, expect, it } from "vitest";
import { readableInk, whiteContrast } from "./color";
import { activeGroup, groupHref, visibleGroups } from "./nav";
import { confirmSentence, earningSentence, minimumSpendMinor, parseGermanMoney, parseWholeNumber, purchaseExample } from "./program-helpers";

describe("purchaseExample uses the server's rounding", () => {
  it("accepts German decimals and rounds down", () => {
    expect(purchaseExample("12,90", 1)).toEqual({ ok: true, amountMinor: 1290, points: 12 });
    expect(purchaseExample("12.90", 2)).toEqual({ ok: true, amountMinor: 1290, points: 25 });
  });
  it("explains instead of inventing a result", () => {
    expect(purchaseExample("0,50", 1)).toMatchObject({ ok: false });
    expect(purchaseExample("abc", 1)).toMatchObject({ ok: false, message: "Bitte einen Betrag wie 12,90 eingeben." });
    expect(purchaseExample("", 1)).toEqual({ ok: false, message: "" });
  });
});

describe("minimumSpendMinor", () => {
  it("finds the smallest purchase that still reaches the reward", () => {
    expect(minimumSpendMinor(50, 1)).toBe(5000);
    expect(minimumSpendMinor(10, 3)).toBe(334); // 3,34 € * 3 = 10,02 -> 10 points; 3,33 € -> 9
    expect(minimumSpendMinor(1, 1000)).toBe(1);
  });
  it("returns null for unusable input", () => {
    expect(minimumSpendMinor(0, 1)).toBeNull();
    expect(minimumSpendMinor(5, 0)).toBeNull();
  });
});

describe("input parsing", () => {
  it("parses whole numbers only", () => {
    expect(parseWholeNumber("10")).toBe(10);
    expect(parseWholeNumber("0")).toBeNull();
    expect(parseWholeNumber("1,5")).toBeNull();
    expect(parseWholeNumber("")).toBeNull();
  });
  it("parses German money", () => {
    expect(parseGermanMoney("1,80")).toBe(1.8);
    expect(parseGermanMoney("2")).toBe(2);
    expect(parseGermanMoney("0")).toBeNull();
    expect(parseGermanMoney("1,234")).toBeNull();
  });
});

describe("rule wording keeps earning and confirmation apart", () => {
  it("never suggests NFC knows an amount", () => {
    expect(confirmSentence("points", "purchase")).toContain("kennt keinen Betrag");
    expect(confirmSentence("stamp", "manual")).not.toContain("Betrag");
  });
  it("describes only supported modes", () => {
    expect(earningSentence("points", "purchase", 2, "EUR")).toBe("2 Punkte pro 1 € Einkaufswert, abgerundet auf ganze Punkte.");
    expect(earningSentence("stamp", "manual", 1, "EUR")).toContain("Stempel");
  });
});

describe("colour helpers", () => {
  it("warns about light brand colours for Apple's fixed white text", () => {
    expect(whiteContrast("#C99A2E")).toBeLessThan(4.5);
    expect(whiteContrast("#1F4A3A")).toBeGreaterThan(7);
  });
  it("chooses readable ink like the customer card", () => {
    expect(readableInk("#1F4A3A")).toBe("#ffffff");
    expect(readableInk("#F7D774")).toBe("#000000");
    expect(readableInk("nope")).toBe("#ffffff");
  });
});

describe("navigation", () => {
  it("has five destinations for owners and hides owner-only areas from managers", () => {
    expect(visibleGroups("owner").map(group => group.label)).toEqual(["Übersicht", "Treueprogramm", "Kunden", "Aktionen", "Einstellungen"]);
    expect(visibleGroups("manager").map(group => group.label)).toEqual(["Übersicht", "Treueprogramm", "Kunden"]);
  });
  it("maps every existing merchant URL to a destination", () => {
    const urls = ["/merchant", "/merchant/program", "/merchant/program/card", "/merchant/referrals", "/merchant/customers", "/merchant/customers/import", "/merchant/audiences", "/merchant/campaigns", "/merchant/automations", "/merchant/analytics", "/merchant/adviser", "/merchant/settings", "/merchant/locations", "/merchant/staff", "/merchant/billing", "/merchant/billing/fixture/x"];
    for (const url of urls) expect(activeGroup(url, "owner"), url).toBeDefined();
  });
  it("links each destination to a page its role can open", () => {
    for (const group of visibleGroups("manager")) expect(["/merchant", "/merchant/program", "/merchant/customers"]).toContain(groupHref(group, "manager"));
  });
});
