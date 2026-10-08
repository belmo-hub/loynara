import { describe, expect, it } from "vitest";
import { assertPassFastBinding, bindPassFastObjectId, passFastObjectId, passFastSerial, type PassFastConfig } from "./passfast";
const serial = "11111111-1111-4111-8111-111111111111";
const config: PassFastConfig = { apiKey: "synthetic-only", appId: "22222222-2222-4222-8222-222222222222", tenantId: "33333333-3333-4333-8333-333333333333", locationId: "44444444-4444-4444-8444-444444444444", templateId: "55555555-5555-4555-8555-555555555555", platforms: ["apple"] };
describe("durable managed pass scope binding", () => {
  it("preserves the original serial while freezing tenant, location, app and template", () => {
    const objectId = bindPassFastObjectId(serial, config);
    expect(objectId).toMatch(/^passfast:11111111-1111-4111-8111-111111111111:[0-9a-f]{64}$/);
    expect(passFastSerial(objectId)).toBe(serial);
    expect(() => assertPassFastBinding(objectId, config)).not.toThrow();
    for (const key of ["tenantId", "locationId", "appId", "templateId"] as const) {
      expect(() => assertPassFastBinding(objectId, { ...config, [key]: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).toThrow();
    }
  });
  it("keeps identity stable across key rotation and allowed platform changes", () => {
    const objectId = bindPassFastObjectId(serial, config);
    expect(bindPassFastObjectId(serial, { ...config, apiKey: "rotated", platforms: ["apple", "google"] })).toBe(objectId);
  });
  it("refuses unbound legacy identity and malformed or partial binding", () => {
    expect(() => assertPassFastBinding(passFastObjectId(serial), config)).toThrow();
    expect(() => bindPassFastObjectId(serial, { ...config, locationId: undefined })).toThrow();
    for (const suffix of ["", "junk", "a".repeat(63), "a".repeat(64)+":extra"]) expect(() => passFastSerial(`passfast:${serial}:${suffix}`)).toThrow();
  });
});
