import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appleWalletStatus } from "../src/lib/wallet/apple";
import { appleFixture } from "../src/lib/wallet/test-support";
import { APPLE_CREDENTIAL_VALUES, type AppleCredentialValue, appleCredentialStartupIssues, inspectAppleCredentialValue } from "./apple-wallet-credential";

const encode = (bytes: Buffer | string) => Buffer.from(bytes).toString("base64");
const pkcs8 = (type: "rsa" | "ec", options: object) => generateKeyPairSync(type as "rsa", { ...options, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } } as never).privateKey as unknown as string;

describe("Apple pass certificate, key and WWDR delivered as environment values", () => {
  const roots: string[] = [];
  const root = () => { const dir = mkdtempSync(path.join(tmpdir(), "loynara-apple-credential-")); roots.push(dir); return dir; };
  const fixtures: Array<ReturnType<typeof appleFixture>> = [];
  const fixture = () => { const made = appleFixture(); fixtures.push(made); return made; };
  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
    for (const made of fixtures.splice(0)) made.cleanup();
    vi.restoreAllMocks();
  });
  const mode = (file: string) => statSync(file).mode & 0o777;
  // The fixture's files as values, with *_PATH pointing into a fresh custody directory instead.
  const delivered = (made = fixture()) => {
    const custody = path.join(root(), "apple");
    const env: Record<string, string | undefined> = {
      ...made.env,
      APPLE_SIGNING_CERT_PATH: path.join(custody, "pass.cert.pem"), APPLE_SIGNING_KEY_PATH: path.join(custody, "pass.key.pem"), APPLE_WWDR_CERT_PATH: path.join(custody, "wwdr.pem"),
      APPLE_SIGNING_CERT_BASE64: encode(readFileSync(made.config.certPath)), APPLE_SIGNING_KEY_BASE64: encode(readFileSync(made.config.keyPath)), APPLE_WWDR_CERT_BASE64: encode(readFileSync(made.config.wwdrPath)),
    };
    return { made, custody, env };
  };

  it("does nothing when the values are absent or empty", () => {
    const { env, custody } = delivered();
    for (const value of [undefined, ""]) {
      expect(appleCredentialStartupIssues({ ...env, APPLE_SIGNING_CERT_BASE64: value, APPLE_SIGNING_KEY_BASE64: value, APPLE_WWDR_CERT_BASE64: value })).toEqual([]);
    }
    expect(existsSync(custody)).toBe(false);
  });

  it("writes each file owner-only into an owner-only directory without logging, and the signer accepts them", () => {
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "info")];
    const { made, env, custody } = delivered();
    expect(appleWalletStatus(env).ready).toBe(false);
    expect(appleCredentialStartupIssues(env)).toEqual([]);
    expect(readdirSync(custody).sort()).toEqual(["pass.cert.pem", "pass.key.pem", "wwdr.pem"]);
    expect(readFileSync(env.APPLE_SIGNING_KEY_PATH!)).toEqual(readFileSync(made.config.keyPath));
    for (const file of readdirSync(custody)) expect(mode(path.join(custody, file))).toBe(0o600);
    expect(mode(custody)).toBe(0o700);
    expect(appleWalletStatus(env)).toMatchObject({ ready: true, reason: null });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

  it("is idempotent on restart, accepts wrapped base64, and keeps a mounted file for any value left out", () => {
    const { made, env } = delivered();
    const wrapped = `  ${env.APPLE_SIGNING_KEY_BASE64!.replace(/.{76}/g, "$&\n")}\n`;
    const mixed = { ...env, APPLE_SIGNING_KEY_BASE64: wrapped, APPLE_WWDR_CERT_BASE64: undefined, APPLE_WWDR_CERT_PATH: made.config.wwdrPath };
    expect(appleCredentialStartupIssues(mixed)).toEqual([]);
    expect(appleCredentialStartupIssues(mixed)).toEqual([]);
    expect(readFileSync(env.APPLE_SIGNING_KEY_PATH!)).toEqual(readFileSync(made.config.keyPath));
    expect(appleWalletStatus(mixed).ready).toBe(true);
  });

  it.each([
    ["APPLE_SIGNING_KEY_BASE64", "raw PEM instead of base64", () => pkcs8("rsa", { modulusLength: 2048 }), /base64-encoded unencrypted PEM RSA/],
    ["APPLE_SIGNING_KEY_BASE64", "a short RSA key", () => encode(pkcs8("rsa", { modulusLength: 1024 })), /at least 2048 bits/],
    ["APPLE_SIGNING_KEY_BASE64", "an EC key", () => encode(pkcs8("ec", { namedCurve: "P-256" })), /RSA private key/],
    ["APPLE_SIGNING_KEY_BASE64", "an encrypted key", () => encode(generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "pem" }, privateKeyEncoding: { type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: "synthetic" } }).privateKey), /unencrypted/],
    ["APPLE_SIGNING_KEY_BASE64", "a certificate in the key slot", () => encode(readFileSync(fixture().config.certPath)), /private key/],
    ["APPLE_SIGNING_CERT_BASE64", "a key in the certificate slot", () => encode(readFileSync(fixture().config.keyPath)), /PEM certificate/],
    ["APPLE_SIGNING_CERT_BASE64", "a DER certificate", () => encode(execFileSync("openssl", ["x509", "-in", fixture().config.certPath, "-outform", "DER"])), /PEM certificate/],
    ["APPLE_WWDR_CERT_BASE64", "placeholder text", () => "replace-with-the-base64-wwdr", /placeholder/],
    ["APPLE_WWDR_CERT_BASE64", "base64 of something that is not a certificate", () => encode("-----BEGIN CERTIFICATE-----\nnot one\n-----END CERTIFICATE-----\n"), /PEM certificate/],
  ] as Array<[AppleCredentialValue, string, () => string, RegExp]>)("refuses %s with %s without writing anything or echoing it", (name, _label, value, pattern) => {
    const { env, custody } = delivered();
    const supplied = value();
    const issues = appleCredentialStartupIssues({ APPLE_SIGNING_KEY_PATH: env.APPLE_SIGNING_KEY_PATH, APPLE_SIGNING_CERT_PATH: env.APPLE_SIGNING_CERT_PATH, APPLE_WWDR_CERT_PATH: env.APPLE_WWDR_CERT_PATH, [name]: supplied });
    expect(issues).toEqual([expect.stringMatching(pattern)]);
    expect(issues[0]).toMatch(new RegExp(`^${name} `));
    expect(inspectAppleCredentialValue(name, supplied).issue).toEqual(issues[0]);
    expect(existsSync(custody)).toBe(false);
    expect(issues.join(" ")).not.toContain(supplied.slice(0, 24));
    expect(issues.join(" ")).not.toMatch(/BEGIN|fixture/);
  });

  it("requires an absolute path outside the application for each file", () => {
    const { env } = delivered();
    for (const [name, { file }] of Object.entries(APPLE_CREDENTIAL_VALUES)) {
      const only = { [name]: env[name] };
      for (const target of [undefined, "", "pass.pem"]) expect(appleCredentialStartupIssues({ ...only, [file]: target }), `${name} ${target}`).toEqual([`${name} requires ${file} as an absolute path for the key file`]);
      const inside = path.join(process.cwd(), "var", "apple-credential-test", "file.pem");
      expect(appleCredentialStartupIssues({ ...only, [file]: inside })).toEqual([expect.stringMatching(new RegExp(`^${file} must be in a directory outside the application`))]);
      expect(existsSync(path.dirname(inside))).toBe(false);
    }
  });
});
