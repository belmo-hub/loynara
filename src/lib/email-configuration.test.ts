import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { campaignReadiness, mailgunConfig } from "./email-configuration";

const ready: NodeJS.ProcessEnv = {
  NODE_ENV: "production",
  TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "true",
  PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "true",
  MAILGUN_SEND_APPROVED: "true",
  MAILGUN_PROMOTIONAL_SEND_APPROVED: "true",
  MAILGUN_EU_DOMAIN: "mail.synthetic.test",
  MAILGUN_FROM_EMAIL: "sender@mail.synthetic.test",
  MAILGUN_EU_API_KEY: "synthetic-private-api-key",
  MAILGUN_EU_WEBHOOK_SIGNING_KEY: "synthetic-private-signing-key",
  PUBLIC_BASE_URL: "https://app.synthetic.test",
  PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "https://unsubscribe.synthetic.test",
  PROMOTIONAL_UNSUBSCRIBE_SECRET: "synthetic-private-unsubscribe-secret",
  PROMOTIONAL_MONTHLY_LOCATION_LIMIT: "100",
  PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: "24",
};
const externalAcceptance = {
  approvedSender: "not_verified_locally",
  spf: "not_verified_locally",
  dkim: "not_verified_locally",
  dmarc: "not_verified_locally",
  syntheticReceipt: "not_verified_locally",
};
const gates = [
  ["PROMOTIONAL_EXTERNAL_EMAIL_ENABLED", "promotional_enabled"],
  ["MAILGUN_PROMOTIONAL_SEND_APPROVED", "promotional_approval"],
  ["MAILGUN_SEND_APPROVED", "sender_approval"],
  ["MAILGUN_EU_DOMAIN", "sender_domain"],
  ["MAILGUN_FROM_EMAIL", "sender_address"],
  ["MAILGUN_EU_API_KEY", "api_key"],
  ["MAILGUN_EU_WEBHOOK_SIGNING_KEY", "webhook_signing_key"],
  ["PUBLIC_BASE_URL", "public_origin"],
  ["PROMOTIONAL_UNSUBSCRIBE_ORIGIN", "unsubscribe_origin"],
  ["PROMOTIONAL_UNSUBSCRIBE_SECRET", "unsubscribe_secret"],
  ["PROMOTIONAL_MONTHLY_LOCATION_LIMIT", "monthly_location_limit"],
  ["PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS", "customer_cooldown"],
] as const;

describe("local Mailgun configuration diagnostics", () => {
  it("defaults to disabled and reports every missing promotional gate in stable order", () => {
    expect(campaignReadiness({})).toEqual({
      scope: "local_configuration_only", provider: "mailgun_eu", purpose: "promotional",
      configurationReady: false,
      missingGates: ["promotional_enabled", "promotional_approval", "sender_approval", "sender_domain",
        "sender_address", "sender_domain_match", "api_key", "webhook_signing_key", "public_origin",
        "unsubscribe_origin", "unsubscribe_origin_isolation", "unsubscribe_secret", "monthly_location_limit", "customer_cooldown"],
      externalAcceptance,
    });
    expect(mailgunConfig({})).toBeNull();
  });

  it.each(gates)("reports absent or empty %s without enabling the provider", (key, gate) => {
    for (const value of [undefined, ""]) {
      const env = { ...ready, [key]: value };
      expect(campaignReadiness(env).missingGates).toContain(gate);
      expect(campaignReadiness(env).configurationReady).toBe(false);
      expect(mailgunConfig(env, "promotional")).toBeNull();
    }
  });

  it("distinguishes sender validity from sender/domain mismatch", () => {
    const env = { ...ready, MAILGUN_FROM_EMAIL: "sender@other.synthetic.test" };
    expect(campaignReadiness(env).missingGates).toEqual(["sender_domain_match"]);
    expect(mailgunConfig(env, "promotional")).toBeNull();
  });

  it("requires a separate unsubscribe origin using normalized URL origins", () => {
    const env = { ...ready, PROMOTIONAL_UNSUBSCRIBE_ORIGIN: "https://APP.synthetic.test:443/" };
    expect(campaignReadiness(env).missingGates).toEqual(["unsubscribe_origin_isolation"]);
    expect(mailgunConfig(env, "promotional")).toBeNull();
  });

  it.each(["false", "TRUE", " true", "1"])("requires literal true approval flags: %s", value => {
    for (const key of ["PROMOTIONAL_EXTERNAL_EMAIL_ENABLED", "MAILGUN_PROMOTIONAL_SEND_APPROVED", "MAILGUN_SEND_APPROVED"]) {
      expect(campaignReadiness({ ...ready, [key]: value }).configurationReady).toBe(false);
    }
  });

  it.each(["not-a-url", "http://public.synthetic.test", "https://localhost", "https://127.0.0.1", "https://[::1]",
    "https://public.synthetic.test/path", "https://user:private@public.synthetic.test", "https://public.synthetic.test?private=value", "https://public.synthetic.test#private"])("rejects malformed or unsafe origins without reflecting them", value => {
    for (const [key, gate] of [["PUBLIC_BASE_URL", "public_origin"], ["PROMOTIONAL_UNSUBSCRIBE_ORIGIN", "unsubscribe_origin"]]) {
      const env = { ...ready, [key]: value };
      expect(campaignReadiness(env).missingGates).toContain(gate);
      expect(mailgunConfig(env, "promotional")).toBeNull();
      expect(JSON.stringify(campaignReadiness(env))).not.toContain(value);
    }
  });

  it.each(["bad_domain", "localhost", "-mail.synthetic.test", "mail..synthetic.test"])("rejects malformed domains: %s", value => {
    expect(campaignReadiness({ ...ready, MAILGUN_EU_DOMAIN: value }).missingGates).toContain("sender_domain");
  });

  it.each(["not-an-address", "sender@@mail.synthetic.test", "sender@mail.synthetic.test\nprivate"])("rejects malformed sender addresses: %s", value => {
    expect(campaignReadiness({ ...ready, MAILGUN_FROM_EMAIL: value }).missingGates).toContain("sender_address");
  });

  it.each(["", " ", "0", "-1", "1.5", "NaN", "Infinity", "9007199254740992", "private"])("rejects unusable promotional limits: %s", value => {
    for (const [key, gate] of [["PROMOTIONAL_MONTHLY_LOCATION_LIMIT", "monthly_location_limit"], ["PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS", "customer_cooldown"]]) {
      const env = { ...ready, [key]: value };
      expect(campaignReadiness(env).missingGates).toEqual([gate]);
      expect(mailgunConfig(env, "promotional")).toBeNull();
    }
  });

  it("preserves the existing limit and secret boundaries", () => {
    for (const [key, maximum, gate] of [["PROMOTIONAL_MONTHLY_LOCATION_LIMIT", 100_000, "monthly_location_limit"], ["PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS", 8760, "customer_cooldown"]] as const) {
      for (const value of ["1", String(maximum)]) expect(campaignReadiness({ ...ready, [key]: value }).configurationReady).toBe(true);
      expect(campaignReadiness({ ...ready, [key]: String(maximum + 1) }).missingGates).toEqual([gate]);
    }
    expect(campaignReadiness({ ...ready, PROMOTIONAL_UNSUBSCRIBE_SECRET: "s".repeat(31) }).missingGates).toEqual(["unsubscribe_secret"]);
    expect(campaignReadiness({ ...ready, PROMOTIONAL_UNSUBSCRIBE_SECRET: "s".repeat(32) }).configurationReady).toBe(true);
    // The extracted adapter predicate requires presence, not a new key-length policy.
    expect(mailgunConfig({ ...ready, MAILGUN_EU_API_KEY: "k", MAILGUN_EU_WEBHOOK_SIGNING_KEY: "s" }, "promotional")).not.toBeNull();
  });

  it("keeps transactional enablement and its legacy fallback separate from promotion", () => {
    const transactional = { ...ready, PROMOTIONAL_EXTERNAL_EMAIL_ENABLED: "false", MAILGUN_PROMOTIONAL_SEND_APPROVED: undefined,
      PROMOTIONAL_UNSUBSCRIBE_SECRET: undefined, PROMOTIONAL_UNSUBSCRIBE_ORIGIN: undefined,
      PROMOTIONAL_MONTHLY_LOCATION_LIMIT: undefined, PROMOTIONAL_CUSTOMER_COOLDOWN_HOURS: undefined };
    expect(mailgunConfig(transactional)).not.toBeNull();
    expect(campaignReadiness(transactional).configurationReady).toBe(false);
    expect(mailgunConfig({ ...transactional, TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: undefined, EXTERNAL_EMAIL_ENABLED: "true" })).not.toBeNull();
    expect(mailgunConfig({ ...transactional, TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false", EXTERNAL_EMAIL_ENABLED: "true" })).toBeNull();
    expect(mailgunConfig({ ...ready, TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: "false" }, "promotional")).not.toBeNull();
    expect(mailgunConfig({ ...ready, TRANSACTIONAL_EXTERNAL_EMAIL_ENABLED: undefined, EXTERNAL_EMAIL_ENABLED: undefined })).toBeNull();
    expect(campaignReadiness({ ...transactional, EXTERNAL_EMAIL_ENABLED: "true" }).configurationReady).toBe(false);
  });

  it("is deterministic, does not mutate inputs, and never claims external acceptance", () => {
    const env = Object.freeze({ ...ready, MAILGUN_EU_DOMAIN: "MAIL.SYNTHETIC.TEST", MAILGUN_FROM_EMAIL: "SENDER@MAIL.SYNTHETIC.TEST" });
    const diagnostic = campaignReadiness(env);
    expect(diagnostic).toEqual({ scope: "local_configuration_only", provider: "mailgun_eu", purpose: "promotional",
      configurationReady: true, missingGates: [], externalAcceptance });
    expect(campaignReadiness(env)).toEqual(diagnostic);
    expect(mailgunConfig(env, "promotional")).toMatchObject({ domain: ready.MAILGUN_EU_DOMAIN, from: ready.MAILGUN_FROM_EMAIL });
    diagnostic.missingGates.push("sender_domain");
    diagnostic.externalAcceptance.spf = "not_verified_locally";
    expect(campaignReadiness(env).missingGates).toEqual([]);
  });

  it("serializes only allowlisted diagnostic data without reflecting secrets or unrelated environment data", () => {
    const env = { ...ready, DATABASE_URL: "postgres://private-user:private-pass@private-host/private-db",
      UNKNOWN_SECRET: "unknown-private-value", MAILGUN_EU_DOMAIN: "private-invalid-domain",
      MAILGUN_FROM_EMAIL: "private-invalid-address", PUBLIC_BASE_URL: "https://private-user:private-pass@private-host" };
    const serialized = JSON.stringify(campaignReadiness(env));
    for (const key of Object.keys(env)) expect(serialized).not.toContain(key);
    for (const key of ["DATABASE_URL", "UNKNOWN_SECRET", "MAILGUN_EU_DOMAIN", "MAILGUN_FROM_EMAIL", "PUBLIC_BASE_URL", "MAILGUN_EU_API_KEY", "MAILGUN_EU_WEBHOOK_SIGNING_KEY", "PROMOTIONAL_UNSUBSCRIBE_SECRET"]) {
      expect(serialized).not.toContain(env[key as keyof typeof env]);
    }
    expect(JSON.parse(serialized).externalAcceptance).toEqual(externalAcceptance);
  });

  it("the operator CLI prints exactly sanitized JSON for the supplied environment", () => {
    for (const env of [{ NODE_ENV: "production" as const }, ready]) {
      const output = execFileSync(process.execPath, ["--import", "tsx", "scripts/campaign-readiness.ts"], { env, encoding: "utf8" });
      expect(output).toBe(`${JSON.stringify(campaignReadiness(env), null, 2)}\n`);
    }
  });
});
