import { describe, expect, it } from "vitest";
import { deviceTestPreparationIssues, deviceTestRuntimeIssues } from "./device-test-config";

const prepared = {
  DATABASE_URL: `postgresql://looplocal_device:${"a".repeat(64)}@127.0.0.1:54331/looplocal_device_test`,
  DEVICE_TEST_DB_PASSWORD: "a".repeat(64),
  BETTER_AUTH_SECRET: "b".repeat(64),
  BETTER_AUTH_URL: "",
  PUBLIC_BASE_URL: "",
  DEVICE_TEST_APPROVED_ORIGIN: "",
  DEVICE_TEST_ACCESS_TEAM: "",
  DEVICE_TEST_ACCESS_AUD: "",
  LOOPLOCAL_NEXT_DIST_DIR: ".next-device-test",
  PUBLIC_REGISTRATION_ENABLED: "false",
  EXTERNAL_EMAIL_ENABLED: "false",
  LIVE_BILLING_ENABLED: "false",
  APPLE_WALLET_ENABLED: "false",
  GOOGLE_WALLET_ENABLED: "false",
  TRUST_PROXY_CLIENT_IP: "false",
  SMTP_HOST: "disabled",
};

const runtime = {
  ...prepared,
  BETTER_AUTH_URL: "https://loyalty.owned-domain.org",
  PUBLIC_BASE_URL: "https://loyalty.owned-domain.org",
  DEVICE_TEST_APPROVED_ORIGIN: "https://loyalty.owned-domain.org",
  DEVICE_TEST_ACCESS_TEAM: "owner-team",
  DEVICE_TEST_ACCESS_AUD: "a".repeat(64),
};

describe("separate synthetic device-test configuration", () => {
  it("accepts freshly prepared secrets and an isolated loopback database before origin approval", () => {
    expect(deviceTestPreparationIssues(prepared)).toEqual([]);
    expect(deviceTestRuntimeIssues(prepared)).toEqual(expect.arrayContaining([expect.stringMatching(/approved HTTPS origin/i)]));
  });

  it("accepts the exact approved HTTPS application origin and Access identifiers", () => {
    expect(deviceTestRuntimeIssues(runtime)).toEqual([]);
  });

  it("rejects any other database target, query override, or weak secret", () => {
    expect(deviceTestPreparationIssues({ ...prepared, DATABASE_URL: prepared.DATABASE_URL.replace("54331", "54330") })).not.toEqual([]);
    expect(deviceTestPreparationIssues({ ...prepared, DATABASE_URL: `${prepared.DATABASE_URL}?host=customer-db.example.org` })).not.toEqual([]);
    expect(deviceTestPreparationIssues({ ...prepared, DATABASE_URL: prepared.DATABASE_URL.replace("127.0.0.1", "database.example.org") })).not.toEqual([]);
    expect(deviceTestPreparationIssues({ ...prepared, DEVICE_TEST_DB_PASSWORD: "a".repeat(16) })).not.toEqual([]);
    expect(deviceTestPreparationIssues({ ...prepared, BETTER_AUTH_SECRET: "replace-me" })).not.toEqual([]);
  });

  it("rejects localhost, placeholder hosts, paths, query strings, mismatches, and absent Access config", () => {
    for (const origin of ["http://loyalty.owned-domain.org", "https://localhost", "https://127.0.0.1", "https://device-test.invalid", "https://loyalty.owned-domain.org/path", "https://loyalty.owned-domain.org?x=1", "https://user@loyalty.owned-domain.org"]) {
      expect(deviceTestRuntimeIssues({ ...runtime, DEVICE_TEST_APPROVED_ORIGIN: origin, BETTER_AUTH_URL: origin, PUBLIC_BASE_URL: origin })).not.toEqual([]);
    }
    expect(deviceTestRuntimeIssues({ ...runtime, PUBLIC_BASE_URL: "https://other.owned-domain.org" })).not.toEqual([]);
    expect(deviceTestRuntimeIssues({ ...runtime, DEVICE_TEST_ACCESS_TEAM: "" })).not.toEqual([]);
    expect(deviceTestRuntimeIssues({ ...runtime, DEVICE_TEST_ACCESS_AUD: "" })).not.toEqual([]);
  });

  it("rejects all external delivery, billing, signup, Wallet, and proxy-IP switches", () => {
    for (const name of ["PUBLIC_REGISTRATION_ENABLED", "EXTERNAL_EMAIL_ENABLED", "LIVE_BILLING_ENABLED", "BILLING_FIXTURE_MODE", "APPLE_WALLET_ENABLED", "GOOGLE_WALLET_ENABLED", "TRUST_PROXY_CLIENT_IP"]) {
      expect(deviceTestRuntimeIssues({ ...runtime, [name]: "true" })).not.toEqual([]);
    }
    expect(deviceTestRuntimeIssues({ ...runtime, SMTP_HOST: "smtp.provider.example" })).not.toEqual([]);
    expect(deviceTestRuntimeIssues({ ...runtime, GOOGLE_WALLET_ASSET_ENABLED: "true" })).not.toEqual([]);
    expect(deviceTestRuntimeIssues({ ...runtime, DEMO_MODE: "true" })).not.toEqual([]);
  });

  it("allows only the explicitly approved EU transactional recovery sender in the device test", () => {
    const email = {
      ...runtime,
      EXTERNAL_EMAIL_ENABLED: "true",
      DEVICE_TEST_APPROVED_EMAIL_PROVIDER: "mailgun-eu",
      MAILGUN_SEND_APPROVED: "true",
      MAILGUN_EU_DOMAIN: "mail.getloynara.com",
      MAILGUN_FROM_EMAIL: "karten@mail.getloynara.com",
      MAILGUN_EU_API_KEY: "a".repeat(32),
      MAILGUN_EU_WEBHOOK_SIGNING_KEY: "b".repeat(32),
    };
    expect(deviceTestRuntimeIssues(email)).toEqual([]);
    for (const change of [
      { DEVICE_TEST_APPROVED_EMAIL_PROVIDER: "" },
      { MAILGUN_SEND_APPROVED: "false" },
      { MAILGUN_EU_DOMAIN: "mail.other.example" },
      { MAILGUN_FROM_EMAIL: "newsletter@mail.getloynara.com" },
      { MAILGUN_EU_API_KEY: "" },
      { MAILGUN_EU_WEBHOOK_SIGNING_KEY: "" },
      { SMTP_HOST: "smtp.example.com" },
    ]) expect(deviceTestRuntimeIssues({ ...email, ...change })).not.toEqual([]);
  });
});
