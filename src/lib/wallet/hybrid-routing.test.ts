import { chmodSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { walletAvailability } from "./capability";
import { googleFixture } from "./test-support";

const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const location = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const program = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const issuer = "3388000000023201754";
const binding = { tenantId: tenant, locationId: location, programId: program,
  classId: `${issuer}.loynara_demo`, issuanceEnabled: true, testAccountsApproved: true };
const apple = { PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: "11111111-1111-4111-8111-111111111111", PASSFAST_WALLET_TYPES: "apple",
  PASSFAST_TENANT_TEMPLATES: JSON.stringify([{ tenantId: tenant, locationId: location, templateId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }]) };

describe("hybrid Wallet routing and Google Direct eligibility", () => {
  it("offers Direct Google alongside mapped PassFast Apple, independently of PassFast platform flags", () => {
    const fixture = googleFixture("demo");
    try {
      const env = { ...fixture.env, ...apple, GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_ISSUER_ID: issuer, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) };
      expect(walletAvailability(env, tenant, location, program)).toEqual({ apple: "available", google: "test_only" });
      expect(walletAvailability({ ...env, PASSFAST_ENABLED: "false" }, tenant, location, program)).toEqual({ apple: "unavailable", google: "test_only" });
    } finally { fixture.cleanup(); }
  });

  it("never offers managed PassFast Google as a fallback", () => {
    expect(walletAvailability({ ...apple, PASSFAST_WALLET_TYPES: "both" }, tenant, location, program)).toEqual({ apple: "available", google: "unavailable" });
  });

  it("does not turn credential readiness into global, location or program access", () => {
    const fixture = googleFixture("published");
    try {
      const env = { ...fixture.env, GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_ISSUER_ID: issuer, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) };
      expect(walletAvailability(env)).toEqual({ apple: "unavailable", google: "unavailable" });
      for (const scope of [[tenant, location, "dddddddd-dddd-4ddd-8ddd-dddddddddddd"], [tenant, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", program], ["dddddddd-dddd-4ddd-8ddd-dddddddddddd", location, program]]) {
        expect(walletAvailability(env, ...scope as [string,string,string]).google).toBe("unavailable");
      }
      expect(walletAvailability({ ...env, GOOGLE_WALLET_LOCATION_CLASSES: undefined }, tenant, location, program).google).toBe("unavailable");
    } finally { fixture.cleanup(); }
  });

  it("requires explicit Direct selection, ON, approved demo testers, own issuer and valid unique class bindings", () => {
    const fixture = googleFixture("demo");
    try {
      const env = { ...fixture.env, GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_ISSUER_ID: issuer, GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding]) };
      for (const change of [
        { GOOGLE_WALLET_PROVIDER: undefined }, { GOOGLE_WALLET_PROVIDER: "PASSFAST" }, { GOOGLE_WALLET_ENABLED: "false" },
        { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ ...binding, issuanceEnabled: false }]) },
        { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ ...binding, testAccountsApproved: false }]) },
        { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ ...binding, classId: "3388000000023094673.managed" }]) },
        { GOOGLE_WALLET_ISSUER_ID: "3388000000023094673", GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ ...binding, classId: "3388000000023094673.managed" }]) },
        { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([binding, binding]) },
        { GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ ...binding, apiKey: "must-not-be-in-bindings" }]) },
      ]) expect(walletAvailability({ ...env, ...change }, tenant, location, program).google, JSON.stringify(change)).toBe("unavailable");
      chmodSync(fixture.env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE!, 0o644);
      expect(walletAvailability(env, tenant, location, program).google).toBe("unavailable");
    } finally { fixture.cleanup(); }
  });
});
