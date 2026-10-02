import { afterEach, describe, expect, it, vi } from "vitest";
import { DERIVED_KEY_PROVIDER, DerivedTapKeyProvider, NfcKeyError, deriveAdminKeys, deriveTagKeys, deriveVerificationKeys, derivedProviderFromEnv, nfcCapability, parseMaster } from "./nfc-keys";
import { defaultTapKeyProvider, localTapKeyProvider } from "./secure-tap";
import { verifySdm } from "./secure-tap-crypto";
import { sdmFor } from "./nfc-test-support";

const VERIFY = "7f3a9c1e5b2d48a06c9e1f3b5d7a8c2e4f6b1d3a5c7e9f0b2d4a6c8e0f1b3d5a";
const ADMIN = "c4e1a07b93d25f68b0a1c3e5d7f9021b4a6c8e0d2f4b6a8c0e1d3f5a7b9c2d4e";
const uid = "04de5f1eacc040";
const PROD = { PRODUCTION_ENVIRONMENT: "loynara-production" };

describe("derived NFC keys", () => {
  const verify = parseMaster(VERIFY);
  const admin = parseMaster(ADMIN);

  it("are deterministic, 16 bytes, and bound to the reference and the chip UID", () => {
    const a = deriveVerificationKeys(verify, "dv1_a", uid);
    expect(a.metaReadKey).toHaveLength(16);
    expect(deriveVerificationKeys(verify, "dv1_a", uid)).toEqual(a);
    expect(deriveVerificationKeys(verify, "dv1_b", uid)).not.toEqual(a);
    expect(deriveVerificationKeys(verify, "dv1_a", "04de5f1eacc041")).not.toEqual(a);
    expect(a.metaReadKey.equals(a.fileReadKey)).toBe(false);
  });
  it("keep verification and administrative keys separate: no key is shared, and the verifier cannot produce an admin key", () => {
    const all = deriveTagKeys({ verifyMaster: verify, adminMaster: admin, ref: "dv1_a", uid });
    const hex = Object.values(all).map(key => key.toString("hex"));
    expect(new Set(hex).size).toBe(5);
    expect(deriveAdminKeys(admin, "dv1_a", uid).key0).toEqual(all.key0);
    expect(deriveAdminKeys(verify, "dv1_a", uid).key0).not.toEqual(all.key0); // a different master never reproduces them
    expect(Object.keys(deriveVerificationKeys(verify, "dv1_a", uid)).sort()).toEqual(["fileReadKey", "metaReadKey"]);
  });
  it("refuse identical masters, malformed masters and malformed context", () => {
    expect(() => deriveTagKeys({ verifyMaster: verify, adminMaster: verify, ref: "dv1_a", uid })).toThrow(NfcKeyError);
    for (const bad of [undefined, "", "abcd", "z".repeat(64), "a".repeat(64), "00".repeat(32)]) expect(() => parseMaster(bad)).toThrow(NfcKeyError);
    expect(() => deriveVerificationKeys(verify, "bad ref!", uid)).toThrow(NfcKeyError);
    expect(() => deriveVerificationKeys(verify, "dv1_a", "XYZ")).toThrow(NfcKeyError);
  });
  it("let the server verify exactly the taps of the chips provisioned from the same masters", async () => {
    const keys = deriveTagKeys({ verifyMaster: verify, adminMaster: admin, ref: "dv1_a", uid });
    const fields = sdmFor({ uid, counter: 7, keys });
    const provider = new DerivedTapKeyProvider(verify);
    expect(verifySdm(fields, await provider.getKeys("dv1_a", { uid }))).toEqual({ uid, counter: 7 });
    await expect(provider.getKeys("dv1_a")).rejects.toThrow(NfcKeyError);                         // no UID, no keys
    expect(() => verifySdm(fields, { metaReadKey: keys.metaReadKey, fileReadKey: keys.key0 })).toThrow(); // an admin key never verifies a tap
    const other = await new DerivedTapKeyProvider(parseMaster("11".repeat(16) + "2233445566778899aabbccddeeff0011")).getKeys("dv1_a", { uid });
    expect(() => verifySdm(fields, other)).toThrow();
  });
});

describe("NFC capability follows what is configured, not the environment name", () => {
  it("production needs the flag, the derived provider and a valid master", () => {
    expect(nfcCapability({ ...PROD })).toEqual({ available: false, reason: "NFC_DISABLED" });
    expect(nfcCapability({ ...PROD, NFC_ENABLED: "true" })).toEqual({ available: false, reason: "KEY_PROVIDER_MISSING" });
    expect(nfcCapability({ ...PROD, NFC_ENABLED: "true", NFC_KEY_PROVIDER: DERIVED_KEY_PROVIDER, NFC_VERIFY_MASTER_KEY: "short" })).toEqual({ available: false, reason: "KEY_INVALID" });
    expect(nfcCapability({ ...PROD, NFC_ENABLED: "true", NFC_KEY_PROVIDER: DERIVED_KEY_PROVIDER, NFC_VERIFY_MASTER_KEY: VERIFY })).toEqual({ available: true, provider: "derived" });
    // development keys never make production capable
    expect(nfcCapability({ ...PROD, NFC_ENABLED: "true", TAP_SYNTHETIC_KEY_FILE: "/x" })).toEqual({ available: false, reason: "KEY_PROVIDER_MISSING" });
  });
  it("development, preview and device test are capable with the synthetic key file or the derived provider", () => {
    expect(nfcCapability({})).toEqual({ available: false, reason: "KEY_PROVIDER_MISSING" });
    expect(nfcCapability({ NODE_ENV: "production", TAP_SYNTHETIC_KEY_FILE: "/x" })).toEqual({ available: true, provider: "synthetic" });
    expect(nfcCapability({ NFC_KEY_PROVIDER: DERIVED_KEY_PROVIDER, NFC_VERIFY_MASTER_KEY: VERIFY })).toEqual({ available: true, provider: "derived" });
  });
  it("derivedProviderFromEnv only exists for the derived provider", () => {
    expect(derivedProviderFromEnv({})).toBeUndefined();
    expect(derivedProviderFromEnv({ NFC_KEY_PROVIDER: DERIVED_KEY_PROVIDER, NFC_VERIFY_MASTER_KEY: VERIFY })).toBeInstanceOf(DerivedTapKeyProvider);
    expect(() => derivedProviderFromEnv({ NFC_KEY_PROVIDER: DERIVED_KEY_PROVIDER, NFC_VERIFY_MASTER_KEY: "bad" })).toThrow(NfcKeyError);
  });
});

describe("runtime key provider selection (canonical production marker, not NODE_ENV)", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("real production never falls back to synthetic file keys and fails closed without the derived provider", async () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production"); vi.stubEnv("TAP_SYNTHETIC_KEY_FILE", "/tmp/keys.json");
    expect(() => defaultTapKeyProvider()).toThrow(/unavailable/i);
    await expect(localTapKeyProvider.getKeys("dev_x")).rejects.toMatchObject({ code: "TAP_KEY_UNAVAILABLE" });
  });
  it("real production uses the derived provider when it is configured", () => {
    vi.stubEnv("PRODUCTION_ENVIRONMENT", "loynara-production"); vi.stubEnv("NFC_KEY_PROVIDER", DERIVED_KEY_PROVIDER); vi.stubEnv("NFC_VERIFY_MASTER_KEY", VERIFY);
    expect(defaultTapKeyProvider()).toBeInstanceOf(DerivedTapKeyProvider);
  });
  it("a device-test or preview process (NODE_ENV=production, no marker) keeps the synthetic provider", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("PRODUCTION_ENVIRONMENT", "device-test");
    expect(defaultTapKeyProvider()).toBe(localTapKeyProvider);
  });
});
