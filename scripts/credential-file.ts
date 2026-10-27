import { randomBytes } from "node:crypto";
import { closeSync, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Messages name settings only; they never contain the value, the key or its identity. */
export class CredentialFileError extends Error {
  constructor(message: string) { super(message); this.name = "CredentialFileError"; }
}

function outside(parent: string, child: string) {
  const relative = path.relative(parent, child);
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
}

/**
 * Writes credential bytes delivered as the environment value `valueName` to the file named by `fileName`: owner-only (0600)
 * in an owner-only directory outside the application, replaced atomically, so a restart rewrites the same file. Nothing is
 * logged. Throws CredentialFileError.
 */
export function writeCredentialFile(target: string | undefined, bytes: Buffer, valueName: string, fileName: string) {
  const unwritable = `${valueName} could not be written to ${fileName}`;
  if (!target || !path.isAbsolute(target)) throw new CredentialFileError(`${valueName} requires ${fileName} as an absolute path for the key file`);
  const directory = path.dirname(target);
  const unsafeDirectory = new CredentialFileError(`${fileName} must be in a directory outside the application that only the runtime user can access (0700, no symlink)`);
  const application = realpathSync(process.cwd());
  if (!outside(application, path.resolve(directory))) throw unsafeDirectory;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
  } catch { throw new CredentialFileError(unwritable); }
  const folder = lstatSync(directory);
  if (!folder.isDirectory() || (folder.mode & 0o077) !== 0 || (process.getuid && folder.uid !== process.getuid()) || !outside(application, realpathSync(directory))) throw unsafeDirectory;
  const existing = lstatSync(target, { throwIfNoEntry: false });
  if (existing && !existing.isFile()) throw new CredentialFileError(`${fileName} exists and is not a regular file`);
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
    throw new CredentialFileError(unwritable);
  }
}

/** Base64 on one line or wrapped, as pasted from a terminal; null when it is not plain base64. */
export function decodeBase64Value(value: string, maxLength: number): Buffer | null {
  const compact = value.replace(/\s+/g, "");
  if (!compact || compact.length > maxLength || compact.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) return null;
  return Buffer.from(compact, "base64");
}
