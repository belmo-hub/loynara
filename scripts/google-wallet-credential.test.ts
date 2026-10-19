import { generateKeyPairSync } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { googleDirectStatus } from "../src/lib/wallet/google-direct";
import { GOOGLE_SERVICE_ACCOUNT_VALUE, googleServiceAccountStartupIssues, inspectGoogleServiceAccountValue, materializeGoogleServiceAccount } from "./google-wallet-credential";

// Generated fresh per run; never a Google-issued key.
const rsaKey = (modulusLength = 2048) => generateKeyPairSync("rsa", { modulusLength, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } }).privateKey;
const serviceAccount = (overrides: Record<string, unknown> = {}, privateKey = rsaKey()) => JSON.stringify({
  type: "service_account", project_id: "loynara-wallet", private_key_id: "0123456789abcdef0123456789abcdef01234567", private_key: privateKey,
  client_email: "wallet-issuer@loynara-wallet.iam.gserviceaccount.com", client_id: "123456789012345678901", ...overrides,
}, null, 2);
const encode = (json: string) => Buffer.from(json, "utf8").toString("base64");

describe("Google service-account key delivered as an environment value", () => {
  const roots: string[] = [];
  const root = () => { const dir = mkdtempSync(path.join(tmpdir(), "loynara-google-credential-")); roots.push(dir); return dir; };
  afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }); vi.restoreAllMocks(); });
  const mode = (file: string) => statSync(file).mode & 0o777;

  it("does nothing when the value is absent or empty", () => {
    const target = path.join(root(), "google", "service-account.json");
    for (const value of [undefined, ""]) {
      expect(materializeGoogleServiceAccount({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: value, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: target })).toBe("absent");
      expect(googleServiceAccountStartupIssues({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: value, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: target })).toEqual([]);
    }
    expect(existsSync(path.dirname(target))).toBe(false);
  });

  it("writes the key owner-only into an owner-only directory, without logging", () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const json = serviceAccount();
    const target = path.join(root(), "google", "service-account.json");
    expect(materializeGoogleServiceAccount({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: encode(json), GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: target })).toBe("written");
    expect(readFileSync(target, "utf8")).toBe(json);
    expect(mode(target)).toBe(0o600);
    expect(mode(path.dirname(target))).toBe(0o700);
    expect(readdirSync(path.dirname(target))).toEqual(["service-account.json"]);
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("is idempotent on restart and replaces a rotated or loosened key atomically", () => {
    const target = path.join(root(), "google", "service-account.json");
    const first = serviceAccount();
    const env = { [GOOGLE_SERVICE_ACCOUNT_VALUE]: encode(first), GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: target };
    materializeGoogleServiceAccount(env);
    materializeGoogleServiceAccount(env);
    expect(readFileSync(target, "utf8")).toBe(first);
    expect(mode(target)).toBe(0o600);
    chmodSync(target, 0o644);
    const rotated = serviceAccount({ private_key_id: "fedcba9876543210fedcba9876543210fedcba98" });
    materializeGoogleServiceAccount({ ...env, [GOOGLE_SERVICE_ACCOUNT_VALUE]: encode(rotated) });
    expect(readFileSync(target, "utf8")).toBe(rotated);
    expect(mode(target)).toBe(0o600);
    expect(readdirSync(path.dirname(target))).toEqual(["service-account.json"]);
  });

  it("accepts wrapped base64 and surrounding whitespace, as copied from a terminal", () => {
    const json = serviceAccount();
    const wrapped = `${encode(json).replace(/.{76}/g, "$&\n")}\n`;
    const target = path.join(root(), "service-account.json");
    materializeGoogleServiceAccount({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: ` ${wrapped}`, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: target });
    expect(readFileSync(target, "utf8")).toBe(json);
  });

  it("hands the file to the existing client, whose custody checks accept it", () => {
    const target = path.join(root(), "google", "service-account.json");
    const env = {
      GOOGLE_WALLET_ENABLED: "true", GOOGLE_WALLET_PROVIDER: "GOOGLE_DIRECT", GOOGLE_WALLET_PUBLISHING_STATUS: "published", GOOGLE_WALLET_ISSUER_ID: "3388000000022123456",
      GOOGLE_WALLET_PROGRAM_LOGO_URL: "https://cdn.getloynara.com/wallet/logo.png", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: target,
      GOOGLE_WALLET_LOCATION_CLASSES: JSON.stringify([{ tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", locationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", programId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", classId: "3388000000022123456.approved", issuanceEnabled: true, testAccountsApproved: false }]),
      [GOOGLE_SERVICE_ACCOUNT_VALUE]: encode(serviceAccount()),
    };
    expect(googleDirectStatus(env).ready).toBe(false);
    materializeGoogleServiceAccount(env);
    expect(googleDirectStatus(env)).toMatchObject({ ready: true, reason: null, publishingStatus: "published" });
  });

  it.each([
    ["raw JSON instead of base64", () => serviceAccount(), /base64-encoded/],
    ["base64 of something that is not JSON", () => encode("not a key"), /base64-encoded/],
    ["placeholder text", () => "replace-with-the-base64-key", /placeholder/],
    ["a placeholder inside the key", () => encode(serviceAccount({ client_email: "replace-me@loynara-wallet.iam.gserviceaccount.com" })), /placeholder/],
    ["the demo service account", () => encode(serviceAccount({ project_id: "loynara-wallet-demo-20261009", client_email: "loynara-wallet-demo@loynara-wallet-demo-20261009.iam.gserviceaccount.com" })), /demo, test or preview/],
    ["a test project", () => encode(serviceAccount({ project_id: "loynara-test" })), /demo, test or preview/],
    ["a key that is not a service account", () => encode(serviceAccount({ type: "authorized_user" })), /base64-encoded/],
    ["a non-Google identity", () => encode(serviceAccount({ client_email: "wallet@getloynara.com" })), /base64-encoded/],
    ["a short RSA key", () => encode(serviceAccount({}, rsaKey(1024))), /base64-encoded/],
    ["an EC key", () => encode(serviceAccount({}, generateKeyPairSync("ec", { namedCurve: "P-256", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey)), /base64-encoded/],
  ])("refuses %s without writing anything or echoing it", (_name, value, pattern) => {
    const delivered = value();
    const target = path.join(root(), "google", "service-account.json");
    const issues = googleServiceAccountStartupIssues({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: delivered, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: target });
    expect(issues).toEqual([expect.stringMatching(pattern)]);
    expect(inspectGoogleServiceAccountValue(delivered).issue).toEqual(issues[0]);
    expect(existsSync(path.dirname(target))).toBe(false);
    expect(issues.join(" ")).not.toContain(delivered.slice(0, 24));
    expect(issues.join(" ")).not.toMatch(/PRIVATE KEY|gserviceaccount|loynara-wallet-demo/);
  });

  it("requires an absolute file path outside the application", () => {
    const value = encode(serviceAccount());
    for (const file of [undefined, "", "service-account.json"]) {
      expect(googleServiceAccountStartupIssues({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: value, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: file }), String(file)).toEqual([expect.stringMatching(/absolute path/)]);
    }
    const inside = path.join(process.cwd(), "var", "google-credential-test", "service-account.json");
    expect(googleServiceAccountStartupIssues({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: value, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: inside })).toEqual([expect.stringMatching(/outside the application/)]);
    expect(existsSync(path.dirname(inside))).toBe(false);
  });

  it("refuses a shared or symlinked directory and a target that is not a regular file", () => {
    const value = encode(serviceAccount());
    const base = root();
    const shared = path.join(base, "shared");
    mkdirSync(shared, { mode: 0o700 });
    chmodSync(shared, 0o755);
    expect(googleServiceAccountStartupIssues({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: value, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: path.join(shared, "key.json") })).toEqual([expect.stringMatching(/only the runtime user/)]);
    expect(readdirSync(shared)).toEqual([]);

    const real = path.join(base, "real");
    mkdirSync(real, { mode: 0o700 });
    symlinkSync(real, path.join(base, "linked"));
    expect(googleServiceAccountStartupIssues({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: value, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: path.join(base, "linked", "key.json") })).toEqual([expect.stringMatching(/only the runtime user/)]);

    const owned = path.join(base, "owned");
    mkdirSync(owned, { mode: 0o700 });
    writeFileSync(path.join(base, "elsewhere.json"), "{}", { mode: 0o600 });
    symlinkSync(path.join(base, "elsewhere.json"), path.join(owned, "key.json"));
    mkdirSync(path.join(owned, "folder.json"));
    for (const name of ["key.json", "folder.json"]) {
      expect(googleServiceAccountStartupIssues({ [GOOGLE_SERVICE_ACCOUNT_VALUE]: value, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: path.join(owned, name) }), name).toEqual([expect.stringMatching(/not a regular file/)]);
    }
    expect(readFileSync(path.join(base, "elsewhere.json"), "utf8")).toBe("{}");
  });
});

// Both processes that read the key (web via `npm start`, worker via `npm run worker`) write it in the same place in their
// startup order: after the configuration gate, before the Wallet runtime check.
describe("startup order invariants", () => {
  it.each(["production-guard.ts", "worker.ts"])("%s writes the delivered key between the two gates", file => {
    const source = readFileSync(path.join(__dirname, file), "utf8");
    const config = source.indexOf("productionConfigIssues(");
    const write = source.indexOf("googleServiceAccountStartupIssues(");
    const runtime = source.indexOf("productionWalletRuntimeIssues(");
    expect(config).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(config);
    expect(runtime).toBeGreaterThan(write);
    expect(source.slice(config, runtime)).toMatch(/if \(!\w+\.length\) \w+\.push\(\.\.\.googleServiceAccountStartupIssues\(/);
  });
});
