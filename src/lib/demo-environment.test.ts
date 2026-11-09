import { describe, expect, it } from "vitest";
import { productionConfigIssues } from "../../scripts/config-check";
import { demoConfigIssues, demoEnvironment, visitSources } from "./demo-environment";
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

  it("an empty DEMO_ENVIRONMENT refuses to start (fails safe) and is not a demo", () => {
    expect(demoEnvironment({ DEMO_ENVIRONMENT: "" })).toBe(false);
    expect(productionConfigIssues({ DEMO_ENVIRONMENT: "" } as unknown as NodeJS.ProcessEnv)).toEqual(["DEMO_ENVIRONMENT must be exactly true or false"]);
  });

  // The production rules run in the demo environment too, minus production's identity, approved origin, database name
  // rule and billing fixture refusals (Reviewer R-4).
  const deployed = {
    ...safe, NODE_ENV: "production", DATABASE_URL: "postgresql://loynara:unique-value@db.railway.internal/loynara_demo",
    BETTER_AUTH_URL: "https://demo.getloynara.com", PUBLIC_BASE_URL: "https://demo.getloynara.com", BETTER_AUTH_SECRET: "a".repeat(64),
    PUBLIC_REGISTRATION_ENABLED: "false", SMTP_HOST: "disabled", PG_POOL_MAX: "5", TRUSTED_INGRESS: "cloudflare_tunnel", BILLING_FIXTURE_SECRET: "b".repeat(64),
  } as NodeJS.ProcessEnv;
  const apple = { APPLE_WALLET_ENABLED: "true", WALLET_PRODUCTION_APPROVED: "true", APPLE_SIGNING_CERT_PATH: "/run/wallet/cert.pem", APPLE_SIGNING_KEY_PATH: "/run/wallet/key.pem", APPLE_WWDR_CERT_PATH: "/run/wallet/wwdr.pem",
    APPLE_PASS_TYPE_ID: "pass.com.getloynara.showcase", APPLE_TEAM_ID: "ABCDE12345", APPLE_WALLET_AUTH_SECRET: "c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5g6h7", APPLE_WALLET_WEB_SERVICE_URL: "https://demo.getloynara.com/api/apple" };

  it("a correctly deployed demo starts, with Apple Wallet and the billing fixture", () => {
    expect(productionConfigIssues(deployed)).toEqual([]);
    expect(productionConfigIssues({ ...deployed, ...apple })).toEqual([]);
  });

  it.each([
    ["local database credentials", { DATABASE_URL: "postgresql://looplocal:looplocal_local_only@localhost:54329/looplocal_demo" }, /remote PostgreSQL/],
    ["a database that does not name itself demo (a copied production URL)", { DATABASE_URL: "postgresql://merchant:unique-value@db.railway.internal/loynara" }, /must name itself demo/],
    ["a preview database", { DATABASE_URL: "postgresql://demo:unique-value@preview-db.internal/loynara_demo" }, /must name itself demo/],
    ["PG_POOL_MAX=50", { PG_POOL_MAX: "50" }, /pool limit/],
    ["an SMTP relay", { SMTP_HOST: "smtp.example.de" }, /SMTP/],
    ["TRUST_PROXY_CLIENT_IP=true", { TRUST_PROXY_CLIENT_IP: "true" }, /proxy client-IP/],
    ["no reviewed ingress", { TRUSTED_INGRESS: undefined }, /TRUSTED_INGRESS/],
    ["NFC_ENABLED=maybe", { NFC_ENABLED: "maybe" }, /NFC_ENABLED must be exactly/],
    ["NFC key settings with NFC off", { NFC_VERIFY_MASTER_KEY: "a".repeat(64) }, /NFC key settings/],
    ["the NFC admin master key", { NFC_ADMIN_MASTER_KEY: "a".repeat(64) }, /administrative master key/],
    ["synthetic NFC keys", { TAP_SYNTHETIC_KEY_FILE: "/tmp/keys.json" }, /Synthetic NFC/],
    ["public registration", { PUBLIC_REGISTRATION_ENABLED: "true" }, /Public registration/],
    ["an ambiguous invite flag", { STAFF_INVITE_SIGNUP_ENABLED: "maybe" }, /STAFF_INVITE_SIGNUP_ENABLED/],
    ["a placeholder login secret", { BETTER_AUTH_SECRET: "replace-me" }, /auth secret/],
    ["plain HTTP", { PUBLIC_BASE_URL: "http://demo.getloynara.com", BETTER_AUTH_URL: "http://demo.getloynara.com" }, /HTTPS/],
    ["auth and base URL on different origins", { BETTER_AUTH_URL: "https://auth.getloynara.com" }, /same HTTPS origin/],
    ["the preview seed", { LOOPLOCAL_PREVIEW_SEED: "true" }, /Preview seeding/],
    ["the legacy demo seed", { DEMO_SEED_ALLOWED: "true" }, /Demo seed/],
    ["Apple with relative certificate paths", { ...apple, APPLE_SIGNING_CERT_PATH: "cert.pem" }, /APPLE_SIGNING_CERT_PATH/],
    ["Apple with a bad pass type ID", { ...apple, APPLE_PASS_TYPE_ID: "demo" }, /APPLE_PASS_TYPE_ID/],
    ["Apple with a bad team ID", { ...apple, APPLE_TEAM_ID: "x" }, /APPLE_TEAM_ID/],
    ["Apple with a 5-character auth secret", { ...apple, APPLE_WALLET_AUTH_SECRET: "short" }, /APPLE_WALLET_AUTH_SECRET/],
    ["Apple without its web service URL", { ...apple, APPLE_WALLET_WEB_SERVICE_URL: undefined }, /APPLE_WALLET_WEB_SERVICE_URL/],
    ["Apple without the separate approval", { ...apple, WALLET_PRODUCTION_APPROVED: undefined }, /WALLET_PRODUCTION_APPROVED/],
  ])("the deployed demo refuses %s", (_, patch, issue) => {
    expect(productionConfigIssues({ ...deployed, ...patch } as NodeJS.ProcessEnv)).toEqual(expect.arrayContaining([expect.stringMatching(issue)]));
  });

  it("withholds the revenue board in the demo environment only; owner messages stay open there", () => {
    expect(hiddenSurfaces(safe)).toContain("revenue");
    expect(hiddenSurfaces(safe)).not.toContain("walletMessages");
    expect(hiddenSurfaces({})).not.toContain("revenue");
    expect(hiddenSurfaces({ ...safe, PRODUCTION_ENVIRONMENT: "loynara-production" })).not.toContain("revenue");
  });

  it("counts the sample visits on the board in the demo environment only", () => {
    expect(visitSources(safe)).toBe("'staff_online','staff_offline','synthetic_seed'");
    expect(visitSources({})).toBe("'staff_online','staff_offline'");
    expect(visitSources({ ...safe, PRODUCTION_ENVIRONMENT: "loynara-production" })).toBe("'staff_online','staff_offline'");
  });
});
