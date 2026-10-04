import { describe, expect, it } from "vitest";
import { formatCardLocator, isScanCodeInput, LOCATOR_ALPHABET, LOCATOR_LENGTH, parseCardLocator } from "./card-locator";

describe("card locator alphabet and parsing", () => {
  it("has 31 unambiguous uppercase symbols and a fixed length", () => {
    expect(LOCATOR_ALPHABET).toHaveLength(31);
    expect(new Set(LOCATOR_ALPHABET).size).toBe(31);
    for (const lookAlike of ["0", "O", "1", "I", "L"]) expect(LOCATOR_ALPHABET).not.toContain(lookAlike);
    expect(LOCATOR_ALPHABET).toBe(LOCATOR_ALPHABET.toUpperCase());
    expect(LOCATOR_LENGTH).toBe(6);
  });

  it("formats with the K- prefix", () => {
    expect(formatCardLocator("7QX2MA")).toBe("K-7QX2MA");
  });

  it.each([
    ["K-7QX2MA", "7QX2MA"], ["k-7qx2ma", "7QX2MA"], ["7QX2MA", "7QX2MA"], [" K 7QX2MA ", "7QX2MA"], ["K7QX2MA", "7QX2MA"],
    ["k - 7qx2ma", "7QX2MA"], ["\tK-7QX2MA\n", "7QX2MA"], ["K-KKKKKK", "KKKKKK"], ["KKKKKK", "KKKKKK"], ["ＫーＡ", null],
  ])("normalises %j to %j", (raw, expected) => {
    expect(parseCardLocator(raw)).toBe(expected);
  });

  it.each([
    "", " ", "K-", "K", "K-7QX2M", "K-7QX2MAB", "7QX2M", "7QX2MAB", "K-0QX2MA", "K-OQX2MA", "K-1QX2MA", "K-IQX2MA", "K-LQX2MA",
    "K--7QX2MA", "KK-7QX2MA", "K_7QX2MA", "K-7QX 2MA", "K-7QX2M!", "sc_" + "a".repeat(32), "7", "K-0001", "1234567", "'; DROP TABLE memberships;--",
  ])("rejects %j", raw => {
    expect(parseCardLocator(raw)).toBeNull();
  });

  it("treats only sc_ input as a scan code", () => {
    expect(isScanCodeInput("sc_" + "a".repeat(32))).toBe(true);
    expect(isScanCodeInput(" sc_abc")).toBe(true);
    expect(isScanCodeInput("K-7QX2MA")).toBe(false);
  });
});
