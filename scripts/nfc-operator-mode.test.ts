import { describe, expect, it } from "vitest";
import { operatorMode, parseOperatorOptions } from "./nfc-operator-mode";

describe("operator command modes", () => {
  it.each(["provision", "resume", "tag-revoke"])("%s requires explicit execution and a provenance reference", command => {
    expect(operatorMode(command, {})).toBe("offline_dry_run");
    expect(operatorMode(command, { "dry-run": "true" })).toBe("offline_dry_run");
    expect(() => operatorMode(command, { execute: "true" })).toThrow(/PROVENANCE_REQUIRED/);
    expect(operatorMode(command, { execute: "true", "provenance-ref": "review-2026-001", "transport-keys-file": "/synthetic-custody.json" })).toBe("execute");
  });
  it.each(["provision", "resume"])("%s refuses execution without explicit transport-key custody", command => {
    expect(() => operatorMode(command, { execute: "true", "provenance-ref": "review-001" })).toThrow(/TRANSPORT_KEYS_REQUIRED/);
  });
  it.each(["reader-check", "tag-inspect", "tag-status"])("%s preserves a read-only mode and rejects mutation flags", command => {
    expect(operatorMode(command, {})).toBe("read_only");
    expect(() => operatorMode(command, { execute: "true" })).toThrow(/Execution flags/);
  });
  it("refuses a conflicting request before execution", () => {
    expect(() => operatorMode("resume", { execute: "true", "dry-run": "true", "provenance-ref": "review-001" })).toThrow(/CONFLICTING_EXECUTION_FLAGS/);
  });
  it.each(["", "factory", "seller", "unknown", "default", "0".repeat(32), "a".repeat(64), "https://receipt.invalid/id", "review id"])("refuses ambiguous or secret-shaped provenance %j", ref => {
    expect(() => operatorMode("provision", { execute: "true", "provenance-ref": ref })).toThrow(/PROVENANCE_(?:REQUIRED|INVALID)/);
  });
  it("parses explicit execution flags without consuming value options", () => {
    expect(parseOperatorOptions(["--execute", "--provenance-ref", "review-001", "--target", "preview"])).toEqual({ execute: "true", "provenance-ref": "review-001", target: "preview" });
  });
  it.each([{ args: ["--execute", "--execute"] }, { args: ["--reader"] }, { args: ["--unrecognized", "x"] }, { args: ["unexpected"] }])("refuses malformed options $args", ({ args }) => {
    expect(() => parseOperatorOptions(args)).toThrow();
  });
});
