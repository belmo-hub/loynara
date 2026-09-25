import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "./config-check";

describe("production configuration gate", () => {
  it("rejects local/demo settings in a production process", () => {
    const issues = productionConfigIssues({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://looplocal:password@localhost:54329/looplocal",
      BETTER_AUTH_URL: "http://localhost:3000",
      PUBLIC_BASE_URL: "http://localhost:3000",
      BETTER_AUTH_SECRET: "replace-with-at-least-32-random-characters",
      PUBLIC_REGISTRATION_ENABLED: "true",
      EXTERNAL_EMAIL_ENABLED: "true",
      SMTP_HOST: "localhost",
      LIVE_BILLING_ENABLED: "true",
    });
    expect(issues).toEqual(expect.arrayContaining([
      expect.stringMatching(/database/i),
      expect.stringMatching(/registration/i),
      expect.stringMatching(/secret/i),
      expect.stringMatching(/email/i),
      expect.stringMatching(/billing/i),
    ]));
  });

  it("does not label a local development environment as production-invalid", () => {
    expect(productionConfigIssues({ NODE_ENV: "development" })).toEqual([]);
  });

  it("refuses the preview seed switch in a real production configuration", () => {
    const issues = productionConfigIssues({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://merchant:unique-value@db.example.com/loyalty",
      BETTER_AUTH_URL: "https://app.example.com",
      PUBLIC_BASE_URL: "https://app.example.com",
      BETTER_AUTH_SECRET: "a".repeat(64),
      LOOPLOCAL_PREVIEW_SEED: "true",
    });
    expect(issues).toContain("Preview seeding is forbidden in production");
  });

  it("refuses the device-test seed switch in a real production configuration", () => {
    const issues = productionConfigIssues({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://merchant:unique-value@db.example.com/loyalty",
      BETTER_AUTH_URL: "https://app.example.com",
      PUBLIC_BASE_URL: "https://app.example.com",
      BETTER_AUTH_SECRET: "a".repeat(64),
      LOOPLOCAL_DEVICE_TEST_SEED: "true",
    });
    expect(issues).toContain("Device-test seeding is forbidden in production");
  });

  it("rejects database query parameters that override the checked production host", () => {
    const issues = productionConfigIssues({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://merchant:unique-value@db.example.com/loyalty?host=localhost&port=54329",
      BETTER_AUTH_URL: "https://app.example.com",
      PUBLIC_BASE_URL: "https://app.example.com",
      BETTER_AUTH_SECRET: "a".repeat(64),
    });
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/database/i)]));
  });

  it("rejects the local billing fixture even with otherwise valid production settings", () => {
    const issues = productionConfigIssues({ NODE_ENV: "production", DATABASE_URL: "postgresql://merchant:unique-value@db.example.com/loyalty", BETTER_AUTH_URL: "https://app.example.com", PUBLIC_BASE_URL: "https://app.example.com", BETTER_AUTH_SECRET: "a".repeat(64), BILLING_FIXTURE_MODE: "true" });
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/fixture/i)]));
  });
});
