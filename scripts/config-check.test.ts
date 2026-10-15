import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
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

  describe("invite-gated staff sign-up (approved for the pilot, default off)", () => {
    const invitation = (flag: string | undefined, registration: string | undefined = "false") => productionConfigIssues({ ...safe, STAFF_INVITE_SIGNUP_ENABLED: flag, PUBLIC_REGISTRATION_ENABLED: registration });

    it("A: registration off, invite sign-up off or unset: passes", () => {
      expect(invitation("false")).toEqual([]);
      expect(invitation(undefined)).toEqual([]);
      expect(productionConfigIssues({ ...safe, PUBLIC_REGISTRATION_ENABLED: undefined })).toEqual([]);
    });

    it("B: registration off, invite sign-up on: passes", () => {
      expect(invitation("true")).toEqual([]);
      expect(invitation("true", undefined)).toEqual([]);
    });

    it("C: public registration on always fails, with or without invite sign-up", () => {
      for (const flag of [undefined, "false", "true"]) expect(invitation(flag, "true"), String(flag)).toEqual(expect.arrayContaining([expect.stringMatching(/Public registration is not approved/)]));
    });

    it("D: ambiguous registration or flag values fail instead of being guessed", () => {
      for (const registration of ["TRUE", "1", "yes", "", " false"]) expect(invitation("true", registration), registration).toEqual(expect.arrayContaining([expect.stringMatching(/exactly false/)]));
      for (const flag of ["TRUE", "1", "yes", "", " true", "enabled"]) expect(invitation(flag), flag).toEqual(expect.arrayContaining([expect.stringMatching(/exactly true or false/)]));
    });

    it("does not relax any other production guard when the flag is on", () => {
      const issues = productionConfigIssues({ ...safe, STAFF_INVITE_SIGNUP_ENABLED: "true", TRUSTED_INGRESS: "local", SMTP_HOST: "localhost", BETTER_AUTH_URL: "https://preview.getloynara.com", BETTER_AUTH_SECRET: "replace-me", DATABASE_URL: "postgresql://looplocal:looplocal_local_only@localhost:54329/looplocal" });
      expect(issues).toEqual(expect.arrayContaining([expect.stringMatching(/ingress/i), expect.stringMatching(/Mailpit/i), expect.stringMatching(/origin/i), expect.stringMatching(/secret/i), expect.stringMatching(/database/i)]));
    });

    it("leaves preview and development processes alone", () => {
      for (const NODE_ENV of ["development", "test", undefined]) {
        expect(productionConfigIssues({ NODE_ENV, STAFF_INVITE_SIGNUP_ENABLED: "true", PUBLIC_REGISTRATION_ENABLED: "true" } as NodeJS.ProcessEnv), String(NODE_ENV)).toEqual([]);
      }
    });
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
    // One connection deadlocks the worker: a delivery transaction holds it while its suppression lookup waits for another.
    expect(productionConfigIssues({ ...safe, PG_POOL_MAX: "1" })).toEqual(expect.arrayContaining([expect.stringMatching(/pool/i)]));
    expect(productionConfigIssues({ ...safe, PG_POOL_MAX: "2" })).not.toEqual(expect.arrayContaining([expect.stringMatching(/pool/i)]));
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

  describe("Wallet fails closed", () => {
    const apple: NodeJS.ProcessEnv = {
      ...safe, WALLET_PRODUCTION_APPROVED: "true", APPLE_WALLET_ENABLED: "true", APPLE_PASS_TYPE_ID: "pass.com.getloynara.loyalty", APPLE_TEAM_ID: "AB12CD34EF",
      APPLE_SIGNING_CERT_PATH: "/run/secrets/apple/pass-cert.pem", APPLE_SIGNING_KEY_PATH: "/run/secrets/apple/pass-key.pem", APPLE_WWDR_CERT_PATH: "/run/secrets/apple/wwdr.pem",
      APPLE_WALLET_AUTH_SECRET: "Qm7v2Kx9pL4tR8wZ1nY6cB3hF5jD0sGa", APPLE_WALLET_WEB_SERVICE_URL: "https://app.getloynara.com/api/apple",
    };
    const google: NodeJS.ProcessEnv = {
      ...safe, WALLET_PRODUCTION_APPROVED: "true", GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_ISSUER_ID: "3388000000022123456",
      GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", programId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", classId: "3388000000022123456.approved", issuanceEnabled: true, testAccountsApproved: false }]),
      GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: "/run/secrets/google/wallet-issuer.json", GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://cdn.getloynara.com/wallet/logo.png", GOOGLE_WALLET_PUBLISHING_STATUS: "published",
    };
    const refused = (env: NodeJS.ProcessEnv, pattern: RegExp) => expect(productionConfigIssues(env)).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));

    it("accepts Wallet OFF and approved Direct Google while native Apple remains dormant", () => {
      expect(productionConfigIssues({ ...safe, APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false" })).toEqual([]);
      expect(productionConfigIssues(apple)).toEqual(expect.arrayContaining([expect.stringMatching(/dormant/)]));
      expect(productionConfigIssues(google)).toEqual([]);
      expect(productionConfigIssues({ ...google, GOOGLE_WALLET_ASSET_ENABLED: "true", GOOGLE_WALLET_ASSET_ORIGIN: "https://assets.getloynara.com" })).toEqual([]);
    });

    it("requires a separate approval and refuses a stray approval or ambiguous flags", () => {
      refused({ ...apple, WALLET_PRODUCTION_APPROVED: undefined }, /production approval/);
      refused({ ...safe, WALLET_PRODUCTION_APPROVED: "true" }, /no Wallet provider/);
      refused({ ...safe, APPLE_WALLET_ENABLED: "yes" }, /APPLE_WALLET_ENABLED must be exactly/);
      refused({ ...safe, GOOGLE_WALLET_ASSET_ENABLED: "1" }, /GOOGLE_WALLET_ASSET_ENABLED must be exactly/);
    });

    it.each([
      ["device-test approval", { DEVICE_TEST_APPROVED_WALLET_PROVIDER: "google-demo" }, /Device-test Wallet/],
      ["fixture certificate", { APPLE_SIGNING_CERT_PATH: "/app/fixtures/cert.pem" }, /APPLE_SIGNING_CERT_PATH/],
      ["public key file", { APPLE_SIGNING_KEY_PATH: "/app/public/key.pem" }, /APPLE_SIGNING_KEY_PATH/],
      ["relative WWDR path", { APPLE_WWDR_CERT_PATH: "wwdr.pem" }, /APPLE_WWDR_CERT_PATH/],
      ["test pass type", { APPLE_PASS_TYPE_ID: "pass.local.loop" }, /Pass Type ID/],
      ["malformed team", { APPLE_TEAM_ID: "team" }, /APPLE_TEAM_ID/],
      ["short secret", { APPLE_WALLET_AUTH_SECRET: "short" }, /AUTH_SECRET must be/],
      ["placeholder secret", { APPLE_WALLET_AUTH_SECRET: "replace-me-with-a-random-value-123456" }, /AUTH_SECRET must be/],
      ["repeated-character secret", { APPLE_WALLET_AUTH_SECRET: "a".repeat(40) }, /AUTH_SECRET must be/],
      ["secret reused", { APPLE_WALLET_AUTH_SECRET: "a".repeat(64) }, /reused|AUTH_SECRET must be/],
      ["HTTP web service", { APPLE_WALLET_WEB_SERVICE_URL: "http://app.getloynara.com/api/apple" }, /WEB_SERVICE_URL/],
      ["preview web service", { APPLE_WALLET_WEB_SERVICE_URL: "https://preview.getloynara.com/api/apple" }, /WEB_SERVICE_URL/],
      ["web service with /v1", { APPLE_WALLET_WEB_SERVICE_URL: "https://app.getloynara.com/api/apple/v1" }, /WEB_SERVICE_URL/],
    ])("refuses Apple with %s", (_name, override, pattern) => refused({ ...apple, ...override }, pattern));

    it.each([
      ["Demo Mode", { GOOGLE_WALLET_PUBLISHING_STATUS: "demo" }, /Demo Mode is not production/],
      ["missing publishing status", { GOOGLE_WALLET_PUBLISHING_STATUS: undefined }, /publishing must be approved/],
      ["synthetic issuer", { GOOGLE_WALLET_ISSUER_ID: "123456" }, /ISSUER_ID/],
      ["device-test credential", { GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: "/srv/device-test/google.json" }, /SERVICE_ACCOUNT_FILE/],
      ["HTTP logo", { GOOGLE_WALLET_PROGRAM_LOGO_URL: "http://cdn.getloynara.com/logo.png" }, /PROGRAM_LOGO_URL/],
      ["example logo host", { GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://wallet.example.com/logo.png" }, /PROGRAM_LOGO_URL/],
      ["asset origin with path", { GOOGLE_WALLET_ASSET_ENABLED: "true", GOOGLE_WALLET_ASSET_ORIGIN: "https://assets.getloynara.com/x" }, /ASSET_ORIGIN/],
      ["local asset origin", { GOOGLE_WALLET_ASSET_ENABLED: "true", GOOGLE_WALLET_ASSET_ORIGIN: "https://localhost" }, /ASSET_ORIGIN/],
    ])("refuses Google with %s", (_name, override, pattern) => refused({ ...google, ...override }, pattern));

    it("never echoes a secret value or credential path in its messages", () => {
      const issues = productionConfigIssues({ ...apple, APPLE_WALLET_AUTH_SECRET: "short-secret-value", APPLE_SIGNING_KEY_PATH: "/app/public/very-private.pem" });
      expect(issues.join(" ")).not.toContain("short-secret-value");
      expect(issues.join(" ")).not.toContain("very-private");
    });
  });
});

// The real startup gate (`npm start` runs scripts/production-guard.ts first), executed as a process from an empty directory so
// no local .env or var/ files can leak in.
describe("production startup gate as a process", () => {
  const root = path.resolve(__dirname, "..");
  const empty = mkdtempSync(path.join(tmpdir(), "loynara-guard-"));
  afterAll(() => rmSync(empty, { recursive: true, force: true }));
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH, HOME: process.env.HOME, PRODUCTION_ENVIRONMENT: "loynara-production", PRODUCTION_APPROVED_ORIGIN: "https://app.getloynara.com",
    DATABASE_URL: "postgresql://merchant:unique-value@db.railway.internal/loynara", BETTER_AUTH_URL: "https://app.getloynara.com", PUBLIC_BASE_URL: "https://app.getloynara.com",
    BETTER_AUTH_SECRET: "a".repeat(64), SMTP_HOST: "disabled", PG_POOL_MAX: "5", TRUSTED_INGRESS: "cloudflare_tunnel",
  };
  const guard = async (extra: Record<string, string | undefined>) => {
    try {
      const done = await promisify(execFile)(path.join(root, "node_modules/.bin/tsx"), ["--tsconfig", path.join(root, "tsconfig.json"), path.join(root, "scripts/production-guard.ts")], { cwd: empty, env: { ...env, ...extra } as NodeJS.ProcessEnv, timeout: 60_000 });
      return { code: 0, output: `${done.stdout}${done.stderr}` };
    } catch (error) {
      const failed = error as { code?: number; stdout?: string; stderr?: string };
      return { code: failed.code ?? 1, output: `${failed.stdout ?? ""}${failed.stderr ?? ""}` };
    }
  };

  it("starts with invite sign-up unset, off, or on while public registration is off", async () => {
    for (const extra of [{}, { PUBLIC_REGISTRATION_ENABLED: "false", STAFF_INVITE_SIGNUP_ENABLED: "false" }, { PUBLIC_REGISTRATION_ENABLED: "false", STAFF_INVITE_SIGNUP_ENABLED: "true" }]) {
      const result = await guard(extra);
      expect(result.output, JSON.stringify(extra)).toContain("Production configuration gate passed.");
      expect(result.code).toBe(0);
    }
  }, 120_000);

  it("refuses to start with public registration on, even alongside invite sign-up", async () => {
    for (const extra of [{ PUBLIC_REGISTRATION_ENABLED: "true" }, { PUBLIC_REGISTRATION_ENABLED: "true", STAFF_INVITE_SIGNUP_ENABLED: "true" }, { STAFF_INVITE_SIGNUP_ENABLED: "TRUE" }]) {
      const result = await guard(extra);
      expect(result.code, JSON.stringify(extra)).toBe(1);
      expect(result.output).toContain("Production startup rejected:");
    }
  }, 120_000);
});

// A configuration check cannot see code. These tripwires pin the two facts it relies on: the flag has one reader, and the
// sign-up hook can admit an account only through the invite check (exact address, secret token, pending/unexpired/unrevoked/unused).
describe("invite sign-up code invariants", () => {
  const src = path.resolve(__dirname, "..", "src");
  const files = (dir: string): string[] => readdirSync(dir).flatMap(name => { const full = path.join(dir, name); return statSync(full).isDirectory() ? files(full) : [full]; });

  it("is read only by invite-signup.ts", () => {
    const readers = files(src).filter(file => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file) && readFileSync(file, "utf8").includes("STAFF_INVITE_SIGNUP_ENABLED")).map(file => path.relative(src, file));
    expect(readers).toEqual(["lib/invite-signup.ts"]);
  });

  it("lets the sign-up hook return early only through the invite check", () => {
    const auth = readFileSync(path.join(src, "lib/auth.ts"), "utf8");
    const hook = auth.slice(auth.indexOf("before: createAuthMiddleware"));
    expect(hook.match(/\breturn\b/g)).toHaveLength(1);
    expect(hook).toContain('if (inviteSignUpEnabled() && await inviteAllowsSignUp(context.headers?.get("x-loynara-invite"), body?.email)) return;');
    expect(hook.indexOf("Registration is not enabled")).toBeGreaterThan(hook.indexOf("inviteAllowsSignUp"));
    expect(hook).toContain('process.env.PUBLIC_REGISTRATION_ENABLED !== "true"');
  });

  it("requires a token, the exact invited address and a live invitation", () => {
    const invite = readFileSync(path.join(src, "lib/invite-signup.ts"), "utf8");
    expect(invite).toContain('return env.STAFF_INVITE_SIGNUP_ENABLED === "true";');
    for (const required of ["accepted_at IS NULL", "revoked_at IS NULL", "expires_at > now()", "token_hash = $1", "invite.email === email.trim().toLowerCase()", "if (!token || typeof email !== \"string\") return false;"]) expect(invite, required).toContain(required);
  });
});
