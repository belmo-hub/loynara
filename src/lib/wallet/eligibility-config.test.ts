import { describe, expect, it } from "vitest";
import { passFastConfig, passFastStatus } from "./passfast";
import { walletAvailability } from "./capability";
const tenant = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const location = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherLocation = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const template = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const secondTemplate = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const env = { PASSFAST_ENABLED: "true", PASSFAST_API_KEY: "sk_live_synthetic_0123456789abcdef0123456789", PASSFAST_APP_ID: "11111111-1111-4111-8111-111111111111", PASSFAST_WALLET_TYPES: "apple", PASSFAST_TEMPLATE_ID: template };
const binding = { tenantId: tenant, locationId: location, templateId: template };
const scoped = { ...env, PASSFAST_TENANT_TEMPLATES: JSON.stringify([binding]) };
describe("managed Wallet exact location eligibility", () => {
  it("does not grant access from a global template in any environment", () => {
    expect(passFastStatus(env).ready).toBe(false);
    expect(walletAvailability(env, tenant, location)).toEqual({ apple: "unavailable", google: "unavailable" });
  });
  it("resolves an explicit scope and denies the same tenant's other location", () => {
    expect(passFastConfig(scoped, tenant, location)).toMatchObject({ tenantId: tenant, locationId: location, templateId: template, platforms: ["apple"] });
    expect(walletAvailability(scoped, tenant, location)).toEqual({ apple: "available", google: "unavailable" });
    expect(walletAvailability(scoped, tenant, otherLocation)).toEqual({ apple: "unavailable", google: "unavailable" });
  });
  it("permits scope-less startup validation but no scope-less customer availability", () => {
    expect(passFastStatus(scoped).ready).toBe(true);
    expect(walletAvailability(scoped)).toEqual({ apple: "unavailable", google: "unavailable" });
    expect(passFastStatus(scoped, tenant).ready).toBe(false);
    expect(passFastStatus(scoped, undefined, location).ready).toBe(false);
  });
  it("allows two locations of a tenant with separate templates", () => {
    const two = { ...env, PASSFAST_TENANT_TEMPLATES: JSON.stringify([binding, { ...binding, locationId: otherLocation, templateId: secondTemplate }]) };
    expect(passFastConfig(two, tenant, otherLocation).templateId).toBe(secondTemplate);
  });
  it.each([
    [{ tenantId: tenant, templateId: template }],
    [binding, { ...binding, templateId: secondTemplate }],
    [binding, { ...binding, locationId: otherLocation }],
    [{ ...binding, locationId: "browser-location" }],
    [{ ...binding, apiKey: env.PASSFAST_API_KEY }],
  ].map(bindings => ({ bindings })))("rejects partial, duplicate, invalid or credential-bearing bindings %j", ({ bindings }) => {
    expect(passFastStatus({ ...env, PASSFAST_TENANT_TEMPLATES: JSON.stringify(bindings) }).ready).toBe(false);
  });
});
