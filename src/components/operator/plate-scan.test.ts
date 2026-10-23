import { describe, expect, it } from "vitest";
import { plateLabelFromScan } from "./plate-scan";

describe("plateLabelFromScan", () => {
  it("reads the label from the plate URL and from typing", () => {
    expect(plateLabelFromScan("https://app.example.test/p/P-007")).toBe("P-007");
    expect(plateLabelFromScan("https://app.example.test/p/p-007?x=1")).toBe("P-007");
    expect(plateLabelFromScan(" p-12 ")).toBe("P-12");
  });
  it("refuses anything else", () => {
    expect(plateLabelFromScan("https://app.example.test/join/shop")).toBeNull();
    expect(plateLabelFromScan("hello")).toBeNull();
    expect(plateLabelFromScan("")).toBeNull();
  });
});
