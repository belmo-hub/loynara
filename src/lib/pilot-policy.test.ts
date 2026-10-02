import { describe, expect, it } from "vitest";
import { automaticTapAllowed, isProductionDeployment } from "./pilot-policy";

describe("pilot policy production detection", () => {
  it("treats either production marker as production", () => {
    expect(isProductionDeployment({ NODE_ENV: "production" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "development", PRODUCTION_ENVIRONMENT: "loynara-production" })).toBe(true);
    expect(isProductionDeployment({ NODE_ENV: "production", PRODUCTION_ENVIRONMENT: "device-test" })).toBe(true);
  });
  it("allows automatic taps only outside production", () => {
    expect(automaticTapAllowed({ NODE_ENV: "development" })).toBe(true);
    expect(automaticTapAllowed({ NODE_ENV: "test" })).toBe(true);
    expect(automaticTapAllowed({ NODE_ENV: "development", PRODUCTION_ENVIRONMENT: "device-test" })).toBe(true);
    expect(automaticTapAllowed({ NODE_ENV: "production" })).toBe(false);
    expect(automaticTapAllowed({ PRODUCTION_ENVIRONMENT: "loynara-production" })).toBe(false);
  });
});
