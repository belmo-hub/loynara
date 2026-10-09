import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "./config-check";
import { productionWalletRuntimeIssues } from "./wallet-runtime-config";
import { googleFixture } from "../src/lib/wallet/test-support";

const safe = {
  NODE_ENV: "production" as const, PRODUCTION_ENVIRONMENT: "loynara-production", PRODUCTION_APPROVED_ORIGIN: "https://app.owned-domain.org",
  DATABASE_URL: "postgresql://synthetic:synthetic-only@db.railway.internal/loynara", BETTER_AUTH_URL: "https://app.owned-domain.org", PUBLIC_BASE_URL: "https://app.owned-domain.org",
  BETTER_AUTH_SECRET: "synthetic-auth-".repeat(4), SMTP_HOST: "disabled", PG_POOL_MAX: "5", TRUSTED_INGRESS: "cloudflare_tunnel",
  WALLET_PRODUCTION_APPROVED: "true",
};

describe("shared web and worker production Wallet runtime gate", () => {
  it("rejects unreadable Apple credentials even when declarative production configuration is complete", () => {
    const env = { ...safe, APPLE_WALLET_ENABLED: "true", APPLE_PASS_TYPE_ID: "pass.com.owned-domain.loyalty", APPLE_TEAM_ID: "ABCDE12345",
      APPLE_SIGNING_CERT_PATH: "/run/secrets/unavailable-apple-cert.pem", APPLE_SIGNING_KEY_PATH: "/run/secrets/unavailable-apple-key.pem", APPLE_WWDR_CERT_PATH: "/run/secrets/unavailable-apple-wwdr.pem",
      APPLE_WALLET_AUTH_SECRET: "synthetic-apple-auth-0123456789abcdef", APPLE_WALLET_WEB_SERVICE_URL: "https://app.owned-domain.org/api/apple" };
    expect(productionConfigIssues(env)).toEqual(expect.arrayContaining([expect.stringMatching(/dormant/)]));
    expect(productionWalletRuntimeIssues(env)).toEqual(expect.arrayContaining([expect.stringMatching(/Apple Wallet enabled without working configuration/)]));
  });

  it("rejects unreadable Google credentials despite complete production declarations without echoing paths", () => {
    const env = { ...safe, GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "3388000000022123456", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: "/run/secrets/unavailable-google-issuer.json",
      GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://assets.owned-domain.org/logo.png", GOOGLE_WALLET_PUBLISHING_STATUS: "published" };
    expect(productionConfigIssues(env)).toEqual(expect.arrayContaining([expect.stringMatching(/GOOGLE_DIRECT/)]));
    const issues = productionWalletRuntimeIssues(env);
    expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/Google Wallet enabled without working configuration/)]));
    expect(issues.join(" ")).not.toContain(env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE);
  });

  it("keeps providers off and skips the production-only gate in synthetic nonproduction runs", () => {
    expect(productionWalletRuntimeIssues({ NODE_ENV: "production", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false" })).toEqual([]);
    expect(productionWalletRuntimeIssues({ NODE_ENV: "test", APPLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ENABLED: "true" })).toEqual([]);
  });

  it("allows a locally parseable synthetic Google key but rejects demo publication in production", () => {
    const google = googleFixture();
    try {
      expect(productionWalletRuntimeIssues({ ...google.env, NODE_ENV: "production" })).toEqual(expect.arrayContaining([expect.stringMatching(/Google Wallet enabled without working configuration/)]));
      expect(productionWalletRuntimeIssues({ ...google.env, NODE_ENV: "production", GOOGLE_WALLET_PUBLISHING_STATUS: "demo" })).toEqual(expect.arrayContaining([expect.stringMatching(/not approved for production/)]));
    } finally { google.cleanup(); }
  });
});
