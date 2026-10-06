import { describe, expect, it } from "vitest";
import { manualAwardLimit, quantityPickerMax } from "./award-limits";

describe("manual award limits", () => {
  it("matches the server caps per role", () => {
    expect([manualAwardLimit("cashier"), manualAwardLimit("manager"), manualAwardLimit("owner")]).toEqual([10, 100, 1000]);
  });
  it("never lets the picker exceed the server cap; unknown role gets the strictest", () => {
    expect([quantityPickerMax("cashier"), quantityPickerMax("manager"), quantityPickerMax("owner")]).toEqual([10, 100, 100]);
    for (const role of ["cashier", "manager", "owner"] as const) expect(quantityPickerMax(role)).toBeLessThanOrEqual(manualAwardLimit(role));
    expect(quantityPickerMax(null)).toBe(10);
    expect(quantityPickerMax(undefined)).toBe(10);
  });
});
