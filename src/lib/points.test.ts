import { describe, expect, it } from "vitest";
import { parsePurchaseAmountMinor, purchasePoints } from "./points";

describe("purchase points", () => {
  it("floors fractional points using exact minor-unit arithmetic", () => {
    expect(purchasePoints(499, 1)).toBe(4);
    expect(purchasePoints(199, 2)).toBe(3);
    expect(purchasePoints(1, 100)).toBe(1);
  });

  it("rejects invalid, zero-point, and excessive purchases", () => {
    expect(() => purchasePoints(99, 1)).toThrow("NO_POINTS");
    expect(() => purchasePoints(0, 1)).toThrow("INVALID_PURCHASE_AMOUNT");
    expect(() => purchasePoints(10_000_001, 1)).toThrow("INVALID_PURCHASE_AMOUNT");
    expect(() => purchasePoints(100.5, 1)).toThrow("INVALID_PURCHASE_AMOUNT");
    expect(() => purchasePoints(100, 0)).toThrow("INVALID_POINTS_RATE");
  });
});

describe("purchase amount entry", () => {
  it("parses two-decimal EUR and MAD amounts without floating point", () => {
    expect(parsePurchaseAmountMinor("16,70")).toBe(1670);
    expect(parsePurchaseAmountMinor("16.7")).toBe(1670);
    expect(parsePurchaseAmountMinor("100000")).toBe(10_000_000);
  });

  it("rejects empty, malformed, zero and excessive amounts", () => {
    for (const amount of ["", "0", "0,00", "1,234", "1,2,3", "-1", "100000,01"]) {
      expect(() => parsePurchaseAmountMinor(amount)).toThrow("INVALID_PURCHASE_AMOUNT");
    }
  });
});
