import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "../../scripts/config-check";
import { demoConfigIssues, demoEnvironment } from "./demo-environment";
import { hiddenSurfaces } from "./pilot-surfaces";

const safe = { DEMO_ENVIRONMENT: "true", BILLING_FIXTURE_MODE: "true" };

describe("demo environment (design v3)", () => {
  it("is on only with DEMO_ENVIRONMENT exactly true, and never on the production deployment", () => {
    expect(demoEnvironment(safe)).toBe(true);
    for (const value of [undefined, "", "false", "TRUE", "1", "yes"]) expect(demoEnvironment({ DEMO_ENVIRONMENT: value }), String(value)).toBe(false);
    expect(demoEnvironment({ ...safe, PRODUCTION_ENVIRONMENT: "loynara-production" })).toBe(false);
  });

  it("starts with a configuration that cannot reach people", () => {
    expect(demoConfigIssues(safe)).toEqual([]);
    expect(demoConfigIssues({ ...safe, EXTERNAL_EMAIL_ENABLED: "false", WALLET_MESSAGES_ENABLED: "false", LIVE_BILLING_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false", MAILGUN_EU_API_KEY: "" })).toEqual([]);
    expect(productionConfigIssues({ ...safe, NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual([]);
  });

  it.each([
    ["MAILGUN_EU_API_KEY", "key", /Mailgun/],
    ["MAILGUN_EU_DOMAIN", "mg.example.test", /Mailgun/],
    ["MAILGUN_SEND_APPROVED", "true", /Mailgun/],
    ["MAILGUN_PROMOTIONAL_SEND_APPROVED", "false", /Mailgun/],
    ["EXTERNAL_EMAIL_ENABLED", "true", /EXTERNAL_EMAIL_ENABLED/],
    ["TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED", "true", /TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED/],
    ["PROMOTIONAL_EXTERNAL_EMAIL_ENABLED", "true", /PROMOTIONAL_EXTERNAL_EMAIL_ENABLED/],
    ["WALLET_MESSAGES_ENABLED", "true", /WALLET_MESSAGES_ENABLED/],
    ["LIVE_BILLING_ENABLED", "true", /LIVE_BILLING_ENABLED/],
    ["GOOGLE_WALLET_ENABLED", "true", /GOOGLE_WALLET_ENABLED/],
    ["STRIPE_SECRET_KEY", "sk_test_x", /Stripe/],
    ["STRIPE_WEBHOOK_SECRET", "whsec_x", /Stripe/],
    ["PRODUCTION_ENVIRONMENT", "loynara-production", /production deployment: refused/],
    ["BILLING_FIXTURE_MODE", "false", /BILLING_FIXTURE_MODE=true/],
    ["BILLING_FIXTURE_MODE", undefined, /BILLING_FIXTURE_MODE=true/],
  ])("refuses %s=%s, also through the web and worker startup check", (name, value, issue) => {
    const env = { ...safe, [name]: value };
    expect(demoConfigIssues(env)).toEqual([expect.stringMatching(issue)]);
    expect(productionConfigIssues({ ...env, NODE_ENV: "test" } as NodeJS.ProcessEnv)).toEqual([expect.stringMatching(issue)]);
  });

  it("an ambiguous flag refuses to start; absent or false leaves the production check as it was", () => {
    expect(productionConfigIssues({ DEMO_ENVIRONMENT: "yes" } as unknown as NodeJS.ProcessEnv)).toEqual(["DEMO_ENVIRONMENT must be exactly true or false"]);
    expect(productionConfigIssues({ NODE_ENV: "production", DEMO_ENVIRONMENT: "false" } as NodeJS.ProcessEnv)).toEqual(productionConfigIssues({ NODE_ENV: "production" } as NodeJS.ProcessEnv));
    expect(productionConfigIssues({ NODE_ENV: "production", DEMO_ENVIRONMENT: "false" } as NodeJS.ProcessEnv)).toEqual(expect.arrayContaining([expect.stringMatching(/Production environment identity/)]));
  });

  it("as a public deployment it still needs HTTPS, a real login secret and no NFC admin or synthetic keys", () => {
    const deployed = { ...safe, NODE_ENV: "production", BETTER_AUTH_URL: "https://demo.example.de", PUBLIC_BASE_URL: "https://demo.example.de", BETTER_AUTH_SECRET: "k".repeat(16) + "abcdefghijklmnopq" } as NodeJS.ProcessEnv;
    expect(productionConfigIssues(deployed)).toEqual([]);
    expect(productionConfigIssues({ ...deployed, PUBLIC_BASE_URL: "http://localhost:3000", BETTER_AUTH_SECRET: "replace-me", PUBLIC_REGISTRATION_ENABLED: "true", NFC_ADMIN_MASTER_KEY: "x", TAP_SYNTHETIC_KEY_FILE: "/tmp/k" })).toHaveLength(5);
  });

  it("withholds the revenue board in the demo environment only", () => {
    expect(hiddenSurfaces(safe)).toContain("revenue");
    expect(hiddenSurfaces({})).not.toContain("revenue");
    expect(hiddenSurfaces({ ...safe, PRODUCTION_ENVIRONMENT: "loynara-production" })).not.toContain("revenue");
  });
});
