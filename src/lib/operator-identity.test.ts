import { describe, expect, it } from "vitest";
import { operatorIdentity, operatorIdentityIssues } from "./operator-identity";

describe("operator identity for owner email footers (ENG-167)", () => {
  it("reads the name and a multi-line address from the environment, joined for the footer", () => {
    expect(operatorIdentity({ OPERATOR_NAME: " Synthetische  Betreiberin ", OPERATOR_ADDRESS: "Musterstraße 1\n12345 Musterstadt\n" })).toEqual({ name: "Synthetische Betreiberin", address: "Musterstraße 1, 12345 Musterstadt" });
    // A Railway variable entered on one line with \n escapes reads the same.
    expect(operatorIdentity({ OPERATOR_NAME: "Synthetische Betreiberin", OPERATOR_ADDRESS: "Musterstraße 1\\n12345 Musterstadt" })?.address).toBe("Musterstraße 1, 12345 Musterstadt");
  });

  it("is null, and named as an issue, when either is missing or malformed", () => {
    for (const env of [{}, { OPERATOR_NAME: "Synthetische Betreiberin" }, { OPERATOR_ADDRESS: "Musterstraße 1" }, { OPERATOR_NAME: "X", OPERATOR_ADDRESS: "Musterstraße 1" },
      { OPERATOR_NAME: "<b>Betreiberin</b>", OPERATOR_ADDRESS: "Musterstraße 1" }, { OPERATOR_NAME: "Betreiberin", OPERATOR_ADDRESS: "a\nb\nc\nd\ne" }]) {
      expect(operatorIdentity(env)).toBeNull();
      expect(operatorIdentityIssues(env)).toEqual([expect.stringContaining("OPERATOR_NAME and OPERATOR_ADDRESS")]);
    }
    expect(operatorIdentityIssues({ OPERATOR_NAME: "Synthetische Betreiberin", OPERATOR_ADDRESS: "Musterstraße 1" })).toEqual([]);
  });
});
