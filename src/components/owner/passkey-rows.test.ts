import { describe, expect, it } from "vitest";
import { passkeysFor } from "./passkey-rows";

// Design R1 (CTO, 23 Nov): the Konto rows are offered to owners and managers, never to a cashier.
describe("who sees the passkey rows", () => {
  it("offers them to owners and managers only", () => {
    expect(passkeysFor("owner")).toBe(true);
    expect(passkeysFor("manager")).toBe(true);
    expect(passkeysFor("cashier")).toBe(false);
    expect(passkeysFor(undefined)).toBe(false);
  });
});
