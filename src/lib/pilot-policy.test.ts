import { describe, expect, it } from "vitest";
import { automaticTapAllowed, isProductionDeployment } from "./pilot-policy";

describe("pilot policy production detection (same definition as the config gate)", () => {
  it("A: the real production marker forbids automatic taps, whatever NODE_ENV says", () => {
    for (const NODE_ENV of ["production", "development", "test", undefined]) {
      const env = { PRODUCTION_ENVIRONMENT: "loynara-production", NODE_ENV };
      expect(isProductionDeployment(env)).toBe(true);
      expect(automaticTapAllowed(env)).toBe(false);
    }
  });
  it("B: device-test and preview processes run NODE_ENV=production without the marker and keep automatic taps", () => {
    for (const marker of [undefined, "", "device-test", "preview", "loynara-production-copy"]) {
      expect(automaticTapAllowed({ NODE_ENV: "production", PRODUCTION_ENVIRONMENT: marker } as { PRODUCTION_ENVIRONMENT?: string })).toBe(true);
    }
  });
  it("C: development and test keep their behaviour", () => {
    expect(automaticTapAllowed({ NODE_ENV: "development" } as { PRODUCTION_ENVIRONMENT?: string })).toBe(true);
    expect(automaticTapAllowed({})).toBe(true);
  });
  it("uses the same literal as the production config gate", async () => {
    const source = (await import("node:fs")).readFileSync("scripts/config-check.ts", "utf8");
    expect(source).toContain('env.PRODUCTION_ENVIRONMENT !== "loynara-production"');
  });
});
