import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertProvisioningEnvironment, DevelopmentKeyStore } from "./operator-safety";
import { generateDevelopmentKeys } from "./ntag";

const origin = "https://preview.getloynara.com";
const safe = {
  NODE_ENV: "development", DATABASE_URL: `postgresql://looplocal_device:${"a".repeat(64)}@127.0.0.1:54331/looplocal_device_test`,
  DEVICE_TEST_DB_PASSWORD: "a".repeat(64), PUBLIC_BASE_URL: origin, BETTER_AUTH_URL: origin, DEVICE_TEST_APPROVED_ORIGIN: origin,
  PUBLIC_REGISTRATION_ENABLED: "false", EXTERNAL_EMAIL_ENABLED: "false", LIVE_BILLING_ENABLED: "false", APPLE_WALLET_ENABLED: "false", GOOGLE_WALLET_ENABLED: "false",
};
describe("NFC operator safety", () => {
  it("refuses production, remote databases, copied preview databases and missing shutdown flags", () => {
    expect(() => assertProvisioningEnvironment(safe, origin)).not.toThrow();
    for (const change of [
      { NODE_ENV: "production" },
      { DATABASE_URL: safe.DATABASE_URL.replace("127.0.0.1", "db.example.com") },
      { DATABASE_URL: safe.DATABASE_URL.replace("54331", "54330") },
      { DATABASE_URL: safe.DATABASE_URL + "?host=db.example.com" },
      { PUBLIC_BASE_URL: "http://localhost:3002" },
      { EXTERNAL_EMAIL_ENABLED: "true" },
    ]) expect(() => assertProvisioningEnvironment({ ...safe, ...change }, origin)).toThrow();
  });
  it("keeps unique development keys in an ignored, restricted local file", async () => {
    const folder = await mkdtemp("var/nfc-key-test-");
    const filename = join(process.cwd(), folder, "keys.json");
    try {
      const store = new DevelopmentKeyStore(filename);
      const keys = generateDevelopmentKeys();
      await store.save("dev_test_a", "04de5f1eacc040", keys);
      const info = await stat(filename);
      expect(info.mode & 0o077).toBe(0);
      const text = await readFile(filename, "utf8");
      expect(text).toContain("DEVELOPMENT_ONLY");
      expect(() => new DevelopmentKeyStore(join(process.cwd(), "public", "keys.json"))).toThrow();
      await expect(store.save("dev_test_a", "04de5f1eacc040", keys)).rejects.toThrow("already exists");
    } finally { await rm(folder, { recursive: true, force: true }); }
  });
});
