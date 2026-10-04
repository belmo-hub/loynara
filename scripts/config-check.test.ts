import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "./config-check";

describe("production configuration gate", () => {
  const safe: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    PRODUCTION_ENVIRONMENT: "loynara-production",
    PRODUCTION_APPROVED_ORIGIN: "https://app.getloynara.com",
    DATABASE_URL: "postgresql://merchant:unique-value@db.railway.internal/loynara",
    BETTER_AUTH_URL: "https://app.getloynara.com",
    PUBLIC_BASE_URL: "https://app.getloynara.com",
    BETTER_AUTH_SECRET: "a".repeat(64),
    PUBLIC_REGISTRATION_ENABLED: "false",
    SMTP_HOST: "disabled",
    BILLING_FIXTURE_MODE: "false",
    PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false",
    PG_POOL_MAX: "5", TRUSTED_INGRESS: "cloudflare_tunnel",
  };

  it.each([undefined, "", "local", "cloudflare", "true", " cloudflare_tunnel", "CLOUDFLARE_TUNNEL"])("rejects ambiguous production ingress mode %s", mode => {
    expect(productionConfigIssues({ ...safe, TRUSTED_INGRESS: mode })).toEqual(expect.arrayContaining([expect.stringMatching(/ingress/i)]));
  });

  it("accepts a distinct HTTPS production origin with disabled local services", () => {
    expect(productionConfigIssues(safe)).toEqual([]);
  });

  it("refuses invite-gated staff sign-up until it is approved for production", () => {
    expect(productionConfigIssues({ ...safe, STAFF_INVITE_SIGNUP_ENABLED: "true" })).toEqual(expect.arrayContaining([expect.stringMatching(/invite-gated/i)]));
    expect(productionConfigIssues({ ...safe, STAFF_INVITE_SIGNUP_ENABLED: "false" })).toEqual([]);
  });

  it("refuses preview, mismatched, or token-bearing public origins", () => {
    expect(productionConfigIssues({ ...safe, BETTER_AUTH_URL: "https://preview.getloynara.com" })).toEqual(expect.arrayContaining([expect.stringMatching(/origin/i)]));
    expect(productionConfigIssues({ ...safe, PUBLIC_BASE_URL: "https://app.getloynara.com/card/private" })).toEqual(expect.arrayContaining([expect.stringMatching(/origin/i)]));
    expect(productionConfigIssues({ ...safe, PRODUCTION_APPROVED_ORIGIN: "https://preview.getloynara.com", BETTER_AUTH_URL: "https://preview.getloynara.com", PUBLIC_BASE_URL: "https://preview.getloynara.com" })).toEqual(expect.arrayContaining([expect.stringMatching(/preview/i)]));
  });

  it("refuses local transports, fixture credentials, and proxy trust without an explicit policy", () => {
    const issues = productionConfigIssues({ ...safe, SMTP_HOST: "localhost", BILLING_FIXTURE_SECRET: "local-secret", TRUST_PROXY_CLIENT_IP: "true" });
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/mailpit|smtp/i), expect.stringMatching(/fixture/i), expect.stringMatching(/proxy/i)]));
  });

  it("refuses unapproved environment identity and placeholder provider credentials", () => {
    const issues = productionConfigIssues({ ...safe, PRODUCTION_ENVIRONMENT: "device-test", MAILGUN_EU_API_KEY: "replace-me", MAILGUN_EU_WEBHOOK_SIGNING_KEY: "placeholder" });
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/environment/i), expect.stringMatching(/placeholder/i)]));
  });

  it("requires a bounded database pool per process", () => {
    expect(productionConfigIssues({ ...safe, PG_POOL_MAX: "50" })).toEqual(expect.arrayContaining([expect.stringMatching(/pool/i)]));
    expect(productionConfigIssues({ ...safe, PG_POOL_MAX: "" })).toEqual(expect.arrayContaining([expect.stringMatching(/pool/i)]));
  });

  it("refuses a remote database labelled preview or device-test", () => {
    const issues = productionConfigIssues({ ...safe, DATABASE_URL: "postgresql://merchant:unique-value@preview-db.railway.internal/device_test" });
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/database/i)]));
  });
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

  describe("NFC", () => {
    const master = "7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a";
    const on: NodeJS.ProcessEnv = { ...safe, NFC_ENABLED: "true", NFC_KEY_PROVIDER: "derived_v1", NFC_VERIFY_MASTER_KEY: master };
    it("is accepted when off, and when on with the derived provider", () => {
      expect(productionConfigIssues({ ...safe, NFC_ENABLED: "false" })).toEqual([]);
      expect(productionConfigIssues(on)).toEqual([]);
    });
    it.each([
      ["no provider", { NFC_KEY_PROVIDER: undefined }],
      ["wrong provider", { NFC_KEY_PROVIDER: "file" }],
      ["no master", { NFC_VERIFY_MASTER_KEY: undefined }],
      ["short master", { NFC_VERIFY_MASTER_KEY: "abcd" }],
      ["placeholder master", { NFC_VERIFY_MASTER_KEY: "a".repeat(64) }],
      ["master reused as auth secret", { BETTER_AUTH_SECRET: master }],
    ])("refuses NFC with %s", (_name, override) => {
      expect(productionConfigIssues({ ...on, ...override })).toEqual(expect.arrayContaining([expect.stringMatching(/NFC|reused/)]));
    });
    it("refuses development keys and the administrative master in production", () => {
      expect(productionConfigIssues({ ...on, TAP_SYNTHETIC_KEY_FILE: "/tmp/keys.json" })).toEqual(expect.arrayContaining([expect.stringMatching(/development keys/)]));
      expect(productionConfigIssues({ ...on, NFC_ADMIN_MASTER_KEY: "b".repeat(64) })).toEqual(expect.arrayContaining([expect.stringMatching(/administrative master/)]));
    });
    it("refuses key settings while NFC is not enabled, and ambiguous flag values", () => {
      expect(productionConfigIssues({ ...safe, NFC_VERIFY_MASTER_KEY: master })).toEqual(expect.arrayContaining([expect.stringMatching(/not enabled/)]));
      expect(productionConfigIssues({ ...safe, NFC_ENABLED: "TRUE" })).toEqual(expect.arrayContaining([expect.stringMatching(/exactly true or false/)]));
    });
  });
});
