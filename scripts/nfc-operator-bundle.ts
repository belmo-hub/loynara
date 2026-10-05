import { constants } from "node:fs";
import { lstat, mkdir, open, rename, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseRegistrationBundle, type RegistrationBundle } from "../src/lib/nfc-provision/production";

const IDENTITY = ["version", "target", "origin", "uid", "publicRef", "keyRef", "tenantId", "locationId", "programId", "configVersion"] as const;
const fail = (code: string): never => { throw new Error(code); };

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}

async function ensureRoot(root: string): Promise<void> {
  const ignored = path.resolve("var");
  if (!root.startsWith(ignored + path.sep)) fail("BUNDLE_DELIVERY_UNSAFE");
  const directories = [ignored];
  for (const segment of path.relative(ignored, root).split(path.sep)) directories.push(path.join(directories.at(-1)!, segment));
  for (const directory of directories) {
    let created = false;
    try { await mkdir(directory, { mode: 0o700 }); created = true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
    const info = await lstat(directory);
    if (!info.isDirectory() || info.isSymbolicLink()) fail("BUNDLE_DELIVERY_UNSAFE");
    if (created) { await syncDirectory(directory); await syncDirectory(path.dirname(directory)); }
  }
}

async function checkDestination(filename: string, incoming: RegistrationBundle): Promise<void> {
  let handle;
  try { handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    if ((error as NodeJS.ErrnoException).code === "ELOOP") fail("BUNDLE_DELIVERY_UNSAFE");
    throw error;
  }
  try {
    const info = await handle.stat();
    if (!info.isFile()) fail("BUNDLE_DELIVERY_UNSAFE");
    // An invalid interrupted file may be replaced, but a valid identity must match.
    let existing: RegistrationBundle;
    try { existing = parseRegistrationBundle(await handle.readFile("utf8")); }
    catch { return; }
    if (IDENTITY.some(key => existing[key] !== incoming[key])) fail("BUNDLE_DELIVERY_CONFLICT");
  } finally { await handle.close(); }
}

/** Persist a previously verified bundle locally; never reads a chip or registers anything. */
export async function deliverRegistrationBundle(bundle: RegistrationBundle, directory = path.resolve("var/nfc-evidence")): Promise<string> {
  let incoming: RegistrationBundle;
  try { incoming = parseRegistrationBundle(JSON.stringify(bundle)); }
  catch { return fail("BUNDLE_DELIVERY_INVALID"); }
  const root = path.resolve(directory);
  await ensureRoot(root);
  const filename = path.join(root, `${incoming.publicRef}.registration.json`);
  const lock = path.join(root, `${incoming.publicRef}.delivery.lock`);
  let owner;
  try { owner = await open(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") fail("BUNDLE_DELIVERY_LOCKED"); throw error; }
  try {
    await owner.sync(); await syncDirectory(root);
    await checkDestination(filename, incoming);
    const temporary = path.join(root, `.${incoming.publicRef}.${randomUUID()}.registration.tmp`);
    let created = false;
    try {
      const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      created = true;
      try { await handle.writeFile(JSON.stringify(incoming, null, 2) + "\n"); await handle.sync(); }
      finally { await handle.close(); }
      await checkDestination(filename, incoming);
      await rename(temporary, filename);
      created = false;
      await syncDirectory(root);
      return filename;
    } finally { if (created) await unlink(temporary).catch(() => undefined); }
  } finally {
    await owner.close();
    await unlink(lock);
    await syncDirectory(root);
  }
}
