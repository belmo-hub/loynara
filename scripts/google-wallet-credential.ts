import { createPrivateKey, randomBytes } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

type Env = Record<string, string | undefined>;

/**
 * Railway cannot mount files, so the Google Wallet service-account key may arrive as this environment value instead: the
 * key file's JSON, base64-encoded on one line. Base64 survives dashboard paste, .env parsing and shell quoting, where the raw
 * JSON's quotes, braces and escaped newlines in the private key do not. At startup it is written to
 * GOOGLE_WALLET_SERVICE_ACCOUNT_FILE, so the existing file-based client and its custody checks apply unchanged.
 * Absent or empty: nothing happens, and a mounted file keeps working exactly as before.
 */
export const GOOGLE_SERVICE_ACCOUNT_VALUE = "GOOGLE_WALLET_SERVICE_ACCOUNT_JSON_BASE64";

const placeholder = /replace|placeholder|example|changeme|test-secret/i;
// The demo key belongs to loynara-wallet-demo@loynara-wallet-demo-20261009 (docs/operations/google-wallet-direct.md).
const nonProductionIdentity = /(^|[@._-])(demo|preview|device[-_]?test|tests?|testing|synthetic|fixtures?|sandbox|staging|example)([@._\d-]|$)/i;
const unwritable = `${GOOGLE_SERVICE_ACCOUNT_VALUE} could not be written to GOOGLE_WALLET_SERVICE_ACCOUNT_FILE`;
const invalid = `${GOOGLE_SERVICE_ACCOUNT_VALUE} must be a base64-encoded Google service-account JSON key (RSA, at least 2048 bits)`;

/** Messages name settings only; they never contain the value, the key or its identity. */
export class GoogleServiceAccountError extends Error {
  constructor(message: string) { super(message); this.name = "GoogleServiceAccountError"; }
}

/** Pure check of the delivered value, shared by the configuration gate and the startup write. */
export function inspectGoogleServiceAccountValue(value: string): { bytes: Buffer; issue: null } | { bytes: null; issue: string } {
  const refuse = (issue: string) => ({ bytes: null, issue });
  if (placeholder.test(value)) return refuse(`${GOOGLE_SERVICE_ACCOUNT_VALUE} contains placeholder text`);
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length > 16384 || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return refuse(invalid);
  const bytes = Buffer.from(compact, "base64");
  let json: unknown;
  try { json = JSON.parse(bytes.toString("utf8")); } catch { return refuse(invalid); }
  if (!json || typeof json !== "object" || Array.isArray(json)) return refuse(invalid);
  const key = json as Record<string, unknown>;
  const text = (field: unknown) => typeof field === "string" ? field : "";
  if ([key.client_email, key.project_id, key.private_key_id].some(field => placeholder.test(text(field)))) return refuse(`${GOOGLE_SERVICE_ACCOUNT_VALUE} contains placeholder text`);
  if ([key.client_email, key.project_id].some(field => nonProductionIdentity.test(text(field)))) {
    return refuse(`${GOOGLE_SERVICE_ACCOUNT_VALUE} holds a demo, test or preview service account; production needs its own key`);
  }
  if (key.type !== "service_account" || typeof key.client_email !== "string" || !/^[a-z0-9-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(key.client_email)
    || typeof key.private_key !== "string" || !key.private_key.includes("BEGIN PRIVATE KEY")) return refuse(invalid);
  try {
    const privateKey = createPrivateKey(key.private_key);
    if (privateKey.asymmetricKeyType !== "rsa" || (privateKey.asymmetricKeyDetails?.modulusLength ?? 0) < 2048) return refuse(invalid);
  } catch { return refuse(invalid); }
  return { bytes, issue: null };
}

function outside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/**
 * Writes the delivered key to GOOGLE_WALLET_SERVICE_ACCOUNT_FILE: owner-only (0600) in an owner-only directory outside the
 * application, replaced atomically, so a restart rewrites the same file. Nothing is logged. Throws GoogleServiceAccountError.
 */
export function materializeGoogleServiceAccount(env: Env = process.env): "absent" | "written" {
  const value = env[GOOGLE_SERVICE_ACCOUNT_VALUE];
  if (!value) return "absent";
  const { bytes, issue } = inspectGoogleServiceAccountValue(value);
  if (!bytes) throw new GoogleServiceAccountError(issue);
  const target = env.GOOGLE_WALLET_SERVICE_ACCOUNT_FILE;
  if (!target || !path.isAbsolute(target)) throw new GoogleServiceAccountError(`${GOOGLE_SERVICE_ACCOUNT_VALUE} requires GOOGLE_WALLET_SERVICE_ACCOUNT_FILE as an absolute path for the key file`);
  const directory = path.dirname(target);
  const unsafeDirectory = new GoogleServiceAccountError("GOOGLE_WALLET_SERVICE_ACCOUNT_FILE must be in a directory outside the application that only the runtime user can access (0700, no symlink)");
  const application = realpathSync(process.cwd());
  if (!outside(application, path.resolve(directory))) throw unsafeDirectory;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch { throw new GoogleServiceAccountError(unwritable); }
  const folder = lstatSync(directory);
  if (!folder.isDirectory() || (folder.mode & 0o077) !== 0 || (process.getuid && folder.uid !== process.getuid()) || !outside(application, realpathSync(directory))) throw unsafeDirectory;
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new GoogleServiceAccountError("GOOGLE_WALLET_SERVICE_ACCOUNT_FILE exists and is not a regular file");
  const temporary = path.join(directory, `.${path.basename(target)}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, "wx", 0o600);
    fchmodSync(descriptor, 0o600);
    writeFileSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, target);
  } catch {
    try { if (descriptor !== undefined) closeSync(descriptor); } catch { /* the write already failed */ }
    try { rmSync(temporary, { force: true }); } catch { /* a leftover stays inside the owner-only directory */ }
    throw new GoogleServiceAccountError(unwritable);
  }
  return "written";
}

/**
 * Startup step shared by the web guard and the worker. Callers run it only after the configuration gate passed, so a refused
 * configuration never writes the key, and before the Wallet runtime check, which then reads the file like any mounted one.
 */
export function googleServiceAccountStartupIssues(env: Env = process.env): string[] {
  try {
    materializeGoogleServiceAccount(env);
    return [];
  } catch (error) {
    return [error instanceof GoogleServiceAccountError ? error.message : unwritable];
  }
}
