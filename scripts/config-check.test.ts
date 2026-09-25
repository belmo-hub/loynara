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
});
