import { createPrivateKey, X509Certificate } from "node:crypto";
import { CredentialFileError, decodeBase64Value, writeCredentialFile } from "./credential-file";

type Env = Record<string, string | undefined>;

/**
 * Railway cannot mount files, so the Apple pass certificate, its private key and Apple's WWDR intermediate may arrive as
 * these environment values instead: each PEM file base64-encoded on one line (`base64 -i pass.key.pem | tr -d '\n'`). At
 * startup each is written to its *_PATH, so the existing file-based signer, push client and their checks apply unchanged.
 * Absent or empty: nothing happens, and a mounted file keeps working exactly as before.
 */
export const APPLE_CREDENTIAL_VALUES = {
  APPLE_SIGNING_CERT_BASE64: { file: "APPLE_SIGNING_CERT_PATH", kind: "certificate" },
  APPLE_SIGNING_KEY_BASE64: { file: "APPLE_SIGNING_KEY_PATH", kind: "key" },
  APPLE_WWDR_CERT_BASE64: { file: "APPLE_WWDR_CERT_PATH", kind: "certificate" },
} as const;
export type AppleCredentialValue = keyof typeof APPLE_CREDENTIAL_VALUES;

const placeholder = /replace|placeholder|example|changeme|test-secret/i;

/** Pure check of one delivered value, shared by the configuration gate and the startup write. Never echoes the value. */
export function inspectAppleCredentialValue(name: AppleCredentialValue, value: string): { bytes: Buffer; issue: null } | { bytes: null; issue: string } {
  const { kind } = APPLE_CREDENTIAL_VALUES[name];
  const invalid = { bytes: null, issue: kind === "key"
    ? `${name} must be a base64-encoded unencrypted PEM RSA private key (at least 2048 bits)`
    : `${name} must be a base64-encoded PEM certificate` };
  if (placeholder.test(value)) return { bytes: null, issue: `${name} contains placeholder text` };
  const bytes = decodeBase64Value(value, 16384);
  if (!bytes) return invalid;
  const pem = bytes.toString("utf8");
  try {
    if (kind === "certificate") {
      if (!pem.includes("-----BEGIN CERTIFICATE-----")) return invalid;
      new X509Certificate(bytes);
    } else {
      // Without a passphrase this throws for an encrypted, DER or non-key value, as the signer would.
      const key = createPrivateKey(bytes);
      if (key.asymmetricKeyType !== "rsa" || (key.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return invalid;
    }
  } catch { return invalid; }
  return { bytes, issue: null };
}

/**
 * Startup step shared by the web guard and the worker, run only after the configuration gate passed and before the Wallet
 * runtime check, which then reads the files like mounted ones. Each value is written owner-only to its *_PATH; nothing is
 * logged. Returns one issue per value that could not be written.
 */
export function appleCredentialStartupIssues(env: Env = process.env): string[] {
  const issues: string[] = [];
  for (const [name, { file }] of Object.entries(APPLE_CREDENTIAL_VALUES) as Array<[AppleCredentialValue, { file: string }]>) {
    const value = env[name];
    if (!value) continue;
    try {
      const { bytes, issue } = inspectAppleCredentialValue(name, value);
      if (!bytes) throw new CredentialFileError(issue);
      writeCredentialFile(env[file], bytes, name, file);
    } catch (error) {
      issues.push(error instanceof CredentialFileError ? error.message : `${name} could not be written to ${file}`);
    }
  }
  return issues;
}
