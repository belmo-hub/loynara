import path from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("device-test synthetic seed gate", () => {
  it("refuses to create accounts until the approved origin and Access values exist", () => {
      const result = spawnSync(path.resolve("node_modules/.bin/tsx"), [path.resolve("scripts/seed.ts")], {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          NODE_ENV: "development",
          LOOPLOCAL_DEVICE_TEST_SEED: "true",
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
        },
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toMatch(/Device-test seeding rejected.*approved HTTPS origin/);
  });
});
