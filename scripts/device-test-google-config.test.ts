import { generateKeyPairSync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { deviceTestPreparationIssues, deviceTestRuntimeIssues } from "./device-test-config";
import { googleClass, googleConfig, GoogleWalletClient } from "../src/lib/wallet/google";
import { merchantGoogleLogoUrl } from "../src/lib/wallet/logo";
import type { WalletPassData } from "../src/lib/wallet/types";

const directory = mkdtempSync(path.join(tmpdir(), "looplocal-google-gate-"));
const keyFile = path.join(directory, "service-account.json");
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
writeFileSync(keyFile, JSON.stringify({ client_email: "synthetic@test-project.iam.gserviceaccount.com", private_key: key }), { mode: 0o600 });
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const logoUrl = "https://assets.owned-domain.org/api/wallet/assets/google-logo/12345678-1234-1234-1234-123456789abc.png";
const approved = {
  DATABASE_URL: `postgresql://looplocal_device:${"a".repeat(64)}@127.0.0.1:54331/looplocal_device_test`,
  DEVICE_TEST_DB_PASSWORD: "a".repeat(64), BETTER_AUTH_SECRET: "b".repeat(64),
  LOOPLOCAL_NEXT_DIST_DIR: ".next-device-test",
  BETTER_AUTH_URL: "https://loyalty.owned-domain.org", PUBLIC_BASE_URL: "https://loyalty.owned-domain.org",
  DEVICE_TEST_APPROVED_ORIGIN: "https://loyalty.owned-domain.org", DEVICE_TEST_ACCESS_TEAM: "owner-team", DEVICE_TEST_ACCESS_AUD: "a".repeat(64),
  PUBLIC_REGISTRATION_ENABLED: "false", EXTERNAL_EMAIL_ENABLED: "false", LIVE_BILLING_ENABLED: "false", APPLE_WALLET_ENABLED: "false",
  TRUST_PROXY_CLIENT_IP: "false", SMTP_HOST: "disabled",
  DEVICE_TEST_APPROVED_WALLET_PROVIDER: "google-demo",
  DEVICE_TEST_APPROVED_GOOGLE_ISSUER_ID: "123456789", DEVICE_TEST_GOOGLE_TESTER_EMAIL: "tester@example.test",
  DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL: logoUrl,
  GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_PUBLISHING_STATUS: "demo", GOOGLE_WALLET_ISSUER_ID: "123456789",
  GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: keyFile,
  GOOGLE_WALLET_ASSET_ENABLED: "true", GOOGLE_WALLET_ASSET_ORIGIN: "https://assets.owned-domain.org", GOOGLE_WALLET_PROGRAM_LOGO_URL: logoUrl,
};
const pass: WalletPassData = {
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", membershipId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  programId: "12345678-1234-1234-1234-123456789abc", merchantName: "Synthetic Café", programName: "Coffee",
  locationName: "Kassel", programType: "stamp", balance: 1, scanCode: "sc_synthetic-fixture-only", cardLocator: "K-AAAAAA", brandColor: "#264C45", country: "DE", locale: "de",
};

describe("explicitly approved Google Demo device-test gate", () => {
  it("admits a declared Google Demo test with a separate exact logo route and restricted local credential", () => {
    expect(deviceTestPreparationIssues(approved)).toEqual([]);
    expect(deviceTestRuntimeIssues(approved)).toEqual([]);
  });

  it("rejects absent approval, tester, changed issuer, published mode, or missing browser Access", () => {
    for (const [name, value] of [
      ["DEVICE_TEST_APPROVED_WALLET_PROVIDER", ""], ["DEVICE_TEST_APPROVED_WALLET_PROVIDER", "apple"],
      ["DEVICE_TEST_GOOGLE_TESTER_EMAIL", ""], ["DEVICE_TEST_GOOGLE_TESTER_EMAIL", "not-an-email"],
      ["DEVICE_TEST_APPROVED_GOOGLE_ISSUER_ID", "987654321"], ["GOOGLE_WALLET_PUBLISHING_STATUS", "published"],
      ["DEVICE_TEST_ACCESS_AUD", ""], ["DEVICE_TEST_ACCESS_TEAM", ""], ["APPLE_WALLET_ENABLED", "true"],
    ]) expect(deviceTestRuntimeIssues({ ...approved, [name]: value }), name).not.toEqual([]);
  });

  it("rejects broad, mismatched, protected-browser or non-HTTPS logo exposure", () => {
    for (const [name, value] of [
      ["DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL", ""],
      ["DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL", "https://assets.owned-domain.org/api/wallet/assets/google-logo/*"],
      ["GOOGLE_WALLET_ASSET_ENABLED", "false"],
      ["GOOGLE_WALLET_ASSET_ORIGIN", "https://other.owned-domain.org"],
      ["GOOGLE_WALLET_PROGRAM_LOGO_URL", "https://assets.owned-domain.org/unapproved.png"],
    ]) expect(deviceTestRuntimeIssues({ ...approved, [name]: value }), name).not.toEqual([]);
    for (const origin of ["https://loyalty.owned-domain.org", "http://assets.owned-domain.org", "https://assets.invalid"]) {
      const url = `${origin}/api/wallet/assets/google-logo/12345678-1234-1234-1234-123456789abc.png`;
      expect(deviceTestRuntimeIssues({ ...approved, DEVICE_TEST_APPROVED_GOOGLE_LOGO_URL: url, GOOGLE_WALLET_PROGRAM_LOGO_URL: url, GOOGLE_WALLET_ASSET_ORIGIN: origin })).not.toEqual([]);
    }
  });

  it("rejects missing, relative, repository-contained, symlinked or readable-by-others credentials", () => {
    const linked = path.join(directory, "linked.json");
    symlinkSync(keyFile, linked);
    for (const filename of ["", "var/service-account.json", path.resolve("public/service-account.json"), linked, path.join(directory, "missing.json")]) {
      expect(deviceTestRuntimeIssues({ ...approved, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: filename }), filename).not.toEqual([]);
    }
    chmodSync(keyFile, 0o644);
    try { expect(deviceTestRuntimeIssues(approved)).not.toEqual([]); }
    finally { chmodSync(keyFile, 0o600); }
  });

  it("carries the approved program and path through config to the actual versioned merchant logo", () => {
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQ83H9DwADCgG307XiNAAAAABJRU5ErkJggg==";
    const selected = merchantGoogleLogoUrl(pass.programId, png, approved);
    expect(selected).toMatch(/\.png\?v=[0-9a-f]{16}$/);
    const config = googleConfig(approved);
    expect(googleClass({ ...pass, googleLogoUrl: selected }, config).programLogo.sourceUri.uri).toBe(selected);
    expect(googleClass(pass, config).programLogo.sourceUri.uri).toBe(logoUrl);
    expect(() => googleClass({ ...pass, programId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, config)).toThrow(/approved/i);
  });

  it("rejects unapproved actual program, origin, path and query before even requesting an OAuth token", async () => {
    const config = googleConfig(approved);
    let transportCalls = 0;
    const client = new GoogleWalletClient(config, async () => { transportCalls++; throw new Error("Unexpected provider transport"); });
    const unapproved: WalletPassData[] = [
      { ...pass, programId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
      ...[
        logoUrl.replace("assets.owned-domain.org", "elsewhere.owned-domain.org"),
        logoUrl.replace(pass.programId, "cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
        `${logoUrl}?v=short`, `${logoUrl}?v=0123456789abcdef&extra=1`, `${logoUrl}?x=0123456789abcdef`,
        `${logoUrl}?v=0123456789abcdef#unapproved`, `${logoUrl}?v=0123456789abcdef&v=0123456789abcdef`,
      ].map(googleLogoUrl => ({ ...pass, googleLogoUrl })),
    ];
    for (const candidate of unapproved) await expect(client.upsert(candidate, "dddddddd-dddd-4ddd-8ddd-dddddddddddd", config)).rejects.toThrow(/approved/i);
    expect(transportCalls).toBe(0);
  });

  it("can validate the isolated database for shutdown even after provider credentials are removed", () => {
    const check = (overrides: Record<string, string>) => spawnSync(path.resolve("node_modules/.bin/tsx"), ["scripts/device-test-assert.ts", "--database"], {
      cwd: process.cwd(), encoding: "utf8", env: { ...process.env, ...approved, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: path.join(directory, "removed.json"), ...overrides },
    });
    expect(check({}).status).toBe(0);
    expect(check({ DATABASE_URL: approved.DATABASE_URL.replace("54331", "54330") }).status).toBe(1);
  });
});
