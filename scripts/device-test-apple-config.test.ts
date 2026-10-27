import { chmodSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { deviceTestPreparationIssues, deviceTestRuntimeIssues } from "./device-test-config";
import { appleFixture } from "../src/lib/wallet/test-support";

const apple = appleFixture();
for (const file of [apple.config.certPath, apple.config.keyPath, apple.config.wwdrPath]) chmodSync(file, 0o600);
afterAll(() => apple.cleanup());

const origin = "https://loyalty.owned-domain.org";
const approved = {
  DATABASE_URL: `postgresql://looplocal_device:${"a".repeat(64)}@127.0.0.1:54331/looplocal_device_test`,
  DEVICE_TEST_DB_PASSWORD: "a".repeat(64), BETTER_AUTH_SECRET: "b".repeat(64), LOOPLOCAL_NEXT_DIST_DIR: ".next-device-test",
  BETTER_AUTH_URL: origin, PUBLIC_BASE_URL: origin, DEVICE_TEST_APPROVED_ORIGIN: origin, DEVICE_TEST_ACCESS_TEAM: "owner-team", DEVICE_TEST_ACCESS_AUD: "a".repeat(64),
  PUBLIC_REGISTRATION_ENABLED: "false", EXTERNAL_EMAIL_ENABLED: "false", LIVE_BILLING_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false",
  TRUST_PROXY_CLIENT_IP: "false", SMTP_HOST: "disabled",
  DEVICE_TEST_APPROVED_WALLET_PROVIDER: "apple-native",
  ...apple.env, APPLE_WALLET_WEB_SERVICE_URL: `${origin}/api/apple`, APPLE_WALLET_AUTH_SECRET: "c".repeat(64),
};
const refused = (env: Record<string, string | undefined>, pattern: RegExp) => {
  for (const check of [deviceTestPreparationIssues, deviceTestRuntimeIssues]) expect(check(env)).toEqual(expect.arrayContaining([expect.stringMatching(pattern)]));
};

describe("approved native Apple device test", () => {
  it("accepts the explicit approval with the real-shaped Apple group on the approved origin", () => {
    expect(deviceTestPreparationIssues(approved)).toEqual([]);
    expect(deviceTestRuntimeIssues(approved)).toEqual([]);
  });

  it("keeps Apple off without the approval, and the approval needs Apple on", () => {
    refused({ ...approved, DEVICE_TEST_APPROVED_WALLET_PROVIDER: undefined }, /APPLE_WALLET_ENABLED must be false/);
    refused({ ...approved, DEVICE_TEST_APPROVED_WALLET_PROVIDER: "apple" }, /Only an explicitly approved/);
    refused({ ...approved, APPLE_WALLET_ENABLED: "false" }, /require APPLE_WALLET_ENABLED=true/);
  });

  it.each([
    ["no Access identifiers", { DEVICE_TEST_ACCESS_AUD: "" }, /Access application audience/],
    ["a web service on another origin", { APPLE_WALLET_WEB_SERVICE_URL: "https://app.getloynara.com/api/apple" }, /approved device-test origin/],
    ["the auth secret reused", { APPLE_WALLET_AUTH_SECRET: "b".repeat(64) }, /its own generated/],
    ["a short auth secret", { APPLE_WALLET_AUTH_SECRET: "c".repeat(40) }, /its own generated/],
    ["Google switched on as well", { GOOGLE_WALLET_ENABLED: "true" }, /Google Wallet must be off/],
    ["a missing key file", { APPLE_SIGNING_KEY_PATH: `${apple.config.keyPath}.missing` }, /owner-only certificate, key and WWDR/],
    // Owner-only files outside the repository that the adapter itself rejects.
    ["a malformed team the adapter refuses", { APPLE_TEAM_ID: "abc" }, /owner-only certificate, key and WWDR/],
  ])("refuses %s", (_name, override, pattern) => refused({ ...approved, ...override }, pattern));

  it("refuses a readable key or one inside the repository", () => {
    chmodSync(apple.config.keyPath, 0o644);
    try { refused(approved, /owner-only certificate, key and WWDR/); } finally { chmodSync(apple.config.keyPath, 0o600); }
    const inside = path.join(process.cwd(), "var", "device-test-apple-key-test");
    mkdirSync(inside, { recursive: true });
    try {
      const key = path.join(inside, "pass.key.pem");
      copyFileSync(apple.config.keyPath, key); chmodSync(key, 0o600);
      refused({ ...approved, APPLE_SIGNING_KEY_PATH: key }, /owner-only certificate, key and WWDR/);
    } finally { rmSync(inside, { recursive: true, force: true }); }
  });
});
